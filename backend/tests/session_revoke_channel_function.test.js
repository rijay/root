"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const channel = require("../session-revoke-channel/index");

const TOKEN_HASH = `sha256:v1:${"b".repeat(64)}`;
const AUTHORIZATION = "a".repeat(64);
const BASE_ENV = Object.freeze({
  MYROOT_SESSION_REVOKE_ADDRESS: "172.17.0.2:3306",
  MYROOT_SESSION_REVOKE_USERNAME: "myroot_session_revoke_044",
  MYROOT_SESSION_REVOKE_PASSWORD: "fixture-only",
  MYROOT_SESSION_REVOKE_DATABASE: "myroot-prod-d5gl3gzg7115f149a",
  MYROOT_SESSION_REVOKE_RELEASE_ID: "v1.0.0+f8e12966-formal-review-candidate-20260804",
  MYROOT_SESSION_REVOKE_STORE_KEY: "root-checkin",
  MYROOT_SESSION_REVOKE_TOKEN_HASH: TOKEN_HASH,
});

function fixture() {
  return {
    sessions: [{ session_id: "session-1", user_id: "user-1", token_hash: TOKEN_HASH, revoked_at: "" }],
    tokens: { [TOKEN_HASH]: "user-1" },
    unrelated: [{ keep: true }],
  };
}

function dependencies(payload = fixture()) {
  let revision = 4;
  let persisted = structuredClone(payload);
  const calls = [];
  const connection = {
    beginTransaction: async () => calls.push("begin"),
    commit: async () => calls.push("commit"),
    rollback: async () => calls.push("rollback"),
    release: () => calls.push("release"),
    query: async (sql, values) => {
      if (/^SELECT revision/i.test(sql.trim())) {
        return [[{ revision, payload_json: JSON.stringify(persisted) }]];
      }
      if (/^UPDATE root_store_snapshot/i.test(sql.trim())) {
        assert.deepEqual(values.slice(0, 2), [28, 5]);
        assert.equal(values[3], "root-checkin");
        assert.equal(values[4], 4);
        persisted = JSON.parse(values[2]);
        revision = values[1];
        return [{ affectedRows: 1 }];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  return {
    adapter: { mysql: { createPool: () => ({
      getConnection: async () => connection,
      end: async () => calls.push("end"),
    }) } },
    calls,
    snapshot: () => structuredClone(persisted),
  };
}

test("preview proves exactly one active session without changing the snapshot", async () => {
  const fake = dependencies();
  const result = await channel.execute({ action: "preview" }, fake.adapter, BASE_ENV);
  assert.equal(result.exactMatchCount, 1);
  assert.equal(result.activeMatchCount, 1);
  assert.equal(fake.snapshot().sessions[0].revoked_at, "");
  assert.deepEqual(fake.calls, ["release", "end"]);
});

test("apply revokes the one digest, removes its token map entry and preserves unrelated data", async () => {
  const fake = dependencies();
  const env = {
    ...BASE_ENV,
    MYROOT_SESSION_REVOKE_MODE: "apply",
    MYROOT_SESSION_REVOKE_WRITE_CONFIRM: `REVOKE:production:${BASE_ENV.MYROOT_SESSION_REVOKE_RELEASE_ID}:${AUTHORIZATION}`,
  };
  const result = await channel.execute({ action: "apply", authorization: AUTHORIZATION }, fake.adapter, env);
  assert.equal(result.revokedCount, 1);
  assert.match(fake.snapshot().sessions[0].revoked_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(Object.hasOwn(fake.snapshot().tokens, TOKEN_HASH), false);
  assert.deepEqual(fake.snapshot().unrelated, [{ keep: true }]);
  assert.deepEqual(fake.calls, ["begin", "commit", "release", "end"]);
});

test("apply is closed unless both the mode and release-bound confirmation match", () => {
  assert.throws(
    () => channel.assertApplyAuthorization({ authorization: AUTHORIZATION }, BASE_ENV),
    { code: "SESSION_REVOKE_APPLY_DISABLED" }
  );
  assert.throws(
    () => channel.assertApplyAuthorization(
      { authorization: AUTHORIZATION },
      { ...BASE_ENV, MYROOT_SESSION_REVOKE_MODE: "apply", MYROOT_SESSION_REVOKE_WRITE_CONFIRM: "wrong" }
    ),
    { code: "SESSION_REVOKE_WRITE_CONFIRMATION_MISMATCH" }
  );
});

test("duplicate or already-revoked matches fail closed before any update", async () => {
  const duplicate = fixture();
  duplicate.sessions.push({ ...duplicate.sessions[0], session_id: "session-2" });
  await assert.rejects(
    channel.execute({ action: "preview" }, dependencies(duplicate).adapter, BASE_ENV),
    { code: "SESSION_REVOKE_EXACT_ACTIVE_SESSION_NOT_FOUND" }
  );
  const revoked = fixture();
  revoked.sessions[0].revoked_at = "2026-08-04T00:00:00.000Z";
  await assert.rejects(
    channel.execute({ action: "preview" }, dependencies(revoked).adapter, BASE_ENV),
    { code: "SESSION_REVOKE_EXACT_ACTIVE_SESSION_NOT_FOUND" }
  );
});
