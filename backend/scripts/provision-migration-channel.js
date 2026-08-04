#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const TARGET = Object.freeze({
  environmentId: "myroot-prod-d5gl3gzg7115f149a",
  database: "myroot-prod-d5gl3gzg7115f149a",
  functionName: "myroot-migration-067-068",
  databaseAddress: "172.17.0.2:3306",
  databaseUser: "myroot_migrator_067_068",
  databaseHost: "172.17.0.0/255.255.240.0",
  vpcId: "vpc-3plmoyf8",
  subnetId: "subnet-entx2uvt",
  releaseId: "v1.0.0+a4c84a57-20260804",
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function jsonFromOutput(stdout) {
  const source = String(stdout || "");
  const start = source.indexOf("{");
  if (start < 0) throw fail("MIGRATION_CHANNEL_TCB_OUTPUT_INVALID");
  try {
    return JSON.parse(source.slice(start));
  } catch {
    throw fail("MIGRATION_CHANNEL_TCB_OUTPUT_INVALID");
  }
}

function runTcb(args, options = {}) {
  const result = spawnSync("tcb", args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw fail(options.errorCode || "MIGRATION_CHANNEL_TCB_COMMAND_FAILED");
  }
  return jsonFromOutput(result.stdout);
}

function runTcbStatus(args, options = {}) {
  const result = spawnSync("tcb", args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw fail(options.errorCode || "MIGRATION_CHANNEL_TCB_COMMAND_FAILED");
  }
}

function rows(payload) {
  const value = payload && payload.Items;
  if (!Array.isArray(value)) throw fail("MIGRATION_CHANNEL_TCB_ROWS_INVALID");
  return value.map((item) => {
    try { return JSON.parse(item); } catch { throw fail("MIGRATION_CHANNEL_TCB_ROWS_INVALID"); }
  });
}

function firstValue(row, pattern) {
  const entry = Object.entries(row || {}).find(([key]) => pattern.test(key));
  return entry ? entry[1] : undefined;
}

function credentials() {
  const payload = runTcb([
    "secrets", "get",
    "-e", TARGET.environmentId,
    "--json",
  ], { errorCode: "MIGRATION_CHANNEL_CREDENTIAL_LOOKUP_FAILED" });
  const value = payload && payload.data;
  if (!value || !value.secretId || !value.secretKey || !value.token) {
    throw fail("MIGRATION_CHANNEL_CREDENTIAL_LOOKUP_FAILED");
  }
  return Object.freeze({
    secretId: value.secretId,
    secretKey: value.secretKey,
    token: value.token,
  });
}

function tcbClient() {
  let sdk;
  try { sdk = require("tencentcloud-sdk-nodejs-tcb"); } catch {
    throw fail("MIGRATION_CHANNEL_TCB_SDK_MISSING");
  }
  return new sdk.tcb.v20180608.Client({
    credential: credentials(),
    region: "",
    profile: {
      signMethod: "TC3-HMAC-SHA256",
      httpProfile: { reqMethod: "POST", reqTimeout: 30, endpoint: "tcb.tencentcloudapi.com" },
    },
  });
}

async function sql(client, sqlText, readOnly = false) {
  try {
    return await client.RunSql({
      EnvId: TARGET.environmentId,
      Sql: sqlText,
      DbInstance: {
        EnvId: TARGET.environmentId,
        InstanceId: "",
        Schema: TARGET.database,
      },
      ReadOnly: readOnly,
    });
  } catch {
    throw fail("MIGRATION_CHANNEL_SQL_FAILED");
  }
}

async function dropAccount(client) {
  await sql(client, `DROP USER IF EXISTS '${TARGET.databaseUser}'@'${TARGET.databaseHost}'`);
}

async function grantAccount(client, database) {
  await sql(client, [
    "GRANT SELECT, INSERT, UPDATE, CREATE, ALTER, DROP,",
    "CREATE ROUTINE, ALTER ROUTINE, EXECUTE",
    `ON \`${database}\`.* TO '${TARGET.databaseUser}'@'${TARGET.databaseHost}'`,
  ].join(" "));
}

function existingFunctionDetail() {
  const listed = runTcb(["fn", "list", "-e", TARGET.environmentId, "--json"]);
  const functions = listed && listed.data;
  if (!Array.isArray(functions)) throw fail("MIGRATION_CHANNEL_FUNCTION_LIST_INVALID");
  if (!functions.some((item) => item && item.name === TARGET.functionName)) return null;
  const detail = runTcb([
    "fn", "detail", TARGET.functionName,
    "-e", TARGET.environmentId,
    "--json",
  ]);
  return detail && detail.data;
}

