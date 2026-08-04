#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const TARGET = Object.freeze({
  environmentId: "myroot-prod-d5gl3gzg7115f149a",
  appId: "wx7727a02565aed1c2",
  serviceName: "myroot-api",
  stableVersion: "myroot-api-041",
  candidateVersion: "myroot-api-044",
  releaseId: "v1.0.0+f8e12966-formal-review-candidate-20260804",
  baseUrl: "https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com",
  database: "myroot-prod-d5gl3gzg7115f149a",
  databaseAddress: "172.17.0.2:3306",
  databaseUser: "myroot_session_revoke_044",
  databaseHost: "172.17.0.0/255.255.240.0",
  functionName: "myroot-session-revoke-044",
  vpcId: "vpc-3plmoyf8",
  subnetId: "subnet-entx2uvt",
  projectPath: path.resolve(__dirname, "../../miniprogram"),
  packagePath: path.resolve(__dirname, "../session-revoke-channel"),
  configPath: path.resolve(__dirname, "../.cloudbaserc.session-revoke-044.json"),
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw fail(options.errorCode || "COMMAND_FAILED");
  return result.stdout;
}

function jsonOutput(stdout, errorCode = "COMMAND_JSON_INVALID") {
  const source = String(stdout || "");
  const start = source.indexOf("{");
  if (start < 0) throw fail(errorCode);
  try { return JSON.parse(source.slice(start)); } catch { throw fail(errorCode); }
}

function api(service, action, body, apiVersion) {
  return jsonOutput(run("tcb", [
    "api", service, action,
    "--api-version", apiVersion,
    "--body", JSON.stringify(body),
    "--json",
  ], { errorCode: `API_${action.toUpperCase()}_FAILED` }));
}

function rows(payload) {
  const value = payload && (payload.data || payload.Response || payload).Items;
  if (!Array.isArray(value)) throw fail("RUNSQL_ROWS_INVALID");
  return value.map((item) => {
    try { return JSON.parse(item); } catch { throw fail("RUNSQL_ROWS_INVALID"); }
  });
}

function sql(sqlText, readOnly = false) {
  return api("tcb", "RunSql", {
    EnvId: TARGET.environmentId,
    Sql: sqlText,
    DbInstance: { EnvId: TARGET.environmentId, InstanceId: "", Schema: TARGET.database },
    ReadOnly: readOnly,
  }, "2018-06-08");
}

function releaseGuard() {
  const payload = api("tcbr", "DescribeReleaseOrder", {
    EnvId: TARGET.environmentId,
    ServerName: TARGET.serviceName,
  }, "2022-02-17");
  const data = payload.data || payload.Response || payload;
  const info = data.ReleaseOrderInfo;
  if (!info
    || info.CurrentVersion.VersionName !== TARGET.stableVersion
    || info.ReleaseVersion.VersionName !== TARGET.candidateVersion
    || info.TrafficType !== "URL_PARAMS"
    || Number(info.FlowRatio) !== 0
    || info.GrayStatus !== "success"
    || info.ReleaseStatus !== "gray"
    || info.IsReleasing !== true
    || !Array.isArray(info.TrafficTypeValues)
    || info.TrafficTypeValues.length !== 1
    || !info.TrafficTypeValues[0].Key
    || !info.TrafficTypeValues[0].Value) {
    throw fail("RELEASE_GUARD_FAILED");
  }
  return Object.freeze({
    routeKey: info.TrafficTypeValues[0].Key,
    routeValue: info.TrafficTypeValues[0].Value,
  });
}

function recoverSingleToken() {
  const stdout = run("wechatide", [
    "-c", "Codex", "get_simulator_network",
    "--project", TARGET.projectPath,
    "--command", "grep -i Authorization",
  ], { errorCode: "WECHATIDE_NETWORK_READ_FAILED" });
  const tokens = [...stdout.matchAll(/Bearer\s+([A-Za-z0-9._~-]+)/g)].map((match) => match[1]);
  const distinct = [...new Set(tokens)];
  if (distinct.length !== 1) throw fail("EXACT_SINGLE_BEARER_NOT_FOUND");
  return distinct[0];
}

