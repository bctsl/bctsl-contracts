const { assert } = require("chai");
const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
const { utils } = require("@aeternity/aeproject");
const {
  toBigIntAettos,
  calculateRewardAmount,
  sleepBlocks,
} = require("./util");
const { generateKeyPair, MemoryAccount } = require("@aeternity/aepp-sdk");
const BigNumber = require("bignumber.js");

chai.use(chaiAsPromised);

const AFFILIATION_SYSTEM_CONTRACT_SOURCE =
  "./contracts/AffiliationTreasury.aes";

const fileSystem = utils.getFilesystem(AFFILIATION_SYSTEM_CONTRACT_SOURCE);
const sourceCode = utils.getContractContent(AFFILIATION_SYSTEM_CONTRACT_SOURCE);
const aeSdk = utils.getSdk();
const inviter = utils.getDefaultAccounts()[1];
const invitee = utils.getDefaultAccounts()[2];

async function initializeContract() {
  const contract = await aeSdk.initializeContract({
    sourceCode,
    fileSystem,
  });
  await contract.init();
  return contract;
}

describe("AffiliationTreasury", () => {
  describe("Invite", () => {
    let contract;

    before(async () => {
      contract = await initializeContract();
    });

    it("invite user", async () => {
      const {
        result: { returnType },
      } = await contract.register_invitation(inviter.address, {
        onAccount: invitee,
      });
      assert.equal(returnType, "ok");
      const { decodedResult } = await contract.get_direct_inviter(
        invitee.address,
      );
      assert.equal(decodedResult, inviter.address);
    });

    it("duplicate inviter", async () => {
      await assert.isRejected(
        contract.register_invitation(inviter.address, {
          onAccount: invitee,
        }),
        "INVITEE_ALREADY_REGISTERED",
      );
    });

    it("register invitation flow", async () => {
      const redemptionFeeCover = 10n ** 15n;
      const inviteAmount = 10n ** 17n;

      const inviteeKeypair = generateKeyPair();
      const tempInviteKeypair = generateKeyPair();

      await assert.isRejected(
        contract.register_invitation_code(
          tempInviteKeypair.publicKey,
          redemptionFeeCover - 1n,
          0n,
          {
            onAccount: inviter,
            amount: redemptionFeeCover - 1n,
          },
        ),
        "MINIMUM_REDEMPTION_AND_FEE_NOT_MEET",
      );

      await assert.isRejected(
        contract.register_invitation_code(
          tempInviteKeypair.publicKey,
          redemptionFeeCover,
          inviteAmount,
          {
            onAccount: inviter,
            amount: redemptionFeeCover + inviteAmount - 1n,
          },
        ),
        "INVITATION_AMOUNT_AND_FEE_NOT_MATCHING",
      );

      const registeredInvitation = await contract.register_invitation_code(
        tempInviteKeypair.publicKey,
        redemptionFeeCover,
        inviteAmount,
        { onAccount: inviter, amount: redemptionFeeCover + inviteAmount },
      );

      assert.equal(registeredInvitation.result.returnType, "ok");
      assert.equal(
        registeredInvitation.decodedEvents[0].name,
        "InvitationRegistered",
      );
      assert.equal(
        registeredInvitation.decodedEvents[0].args[0],
        inviter.address,
      );
      assert.equal(
        registeredInvitation.decodedEvents[0].args[1],
        tempInviteKeypair.publicKey,
      );
      assert.equal(registeredInvitation.decodedEvents[0].args[2], inviteAmount);

      assert.equal(
        await aeSdk.getBalance(tempInviteKeypair.publicKey),
        redemptionFeeCover,
      );
      assert.deepEqual(
        await contract
          .invitation_codes()
          .then(({ decodedResult }) => decodedResult),
        new Map([
          [tempInviteKeypair.publicKey, [inviter.address, inviteAmount, false]],
        ]),
      );

      await assert.isRejected(
        contract.register_invitation_code(
          tempInviteKeypair.publicKey,
          redemptionFeeCover,
          0n,
          {
            onAccount: inviter,
            amount: redemptionFeeCover,
          },
        ),
        "INVITATION_ALREADY_REGISTERED",
      );

      const previousInviterBalance = await aeSdk.getBalance(inviter.address);
      const revokeInvitationCode = await contract.revoke_invitation_code(
        tempInviteKeypair.publicKey,
        { onAccount: inviter },
      );
      assert.equal(revokeInvitationCode.result.returnType, "ok");
      assert.equal(
        revokeInvitationCode.decodedEvents[0].name,
        "InvitationRevoked",
      );
      assert.equal(
        revokeInvitationCode.decodedEvents[0].args[0],
        tempInviteKeypair.publicKey,
      );
      assert.equal(
        revokeInvitationCode.decodedEvents[0].args[1],
        inviter.address,
      );

      assert.equal(
        BigInt(
          new BigNumber(await aeSdk.getBalance(inviter.address))
            .minus(previousInviterBalance)
            .toNumber(),
        ),
        inviteAmount -
          BigInt(revokeInvitationCode.tx.encodedTx.fee) -
          BigInt(revokeInvitationCode.result.gasUsed) *
            BigInt(revokeInvitationCode.result.gasPrice),
      );

      assert.equal(
        await aeSdk.getBalance(tempInviteKeypair.publicKey),
        redemptionFeeCover,
      );
      assert.deepEqual(
        await contract
          .invitation_codes()
          .then(({ decodedResult }) => decodedResult),
        new Map([]),
      );
      await contract.register_invitation_code(
        tempInviteKeypair.publicKey,
        redemptionFeeCover,
        inviteAmount,
        { onAccount: inviter, amount: redemptionFeeCover + inviteAmount },
      );

      await assert.isRejected(
        contract.redeem_invitation_code(inviteeKeypair.publicKey),
        "INVITATION_NOT_REGISTERED",
      );

      await assert.isRejected(
        contract.revoke_invitation_code(inviteeKeypair.publicKey),
        "INVITATION_NOT_REGISTERED",
      );

      await assert.isRejected(
        contract.revoke_invitation_code(tempInviteKeypair.publicKey),
        "CALLER_NOT_INVITER",
      );

      await assert.isRejected(
        contract.redeem_invitation_code(inviter.address, {
          onAccount: new MemoryAccount(tempInviteKeypair.secretKey),
        }),
        "INVITER_EQUAL_INVITEE",
      );

      const redeemInvitation = await contract.redeem_invitation_code(
        inviteeKeypair.publicKey,
        { onAccount: new MemoryAccount(tempInviteKeypair.secretKey) },
      );
      assert.equal(redeemInvitation.result.returnType, "ok");
      assert.equal(
        redeemInvitation.decodedEvents[0].name,
        "InvitationRedeemed",
      );
      assert.equal(
        redeemInvitation.decodedEvents[0].args[0],
        inviteeKeypair.publicKey,
      );
      assert.equal(redeemInvitation.decodedEvents[0].args[1], inviter.address);
      assert.equal(
        redeemInvitation.decodedEvents[0].args[2],
        tempInviteKeypair.publicKey,
      );

      assert.deepEqual(
        await contract
          .invitation_codes()
          .then(({ decodedResult }) => decodedResult),
        new Map([
          [tempInviteKeypair.publicKey, [inviter.address, inviteAmount, true]],
        ]),
      );
      assert.equal(
        await contract
          .get_direct_inviter(inviteeKeypair.publicKey)
          .then(({ decodedResult }) => decodedResult),
        inviter.address,
      );
      assert.equal(
        await aeSdk.getBalance(inviteeKeypair.publicKey),
        inviteAmount,
      );

      await assert.isRejected(
        contract.redeem_invitation_code(inviteeKeypair.publicKey, {
          onAccount: new MemoryAccount(tempInviteKeypair.secretKey),
        }),
        "ALREADY_REDEEMED",
      );

      await assert.isRejected(
        contract.revoke_invitation_code(tempInviteKeypair.publicKey, {
          onAccount: inviter,
        }),
        "ALREADY_REDEEMED",
      );

      const otherTempInviteKeypair = generateKeyPair();
      await contract.register_invitation_code(
        otherTempInviteKeypair.publicKey,
        redemptionFeeCover,
        inviteAmount,
        {
          onAccount: inviter,
          amount: redemptionFeeCover + inviteAmount,
        },
      );
      await assert.isRejected(
        contract.redeem_invitation_code(inviteeKeypair.publicKey, {
          onAccount: new MemoryAccount(otherTempInviteKeypair.secretKey),
        }),
        "INVITEE_ALREADY_REGISTERED",
      );
    });
  });

  describe("Reward requirements", () => {
    let contract;
    let treasuryAffiliationPercentage;
    let treasuryAffiliationPercentages;

    const invite = (invitee, inviter) =>
      contract.register_invitation(inviter.address, {
        onAccount: invitee,
      });
    const recordSale = (buyer, tokenSaleAmount, amount) =>
      contract.record_sale_transaction(buyer.address, tokenSaleAmount, {
        onAccount: buyer,
        amount,
      });
    const getAccumulatedRewards = (address) =>
      contract.get_accumulated_rewards(address);

    before(async () => {
      contract = await initializeContract();
      treasuryAffiliationPercentage = (
        await contract.get_affiliation_fee_percentage()
      ).decodedResult;
      treasuryAffiliationPercentages = (
        await contract.get_affiliation_fee_percentages()
      ).decodedResult;
      await contract.register_invitation(inviter.address, {
        onAccount: invitee,
      });
      await utils.createSnapshot(aeSdk);
    });

    afterEach(async () => {
      await utils.rollbackSnapshot(aeSdk);
    });

    it("amount sent is not as expected as the affiliation reward requirement 1% of the buy volume", async () => {
      const tokenSaleAmount = toBigIntAettos(11);

      await assert.isFulfilled(
        recordSale(
          invitee,
          tokenSaleAmount,
          calculateRewardAmount(tokenSaleAmount, treasuryAffiliationPercentage),
        ).catch(console.error),
      );

      await assert.isRejected(
        recordSale(
          invitee,
          tokenSaleAmount,
          calculateRewardAmount(
            tokenSaleAmount,
            treasuryAffiliationPercentage,
          ) - 1n,
        ),
        "AMOUNT_IS_NOT_EQUAL_TO_THE_AFFILIATION_PERCENTAGE",
      );
    });

    it("record token sale, accumulate rewards must be 0.3% of the token value", async () => {
      const tokenSaleAmount = toBigIntAettos(11);

      const treasuryFee = calculateRewardAmount(
        tokenSaleAmount,
        treasuryAffiliationPercentage,
      );
      const {
        result: { returnType },
      } = await recordSale(invitee, tokenSaleAmount, treasuryFee);
      assert.equal(returnType, "ok");
      await assert.eventually.equal(
        getAccumulatedRewards(inviter.address).then(
          (result) => result.decodedResult,
        ),
        calculateRewardAmount(
          tokenSaleAmount,
          treasuryAffiliationPercentages[0],
        ),
      );
    });

    it("record token sale, the accumulated rewards across the affiliation tree are respectively 0.3%, 0.125%, 0.050%, and 0.025% of the token sale amount", async () => {
      const tokenSaleAmount = toBigIntAettos(100);

      const users = utils.getDefaultAccounts().slice(3, 8);
      for (const [index, inviter] of users.slice(0, -1).entries()) {
        await invite(users[index + 1], inviter);
      }
      await recordSale(
        utils.getDefaultAccounts()[7],
        tokenSaleAmount,
        calculateRewardAmount(tokenSaleAmount, treasuryAffiliationPercentage),
      );

      for (const [i, buyer] of users.slice(0, -1).reverse().entries()) {
        const accumulatedReward = getAccumulatedRewards(buyer.address).then(
          (result) => result.decodedResult,
        );

        await assert.eventually.equal(
          accumulatedReward,
          calculateRewardAmount(
            tokenSaleAmount,
            treasuryAffiliationPercentages[i],
          ),
        );
      }
    });

    it("Record token sale, the accumulated rewards for each inviter in the affiliation tree are correctly calculated and match the expected values based on the specified affiliation percentages and depth deltas", async () => {
      const tokenSaleAmount = toBigIntAettos(100);

      const users = utils.getDefaultAccounts().slice(3, 8);
      for (const [index, user] of users.slice(0, -1).entries()) {
        await invite(users[index + 1], user);
      }

      for (const user of utils.getDefaultAccounts()) {
        await recordSale(
          user,
          tokenSaleAmount,
          calculateRewardAmount(tokenSaleAmount, treasuryAffiliationPercentage),
        );
      }

      let baseAffiliationPercentage = 500n;

      for (const [i, user] of users.slice(0, -1).entries()) {
        const expectedReward = calculateRewardAmount(
          tokenSaleAmount,
          baseAffiliationPercentage,
        );
        const accumulatedReward = await getAccumulatedRewards(
          user.address,
        ).then((result) => result.decodedResult);

        await assert.equal(accumulatedReward, expectedReward);
        baseAffiliationPercentage -=
          treasuryAffiliationPercentages[
            treasuryAffiliationPercentages.length - 1 - i
          ];
      }
    });
  });

  describe("Trigger payout", () => {
    let contract;
    let treasuryAffiliationFeePercentage;
    let treasuryAffiliationFeePercentages;

    const recordSale = (buyer, tokenSaleAmount, amount) =>
      contract.record_sale_transaction(buyer.address, tokenSaleAmount, {
        onAccount: buyer,
        amount,
      });
    const getAccumulatedRewards = (address) =>
      contract.get_accumulated_rewards(address);

    before(async () => {
      contract = await initializeContract();
      treasuryAffiliationFeePercentage =
        (await contract.get_affiliation_fee_percentage()).decodedResult *
        (await contract.get_affiliation_fee_precision()).decodedResult;
      treasuryAffiliationFeePercentages = (
        await contract.get_affiliation_fee_percentages()
      ).decodedResult;
      await utils.createSnapshot(aeSdk);
      await contract.register_invitation(inviter.address, {
        onAccount: invitee,
      });
    });

    afterEach(async () => {
      await utils.rollbackSnapshot(aeSdk);
    });

    it("the payout cannot be triggered if in the period the user and other minimum 4 other accounts did not buy", async () => {
      const tokenSaleAmount = toBigIntAettos(11);

      const uniqueTokenBuyers = utils.getDefaultAccounts().slice(3, 6); // 3 accounts
      assert.equal(uniqueTokenBuyers.length, 3);
      for (const buyer of uniqueTokenBuyers) {
        await contract.register_invitation(inviter.address, {
          onAccount: buyer,
        });
        await recordSale(
          buyer,
          tokenSaleAmount,
          calculateRewardAmount(
            tokenSaleAmount,
            treasuryAffiliationFeePercentage,
          ),
        );
      }
      assert.isRejected(
        contract.withdraw({ onAccount: inviter }),
        "MINIMUM_ACCOUNTS_THRESHOLD_NOT_REACHED",
      );
    });

    it("the payout cannot be triggered if in the period the users did not buy token worth more than 10 AE each", async () => {
      const tokenSaleAmount = toBigIntAettos(9);

      const uniqueTokenBuyers = utils.getDefaultAccounts().slice(3, 7); // 4 accounts
      assert.equal(uniqueTokenBuyers.length, 4);
      for (const buyer of uniqueTokenBuyers) {
        await contract.register_invitation(inviter.address, {
          onAccount: buyer,
        });
        await recordSale(
          buyer,
          tokenSaleAmount,
          calculateRewardAmount(
            tokenSaleAmount,
            treasuryAffiliationFeePercentage,
          ),
        );
      }
      assert.isRejected(
        contract.withdraw({ onAccount: inviter }),
        "MINIMUM_ACCOUNTS_THRESHOLD_NOT_REACHED",
      );
    });

    it("the payout can be triggered if in the period the user and other minimum 4 other accounts buy tokens worth more than 10 AE each", async () => {
      const tokenSaleAmount = toBigIntAettos(11);

      const uniqueTokenBuyers = utils.getDefaultAccounts().slice(3, 7); // 4 accounts
      assert.equal(uniqueTokenBuyers.length, 4);
      for (const buyer of uniqueTokenBuyers) {
        await contract.register_invitation(inviter.address, {
          onAccount: buyer,
        });
        await recordSale(
          buyer,
          tokenSaleAmount,
          calculateRewardAmount(
            tokenSaleAmount,
            treasuryAffiliationFeePercentage,
          ),
        );
      }

      const { decodedResult: totalAccumulatedRewardsBefore } =
        await getAccumulatedRewards(inviter.address);
      assert.equal(
        totalAccumulatedRewardsBefore,
        BigInt(uniqueTokenBuyers.length) *
          calculateRewardAmount(
            tokenSaleAmount,
            treasuryAffiliationFeePercentages[0],
          ),
      );

      const balanceBefore = BigInt(await aeSdk.getBalance(inviter.address));
      const withdraw = await contract.withdraw({
        onAccount: inviter,
      });
      const balanceAfter = BigInt(await aeSdk.getBalance(inviter.address));
      assert.equal(
        balanceAfter,
        balanceBefore +
          BigInt(totalAccumulatedRewardsBefore) -
          BigInt(withdraw.tx.encodedTx.fee) -
          BigInt(withdraw.result.gasUsed) * BigInt(withdraw.result.gasPrice),
      );

      await assert.eventually.equal(
        contract
          .get_accumulated_rewards(inviter.address)
          .then((result) => result.decodedResult),
        0n,
      );
    });
  });

  describe("Rewards expire over time", () => {
    let contract;

    before(async () => {
      contract = await aeSdk.initializeContract({
        sourceCode: sourceCode.replace(
          "let payout_period_interval = 2592000000",
          "let payout_period_interval = 25920",
        ), // Approximately 30 secs
        fileSystem,
      });
      await contract.init();
    });

    it("Rewards can be claimed within a month and have an additional grace period before expiration", async () => {
      await contract.register_invitation(inviter.address, {
        onAccount: invitee,
      });

      const tokenSaleAmount = toBigIntAettos(10);
      const treasuryAffiliationFeePercentage = (
        await contract.get_affiliation_fee_percentage()
      ).decodedResult;
      const treasuryAffiliationFeePercentages = (
        await contract.get_affiliation_fee_percentages()
      ).decodedResult;

      await contract.record_sale_transaction(invitee.address, tokenSaleAmount, {
        onAccount: invitee,
        amount: calculateRewardAmount(
          tokenSaleAmount,
          treasuryAffiliationFeePercentage,
        ),
      });
      await assert.eventually.equal(
        contract
          .get_accumulated_rewards(inviter.address)
          .then((result) => result.decodedResult),
        calculateRewardAmount(
          tokenSaleAmount,
          treasuryAffiliationFeePercentages[0],
        ),
        "initial reward must be 0.3% of the token sale amount",
      );

      await sleepBlocks(aeSdk, 25920, 0);
      await contract.record_sale_transaction(invitee.address, tokenSaleAmount, {
        onAccount: invitee,
        amount: calculateRewardAmount(
          tokenSaleAmount,
          treasuryAffiliationFeePercentage,
        ),
      });
      await assert.eventually.equal(
        contract
          .get_accumulated_rewards(inviter.address)
          .then((result) => result.decodedResult),
        calculateRewardAmount(
          tokenSaleAmount,
          treasuryAffiliationFeePercentages[0] +
            treasuryAffiliationFeePercentages[0],
        ),
        "The current reward should consist of the initial 0.3% plus an additional 0.3% of the token sale amount, provided that the reward from the first sale is within the grace period and the reward from the recent sale is within the valid period",
      );

      await sleepBlocks(aeSdk, 25920, 1);
      await assert.eventually.equal(
        contract
          .get_accumulated_rewards(inviter.address)
          .then((result) => result.decodedResult),
        calculateRewardAmount(
          tokenSaleAmount,
          treasuryAffiliationFeePercentages[0],
        ),
        "initial reward must be expired",
      );

      await sleepBlocks(aeSdk, 25920, 1);
      await assert.eventually.equal(
        contract
          .get_accumulated_rewards(inviter.address)
          .then((result) => result.decodedResult),
        calculateRewardAmount(tokenSaleAmount, 0n),
        "all the rewards must be expired",
      );
    });
  });
});