function existingFunctionPassword(detail) {
  const variables = detail && detail.Environment && detail.Environment.Variables;
  const values = Object.fromEntries((Array.isArray(variables) ? variables : []).map((item) => [item.Key, item.Value]));
  const vpcId = detail && detail.VpcConfig && detail.VpcConfig.vpc && detail.VpcConfig.vpc.VpcId;
  const subnetId = detail && detail.VpcConfig && detail.VpcConfig.subnet && detail.VpcConfig.subnet.SubnetId;
  if (detail.FunctionName !== TARGET.functionName
    || detail.Runtime !== "Nodejs18.15"
    || detail.Status !== "Active"
    || detail.AvailableStatus !== "Available"
    || vpcId !== TARGET.vpcId
    || subnetId !== TARGET.subnetId
    || (Array.isArray(detail.Triggers) ? detail.Triggers.length : -1) !== 0
    || values.MYROOT_MYSQL_MIGRATION_ADDRESS !== TARGET.databaseAddress
    || values.MYROOT_MYSQL_MIGRATION_USERNAME !== TARGET.databaseUser
    || values.MYROOT_MYSQL_MIGRATION_DATABASE !== TARGET.database
    || values.MYROOT_MYSQL_MIGRATION_RELEASE_ID !== TARGET.releaseId
    || values.MYROOT_MYSQL_MIGRATION_CHANNEL_MODE !== "plan"
    || typeof values.MYROOT_MYSQL_MIGRATION_PASSWORD !== "string"
    || values.MYROOT_MYSQL_MIGRATION_PASSWORD.length < 32) {
    throw fail("MIGRATION_CHANNEL_EXISTING_FUNCTION_DRIFT");
  }
  return values.MYROOT_MYSQL_MIGRATION_PASSWORD;
}

function assertPackage(packageDirectory) {
  const packagePath = path.resolve(packageDirectory || "");
  if (!fs.existsSync(path.join(packagePath, "index.js"))
    || !fs.existsSync(path.join(packagePath, "package-lock.json"))
    || !fs.existsSync(path.join(packagePath, "db", "migrations", "068_formal_launch_confirmed_prelaunch_cleanup.sql"))) {
    throw fail("MIGRATION_CHANNEL_PACKAGE_INVALID");
  }
  return packagePath;
}

function functionConfig(packagePath, password, database) {
  return {
    $schema: "https://static.cloudbase.net/cli/cloudbaserc.schema.json",
    version: "2.0",
    envId: TARGET.environmentId,
    functionRoot: ".",
    functions: [{
      name: TARGET.functionName,
      dir: path.basename(packagePath),
      description: "One-time formal-launch migration channel; no triggers; apply disabled by default",
      runtime: "Nodejs18.15",
      handler: "index.main",
      timeout: 900,
      memorySize: 512,
      installDependency: true,
      vpc: { vpcId: TARGET.vpcId, subnetId: TARGET.subnetId },
      envVariables: {
        MYROOT_MYSQL_MIGRATION_ADDRESS: TARGET.databaseAddress,
        MYROOT_MYSQL_MIGRATION_USERNAME: TARGET.databaseUser,
        MYROOT_MYSQL_MIGRATION_PASSWORD: password,
        MYROOT_MYSQL_MIGRATION_DATABASE: database,
        MYROOT_MYSQL_MIGRATION_RELEASE_ID: TARGET.releaseId,
        MYROOT_MYSQL_MIGRATION_CHANNEL_MODE: "plan",
      },
      triggers: [],
    }],
  };
}

