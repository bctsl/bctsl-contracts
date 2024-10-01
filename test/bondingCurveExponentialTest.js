const { assert } = require("chai");
const { utils } = require("@aeternity/aeproject");
const BigNumber = require("bignumber.js");
const createModule = require("libqalculate-wasm");

const BONDING_CURVE_EXPONENTIAL_CONTRACT_SOURCE =
  "./contracts/BondingCurveExponential.aes";

// TODO add more test cases
const testCases = [
  {
    curve: {
      // this is a edge case for the fallback calculations worst case, paying more, receiving back less
      supply: 0n,
      amount: 1n * 10n ** 12n, // minimum buy
      buyCurve: 0.00000000010000002,
      sellCurve: 0.0000000000995000199,
      price: 100n,
      sellReturn: 99n,
    },
  },
  {
    curve: {
      supply: 0n,
      amount: 1n * 10n ** 16n,
      buyCurve: 0.0000000001002,
      sellCurve: 0.000000000099699,
      price: 1001000n,
      sellReturn: 995995n,
    },
  },
  {
    curve: {
      supply: 0n,
      amount: 141358902342371412n,
      buyCurve: 0.000000000102827178,
      sellCurve: 0.00000000010231304211,
      price: 14335713n,
      sellReturn: 14264034n,
    },
  },
  {
    curve: {
      supply: 1n * 10n ** 18n,
      amount: 1n * 10n ** 16n,
      buyCurve: 0.0000000001202,
      sellCurve: 0.000000000119599,
      price: 1201000n,
      sellReturn: 1194995n,
    },
  },
  {
    curve: {
      supply: 1n * 10n ** 26n,
      amount: 1n * 10n ** 16n,
      buyCurve: 0.002002001434200665,
      sellCurve: 0.001991991427029662,
      price: 20020014341004n,
      sellReturn: 19919914269298n,
    },
  },
  {
    curve: {
      supply: 0n,
      amount: 1n * 10n ** 18n,
      buyCurve: 0.00000000012,
      sellCurve: 0.0000000001194,
      price: 110000000n,
      sellReturn: 109450000n,
    },
  },
  {
    curve: {
      supply: 1n * 10n ** 18n,
      amount: 1n * 10n ** 18n,
      buyCurve: 0.00000000014,
      sellCurve: 0.0000000001393,
      price: 130000000n,
      sellReturn: 129350000n,
    },
  },
  {
    curve: {
      supply: 1n * 10n ** 26n,
      amount: 1n * 10n ** 18n,
      buyCurve: 0.002002001454040305,
      sellCurve: 0.0019919914467701034,
      price: 2002001444020286n,
      sellReturn: 1991991436800184n,
    },
  },
  {
    curve: {
      supply: 0n,
      amount: 1n * 10n ** 25n, //10mio
      buyCurve: 0.000200020101333399,
      sellCurve: 0.00019902000082673202,
      price: 1000067670000133337777n, //1,000.0676700AE
      sellReturn: 995067331650132671088n, // 990.0669932505AE
    },
  },
];

BigInt.prototype.toJSON = function () {
  return this.toString();
};

function generateRanges(start, factor, count) {
  const ranges = [];
  let currentMin = start;

  for (let i = 0; i < count; i++) {
    const currentMax = currentMin * factor - 1n;
    ranges.push([currentMin, currentMax]);
    currentMin = currentMax + 1n;
  }

  return ranges;
}

function getRandomBigIntInRange(min, max) {
  const range = max - min + 1n;
  const randomBigInt = BigInt(Math.floor(Math.random() * Number(range)));
  return min + randomBigInt;
}

function generateRandomBigIntsAutomated(start, factor, count, numbersPerRange) {
  const ranges = generateRanges(start, factor, count);
  return ranges.map(([min, max]) => {
    const randomBigInts = [];
    for (let i = 0; i < numbersPerRange; i++) {
      randomBigInts.push(getRandomBigIntInRange(min, max));
    }
    return randomBigInts;
  });
}

