const { utils } = require("@aeternity/aeproject");
const BigNumber = require("bignumber.js");
const { debugAmounts } = require("./util");
const BONDING_CURVE_EXPONENTIAL_CONTRACT_SOURCE =
  "./contracts/BondingCurveExponential.aes";

describe(`Try BondingCurveExponential Configurations`, () => {
  it(`BondingCurveExponential amounts`, async () => {
    const aeSdk = await utils.getSdk();
    const contract = await aeSdk.initializeContract({
      sourceCode: utils.getContractContent(
        BONDING_CURVE_EXPONENTIAL_CONTRACT_SOURCE,
      ),
      fileSystem: utils.getFilesystem(
        BONDING_CURVE_EXPONENTIAL_CONTRACT_SOURCE,
      ),
    });

    await contract.$deploy([]);
    // reset to default
    BigNumber.set({
      ROUNDING_MODE: BigNumber.ROUND_HALF_UP,
      DECIMAL_PLACES: 20,
    });

    await debugAmounts(contract, 0n * 10n ** 18n, [
      0n,
      1n,
      2n,
      3n,
      4n,
      5n,
      6n,
      7n,
      8n,
      9n,
      10n,
      69n,
      70n,
      71n,
      100n,
      1000n,
      1111n,
      10000n,
      100000n,
      123456n,
      200000n,
      300000n,
      400000n,
      500000n,
      600000n,
      700000n,
      800000n,
      900000n,
      1000000n,
      10000000n,
      12345678n,
      20000000n,
      30000000n,
      40000000n,
      50000000n,
      60000000n,
      70000000n,
      80000000n,
      90000000n,
      100000000n,
      200000000n,
      300000000n,
      400000000n,
      500000000n,
      1000000000n,
      2000000000n,
      3000000000n,
      4000000000n,
      5000000000n,
      6000000000n,
      7000000000n,
      7500000000n,
    ]);
  });
});
