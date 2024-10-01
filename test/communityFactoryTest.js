const { utils, wallets } = require("@aeternity/aeproject");
const { assert } = require("chai");
const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");

const {
  testAddVoteVoteApplySubject,
  timeoutReplacements,
  toDecimals,
} = require("./util");
const { generateKeyPair } = require("@aeternity/aepp-sdk");
const { getFilesystemDeduplicateNodeModules } = require("../.scripts/utils");
const TokenSaleACI = require("../generated/TokenSale.aci.json");
const FungibleTokenFullAci = require("aeternity-fungible-token/generated/FungibleTokenFull.aci.json");

chai.use(chaiAsPromised);

const DAO_CONTRACT_SOURCE = "./contracts/DAO.aes";
const COMMUNITY_FACTORY_CONTRACT_SOURCE = "./contracts/CommunityFactory.aes";
const COMMUNITY_MANAGEMENT_CONTRACT_SOURCE =
  "./contracts/CommunityManagement.aes";
const AFFILIATION_BONDING_CURVE_TOKEN_SALE_CONTRACT_SOURCE =
  "./contracts/AffiliationBondingCurveTokenSale.aes";

describe(`CommunityFactory and CommunityManagement, community-related DAO Vote`, () => {
  let aeSdk;
  let factoryContract,
    tokenSale,
    dao,
    newDAO,
    communityManagement,
    tokenSale2Address,
    communityManagement2Address,
    protocolDaoTokenContract,
    expectedCollectionName;

  before(async () => {
    aeSdk = await utils.getSdk();
    expectedCollectionName = `COLLECTION_TEST-${aeSdk.address}`
  });

  it("init", async () => {
    factoryContract = await aeSdk.initializeContract({
      sourceCode: utils.getContractContent(COMMUNITY_FACTORY_CONTRACT_SOURCE),
      fileSystem: getFilesystemDeduplicateNodeModules(
        COMMUNITY_FACTORY_CONTRACT_SOURCE,
        timeoutReplacements,
      ),
    });

    const init = await factoryContract.init("BCTSL-TEST");
    assert.equal(init.result.returnType, "ok");

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

    const { decodedResult } = await factoryContract.protocol_dao_token();

    protocolDaoTokenContract = await aeSdk.initializeContract({
      aci: FungibleTokenFullAci,
      address: decodedResult,
    });
  });

  describe(`CommunityFactory`, async () => {
    it("create_community", async () => {
      await assert.isRejected(
        factoryContract.create_community(
          expectedCollectionName,
          `VERY-LONG-NAME-GREATER-20-CHARS`,
          0, // initial buy is tested and unchanged from CommunityFactory
          false,
          new Map(),
        ),
        "NAME_TOO_LONG",
      );

      await assert.isRejected(
        factoryContract.create_community(
          expectedCollectionName,
          `TC 1`,
          0, // initial buy is tested and unchanged from CommunityFactory
          false,
          new Map(),
        ),
        "NAME_NOT_ALLOWED_CHAR",
      );

      await assert.isRejected(
        factoryContract.create_community(
          expectedCollectionName,
          `tc1`,
          0, // initial buy is tested and unchanged from CommunityFactory
          false,
          new Map(),
        ),
        "NAME_NOT_ALLOWED_CHAR",
      );

      await assert.isRejected(
        factoryContract.create_community(
          expectedCollectionName,
          `a`,
          0, // initial buy is tested and unchanged from CommunityFactory
          false,
          new Map(),
        ),
        "NAME_NOT_ALLOWED_CHAR",
      );

      await assert.isRejected(
        factoryContract.create_community(
          expectedCollectionName,
          `z`,
          0, // initial buy is tested and unchanged from CommunityFactory
          false,
          new Map(),
        ),
        "NAME_NOT_ALLOWED_CHAR",
      );

      await assert.isRejected(
        factoryContract.create_community(
          expectedCollectionName,
          `#`,
          0, // initial buy is tested and unchanged from CommunityFactory
          false,
          new Map(),
        ),
        "NAME_NOT_ALLOWED_CHAR",
      );

      await assert.isRejected(
        factoryContract.create_community(
          expectedCollectionName,
          `_`,
          0, // initial buy is tested and unchanged from CommunityFactory
          false,
          new Map(),
        ),
        "NAME_NOT_ALLOWED_CHAR",
      );

      const createCommunity = await factoryContract.create_community(
        expectedCollectionName,
        `TC1`,
        0, // initial buy is tested and unchanged from CommunityFactory
        false,
        new Map(),
      );

      assert.equal(createCommunity.result.returnType, "ok");
      assert.lengthOf(createCommunity.decodedResult, 3);
      await assert.eventually.equal(
        factoryContract
          .has_community(expectedCollectionName, `TC1`)
          .then((result) => result.decodedResult),
        true,
      );

      await assert.isRejected(
        factoryContract.create_community(
          expectedCollectionName,
          `TC2`,
          toDecimals(1, 18),
          false,
          new Map(),
        ),
        "VALUE_HAS_TO_BE_GREATER_THAN_BUY_PRICE",
      );
      await assert.isRejected(
        factoryContract.create_community(
          expectedCollectionName,
          `TC2`,
          toDecimals(1, 18),
          false,
          new Map(),
          {
            amount: toDecimals(1, 8) + toDecimals(5, 5) - 1n,
          },
        ),
        "VALUE_HAS_TO_BE_GREATER_THAN_BUY_PRICE",
      );

      const createCommunityWithInitialBuy =
        await factoryContract.create_community(
          expectedCollectionName,
          `TC1I`,
          toDecimals(1, 18),
          false,
          new Map(),
          { amount: toDecimals(2, 8) + toDecimals(5, 5) },
        );

      assert.equal(createCommunityWithInitialBuy.result.returnType, "ok");
      tokenSale2Address = createCommunityWithInitialBuy.decodedResult[1];
      communityManagement2Address =
        createCommunityWithInitialBuy.decodedResult[2];

      // Test Mint of platform dao tokens
      console.log(createCommunityWithInitialBuy.decodedEvents);
      assert.equal(createCommunityWithInitialBuy.decodedEvents[5].name, "Mint");
      assert.equal(
        createCommunityWithInitialBuy.decodedEvents[1].args[0],
        utils.getDefaultAccounts()[0].address,
      );
      assert.equal(
        createCommunityWithInitialBuy.decodedEvents[1].args[1],
        (toDecimals(11, 7) + (toDecimals(11, 7) * 500n) / 100000n) * 1000n,
      );

      await assert.eventually.equal(
        factoryContract
          .has_community(expectedCollectionName,`TC1I`)
          .then((result) => result.decodedResult),
        true,
      );
      await assert.eventually.equal(
        factoryContract
          .has_community(expectedCollectionName,`TC2`)
          .then((result) => result.decodedResult),
        false,
      );

      communityManagement = await aeSdk.initializeContract({
        sourceCode: utils.getContractContent(
          COMMUNITY_MANAGEMENT_CONTRACT_SOURCE,
        ),
        fileSystem: getFilesystemDeduplicateNodeModules(
          COMMUNITY_MANAGEMENT_CONTRACT_SOURCE,
        ),
        address: createCommunity.decodedResult[2],
      });

      tokenSale = await aeSdk.initializeContract({
        aci: TokenSaleACI,
        address: createCommunity.decodedResult[1],
        omitUnknown: true,
      });

      dao = await aeSdk.initializeContract({
        sourceCode: utils
          .getContractContent(DAO_CONTRACT_SOURCE)
          .replace("contract DAO", "main contract DAO"),
        fileSystem: getFilesystemDeduplicateNodeModules(DAO_CONTRACT_SOURCE),
        address: createCommunity.decodedResult[0],
      });
    });

    it("token_sale_registry", async () => {
      const tokenSaleRegistry = await factoryContract.token_sale_registry(expectedCollectionName);

      assert.deepEqual(
        tokenSaleRegistry.decodedResult,
        new Map([
          ["TC1", tokenSale.$options.address],
          ["TC1I", tokenSale2Address],
        ]),
      );
    });

    it("community_management", async () => {
      const { decodedResult } = await factoryContract.community_management();

      assert.deepEqual(
        decodedResult,
        new Map([
          [tokenSale.$options.address, communityManagement.$options.address],
          [tokenSale2Address, communityManagement2Address],
        ]),
      );
    });

    it("fee_percentage", async () => {
      const { decodedResult } = await factoryContract.fee_percentage();
      assert.equal(decodedResult, 500n);
    });

    it("fee_precision", async () => {
      const { decodedResult } = await factoryContract.fee_precision();
      assert.equal(decodedResult, 100000n);
    });

    it("version", async () => {
      const { decodedResult } = await factoryContract.version();
      assert.equal(decodedResult, 1n);
    });

    it("factory_type", async () => {
      const { decodedResult } = await factoryContract.factory_type();
      assert.equal(decodedResult, "AFFILIATION_COMMUNITY_FACTORY");
    });

    it("protocol_dao_token", async () => {
      assert.eventually.equal(
        protocolDaoTokenContract
          .meta_info()
          .then((res) => res.decodedResult.name),
        "BCTSL-TEST",
      );
    });

    it("mint_protocol_dao_token", async () => {
      await assert.isRejected(
        factoryContract.mint_protocol_dao_token(
          1000,
          utils.getDefaultAccounts()[0].address,
        ),
        "NOT_KNOWN_TOKEN_SALE",
      );

      const createCommunity = await factoryContract.create_community(
        expectedCollectionName,
        `TC-MINT`,
        0, // initial buy is tested and unchanged from CommunityFactory
        false,
        new Map(),
      );

      const tokenSale = await aeSdk.initializeContract({
        sourceCode: utils
          .getContractContent(
            AFFILIATION_BONDING_CURVE_TOKEN_SALE_CONTRACT_SOURCE,
          )
          .replaceAll(
            "contract AffiliationBondingCurveTokenSale",
            "main contract AffiliationBondingCurveTokenSale",
          ),
        fileSystem: getFilesystemDeduplicateNodeModules(
          AFFILIATION_BONDING_CURVE_TOKEN_SALE_CONTRACT_SOURCE,
        ),
        address: createCommunity.decodedResult[1],
      });

      const buy = await tokenSale.buy(1n * 10n ** 18n, {
        amount: 110550000n,
      });
      assert.equal(
        buy.decodedEvents[2].args[0],
        utils.getDefaultAccounts()[0].address,
      );
      assert.equal(buy.decodedEvents[2].args[1], 110550000n * 1000n);
      assert.equal(
        buy.decodedEvents[2].contract.address,
        protocolDaoTokenContract.$options.address,
      );

      assert.eventually.equal(
        protocolDaoTokenContract
          .balance(utils.getDefaultAccounts()[0].address)
          .then((res) => res.decodedResult),
        110550000n * 1000n,
      );
    });
  });

  describe(`CommunityManagement`, async () => {
    it("get_state", async () => {
      const state = await communityManagement.get_state();

      assert.deepEqual(state.decodedResult, {
        owner: dao.$options.address.replaceAll("ct_", "ak_"),
        minimum_token_threshold: 10n ** 18n,
        moderator_accounts: new Set([wallets[0].publicKey]),
        is_private: false,
        muted_user_ids: new Set(),
        meta_info: new Map(),
      });
    });

    it("muted_user_ids", async () => {
      const userId = "USER_ID";
      const muteUserId = await communityManagement.mute_user_id(userId);
      assert.equal(muteUserId.result.returnType, "ok");

      const mutesUserIds1 = await communityManagement.muted_user_ids();
      assert.deepEqual(mutesUserIds1.decodedResult, new Set([userId]));

      await assert.isRejected(
        communityManagement.mute_user_id(userId, {
          onAccount: utils.getDefaultAccounts()[1],
        }),
        "ONLY_MODERATOR_CAN_CHANGE",
      );

      const unmuteUserId = await communityManagement.unmute_user_id(userId);
      assert.equal(unmuteUserId.result.returnType, "ok");

      const mutedUserIds2 = await communityManagement.muted_user_ids();
      assert.deepEqual(mutedUserIds2.decodedResult, new Set([]));

      await assert.isRejected(
        communityManagement.unmute_user_id(userId, {
          onAccount: utils.getDefaultAccounts()[1],
        }),
        "ONLY_MODERATOR_CAN_CHANGE",
      );
    });
  });

  describe(`Vote`, async () => {
    before(async () => {
      await tokenSale.buy(toDecimals(1, 18), { amount: toDecimals(1) }); // overpay as its hard to estimate
    });

    it("ChangeDAO", async () => {
      newDAO = await aeSdk.initializeContract({
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

      const { applyVoteSubject } = await testAddVoteVoteApplySubject(
        aeSdk,
        tokenSale,
        {
          subject: { ChangeDAO: [newDAOAddress] },
          description: "This Poll is created for Testing purposes only",
          link: "https://aeternity.com/",
        },
        dao,
      );

      assert.lengthOf(applyVoteSubject.decodedEvents, 2);

      // other outcomes are asserted in dao vote tests
      assert.equal(
        (await communityManagement.get_state()).decodedResult.owner,
        newDAOAddress,
      );

      // after here, error cases

      const createTokenCommunity = await factoryContract.create_community(
        expectedCollectionName,
        `TC2`,
        0, // initial buy is tested and unchanged from CommunityFactory
        false,
        new Map(),
      );

      // is expected to not be NEW_DAO_INVALID
      await assert.isRejected(
        testAddVoteVoteApplySubject(
          aeSdk,
          tokenSale,
          {
            subject: {
              ChangeDAO: [generateKeyPair().publicKey],
            },
            description: "This Poll is created for Testing purposes only",
            link: "https://aeternity.com/",
          },
          newDAO,
          8, // each subsequent test buys additional stake, increasing need to vote with more
        ),
        "Trying to call invalid contract",
      );

      await assert.isRejected(
        testAddVoteVoteApplySubject(
          aeSdk,
          tokenSale,
          {
            subject: {
              ChangeDAO: [
                createTokenCommunity.decodedResult[0].replace("ct_", "ak_"),
              ],
            },
            description: "This Poll is created for Testing purposes only",
            link: "https://aeternity.com/",
          },
          newDAO,
          12, // each subsequent test buys additional stake, increasing need to vote with more
        ),
        "NEW_DAO_HAS_TO_REFERENCE_SAME_COMMUNITY_MANAGEMENT",
      );

      // ChangeDAO has to abort, so staying with old factory
      assert.equal(
        (await communityManagement.get_state()).decodedResult.owner,
        newDAOAddress,
      );
    });

    it("ChangeMetaInfo", async () => {
      await testAddVoteVoteApplySubject(
        aeSdk,
        tokenSale,
        {
          subject: {
            ChangeMetaInfo: [
              new Map([
                ["DESCRIPTION", "description"],
                ["IPFS_CID", "Q..."],
              ]),
            ],
          },
          description: "This Poll is created for Testing purposes only",
          link: "https://aeternity.com/",
        },
        newDAO,
        16, // each subsequent test buys additional stake, increasing need to vote with more
      );

      const state = await communityManagement.get_state();
      assert.deepEqual(
        state.decodedResult.meta_info,
        new Map([
          ["DESCRIPTION", "description"],
          ["IPFS_CID", "Q..."],
        ]),
      );
    });
    it("ChangeMinimumTokenThreshold", async () => {
      await testAddVoteVoteApplySubject(
        aeSdk,
        tokenSale,
        {
          subject: { ChangeMinimumTokenThreshold: [100n] },
          description: "This Poll is created for Testing purposes only",
          link: "https://aeternity.com/",
        },
        newDAO,
        16, // each subsequent test buys additional stake, increasing need to vote with more
      );

      const state = await communityManagement.get_state();
      assert.equal(state.decodedResult.minimum_token_threshold, 100n);
    });

    it("AddModerator", async () => {
      await testAddVoteVoteApplySubject(
        aeSdk,
        tokenSale,
        {
          subject: { AddModerator: [wallets[1].publicKey] },
          description: "This Poll is created for Testing purposes only",
          link: "https://aeternity.com/",
        },
        newDAO,
        20, // each subsequent test buys additional stake, increasing need to vote with more
      );

      const state = await communityManagement.get_state();
      assert.deepEqual(
        state.decodedResult.moderator_accounts,
        new Set([wallets[0].publicKey, wallets[1].publicKey]),
      );
    });

    it("DeleteModerator", async () => {
      await testAddVoteVoteApplySubject(
        aeSdk,
        tokenSale,
        {
          subject: { DeleteModerator: [wallets[0].publicKey] },
          description: "This Poll is created for Testing purposes only",
          link: "https://aeternity.com/",
        },
        newDAO,
        24, // each subsequent test buys additional stake, increasing need to vote with more
      );

      const state = await communityManagement.get_state();
      assert.deepEqual(
        state.decodedResult.moderator_accounts,
        new Set([wallets[1].publicKey]),
      );
    });
  });
});
