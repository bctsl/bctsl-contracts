const { assert } = require("chai");
const { utils, wallets } = require("@aeternity/aeproject");
const FungibleTokenFullAci = require("aeternity-fungible-token/generated/FungibleTokenFull.aci.json");
const { generateKeyPair } = require("@aeternity/aepp-sdk");
const { curves, timeoutReplacements, toDecimals } = require("./util");
const { getFilesystemDeduplicateNodeModules } = require("../.scripts/utils");

const AFFILIATION_BONDING_CURVE_TOKEN_SALE_CONTRACT_SOURCE =
  "./contracts/AffiliationBondingCurveTokenSale.aes";

const COMMUNITY_FACTORY_CONTRACT_SOURCE = "./contracts/CommunityFactory.aes";

const AFFILIATION_TREASURY_CONTRACT_SOURCE =
  "./contracts/AffiliationTreasury.aes";

curves.forEach((curve) => {
  describe(`AffiliationBondingCurveTokenSale (${curve.type}): trade methods`, () => {
    let aeSdk;
    let bondingCurveContract,
      contract,
      tokenContract,
      affiliationTreasury,
      factoryContract,
      beneficiary,
      expectedCollectionName;

    before(async () => {
      aeSdk = await utils.getSdk();
      expectedCollectionName = `COLLECTION_TEST-${aeSdk.address}`;
    });

    // after each test roll back to initial state
    afterEach(async () => {
      await utils.rollbackSnapshot(aeSdk);
    });

    it(`BondingCurve (${curve.type}): init, BondingCurveTokenSale: init`, async () => {
      factoryContract = await aeSdk.initializeContract({
        sourceCode: utils.getContractContent(COMMUNITY_FACTORY_CONTRACT_SOURCE),
        fileSystem: getFilesystemDeduplicateNodeModules(
          COMMUNITY_FACTORY_CONTRACT_SOURCE,
          timeoutReplacements,
        ),
      });

      await factoryContract.init("BCTSL-TEST");

      const createCollection = await factoryContract.create_collection(
        "COLLECTION_TEST",
        20,
        [
          { SingleChar: [45] },
          { CharRangeFromTo: [48, 57] },
          { CharRangeFromTo: [65, 90] },
        ], {
          amount: 555n * 10n ** 18n,
        }
      );
      assert.equal(createCollection.decodedResult, expectedCollectionName)

      const createCommunity = await factoryContract.create_community(
        expectedCollectionName,
        `TC1`,
        0, // initial buy is tested and unchanged from CommunityFactory
        false,
        new Map(),
      );
      beneficiary = createCommunity.decodedResult[0].replaceAll("ct_", "ak_");

      bondingCurveContract = await aeSdk.initializeContract({
        sourceCode: utils.getContractContent(curve.source),
        fileSystem: utils.getFilesystem(curve.source),
      });
      const initBondingCurveContract = await bondingCurveContract.$deploy([]);
      assert.equal(initBondingCurveContract.result.returnType, "ok");
      assert.equal(
        (await bondingCurveContract.curve_type()).decodedResult,
        curve.type,
      );

      affiliationTreasury = await aeSdk.initializeContract({
        sourceCode: utils.getContractContent(
          AFFILIATION_TREASURY_CONTRACT_SOURCE,
        ),
        fileSystem: utils.getFilesystem(AFFILIATION_TREASURY_CONTRACT_SOURCE),
        address: await factoryContract
          .affiliation_treasury()
          .then(({ decodedResult }) => decodedResult),
      });

      const fileSystem = getFilesystemDeduplicateNodeModules(
        AFFILIATION_BONDING_CURVE_TOKEN_SALE_CONTRACT_SOURCE,
      );
      const sourceCode = utils
        .getContractContent(
          AFFILIATION_BONDING_CURVE_TOKEN_SALE_CONTRACT_SOURCE,
        )
        .replaceAll(
          "contract AffiliationBondingCurveTokenSale",
          "main contract AffiliationBondingCurveTokenSale",
        );

      contract = await aeSdk.initializeContract({
        sourceCode,
        fileSystem,
        address: await factoryContract
          .get_token_sale(expectedCollectionName, `TC1`)
          .then(({ decodedResult }) => decodedResult),
      });


      await utils.createSnapshot(aeSdk);

      const nonPayable = await aeSdk.initializeContract({
        sourceCode: "contract EmptyNonPayable = entrypoint init() = ()",
      });
      await nonPayable.init();

      const contractForInitFailure = await aeSdk.initializeContract({
        sourceCode,
        fileSystem,
      });

      const nonPayableBeneficiary = nonPayable.$options.address.replace(
        "ct_",
        "ak_",
      );
      const contractInitFailure = await contractForInitFailure
        .init(
          nonPayableBeneficiary,
          "Test",
          18,
          "TC1",
          bondingCurveContract.$options.address,
          undefined,
          affiliationTreasury.$options.address,
        )
        .catch((e) => e.message);

      assert.include(contractInitFailure, "Trying to call undefined function");

      const contractInitDecimalsFailure = await contractForInitFailure
        .init(
          beneficiary,
          "Test",
          0,
          "TC1",
          bondingCurveContract.$options.address,
          undefined,
          affiliationTreasury.$options.address,
        )
        .catch((e) => e.message);

      assert.include(
        contractInitDecimalsFailure,
        "BONDING_CURVE_SUPPORTED_DECIMALS_MISSMATCH",
      );
    });

    it("token_contract", async () => {
      const afterTokenContractAddress = await contract.token_contract();
      assert.equal(
        afterTokenContractAddress.decodedResult.startsWith("ct_"),
        true,
      );

      tokenContract = await aeSdk.initializeContract({
        aci: FungibleTokenFullAci,
        address: afterTokenContractAddress.decodedResult,
      });
    });

    it("buy", async () => {
      const unit = BigInt(1 * 10 ** 18);
      const previousPrice = (await contract.price(unit)).decodedResult;

      const buy = await contract.buy(curve.buyCount, {
        amount: curve.buyAmount,
      });
      assert.equal(buy.result.returnType, "ok");

      assert.equal(buy.decodedEvents[0].name, "Buy");
      assert.equal(buy.decodedEvents[0].args[0], curve.buyAmount);
      assert.equal(
        buy.decodedEvents[0].args[1],
        curve.affiliationTreasuryAmount,
      );
      assert.equal(buy.decodedEvents[0].args[2], 0n);

      const nextPrice = (await contract.price(unit)).decodedResult;
      assert.equal(buy.decodedEvents[0].name, "Buy");
      assert.equal(buy.decodedEvents[1].name, "PriceChange");
      assert.equal(buy.decodedEvents[1].args[0], previousPrice);
      assert.equal(buy.decodedEvents[1].args[1], nextPrice);

      assert.equal(buy.decodedEvents[2].name, "Mint"); // token mint
      assert.equal(buy.decodedEvents[3].name, "Mint"); // protocol dao token mint
      assert.equal(buy.decodedEvents[4].name, "RecordSaleTransaction"); // careful: if this fails the sale hasn't been recorded with the affiliation system as some check failed

      const buyWithInsufficientAmount = await contract
        .buy(curve.buyCount, { amount: curve.buyAmount - BigInt(1) })
        .catch((e) => e.message);
      assert.include(buyWithInsufficientAmount, "AE_AMOUNT_NOT_SUFFICIENT");

      assert.equal(
        await aeSdk.getBalance(
          contract.$options.address.replaceAll("ct_", "ak_"),
        ),
        curve.reserveAmount, // reserve
      );

      assert.equal(
        await aeSdk.getBalance(
          affiliationTreasury.$options.address.replaceAll("ct_", "ak_"),
        ),
        curve.affiliationTreasuryAmount, // affiliation treasury
      );

      assert.equal(
        await aeSdk.getBalance(beneficiary),
        curve.beneficiaryAmount,
      );

      const tokenBalance = await tokenContract.balance(wallets[0].publicKey);
      assert.equal(tokenBalance.decodedResult, BigInt(2 * 10 ** 18));
    });

    it("sell", async () => {
      // + 2 amount is added to infer if refund has worked as expected
      const buy = await contract.buy(curve.buyCount, {
        amount: curve.buyAmount,
      });
      assert.equal(buy.result.returnType, "ok");

      const tokenBalanceBuy = await tokenContract.balance(wallets[0].publicKey);
      assert.equal(tokenBalanceBuy.decodedResult, BigInt(2 * 10 ** 18));

      await tokenContract.create_allowance(
        contract.$options.address.replace("ct_", "ak_"),
        curve.buyCount,
      );
      const aeBalanceBefore = await aeSdk.getBalance(wallets[0].publicKey);
      const sell = await contract.sell(
        curve.buyCount,
        await contract
          .sell_return(curve.buyCount)
          .then((res) => res.decodedResult),
      );
      const aeBalanceAfter = await aeSdk.getBalance(wallets[0].publicKey);

      assert.equal(sell.result.returnType, "ok");
      assert.equal(sell.decodedEvents[0].args[0], curve.sellReturn);
      assert.equal(sell.decodedEvents[0].args[1], curve.buyCount);

      assert.equal(
        BigInt(aeBalanceAfter),
        BigInt(aeBalanceBefore) +
          curve.sellReturn -
          (sell.txData.tx.fee +
            BigInt(sell.result.gasUsed) * sell.result.gasPrice),
      );

      assert.equal(
        await aeSdk.getBalance(
          contract.$options.address.replaceAll("ct_", "ak_"),
        ),
        0n, // reserve
      );

      assert.equal(
        await aeSdk.getBalance(
          affiliationTreasury.$options.address.replaceAll("ct_", "ak_"),
        ),
        curve.affiliationTreasuryAmount, // affiliation treasury
      );

      assert.equal(
        await aeSdk.getBalance(beneficiary),
        curve.beneficiaryAmount,
      );

      const tokenBalance = await tokenContract.balance(wallets[0].publicKey);
      assert.equal(tokenBalance.decodedResult, 0n);
    });

    it("buy, sell with profit", async () => {
      const count = toDecimals(2);
      const price = await contract.price(count);
      await contract.buy(count, {
        amount: price.decodedResult,
      });

      // one in-between buy that increases the price
      await contract.buy(count, {
        amount: await contract.price(count).then((res) => res.decodedResult),
      });

      await tokenContract.create_allowance(
        contract.$options.address.replace("ct_", "ak_"),
        count,
      );

      //sell initial buy with profit
      const sell = await contract.sell(count, price.decodedResult);
      assert.isAbove(Number(sell.decodedResult), Number(price.decodedResult));
    });

    it("buy, with affiliation", async () => {
      const count = toDecimals(2);
      const price = await contract.price(count);

      await assert.isRejected(
        contract.buy_with_affiliation(count, wallets[0].publicKey, {
          amount: price.decodedResult,
        }),
        "ONLY_FACTORY_CAN_CALL",
      );
    });

    it("price", async () => {
      const priceNegative = await contract.price(-1).catch((e) => e.message);
      assert.include(priceNegative, "COUNT_NOT_POSITIVE");

      const priceZero = await contract.price(0).catch((e) => e.message);
      assert.include(priceZero, "COUNT_NOT_POSITIVE");

      console.log(
        contract.$options.address,
        bondingCurveContract.$options.address,
      );
      assert.equal(
        (await bondingCurveContract.curve_type()).decodedResult,
        curve.type,
      );

      const price = await contract.price(curve.buyCount);
      assert.equal(price.decodedResult, curve.buyAmount);
    });

    it("sale_type", async () => {
      const saleType = await contract.sale_type();
      assert.equal(saleType.decodedResult, "AFFILIATION_BONDING_CURVE");
    });

    it("version", async () => {
      const version = await contract.version();
      assert.equal(version.decodedResult, 1n);
    });
  });

  describe(`AffiliationBondingCurveTokenSale (${curve.type}): state methods`, () => {
    let aeSdk;
    let bondingCurveContract,
      contract,
      tokenContract,
      affiliationTreasury,
      factoryContract,
      beneficiary,
      expectedCollectionName,
      createCommunity;

    before(async () => {
      aeSdk = await utils.getSdk();
      expectedCollectionName = `COLLECTION_TEST-${aeSdk.address}`;
      factoryContract = await aeSdk.initializeContract({
        sourceCode: utils.getContractContent(COMMUNITY_FACTORY_CONTRACT_SOURCE),
        fileSystem: getFilesystemDeduplicateNodeModules(
          COMMUNITY_FACTORY_CONTRACT_SOURCE,
          timeoutReplacements,
        ),
      });

      await factoryContract.init("BCTSL-TEST");

      const createCollection = await factoryContract.create_collection(
        "COLLECTION_TEST",
        20,
        [
          { SingleChar: [45] },
          { CharRangeFromTo: [48, 57] },
          { CharRangeFromTo: [65, 90] },
        ], {
        amount: 555n * 10n ** 18n,
      }
      );
      assert.equal(createCollection.decodedResult, expectedCollectionName)

      createCommunity = await factoryContract.create_community(
        expectedCollectionName,
        `TC1`,
        0, // initial buy is tested and unchanged from CommunityFactory
        false,
        new Map(),
      );

      bondingCurveContract = await aeSdk.initializeContract({
        sourceCode: utils.getContractContent(curve.source),
        fileSystem: utils.getFilesystem(curve.source),
      });
      await bondingCurveContract.$deploy([]);

      affiliationTreasury = await aeSdk.initializeContract({
        sourceCode: utils.getContractContent(
          AFFILIATION_TREASURY_CONTRACT_SOURCE,
        ),
        fileSystem: utils.getFilesystem(AFFILIATION_TREASURY_CONTRACT_SOURCE),
        address: await factoryContract
          .affiliation_treasury()
          .then(({ decodedResult }) => decodedResult),
      });

      const fileSystem = getFilesystemDeduplicateNodeModules(
        AFFILIATION_BONDING_CURVE_TOKEN_SALE_CONTRACT_SOURCE,
      );
      const sourceCode = utils
        .getContractContent(
          AFFILIATION_BONDING_CURVE_TOKEN_SALE_CONTRACT_SOURCE,
        )
        .replaceAll(
          "contract AffiliationBondingCurveTokenSale",
          "main contract AffiliationBondingCurveTokenSale",
        );

      contract = await aeSdk.initializeContract({ sourceCode, fileSystem });
      beneficiary = createCommunity.decodedResult[0].replaceAll("ct_", "ak_");
      const init = await contract.init(
        beneficiary,
        "Test",
        18,
        "TC1",
        bondingCurveContract.$options.address,
        undefined,
        affiliationTreasury.$options.address,
      );
      assert.equal(init.result.returnType, "ok");
      await utils.createSnapshot(aeSdk);
    });

    // after each test roll back to initial state
    afterEach(async () => {
      await utils.rollbackSnapshot(aeSdk);
    });

    it("token_contract", async () => {
      const afterTokenContractAddress = await contract.token_contract();
      assert.equal(
        afterTokenContractAddress.decodedResult.startsWith("ct_"),
        true,
      );

      tokenContract = await aeSdk.initializeContract({
        aci: FungibleTokenFullAci,
        address: afterTokenContractAddress.decodedResult,
      });
    });

    it("get_state", async () => {
      const state = await contract.get_state();
      assert.equal(
        state.decodedResult.token_contract,
        tokenContract.$options.address,
      );
      assert.equal(state.decodedResult.owner, wallets[0].publicKey);
      assert.equal(state.decodedResult.beneficiary, beneficiary);
      assert.equal(
        state.decodedResult.affiliation_treasury,
        affiliationTreasury.$options.address,
      );
    });

    it("set_beneficiary, beneficiary", async () => {
      const oldBeneficiary = await contract.beneficiary();
      assert.equal(oldBeneficiary.decodedResult, beneficiary);

      const createCommunity = await factoryContract.create_community(
        expectedCollectionName,
        `TC2`,
        0, // initial buy is tested and unchanged from CommunityFactory
        false,
        new Map(),
      );
      const newBeneficiaryToSet = createCommunity.decodedResult[0].replaceAll(
        "ct_",
        "ak_",
      );
      const setBeneficiary =
        await contract.set_beneficiary(newBeneficiaryToSet);
      assert.equal(setBeneficiary.result.returnType, "ok");

      const newBeneficiary = await contract.beneficiary();
      assert.equal(newBeneficiary.decodedResult, newBeneficiaryToSet);

      const setBeneficiaryOtherThanOwner = await contract
        .set_beneficiary(generateKeyPair().publicKey, {
          onAccount: utils.getDefaultAccounts()[1],
        })
        .catch((e) => e.message);
      assert.include(setBeneficiaryOtherThanOwner, "UNAUTHORIZED");
    });

    it("owner", async () => {
      const owner = await contract.owner();
      assert.equal(owner.decodedResult, wallets[0].publicKey);
    });
  });
});