function deployFunction(packagePath, password, database, force = false) {
  const configPath = path.join(path.dirname(packagePath), "cloudbaserc.migration-channel.json");
  try {
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(functionConfig(packagePath, password, database), null, 2)}\n`,
      { mode: 0o600, flag: "wx" }
    );
    runTcbStatus([
      "--config-file", configPath,
      "-e", TARGET.environmentId,
      "fn", "deploy", TARGET.functionName,
      ...(force ? ["--force"] : []),
      "--json",
    ], {
      cwd: path.dirname(packagePath),
      errorCode: "MIGRATION_CHANNEL_FUNCTION_DEPLOY_FAILED",
    });
  } finally {
    if (fs.existsSync(configPath)) fs.rmSync(configPath, { force: true });
  }
}

async function provision(packageDirectory) {
  const packagePath = assertPackage(packageDirectory);

  const client = tcbClient();
  const conflictRows = rows(await sql(client,
    `SELECT COUNT(*) AS account_conflict FROM mysql.user WHERE User = '${TARGET.databaseUser}'`,
    true
  ));
  if (Number(firstValue(conflictRows[0], /account_conflict/i)) !== 0) {
    throw fail("MIGRATION_CHANNEL_ACCOUNT_CONFLICT");
  }
  const databaseRows = rows(await sql(client, "SELECT DATABASE() AS database_name", true));
  const database = String(firstValue(databaseRows[0], /database_name/i) || "");
  if (database !== TARGET.database) throw fail("MIGRATION_CHANNEL_DATABASE_INVALID");

  const existingFunction = existingFunctionDetail();
  if (existingFunction) {
    const password = existingFunctionPassword(existingFunction);
    let accountCreated = false;
    try {
      await sql(
        client,
        `CREATE USER '${TARGET.databaseUser}'@'${TARGET.databaseHost}' IDENTIFIED BY '${password}' PASSWORD EXPIRE NEVER ACCOUNT UNLOCK`
      );
      accountCreated = true;
      await grantAccount(client, database);
      return Object.freeze({
        ok: true,
        environmentId: TARGET.environmentId,
        functionName: TARGET.functionName,
        databaseUser: TARGET.databaseUser,
        databaseHost: TARGET.databaseHost,
        releaseId: TARGET.releaseId,
        mode: "plan",
        triggers: 0,
        reconciledExistingFunction: true,
      });
    } catch (error) {
      if (accountCreated) {
        try { await dropAccount(client); } catch {}
      }
      throw error;
    }
  }

  let accountCreated = false;
  try {
    const password = `${crypto.randomBytes(36).toString("base64url")}aA1!`;
    await sql(
      client,
      `CREATE USER '${TARGET.databaseUser}'@'${TARGET.databaseHost}' IDENTIFIED BY '${password}' PASSWORD EXPIRE NEVER ACCOUNT UNLOCK`
    );
    accountCreated = true;
    await grantAccount(client, database);

    deployFunction(packagePath, password, database, false);
    return Object.freeze({
      ok: true,
      environmentId: TARGET.environmentId,
      functionName: TARGET.functionName,
      databaseUser: TARGET.databaseUser,
      databaseHost: TARGET.databaseHost,
      releaseId: TARGET.releaseId,
      mode: "plan",
      triggers: 0,
    });
  } catch (error) {
    if (accountCreated) {
      try { await dropAccount(client); } catch {}
    }
    throw error;
  }
}

async function redeployExisting(packageDirectory) {
  const packagePath = assertPackage(packageDirectory);
  const detail = existingFunctionDetail();
  if (!detail) throw fail("MIGRATION_CHANNEL_EXISTING_FUNCTION_MISSING");
  const password = existingFunctionPassword(detail);
  const client = tcbClient();
  const accountRows = rows(await sql(client, [
    "SELECT COUNT(*) AS total_count,",
    `SUM(CASE WHEN Host = '${TARGET.databaseHost}' THEN 1 ELSE 0 END) AS exact_count`,
    `FROM mysql.user WHERE User = '${TARGET.databaseUser}'`,
  ].join(" "), true));
  if (Number(firstValue(accountRows[0], /total_count/i)) !== 1
    || Number(firstValue(accountRows[0], /exact_count/i)) !== 1) {
    throw fail("MIGRATION_CHANNEL_ACCOUNT_DRIFT");
  }
  deployFunction(packagePath, password, TARGET.database, true);
  return Object.freeze({
    ok: true,
    environmentId: TARGET.environmentId,
    functionName: TARGET.functionName,
    releaseId: TARGET.releaseId,
    mode: "plan",
    triggers: 0,
    redeployedExistingFunction: true,
  });
}

if (require.main === module) {
  const operation = process.argv[3] === "--redeploy-existing"
    ? redeployExisting(process.argv[2])
    : provision(process.argv[2]);
  operation.then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "MIGRATION_CHANNEL_PROVISION_FAILED" })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  TARGET,
  jsonFromOutput,
  existingFunctionPassword,
  provision,
  redeployExisting,
  rows,
};
