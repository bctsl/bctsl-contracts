const {
  AeSdk,
  Node,
  CompilerHttp,
  MemoryAccount,
  generateKeyPair,
  toAe,
  getExecutionCostUsingNode,
} = require("@aeternity/aepp-sdk");
const { utils } = require("@aeternity/aeproject");
const path = require("path");
const { getFilesystemDeduplicateNodeModules } = require("./utils");

const COMMUNITY_FACTORY_CONTRACT_SOURCE = path.resolve(__dirname, "../contracts/CommunityFactory.aes");
const FACTORY_CONTRACT_ADDRESS = "ct_2QmAcPxY4TBbFmkSUhxU4UTwoRot8SMmZzaAKL6oyHmQqRL1rK";

// generate random keypair
const { secretKey, publicKey } = generateKeyPair();

// initialize aepp-sdk
const nodeInstance = new Node("https://testnet.aeternity.io/");
const aeSdk = new AeSdk({
  accounts: [new MemoryAccount(secretKey)], // or use custom secretKey that you maintain in a wallet
  nodes: [
    {
      name: "node",
      instance: nodeInstance,
    },
  ],
  onCompiler: new CompilerHttp("https://v8.compiler.aepps.com/"),
});


async function initializeFactoryContract() {
  return aeSdk.initializeContract({
    sourceCode: utils.getContractContent(COMMUNITY_FACTORY_CONTRACT_SOURCE),
    fileSystem: getFilesystemDeduplicateNodeModules(
      COMMUNITY_FACTORY_CONTRACT_SOURCE,
    ),
    address: FACTORY_CONTRACT_ADDRESS,
  });
}


/**
 * Estimate the gas price for the create collection transaction
 * @returns {Promise<bigint>} the estimated gas price
 */
async function estimateGasPrice() {
  const factoryContract = await initializeFactoryContract();

  const { rawTx } = await factoryContract.create_collection("WORDS",
    20,
    [
      { SingleChar: [45] },
      { CharRangeFromTo: [48, 57] },
      { CharRangeFromTo: [65, 90] },
    ], {
    amount: 555n * 10n ** 18n,
    callStatic: true,
  }
  );

  return getExecutionCostUsingNode(rawTx, nodeInstance);
}

async function main() {
  // fund account, estimate gas price. Skip this if you already have funds or using custom account
  // Fund the account and estimate the gas price for the transaction.
  // This step ensures that the account has enough funds to cover the transaction fees.
  // Skip this if you already have sufficient funds or are using a custom account.
  const txFee = await estimateGasPrice();
  console.log(`Please fund the following address with a minimum of ${toAe(txFee)} AE: ${publicKey}`);
  console.log(`Current balance: ${toAe(await aeSdk.getBalance(publicKey))} AE`);

  const interval = setInterval(async () => {
    if (await aeSdk.getBalance(publicKey) >= txFee) {
      clearInterval(interval);
      console.log(`Funding successful. Balance: ${toAe(await aeSdk.getBalance(publicKey))} AE`);

      console.log(`Creating WORDS collection...`);
      const factoryContract = await initializeFactoryContract();
      const createWordCollection = await factoryContract.create_collection(
        "WORDS",
        20,
        [
          { SingleChar: [45] },
          { CharRangeFromTo: [48, 57] },
          { CharRangeFromTo: [65, 90] },
        ],
        {
          amount: 555n * 10n ** 18n, // Minimum of 555 AE is needed to create a collection
        }
      );
      console.log(`WORDS collection created successfully at ${createWordCollection.decodedResult}`);

      // Uncomment the following code to create the NUMBERS collection
      // const createNumberCollection = await factoryContract.create_collection(
      //   "NUMBERS",
      //   20,
      //   [
      //     { CharRangeFromTo: [48, 57] },
      //   ],
      //   {
      //     amount: 555n * 10n ** 18n,
      //   }
      // );
      // console.log(`NUMBERS collection created successfully at ${createNumberCollection.decodedResult}`);
    }
  }, 5000);
}

main();
