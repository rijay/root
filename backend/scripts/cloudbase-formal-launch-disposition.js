#!/usr/bin/env node

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const {
  collectFormalLaunchMysqlDispositionReport,
} = require("../src/formalLaunchMysqlDispositionReport");

const execFileAsync = promisify(execFile);

function commandError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function parseArguments(argv) {
  if (argv.length !== 5 || argv[0] !== "--read-only" || argv[1] !== "--appid" || argv[3] !== "--env-id") {
    throw commandError(
      "FORMAL_DISPOSITION_COMMAND_INVALID",
      "Usage: cloudbase-formal-launch-disposition.js --read-only --appid <wx-appid> --env-id <environment-id>"
    );
  }
  return Object.freeze({ appId: argv[2], environmentId: argv[4] });
}

function rowsFromCloudBaseOutput(stdout) {
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw commandError("FORMAL_DISPOSITION_CLOUDBASE_OUTPUT_INVALID");
  }
  if (!payload || !payload.data || !Array.isArray(payload.data.items)) {
    throw commandError("FORMAL_DISPOSITION_CLOUDBASE_OUTPUT_INVALID");
  }
  return payload.data.items;
}

function createCloudBaseExecutor(options = {}) {
  const environmentId = options.environmentId;
  const executable = options.executable || "tcb";
  const run = options.run || execFileAsync;
  return async (sql) => {
    if (typeof sql !== "string" || !/^SELECT\b/i.test(sql.trim()) || /;\s*\S/.test(sql)) {
      throw commandError("FORMAL_DISPOSITION_NON_SELECT_QUERY_FORBIDDEN");
    }
    const { stdout } = await run(executable, [
      "db",
      "execute",
      "-e",
      environmentId,
      "--read-only",
      "--json",
      "--sql",
      sql,
    ], { maxBuffer: 4 * 1024 * 1024 });
    return rowsFromCloudBaseOutput(stdout);
  };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const target = parseArguments(argv);
  const execute = createCloudBaseExecutor({
    environmentId: target.environmentId,
    executable: env.MYROOT_CLOUDBASE_CLI || "tcb",
  });
  const report = await collectFormalLaunchMysqlDispositionReport({
    ...target,
    execute,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.code || "FORMAL_DISPOSITION_COMMAND_FAILED"}: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  createCloudBaseExecutor,
  main,
  parseArguments,
  rowsFromCloudBaseOutput,
};