function functionList() {
  const payload = jsonOutput(run("tcb", ["fn", "list", "-e", TARGET.environmentId, "--json"], {
    errorCode: "FUNCTION_LIST_FAILED",
  }));
  const data = payload.data || payload;
  if (!Array.isArray(data)) throw fail("FUNCTION_LIST_INVALID");
  return data;
}

function accountCount() {
  const result = rows(sql(
    `SELECT COUNT(*) AS account_count FROM mysql.user WHERE User = '${TARGET.databaseUser}'`,
    true
  ));
  return Number(result[0] && result[0].account_count || 0);
}

function config(password, tokenHash, mode, authorization = "") {
  return {
    $schema: "https://static.cloudbase.net/cli/cloudbaserc.schema.json",
    version: "2.0",
    envId: TARGET.environmentId,
    functionRoot: ".",
    functions: [{
      name: TARGET.functionName,
      dir: "session-revoke-channel",
      description: "One-time exact session revocation for 044; no triggers; fixed snapshot target",
      runtime: "Nodejs18.15",
      handler: "index.main",
      timeout: 60,
      memorySize: 256,
      installDependency: true,
      vpc: { vpcId: TARGET.vpcId, subnetId: TARGET.subnetId },
      envVariables: {
        MYROOT_SESSION_REVOKE_ADDRESS: TARGET.databaseAddress,
        MYROOT_SESSION_REVOKE_USERNAME: TARGET.databaseUser,
        MYROOT_SESSION_REVOKE_PASSWORD: password,
        MYROOT_SESSION_REVOKE_DATABASE: TARGET.database,
        MYROOT_SESSION_REVOKE_RELEASE_ID: TARGET.releaseId,
        MYROOT_SESSION_REVOKE_STORE_KEY: "root-checkin",
        MYROOT_SESSION_REVOKE_TOKEN_HASH: tokenHash,
        MYROOT_SESSION_REVOKE_MODE: mode,
        ...(mode === "apply" ? {
          MYROOT_SESSION_REVOKE_WRITE_CONFIRM: `REVOKE:production:${TARGET.releaseId}:${authorization}`,
        } : {}),
      },
      triggers: [],
    }],
  };
}

function deploy(password, tokenHash, mode, authorization = "", force = false) {
  fs.writeFileSync(TARGET.configPath, `${JSON.stringify(config(password, tokenHash, mode, authorization), null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  try {
    run("tcb", [
      "--config-file", TARGET.configPath,
      "-e", TARGET.environmentId,
      "fn", "deploy", TARGET.functionName,
      ...(force ? ["--force"] : []),
      "--json",
    ], { cwd: path.dirname(TARGET.packagePath), errorCode: "FUNCTION_DEPLOY_FAILED" });
  } finally {
    fs.rmSync(TARGET.configPath, { force: true });
  }
}

function invoke(data) {
  const payload = jsonOutput(run("tcb", [
    "fn", "invoke", TARGET.functionName,
    "-e", TARGET.environmentId,
    "-d", JSON.stringify(data),
    "--json",
  ], { errorCode: "FUNCTION_INVOKE_FAILED" }), "FUNCTION_INVOKE_JSON_INVALID");
  const serialized = JSON.stringify(payload);
  if (serialized.includes("SESSION_REVOKE_")) throw fail("FUNCTION_REPORTED_FAILURE");
  return payload;
}

function resultHas(payload, expected) {
  const source = JSON.stringify(payload);
  return Object.entries(expected).every(([key, value]) => source.includes(`\\\"${key}\\\":${JSON.stringify(value)}`)
    || source.includes(`\"${key}\":${JSON.stringify(value)}`));
}

async function verifyOldTokenRejected(token, route) {
  const url = new URL(TARGET.baseUrl);
  url.pathname = "/api/v1/privacy/health-consent";
  url.searchParams.set(route.routeKey, route.routeValue);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  let body = {};
  try { body = await response.json(); } catch {}
  if (response.status !== 401 || Number(body && body.code) !== 1003) {
    throw fail("REVOKED_TOKEN_RUNTIME_CHECK_FAILED");
  }
}

