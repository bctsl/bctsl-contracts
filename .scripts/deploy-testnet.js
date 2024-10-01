const {
  AeSdk,
  Node,
  CompilerHttp,
  MemoryAccount,
} = require("@aeternity/aepp-sdk");
const { utils } = require("@aeternity/aeproject");
const path = require("path");
const { getFilesystemDeduplicateNodeModules } = require("./utils");

const COMMUNITY_FACTORY_CONTRACT_SOURCE = path.resolve(__dirname, "../contracts/CommunityFactory.aes");

async function main() {
  const aeSdk = new AeSdk({
    accounts: [new MemoryAccount("")],
    nodes: [
      {
        name: "node",
        instance: new Node("https://testnet.aeternity.io/"),
      },
    ],
    onCompiler: new CompilerHttp("https://v8.compiler.aepps.com/"),
  });

  const factoryContract = await aeSdk.initializeContract({
    sourceCode: utils.getContractContent(COMMUNITY_FACTORY_CONTRACT_SOURCE),
    fileSystem: getFilesystemDeduplicateNodeModules(
      COMMUNITY_FACTORY_CONTRACT_SOURCE,
    ),
  });

  await factoryContract.init("PROTOCOL-TEST-TOKEN");
  console.log(`community factory deployed successfully at ${factoryContract.$options.address}`);

  const createCollection = await factoryContract.create_collection(
    "ALPHA",
    20,
    [
      { SingleChar: [45] },
      { CharRangeFromTo: [48, 57] },
      { CharRangeFromTo: [65, 90] },
    ],
    {
      amount: 555n * 10n ** 18n,
    }
  );
  console.log(`collection created successfully at ${createCollection.decodedResult}`);
}

void main();
