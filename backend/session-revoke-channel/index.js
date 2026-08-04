"use strict";

const crypto = require("node:crypto");

const AUTHORIZATION_PATTERN = /^[0-9a-f]{64}$/;
const TOKEN_DIGEST_PATTERN = /^sha256:v1:[0-9a-f]{64}$/;
const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/;
const MYSQL_SCHEMA_VERSION = 28;

function channelError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function connectionConfig(env = process.env) {
  const address = text(env.MYROOT_SESSION_REVOKE_ADDRESS);
  const match = address.match(/^([^:]+):(\d+)$/);
  const user = text(env.MYROOT_SESSION_REVOKE_USERNAME);
  const password = typeof env.MYROOT_SESSION_REVOKE_PASSWORD === "string"
    ? env.MYROOT_SESSION_REVOKE_PASSWORD
    : "";
  const database = text(env.MYROOT_SESSION_REVOKE_DATABASE);
  if (!match || !user || !password || !/^[A-Za-z0-9_-]+$/.test(database)) {
    throw channelError("SESSION_REVOKE_CHANNEL_CONFIG_INVALID");
  }
  return Object.freeze({
    host: match[1],
    port: Number(match[2]),
    user,
    password,
    database,
    charset: "utf8mb4",
    timezone: "+08:00",
    dateStrings: true,
    multipleStatements: false,
    waitForConnections: true,
    connectionLimit: 1,
    queueLimit: 0,
    connectTimeout: 10000,
    enableKeepAlive: true,
  });
}

function target(env = process.env) {
  const tokenHash = text(env.MYROOT_SESSION_REVOKE_TOKEN_HASH);
  const releaseId = text(env.MYROOT_SESSION_REVOKE_RELEASE_ID);
  const storeKey = text(env.MYROOT_SESSION_REVOKE_STORE_KEY);
  if (!TOKEN_DIGEST_PATTERN.test(tokenHash)
    || !RELEASE_ID_PATTERN.test(releaseId)
    || storeKey !== "root-checkin") {
    throw channelError("SESSION_REVOKE_TARGET_INVALID");
  }
  return Object.freeze({ tokenHash, releaseId, storeKey });
}

function assertApplyAuthorization(event = {}, env = process.env) {
  if (env.MYROOT_SESSION_REVOKE_MODE !== "apply") {
    throw channelError("SESSION_REVOKE_APPLY_DISABLED");
  }
  const authorization = text(event.authorization);
  if (!AUTHORIZATION_PATTERN.test(authorization)) {
    throw channelError("SESSION_REVOKE_AUTHORIZATION_INVALID");
  }
  const expected = `REVOKE:production:${target(env).releaseId}:${authorization}`;
  const actual = String(env.MYROOT_SESSION_REVOKE_WRITE_CONFIRM || "");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (actualBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw channelError("SESSION_REVOKE_WRITE_CONFIRMATION_MISMATCH");
  }
}

function parsePayload(value) {
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) return value;
  try {
    const parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value || ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw channelError("SESSION_REVOKE_SNAPSHOT_INVALID");
  }
}

function inspectPayload(payload, tokenHash) {
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const matches = sessions.filter((item) => item && item.token_hash === tokenHash);
  const active = matches.filter((item) => !text(item.revoked_at));
  const tokenPresent = Boolean(payload.tokens
    && typeof payload.tokens === "object"
    && Object.prototype.hasOwnProperty.call(payload.tokens, tokenHash));
  return Object.freeze({ matches, active, tokenPresent });
}

function runtimeDependencies() {
  return { mysql: require("mysql2/promise") };
}

async function execute(event = {}, dependencies = runtimeDependencies(), env = process.env) {
  const action = text(event.action) || "preview";
  if (!new Set(["preview", "apply"]).has(action)) {
    throw channelError("SESSION_REVOKE_ACTION_INVALID");
  }
  if (action === "apply") assertApplyAuthorization(event, env);

  const fixedTarget = target(env);
  const pool = dependencies.mysql.createPool(connectionConfig(env));
  const connection = await pool.getConnection();
  let transactionOpen = false;
  try {
    if (action === "apply") {
      await connection.beginTransaction();
      transactionOpen = true;
    }
    const [rows] = await connection.query(
      `SELECT revision, payload_json FROM root_store_snapshot WHERE store_key = ?${action === "apply" ? " FOR UPDATE" : ""}`,
      [fixedTarget.storeKey]
    );
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw channelError("SESSION_REVOKE_SNAPSHOT_ROW_INVALID");
    }
    const revision = Number(rows[0].revision);
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw channelError("SESSION_REVOKE_REVISION_INVALID");
    }
    const payload = parsePayload(rows[0].payload_json);
    const before = inspectPayload(payload, fixedTarget.tokenHash);
    if (before.matches.length !== 1 || before.active.length !== 1 || !before.tokenPresent) {
      throw channelError("SESSION_REVOKE_EXACT_ACTIVE_SESSION_NOT_FOUND");
    }
    if (action === "preview") {
      return Object.freeze({
        ok: true,
        mode: "preview",
        target: "production",
        releaseId: fixedTarget.releaseId,
        revision,
        exactMatchCount: 1,
        activeMatchCount: 1,
        tokenMapEntryPresent: true,
      });
    }

    const revokedAt = new Date().toISOString();
    before.matches[0].revoked_at = revokedAt;
    delete payload.tokens[fixedTarget.tokenHash];
    const [update] = await connection.query(
      `UPDATE root_store_snapshot
       SET schema_version = ?, revision = ?, payload_json = ?, updated_at = CURRENT_TIMESTAMP(3)
       WHERE store_key = ? AND revision = ?`,
      [MYSQL_SCHEMA_VERSION, revision + 1, JSON.stringify(payload), fixedTarget.storeKey, revision]
    );
    if (!update || update.affectedRows !== 1) {
      throw channelError("SESSION_REVOKE_CAS_FAILED");
    }

    const [verifiedRows] = await connection.query(
      "SELECT revision, payload_json FROM root_store_snapshot WHERE store_key = ?",
      [fixedTarget.storeKey]
    );
    if (!Array.isArray(verifiedRows) || verifiedRows.length !== 1) {
      throw channelError("SESSION_REVOKE_READBACK_FAILED");
    }
    const after = inspectPayload(parsePayload(verifiedRows[0].payload_json), fixedTarget.tokenHash);
    if (after.matches.length !== 1 || after.active.length !== 0 || after.tokenPresent) {
      throw channelError("SESSION_REVOKE_READBACK_FAILED");
    }
    await connection.commit();
    transactionOpen = false;
    return Object.freeze({
      ok: true,
      mode: "apply",
      target: "production",
      releaseId: fixedTarget.releaseId,
      beforeRevision: revision,
      afterRevision: revision + 1,
      revokedCount: 1,
      tokenMapEntryRemoved: true,
    });
  } catch (error) {
    if (transactionOpen) {
      try { await connection.rollback(); } catch {}
    }
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

async function main(event = {}) {
  return execute(event, runtimeDependencies(), process.env);
}

exports.main = main;
exports.execute = execute;
exports.assertApplyAuthorization = assertApplyAuthorization;
exports.connectionConfig = connectionConfig;
exports.inspectPayload = inspectPayload;
exports.parsePayload = parsePayload;
exports.target = target;
