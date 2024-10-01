const fs = require("fs");

// use to wrap source in js files for easier import
const DAO = fs.readFileSync(__dirname + "/../contracts/DAO.aes", "utf-8");
fs.writeFileSync(
  __dirname + "/../generated/DAO.aes.js",
  `module.exports = \`\n${DAO.replace(/`/g, "\\`")}\`;\n`,
  "utf-8",
);

const DAOVote = fs.readFileSync(
  __dirname + "/../contracts/DAOVote.aes",
  "utf-8",
);
fs.writeFileSync(
  __dirname + "/../generated/DAOVote.aes.js",
  `module.exports = \`\n${DAOVote.replace(/`/g, "\\`")}\`;\n`,
  "utf-8",
);

const CommunityFactory = fs.readFileSync(
  __dirname + "/../contracts/CommunityFactory.aes",
  "utf-8",
);
fs.writeFileSync(
  __dirname + "/../generated/CommunityFactory.aes.js",
  `module.exports = \`\n${CommunityFactory.replace(/`/g, "\\`")}\`;\n`,
  "utf-8",
);

const CommunityManagement = fs.readFileSync(
  __dirname + "/../contracts/CommunityManagement.aes",
  "utf-8",
);
fs.writeFileSync(
  __dirname + "/../generated/CommunityManagement.aes.js",
  `module.exports = \`\n${CommunityManagement.replace(/`/g, "\\`")}\`;\n`,
  "utf-8",
);

const AffiliationTreasury = fs.readFileSync(
  __dirname + "/../contracts/AffiliationTreasury.aes",
  "utf-8",
);
fs.writeFileSync(
  __dirname + "/../generated/AffiliationTreasury.aes.js",
  `module.exports = \`\n${AffiliationTreasury.replace(/`/g, "\\`")}\`;\n`,
  "utf-8",
);

const BondingCurveExponential = fs.readFileSync(
  __dirname + "/../contracts/BondingCurveExponential.aes",
  "utf-8",
);
fs.writeFileSync(
  __dirname + "/../generated/BondingCurveExponential.aes.js",
  `module.exports = \`\n${BondingCurveExponential.replace(/`/g, "\\`")}\`;\n`,
  "utf-8",
);

const TokenSale = fs.readFileSync(
  __dirname + "/../contracts/interfaces/TokenSale.aes",
  "utf-8",
);
fs.writeFileSync(
  __dirname + "/../generated/TokenSale.aes.js",
  `module.exports = \`\n${TokenSale.replace(/`/g, "\\`")}\`;\n`,
  "utf-8",
);

const BondingCurve = fs.readFileSync(
  __dirname + "/../contracts/interfaces/BondingCurve.aes",
  "utf-8",
);
fs.writeFileSync(
  __dirname + "/../generated/BondingCurve.aes.js",
  `module.exports = \`\n${BondingCurve.replace(/`/g, "\\`")}\`;\n`,
  "utf-8",
);