function cleanup() {
  const errors = [];
  try {
    if (functionList().some((item) => item && item.name === TARGET.functionName)) {
      run("tcb", ["fn", "delete", TARGET.functionName, "-e", TARGET.environmentId, "--json"], {
        errorCode: "FUNCTION_DELETE_FAILED",
      });
    }
  } catch (error) { errors.push(error.code || "FUNCTION_DELETE_FAILED"); }
  try { sql(`DROP USER IF EXISTS '${TARGET.databaseUser}'@'${TARGET.databaseHost}'`); }
  catch (error) { errors.push(error.code || "ACCOUNT_DROP_FAILED"); }
  if (errors.length) throw fail(`CLEANUP_FAILED:${errors.join(",")}`);
}

function waitForFunctionDeletion() {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    if (!functionList().some((item) => item && item.name === TARGET.functionName)) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  return false;
}

async function execute() {
  if (!fs.existsSync(path.join(TARGET.packagePath, "index.js"))
    || !fs.existsSync(path.join(TARGET.packagePath, "package-lock.json"))) {
    throw fail("FUNCTION_PACKAGE_INVALID");
  }
  if (fs.existsSync(TARGET.configPath)) throw fail("TEMP_CONFIG_ALREADY_EXISTS");
  const route = releaseGuard();
  const token = recoverSingleToken();
  const tokenHash = `sha256:v1:${crypto.createHash("sha256").update(token, "utf8").digest("hex")}`;
  const authorization = crypto.randomBytes(32).toString("hex");
  if (functionList().some((item) => item && item.name === TARGET.functionName)) {
    throw fail("FUNCTION_NAME_CONFLICT");
  }
  if (accountCount() !== 0) throw fail("DATABASE_ACCOUNT_CONFLICT");

  const password = `${crypto.randomBytes(36).toString("base64url")}aA1!`;
  let created = false;
  try {
    sql(`CREATE USER '${TARGET.databaseUser}'@'${TARGET.databaseHost}' IDENTIFIED BY '${password}' PASSWORD EXPIRE NEVER ACCOUNT UNLOCK`);
    created = true;
    sql(`GRANT SELECT, UPDATE ON \`${TARGET.database}\`.\`root_store_snapshot\` TO '${TARGET.databaseUser}'@'${TARGET.databaseHost}'`);
    process.stdout.write("channel-account-ready\n");

    deploy(password, tokenHash, "preview");
    process.stdout.write("channel-preview-deployed\n");
    const preview = invoke({ action: "preview" });
    if (!resultHas(preview, { exactMatchCount: 1, activeMatchCount: 1, tokenMapEntryPresent: true })) {
      throw fail("PREVIEW_RESULT_INVALID");
    }
    process.stdout.write("exact-session-preview-passed\n");

    deploy(password, tokenHash, "apply", authorization, true);
    process.stdout.write("channel-apply-gate-deployed\n");
    const applied = invoke({ action: "apply", authorization });
    if (!resultHas(applied, { revokedCount: 1, tokenMapEntryRemoved: true })) {
      throw fail("APPLY_RESULT_INVALID");
    }
    process.stdout.write("exact-session-revoked\n");

    await verifyOldTokenRejected(token, route);
    process.stdout.write("revoked-token-runtime-check-passed\n");
  } finally {
    if (created || functionList().some((item) => item && item.name === TARGET.functionName)) cleanup();
    fs.rmSync(TARGET.configPath, { force: true });
  }

  if (!waitForFunctionDeletion()) {
    throw fail("FUNCTION_CLEANUP_VERIFY_FAILED");
  }
  if (accountCount() !== 0) throw fail("ACCOUNT_CLEANUP_VERIFY_FAILED");
  releaseGuard();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    revokedCount: 1,
    oldTokenRejected: true,
    functionDeleted: true,
    accountRevoked: true,
    stableDefault: TARGET.stableVersion,
    candidate: TARGET.candidateVersion,
    candidateTrafficPercent: 0,
  }, null, 2)}\n`);
}

if (require.main === module) {
  execute().catch((error) => {
    try { fs.rmSync(TARGET.configPath, { force: true }); } catch {}
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "SESSION_REVOKE_EXECUTION_FAILED" })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { TARGET, execute, releaseGuard, resultHas };
