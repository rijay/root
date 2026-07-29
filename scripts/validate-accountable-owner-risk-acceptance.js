#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const {
  getDefaultAccountableOwnerRiskAcceptanceRegistry,
} = require("../backend/src/accountableOwnerRiskAcceptanceRegistry");

const ROOT = path.resolve(__dirname, "..");
const EVIDENCE_RELATIVE_PATH =
  "docs/evidence/v1.0.0/accountable_owner_risk_acceptance_v2_2026-07-28.json";

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 0) {
    const error = new Error("ACCOUNTABLE_OWNER_RISK_ACCEPTANCE_CLI_ARGUMENTS_FORBIDDEN");
    error.code = "ACCOUNTABLE_OWNER_RISK_ACCEPTANCE_CLI_ARGUMENTS_FORBIDDEN";
    throw error;
  }
  const registry = getDefaultAccountableOwnerRiskAcceptanceRegistry();
  const document = JSON.parse(fs.readFileSync(path.join(ROOT, EVIDENCE_RELATIVE_PATH), "utf8"));
  const evaluation = registry.evaluate(document);
  const envelope = registry.seal(document);
  if (!registry.verify(envelope)) {
    const error = new Error("ACCOUNTABLE_OWNER_RISK_ACCEPTANCE_VERIFY_FAILED");
    error.code = "ACCOUNTABLE_OWNER_RISK_ACCEPTANCE_VERIFY_FAILED";
    throw error;
  }
  const output = {
    ...evaluation,
    registryDigest: registry.describe().registryDigest,
    evidencePath: EVIDENCE_RELATIVE_PATH,
    supersededContractPath: document.supersedes.contractPath,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return output;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.code || "ACCOUNTABLE_OWNER_RISK_ACCEPTANCE_FAILED"}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
