const { assert } = require("chai");
const { utils } = require("@aeternity/aeproject");
const FungibleTokenFullAci = require("aeternity-fungible-token/generated/FungibleTokenFull.aci.json");
const BigNumber = require("bignumber.js");
const { toAettos } = require("@aeternity/aepp-sdk");

const BONDING_CURVE_EXPONENTIAL_CONTRACT_SOURCE =
  "./contracts/BondingCurveExponential.aes";

const buyPrice = BigInt(24 * 10 ** 7);
const affiliateAmount = BigInt(24 * 5 * 10 ** 4);
const spreadAmount = BigInt(24 * 5 * 10 ** 4);

const curves = [
  {
    type: "TAYLOR_EXPONENTIAL_V1",
    source: BONDING_CURVE_EXPONENTIAL_CONTRACT_SOURCE,
    buyCount: BigInt(2 * 10 ** 18),
    buyAmount: buyPrice + affiliateAmount, // price + affiliate amount 1%
    affiliationTreasuryAmount: affiliateAmount,
    reserveAmount: buyPrice - spreadAmount, // price - spread 1%
    beneficiaryAmount: spreadAmount,
    sellReturn: buyPrice - spreadAmount, // price - spread 1%
  },
];

const voteCloseTimeout = 10;
const timeoutReplacements = [
  ["(60 / 3) * 24 * 7 * 2", "10"],
  ["(60 / 3) * 24 * 2", "10"],
];
const daoDonation = 555n * 10n ** 18n;

const DAO_VOTE_CONTRACT_SOURCE = "./contracts/DAOVote.aes";

const testAddVote = async (aeSdk, tokenSale, metadata, useDAO) => {
  const addVote = await useDAO.add_vote(metadata, {
    amount: daoDonation,
  });
  assert.equal(addVote.result.returnType, "ok");
  assert.isTrue(addVote.decodedResult[1].startsWith("ct_"));

  const tokenVote = await aeSdk.initializeContract({
    sourceCode: utils
      .getContractContent(DAO_VOTE_CONTRACT_SOURCE)
      .replace("contract DAOVote", "main contract DAOVote"),
    fileSystem: utils.getFilesystem(DAO_VOTE_CONTRACT_SOURCE),
    address: addVote.decodedResult[1],
  });
  const buy_amount = toDecimals(4);
  await tokenSale.buy(buy_amount, {
    amount: toDecimals(1),
  }); // just overpay
  const tokenContractAddress = await tokenSale.token_contract();

  const tokenContract = await aeSdk.initializeContract({
    aci: FungibleTokenFullAci,
    address: tokenContractAddress.decodedResult,
  });

  return { addVote, tokenVote, tokenContract };
};

const toDecimals = (amount, decimals) =>
  BigInt(amount) * BigInt(10) ** BigInt(decimals || 18);

const testAddVoteVoteApplySubject = async (
  aeSdk,
  tokenSale,
  metadata,
  useDAO,
  amount = 4,
) => {
  const { addVote, tokenVote, tokenContract } = await testAddVote(
    aeSdk,
    tokenSale,
    metadata,
    useDAO,
    amount,
  );

  await tokenContract.create_allowance(
    tokenVote.$options.address.replace("ct_", "ak_"),
    toDecimals(amount),
  );

  const vote = await tokenVote.vote(true, toDecimals(amount));
  assert.equal(vote.result.returnType, "ok");

  await utils.awaitKeyBlocks(aeSdk, voteCloseTimeout);

  try {
    const applyVoteSubject = await useDAO.apply_vote_subject(
      addVote.decodedResult[0],
    );
    assert.equal(applyVoteSubject.result.returnType, "ok");
    console.log(
      "applyVoteSubject gasUsed:",
      applyVoteSubject.result.gasUsed,
      metadata,
    );

    return { addVote, tokenVote, tokenContract, applyVoteSubject };
  } catch (e) {
    throw e;
  } finally {
    await tokenVote.withdraw();
  }
};

const affiliationPercentagePrecision = 100000n;

const calculateRewardAmount = (totalAmountInAettos, rewardPercentage) =>
  (totalAmountInAettos * rewardPercentage) / affiliationPercentagePrecision;

const toBigIntAettos = (amountInAe) => BigInt(toAettos(amountInAe));

const sleepBlocks = async (aeSdk, timeInMilliSeconds, noOfBlocks) => {
  await new Promise((r) => setTimeout(r, timeInMilliSeconds));
  await utils.awaitKeyBlocks(aeSdk, noOfBlocks);
};

const debugAmounts = async (bondingCurveContract, total_supply, amounts) => {
  for (const amount of amounts) {
    try {
      const amount_decimals = BigInt(amount) * 10n ** 18n;
      const price = await bondingCurveContract
        .calculate_buy_price(total_supply, amount_decimals)
        .then((res) => {
          console.log(
            "buy",
            res.result.gasUsed,
            new BigNumber(res.decodedResult).shiftedBy(-18).toString(),
          );
          return new BigNumber(res.decodedResult).shiftedBy(-18);
        });

      const sellReturn = await bondingCurveContract
        .calculate_sell_return(total_supply + amount_decimals, amount_decimals)
        .then((res) => {
          //console.log("sell", res.decodedResult);
          return new BigNumber(res.decodedResult).shiftedBy(-18);
        });

      const buyCurve = await bondingCurveContract
        .buy_curve(total_supply + amount_decimals)
        .then((res) => {
          //console.log(res.decodedResult);
          return new BigNumber(res.decodedResult.Pos[0]).div(
            res.decodedResult.Pos[1],
          );
        });
      const sellCurve = await bondingCurveContract
        .sell_curve(total_supply + amount_decimals)
        .then((res) => {
          return new BigNumber(res.decodedResult.Pos[0]).div(
            res.decodedResult.Pos[1],
          );
        });

      console.log(
        new BigNumber(amount).toFormat(),
        "Tokens for",
        price.toFormat(7),
        "AE (Spread",
        price.minus(sellReturn).toFormat(7),
        "AE) at",
        buyCurve.toFormat(7),
        "AE/Token (Sell Price:",
        sellCurve.toFormat(7),
        "AE/Token)",
      );
    } catch (e) {
      if (!e.message.includes("MINIMUM_TOKENS_REQUIRED")) throw e;
    }
  }
};

module.exports = {
  curves,
  BONDING_CURVE_EXPONENTIAL_CONTRACT_SOURCE,
  testAddVoteVoteApplySubject,
  testAddVote,
  toDecimals,
  voteCloseTimeout,
  timeoutReplacements,
  daoDonation,
  calculateRewardAmount,
  toBigIntAettos,
  sleepBlocks,
  debugAmounts,
};
