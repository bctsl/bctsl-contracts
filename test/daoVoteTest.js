const { utils, wallets } = require("@aeternity/aeproject");
const { assert } = require("chai");
const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
const { generateKeyPair } = require("@aeternity/aepp-sdk");

chai.use(chaiAsPromised);

const {
  getFilesystemDeduplicateNodeModules,
  getContractContent,
} = require("../.scripts/utils");

const {
  testAddVoteVoteApplySubject,
  testAddVote,
  toDecimals,
  timeoutReplacements,
  voteCloseTimeout,
  daoDonation,
} = require("./util");

const COMMUNITY_FACTORY_CONTRACT_SOURCE = "./contracts/CommunityFactory.aes";
const DAO_CONTRACT_SOURCE = "./contracts/DAO.aes";
const TOKEN_SALE_CONTRACT_SOURCE =
  "./contracts/AffiliationBondingCurveTokenSale.aes";

describe("DAO and Vote", () => {
  let aeSdk;
  let factoryContract, tokenSale, DAO;
  let expectedCollectionName;
  const receiver = generateKeyPair();

  before(async () => {
    aeSdk = await utils.getSdk();
    expectedCollectionName = `COLLECTION_TEST-${aeSdk.address}`
  });

  afterEach(async () => {
    await utils.rollbackSnapshot(aeSdk);
  });

  it("init via factory", async () => {
    factoryContract = await aeSdk.initializeContract({
      sourceCode: utils.getContractContent(COMMUNITY_FACTORY_CONTRACT_SOURCE),
      fileSystem: getFilesystemDeduplicateNodeModules(
        COMMUNITY_FACTORY_CONTRACT_SOURCE,
        timeoutReplacements,
      ),
    });

    await factoryContract.init( "BCTSL-TEST");

    const createCollection = await factoryContract.create_collection(
      "COLLECTION_TEST",
      20,
      [
        { SingleChar: [45] },
        { CharRangeFromTo: [48, 57] },
        { CharRangeFromTo: [65, 90] },
      ], {
        amount: 555n * 10n ** 18n,
      },
    );
    assert.equal(createCollection.decodedResult, expectedCollectionName)

    const deploy = await factoryContract.create_community(
      expectedCollectionName,
      "TEST",
      toDecimals(1, 18),
      false,
      new Map(),
      { amount: toDecimals(1, 18) + toDecimals(5, 14) },
    );

    assert.equal(deploy.result.returnType, "ok");

    tokenSale = await aeSdk.initializeContract({
      sourceCode: utils
        .getContractContent(TOKEN_SALE_CONTRACT_SOURCE)
        .replace(
          "contract AffiliationBondingCurveTokenSale",
          "main contract AffiliationBondingCurveTokenSale",
        ),
      fileSystem: getFilesystemDeduplicateNodeModules(
        TOKEN_SALE_CONTRACT_SOURCE,
      ),
      address: deploy.decodedResult[1],
      omitUnknown: true,
    });

    DAO = await aeSdk.initializeContract({
      sourceCode: utils
        .getContractContent(DAO_CONTRACT_SOURCE)
        .replace("contract DAO", "main contract DAO"),
      fileSystem: getFilesystemDeduplicateNodeModules(DAO_CONTRACT_SOURCE),
      address: deploy.decodedResult[0],
    });

    await utils.createSnapshot(aeSdk);
    await utils.awaitKeyBlocks(aeSdk, 1);
  });

  it("add_vote dao donation", async () => {
    const addVoteWithDaoDonation = await DAO.add_vote(
      {
        subject: { VotePayout: [receiver.publicKey] },
        description: "This Vote is created for Testing purposes only",
        link: "https://aeternity.com/",
      },
      { amount: daoDonation },
    );

    assert.equal(addVoteWithDaoDonation.result.returnType, "ok");

    await assert.isRejected(
      DAO.add_vote({
        subject: { VotePayout: [receiver.publicKey] },
        description: "This Vote is created for Testing purposes only",
        link: "https://aeternity.com/",
      }),
      "ADD_VOTE_DAO_DONATION_MISSMATCH",
    );

    await assert.isRejected(
      DAO.add_vote(
        {
          subject: { VotePayout: [receiver.publicKey] },
          description: "This Vote is created for Testing purposes only",
          link: "https://aeternity.com/",
        },
        { amount: daoDonation - 1n },
      ),
      "ADD_VOTE_DAO_DONATION_MISSMATCH",
    );

    await assert.isRejected(
      DAO.add_vote(
        {
          subject: { VotePayout: [receiver.publicKey] },
          description: "This Vote is created for Testing purposes only",
          link: "https://aeternity.com/",
        },
        { amount: daoDonation + 1n },
      ),
      "ADD_VOTE_DAO_DONATION_MISSMATCH",
    );
  });

  it("add_vote token holder requirement and threshold", async () => {
    const deploy = await factoryContract.create_community(
       expectedCollectionName,
      "TEST1",
      0,
      false,
      new Map(),
    );
    const otherDAO = await aeSdk.initializeContract({
      sourceCode: utils
        .getContractContent(DAO_CONTRACT_SOURCE)
        .replace("contract DAO", "main contract DAO"),
      fileSystem: getFilesystemDeduplicateNodeModules(DAO_CONTRACT_SOURCE),
      address: deploy.decodedResult[0],
    });
    const otherTokenSale = await aeSdk.initializeContract({
      sourceCode: utils
        .getContractContent(TOKEN_SALE_CONTRACT_SOURCE)
        .replace(
          "contract AffiliationBondingCurveTokenSale",
          "main contract AffiliationBondingCurveTokenSale",
        ),
      fileSystem: getFilesystemDeduplicateNodeModules(
        TOKEN_SALE_CONTRACT_SOURCE,
      ),
      address: deploy.decodedResult[1],
      omitUnknown: true,
    });

    await assert.isRejected(
      otherDAO.add_vote(
        {
          subject: { VotePayout: [receiver.publicKey] },
          description: "This Vote is created for Testing purposes only",
          link: "https://aeternity.com/",
        },
        { amount: daoDonation },
      ),
      "ADD_VOTE_TOKEN_HOLDER_MISSMATCH",
    );

    await otherTokenSale.buy(toDecimals(9, 17), { amount: toDecimals(1, 18) });

    await assert.isRejected(
      otherDAO.add_vote(
        {
          subject: { VotePayout: [receiver.publicKey] },
          description: "This Vote is created for Testing purposes only",
          link: "https://aeternity.com/",
        },
        { amount: daoDonation },
      ),
      "ADD_VOTE_TOKEN_HOLDER_MISSMATCH",
    );

    await otherTokenSale.buy(toDecimals(1, 17), { amount: toDecimals(1, 18) });

    const addVoteAfterTokenHolding = await otherDAO.add_vote(
      {
        subject: { VotePayout: [receiver.publicKey] },
        description: "This Vote is created for Testing purposes only",
        link: "https://aeternity.com/",
      },
      { amount: daoDonation },
    );

    assert.equal(addVoteAfterTokenHolding.result.returnType, "ok");
  });

  it("set_token_sale negative case", async () => {
    await assert.isRejected(
      DAO.set_token_sale(tokenSale.$options.address),
      "ONLY_CREATOR_CAN_SET_SALE",
    );
  });

  it("VotePayout: add_vote, vote, apply_vote_subject", async () => {
    assert.equal(await aeSdk.getBalance(receiver.publicKey), 0);
    const metadata = {
      subject: { VotePayout: [receiver.publicKey] },
      description: "This Vote is created for Testing purposes only",
      link: "https://aeternity.com/",
    };

    await testAddVoteVoteApplySubject(aeSdk, tokenSale, metadata, DAO);
    assert.equal(
      await aeSdk.getBalance(receiver.publicKey),
      toDecimals(375, 4) + daoDonation,
    );
    assert.equal(await aeSdk.getBalance(DAO.$options.address), 0);
  });

  it("VotePayoutAmount: add_vote, vote, apply_vote_subject", async () => {
    assert.equal(await aeSdk.getBalance(receiver.publicKey), 0);
    const metadata = {
      subject: { VotePayoutAmount: [receiver.publicKey, toDecimals(1, 14)] },
      description: "This Vote is created for Testing purposes only",
      link: "https://aeternity.com/",
    };

    await testAddVoteVoteApplySubject(aeSdk, tokenSale, metadata, DAO);
    assert.equal(await aeSdk.getBalance(receiver.publicKey), toDecimals(1, 14));
    assert.equal(
      await aeSdk.getBalance(DAO.$options.address),
      toDecimals(375, 4) + daoDonation - toDecimals(1, 14),
    );
  });

  it("ChangeDAO: add_vote, vote, apply_vote_subject", async () => {
    const newDAO = await aeSdk.initializeContract({
      sourceCode: utils
        .getContractContent(DAO_CONTRACT_SOURCE)
        .replace("contract DAO", "main contract DAO"),
      fileSystem: getFilesystemDeduplicateNodeModules(
        DAO_CONTRACT_SOURCE,
        timeoutReplacements,
      ),
    });

    await newDAO.init(
      tokenSale.$options.address,
      factoryContract.$options.address.replace("ct_", "ak_"),
    );
    const newDAOAddress = newDAO.$options.address.replace("ct_", "ak_");

    const metadata = {
      subject: { ChangeDAO: [newDAOAddress] },
      description: "This Vote is created for Testing purposes only",
      link: "https://aeternity.com/",
    };

    await testAddVoteVoteApplySubject(aeSdk, tokenSale, metadata, DAO);
    assert.equal(await aeSdk.getBalance(DAO.$options.address), 0);
    assert.equal((await tokenSale.owner()).decodedResult, newDAOAddress);
    assert.equal((await tokenSale.beneficiary()).decodedResult, newDAOAddress);
    assert.equal(
      await aeSdk.getBalance(newDAOAddress),
      toDecimals(375, 4) + daoDonation,
    );

    // check new DAO working
    const newReceiver = generateKeyPair().publicKey;
    await testAddVoteVoteApplySubject(
      aeSdk,
      tokenSale,
      {
        subject: { VotePayout: [newReceiver] },
        description: "This Vote is created for Testing purposes only",
        link: "https://aeternity.com/",
      },
      newDAO,
      5, // each time our util helper is called additional 4 tokens are bought, to have 8 > 55%, 5 is safe
    );

    assert.equal(
      await aeSdk.getBalance(newReceiver),
      (toDecimals(375, 4) + toDecimals(48, 5) + daoDonation * 2n).toString(),
    ); // amount from 5 + 4 buy
    assert.equal(await aeSdk.getBalance(newDAO.$options.address), 0);
  });

  it("apply_vote_subject negative cases", async () => {
    // after here: setup new vote, try to apply before final
    const { addVote, tokenVote, tokenContract } = await testAddVote(
      aeSdk,
      tokenSale,
      {
        subject: { VotePayout: [receiver.publicKey] },
        description: "This Vote is created for Testing purposes only",
        link: "https://aeternity.com/",
      },
      DAO,
    );

    await assert.isRejected(
      DAO.apply_vote_subject(addVote.decodedResult[0]),
      "VOTE_NOT_YET_FINAL",
    );

    await tokenContract.create_allowance(
      tokenVote.$options.address.replace("ct_", "ak_"),
      1,
    );
    await tokenVote.vote(false, 1);

    // after here: wait for final vote without any participation, thus agreement not reached
    await utils.awaitKeyBlocks(aeSdk, voteCloseTimeout);

    await assert.isRejected(
      DAO.apply_vote_subject(addVote.decodedResult[0]),
      "GREATER_55_PERCENT_AGREEMENT_REQUIRED",
    );

    // after here: setup new vote, only vote with fraction of stake, try to apply
    const {
      addVote: addOtherVote,
      tokenVote: otherTokenVote,
      tokenContract: otherTokenContract,
    } = await testAddVote(
      aeSdk,
      tokenSale,
      {
        subject: { VotePayout: [receiver.publicKey] },
        description: "This Vote is created for Testing purposes only",
        link: "https://aeternity.com/",
      },
      DAO,
    );

    await otherTokenContract.create_allowance(
      otherTokenVote.$options.address.replace("ct_", "ak_"),
      1,
    );

    await otherTokenVote.vote(true, 1);
    await utils.awaitKeyBlocks(aeSdk, voteCloseTimeout);

    await assert.isRejected(
      DAO.apply_vote_subject(addOtherVote.decodedResult[0]),
      "GREATER_10_PERCENT_STAKE_REQUIRED",
    );

    // after here: setup new vote, let it timeout, try to apply
    const customDAO = await aeSdk.initializeContract({
      sourceCode: getContractContent(
        DAO_CONTRACT_SOURCE,
        timeoutReplacements,
      ).replace("contract DAO", "main contract DAO"),
      fileSystem: getFilesystemDeduplicateNodeModules(
        DAO_CONTRACT_SOURCE,
        timeoutReplacements,
      ),
    });

    await customDAO.init(
      tokenSale.$options.address,
      factoryContract.$options.address.replace("ct_", "ak_"),
    );

    const customDAOAddVote = await customDAO.add_vote(
      {
        subject: { VotePayout: [receiver.publicKey] },
        description: "This Vote is created for Testing purposes only",
        link: "https://aeternity.com/",
      },
      { amount: daoDonation },
    );

    //wait for vote to be final
    await utils.awaitKeyBlocks(aeSdk, voteCloseTimeout);

    //wait for timeout to have been reached
    await utils.awaitKeyBlocks(aeSdk, voteCloseTimeout);

    await assert.isRejected(
      customDAO.apply_vote_subject(customDAOAddVote.decodedResult[0]),
      "VOTE_RESULT_TIMEOUTED",
    );

    // after here: setup new vote, vote, apply, try to apply again
    await utils.rollbackSnapshot(aeSdk);
    const {
      addVote: addSecondVote,
      tokenVote: secondTokenVote,
      tokenContract: secondTokenContract,
    } = await testAddVote(
      aeSdk,
      tokenSale,
      {
        subject: { VotePayout: [receiver.publicKey] },
        description: "This Vote is created for Testing purposes only",
        link: "https://aeternity.com/",
      },
      DAO,
    );

    await secondTokenContract.create_allowance(
      secondTokenVote.$options.address.replace("ct_", "ak_"),
      toDecimals(3, 18),
    );

    await secondTokenVote.vote(true, toDecimals(3, 18));
    await utils.awaitKeyBlocks(aeSdk, voteCloseTimeout);
    await DAO.apply_vote_subject(addSecondVote.decodedResult[0]);

    await assert.isRejected(
      DAO.apply_vote_subject(addSecondVote.decodedResult[0]),
      "VOTE_ALREADY_APPLIED",
    );
  });

  it("vote", async () => {
    const { tokenVote, tokenContract } = await testAddVote(
      aeSdk,
      tokenSale,
      {
        subject: { VotePayout: [receiver.publicKey] },
        description: "This Vote is created for Testing purposes only",
        link: "https://aeternity.com/",
      },
      DAO,
    );

    await tokenContract.create_allowance(
      tokenVote.$options.address.replace("ct_", "ak_"),
      1,
    );

    await assert.isRejected(
      tokenVote.vote(true, 2),
      "NON_NEGATIVE_VALUE_REQUIRED",
    );

    await tokenContract.change_allowance(
      tokenVote.$options.address.replace("ct_", "ak_"),
      1,
    );
    const vote = await tokenVote.vote(true, 2);
    assert.equal(vote.result.returnType, "ok");

    await assert.isRejected(tokenVote.vote(true, 2), "VOTER_ALREADY_VOTED");

    await utils.awaitKeyBlocks(aeSdk, voteCloseTimeout);
    await assert.isRejected(tokenVote.vote(true, 2), "VOTE_ALREADY_CLOSED");
  });

  it("has_voted (uses vote_accounts)", async () => {
    const { tokenVote, tokenContract } = await testAddVote(
      aeSdk,
      tokenSale,
      {
        subject: { VotePayout: [receiver.publicKey] },
        description: "This Vote is created for Testing purposes only",
        link: "https://aeternity.com/",
      },
      DAO,
    );

    assert.equal(
      (await tokenVote.has_voted(wallets[0].publicKey)).decodedResult,
      false,
    );

    await tokenContract.create_allowance(
      tokenVote.$options.address.replace("ct_", "ak_"),
      2,
    );
    await tokenVote.vote(true, 2);

    assert.equal(
      (await tokenVote.has_voted(wallets[0].publicKey)).decodedResult,
      true,
    );

    await tokenVote.revoke_vote();

    assert.equal(
      (await tokenVote.has_voted(wallets[0].publicKey)).decodedResult,
      false,
    );
  });

  it("revoke_vote, voted_option (uses vote_accounts)", async () => {
    const { tokenVote, tokenContract } = await testAddVote(
      aeSdk,
      tokenSale,
      {
        subject: { VotePayout: [receiver.publicKey] },
        description: "This Vote is created for Testing purposes only",
        link: "https://aeternity.com/",
      },
      DAO,
    );

    assert.equal(
      (await tokenVote.voted_option(wallets[0].publicKey)).decodedResult,
      undefined,
    );

    await assert.isRejected(tokenVote.revoke_vote(), "VOTER_NOT_VOTED");

    await tokenContract.create_allowance(
      tokenVote.$options.address.replace("ct_", "ak_"),
      2,
    );
    await tokenVote.vote(true, 2);

    assert.equal(
      (await tokenVote.voted_option(wallets[0].publicKey)).decodedResult,
      true,
    );

    await tokenVote.revoke_vote();

    assert.equal(
      (await tokenVote.voted_option(wallets[0].publicKey)).decodedResult,
      undefined,
    );

    await utils.awaitKeyBlocks(aeSdk, voteCloseTimeout);
    await assert.isRejected(tokenVote.revoke_vote(), "VOTE_ALREADY_CLOSED");
  });

  it("current_vote_state", async () => {
    const { tokenVote, tokenContract } = await testAddVote(
      aeSdk,
      tokenSale,
      {
        subject: { VotePayout: [receiver.publicKey] },
        description: "This Vote is created for Testing purposes only",
        link: "https://aeternity.com/",
      },
      DAO,
    );

    assert.deepEqual(
      (await tokenVote.current_vote_state()).decodedResult,
      new Map([
        [false, 0n],
        [true, 0n],
      ]),
    );

    await tokenContract.create_allowance(
      tokenVote.$options.address.replace("ct_", "ak_"),
      2,
    );
    await tokenVote.vote(true, 2);

    assert.deepEqual(
      (await tokenVote.current_vote_state()).decodedResult,
      new Map([
        [false, 0n],
        [true, 2n],
      ]),
    );
  });

  it("withdraw, has_withdrawn & negative cases", async () => {
    const { tokenVote, tokenContract } = await testAddVote(
      aeSdk,
      tokenSale,
      {
        subject: { VotePayout: [receiver.publicKey] },
        description: "This Vote is created for Testing purposes only",
        link: "https://aeternity.com/",
      },
      DAO,
    );

    assert.equal(
      (await tokenVote.has_withdrawn(wallets[0].publicKey)).decodedResult,
      undefined,
    );

    await tokenContract.create_allowance(
      tokenVote.$options.address.replace("ct_", "ak_"),
      2,
    );
    await tokenVote.vote(true, 2);

    await assert.isRejected(tokenVote.withdraw(), "VOTE_NOT_CLOSED");

    await utils.awaitKeyBlocks(aeSdk, voteCloseTimeout);

    const withdraw = await tokenVote.withdraw();
    assert.equal(withdraw.result.returnType, "ok");

    await assert.isRejected(tokenVote.withdraw(), "AMOUNT_ALREADY_WITHDRAWN");
  });

  it("is_closed, final_vote_state", async () => {
    const { tokenVote } = await testAddVote(
      aeSdk,
      tokenSale,
      {
        subject: { VotePayout: [receiver.publicKey] },
        description: "This Vote is created for Testing purposes only",
        link: "https://aeternity.com/",
      },
      DAO,
    );

    assert.equal((await tokenVote.is_closed()).decodedResult, false);
    assert.equal((await tokenVote.final_vote_state()).decodedResult, undefined);

    await utils.awaitKeyBlocks(aeSdk, voteCloseTimeout);

    assert.equal((await tokenVote.is_closed()).decodedResult, true);
    assert.deepEqual(
      (await tokenVote.final_vote_state()).decodedResult,
      new Map([
        [false, 0n],
        [true, 0n],
      ]),
    );
  });
});
