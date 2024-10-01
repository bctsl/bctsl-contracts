const fs = require("fs");
const path = require("path");
const { utils } = require("@aeternity/aeproject");

const getContractContent = (contractPath, replacements = []) => {
  let content = fs.readFileSync(contractPath, "utf8");

  for (const replacement of replacements) {
    content = content.replaceAll(replacement[0], replacement[1]);
  }

  return content;
};

const getFilesystemDeduplicateNodeModules = (
  contractPath,
  replacements = [],
) => {
  const defaultIncludes = [
    "List.aes",
    "Option.aes",
    "String.aes",
    "Func.aes",
    "Pair.aes",
    "Triple.aes",
    "BLS12_381.aes",
    "Frac.aes",
    "Set.aes",
    "Bitwise.aes",
  ];

  const rgx = /^include\s+"([\w/.-]+)"/gim;
  const rgxIncludePath = /"([\w/.-]+)"/i;
  const rgxMainPath = /.*\//g;

  const contractContent = utils.getContractContent(contractPath);
  const filesystem = {};

  const rootIncludes = contractContent.match(rgx);
  if (!rootIncludes) return filesystem;
  const contractPathMatch = rgxMainPath.exec(contractPath);

  // eslint-disable-next-line no-restricted-syntax
  for (const rootInclude of rootIncludes) {
    const includeRelativePath = rgxIncludePath.exec(rootInclude);

    // eslint-disable-next-line no-continue
    if (defaultIncludes.includes(includeRelativePath[1])) continue;

    // eslint-disable-next-line no-console
    let includePath = path.resolve(
      `${contractPathMatch[0]}/${includeRelativePath[1]}`,
    );

    if ((includePath.match(/node_modules/g) || []).length > 1) {
      includePath =
        includePath.substring(0, includePath.indexOf("node_modules")) +
        includePath.substring(includePath.lastIndexOf("node_modules"));
    }

    try {
      filesystem[includeRelativePath[1]] = fs.readFileSync(
        includePath,
        "utf-8",
      );
      for (const replacement of replacements) {
        filesystem[includeRelativePath[1]] = filesystem[
          includeRelativePath[1]
        ].replaceAll(replacement[0], replacement[1]);
      }
    } catch (error) {
      throw Error(`File to include '${includeRelativePath[1]}' not found.`);
    }

    Object.assign(
      filesystem,
      getFilesystemDeduplicateNodeModules(includePath, replacements),
    );
  }

  return filesystem;
};

module.exports = { getFilesystemDeduplicateNodeModules, getContractContent };
