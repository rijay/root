#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const {
  validateFormalLaunchReadiness,
} = require("../backend/src/formalLaunchReadinessRegistry");

const ROOT = path.join(__dirname, "..");
const CONTRACT_RELATIVE = "contracts/formal-launch-readiness/v1.0.0.json";

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 0) {
    const error = new Error("FORMAL_LAUNCH_READINESS_CLI_ARGUMENTS_FORBIDDEN");
    error.code = "FORMAL_LAUNCH_READINESS_CLI_ARGUMENTS_FORBIDDEN";
    throw error;
  }
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, CONTRACT_RELATIVE), "utf8"));
  const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, contract.matrixPath), "utf8"));
  const result = validateFormalLaunchReadiness({ contract, matrix });
  process.stdout.write(`${JSON.stringify({
    ...result,
    contractPath: CONTRACT_RELATIVE,
    matrixPath: contract.matrixPath,
  }, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.code || "FORMAL_LAUNCH_READINESS_VALIDATION_FAILED"}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