describe(`BondingCurveExponential Random Spread Check`, function () {
  this.timeout(1000000);
  let aeSdk, contract;
  let libqalculate;

  before(async () => {
    aeSdk = await utils.getSdk();

    // reset to default
    BigNumber.set({
      ROUNDING_MODE: BigNumber.ROUND_HALF_UP,
      DECIMAL_PLACES: 20,
    });

    libqalculate = await createModule();
    libqalculate.setPrecision(28);
  });

  beforeEach(async () => {
    contract = await aeSdk.initializeContract({
      sourceCode: utils.getContractContent(
        BONDING_CURVE_EXPONENTIAL_CONTRACT_SOURCE,
      ),
      fileSystem: utils.getFilesystem(
        BONDING_CURVE_EXPONENTIAL_CONTRACT_SOURCE,
      ),
    });

    await contract.$deploy([]);

    await utils.createSnapshot(aeSdk);
  });

  // after each test roll back to initial state
  afterEach(async () => {
    await utils.rollbackSnapshot(aeSdk);
  });

  // Usage Example
  const start = 1n; // Starting range (e.g., 0 or 1)
  const factor = 10n; // Each range grows by a factor of 10
  const rangeCount = 28; // Number of ranges to generate
  const numbersPerRange = 20; // Number of random numbers per range

  const randomBigIntSets = generateRandomBigIntsAutomated(
    start,
    factor,
    rangeCount,
    numbersPerRange,
  );
  it(`sampling, ${JSON.stringify({
    start,
    factor,
    rangeCount,
    numbersPerRange,
  })}`, async () => {
    console.log("sample", randomBigIntSets);
    let highestDiff = 0;
    let lowestDiff = 0;

    for (const randomBigIntSet of randomBigIntSets) {
      for (const randomBigInt of randomBigIntSet) {
        try {
          const buyPrice = await contract
            .calculate_buy_price(0n, randomBigInt)
            .then((res) => res.decodedResult);
          const sellReturn = await contract
            .calculate_sell_return(randomBigInt, randomBigInt)
            .then((res) => res.decodedResult);

          const calculatorResult = libqalculate.calculate(
            `integrate(e^(0.00000000002×x)−0.9999999999, 0, ${randomBigInt.toString()} / 1e18)`,
            500,
            0,
          );
          const calculatorResultBN = new BigNumber(
            calculatorResult.output,
          ).shiftedBy(18);

          console.log("prices", randomBigInt, buyPrice, sellReturn);

          const diff = calculatorResultBN.minus(buyPrice).toNumber();
          console.log("diff", diff, calculatorResultBN.toString(), buyPrice);
          if (diff > highestDiff) highestDiff = diff;
          if (diff < lowestDiff) lowestDiff = diff;

          assert.isTrue(buyPrice > 0);
          const percentage = (sellReturn * 100000n) / buyPrice;
          console.log("percentage", percentage);
          assert.isTrue(sellReturn >= 0);
          assert.isTrue(percentage <= 99500n); //&& percentage >= 99000n);
        } catch (e) {
          if (!e.message.includes("MINIMUM_TOKENS_REQUIRED")) throw e;
        }
      }
    }

    assert.isAtMost(highestDiff, 2);
    assert.isAtLeast(lowestDiff, 0);
    console.log("highestdiff", highestDiff);
    console.log("lowestDiff", lowestDiff);
  });
});

testCases.forEach((testCase) => {
  describe(`BondingCurveExponential (${JSON.stringify(testCase)})`, () => {
    let aeSdk, contract;

    before(async () => {
      aeSdk = await utils.getSdk();

      // reset to default
      BigNumber.set({
        ROUNDING_MODE: BigNumber.ROUND_HALF_UP,
        DECIMAL_PLACES: 20,
      });
    });

    // after each test roll back to initial state
    afterEach(async () => {
      await utils.rollbackSnapshot(aeSdk);
    });

    it(`BondingCurveExponential init`, async () => {
      contract = await aeSdk.initializeContract({
        sourceCode: utils.getContractContent(
          BONDING_CURVE_EXPONENTIAL_CONTRACT_SOURCE,
        ),
        fileSystem: utils.getFilesystem(
          BONDING_CURVE_EXPONENTIAL_CONTRACT_SOURCE,
        ),
      });

      await contract.$deploy([]);

      await utils.createSnapshot(aeSdk);
    });

    const toNumber = (frac) =>
      frac.hasOwnProperty("Zero")
        ? 0
        : new BigNumber(frac.Pos[0]).div(frac.Pos[1]).toNumber();

    it(`buy_curve`, async () => {
      const buyCurve = await contract.buy_curve(
        testCase.curve.supply + testCase.curve.amount,
      );
      console.log(buyCurve.decodedResult);

      assert.equal(toNumber(buyCurve.decodedResult), testCase.curve.buyCurve);
    });

    it(`sell_curve`, async () => {
      const sellCurve = await contract.sell_curve(
        testCase.curve.supply + testCase.curve.amount,
      );
      assert.equal(toNumber(sellCurve.decodedResult), testCase.curve.sellCurve);
    });

    it(`calculate_buy_price`, async () => {
      const buyPrice = await contract.calculate_buy_price(
        testCase.curve.supply,
        testCase.curve.amount,
      );

      console.log(buyPrice.decodedEvents);
      assert.equal(buyPrice.decodedResult, testCase.curve.price);
    });

    it(`calculate_sell_return`, async () => {
      const sellReturn = await contract.calculate_sell_return(
        testCase.curve.supply + testCase.curve.amount,
        testCase.curve.amount,
      );
      console.log(
        "sell",
        testCase.curve.supply,
        testCase.curve.amount,
        sellReturn.decodedResult,
      );
      assert.equal(sellReturn.decodedResult, testCase.curve.sellReturn);
    });
  });
});
