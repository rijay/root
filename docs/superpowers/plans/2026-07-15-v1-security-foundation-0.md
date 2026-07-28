# myRoot v1.0.0 Security Foundation 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the code-fixable v1.0.0 launch P0s for trusted identity, authorization, credential representation, runtime persistence, and continuous verification without changing production data or releasing a candidate.

**Architecture:** Put trust decisions behind small, explicit Module Interfaces. The HTTP Adapter may pass only a verified WeChat assertion to the Identity Module; session lookup stores a one-way digest rather than bearer material; production runtime fails closed unless a persistent Store Adapter is configured. Existing local compatibility remains explicit and cannot silently activate in production/cloud runtime.

**Tech Stack:** Node.js 20, CommonJS, `node:test`, existing snapshot/MySQL Store adapters, GitHub Actions, root `npm run verify`.

**Execution constraints:** Work on `codex/v1.0.0-foundation-20260715`. Do not deploy, migrate production data, send messages, upload a candidate, or change any `0.5.13` version. The shared checkout already contains user-owned Design/PRD changes, so commits are deferred; each task ends with a path-scoped diff and test checkpoint.

**Local execution status:** `LOCAL_CODE_SLICE_COMPLETE / REMOTE_AND_CANDIDATE_EVIDENCE_PENDING`。计划内本地代码步骤已在 2026-07-15 完成；状态不代表 PRD baseline、远端 CI、平台身份、生产迁移、候选或发布 Gate 已关闭。

---

### Task 1: Record the executable Wave 1 scope

**Files:**
- Create: `docs/superpowers/plans/2026-07-15-v1-security-foundation-0.md`
- Modify: `docs/v1.0.0_technical_review_2026-07-15.md`

- [x] **Step 1: Preserve the Gate distinction**

Record that the user authorized formal code development, while named PRD sign-off, production migration, candidate creation, and release remain separate evidence.

- [x] **Step 2: Confirm the branch and baseline**

Run: `git branch --show-current && npm run verify`

Expected: branch `codex/v1.0.0-foundation-20260715`; existing full verification passes before security changes.

- [x] **Step 3: Record a diff checkpoint**

Run: `git status --short && git diff --check`

Expected: existing user changes remain present and no whitespace errors are introduced.

### Task 2: Trusted WeChat Identity Module

**Files:**
- Create: `backend/src/trustedWechatIdentity.js`
- Create: `backend/tests/trusted_wechat_identity.test.js`
- Modify: `backend/src/app.js`
- Modify: `backend/src/domain.js`
- Modify: `backend/tests/api.test.js`

- [x] **Step 1: Write failing trust tests**

Test these exact cases:

```js
test("raw X-WX headers are not identity assertions", async () => {
  const result = await resolveTrustedWechatIdentity({ headers: { "x-wx-openid": "spoofed" } });
  assert.equal(result, null);
});

test("a verified Adapter assertion is normalized", async () => {
  const result = await resolveTrustedWechatIdentity({
    adapter: async () => ({ openid: "openid_verified", unionid: "union_verified", source: "CLOUDBASE" }),
  });
  assert.equal(result.openid, "openid_verified");
});
```

Add an HTTP test proving raw headers alone cannot create `rootUsers`, plus a test proving an injected verified Adapter can log in.

- [x] **Step 2: Verify the tests fail**

Run: `node --test backend/tests/trusted_wechat_identity.test.js`

Expected: FAIL because the Module does not exist.

- [x] **Step 3: Implement the trust seam**

Expose one Interface:

```js
async function resolveTrustedWechatIdentity({ adapter, request, env }) {
  if (typeof adapter !== "function") return null;
  const assertion = await adapter({ request, env });
  return normalizeVerifiedAssertion(assertion);
}
```

The Module must reject missing `openid`, overlong values, unknown sources, and raw header fallback. `createApp()` injects the verified assertion into `loginWithWechat`; `domain.js` reads only `context.trustedWechatIdentity`, `wxCode`, or explicit non-production test overrides. The CloudBase identity probe may report raw header presence only as an untrusted observation; it reaches `READY` solely from the same verified Adapter assertion.

- [x] **Step 4: Run focused and backend tests**

Run: `node --test backend/tests/trusted_wechat_identity.test.js backend/tests/api.test.js && npm test --prefix backend`

Expected: all pass; spoofed headers create no user.

- [x] **Step 5: Record the path-scoped diff**

Run: `git diff --check -- backend/src/trustedWechatIdentity.js backend/src/app.js backend/src/domain.js backend/tests/trusted_wechat_identity.test.js backend/tests/api.test.js`

### Task 3: Credential Protection Module

**Files:**
- Create: `backend/src/credentialProtection.js`
- Create: `backend/tests/credential_protection.test.js`
- Modify: `backend/src/identity.js`
- Modify: `backend/src/domain.js`
- Modify: `backend/src/store.js`
- Modify: `backend/tests/domain.test.js`

- [x] **Step 1: Write failing representation tests**

Cover deterministic keyed phone HMAC, different-key separation, raw-phone absence, session digest lookup, expiry/revocation, and rejection of legacy token-map-only authentication.

```js
assert.match(phoneFingerprint("13800000000", { ROOT_PHONE_HMAC_KEY: "key-a" }), /^hmac-sha256:v1:/);
assert.notEqual(sessionTokenDigest("root_secret"), "root_secret");
```

- [x] **Step 2: Verify the tests fail**

Run: `node --test backend/tests/credential_protection.test.js`

Expected: FAIL because the Module does not exist.

- [x] **Step 3: Implement minimal protection**

Use `HMAC-SHA-256` with `ROOT_PHONE_HMAC_KEY` for enumerable phone values and `SHA-256` for high-entropy random session tokens. New session records contain `token_hash`, never `token`; `data.tokens` uses the digest as its key. Legacy raw session fields may be read only through a one-way normalization path that deletes raw material and preserves expiry; a token-map entry without a session is rejected.

- [x] **Step 4: Wire the Identity and session implementations**

Pass the runtime environment to contact fingerprinting. Production/cloud runtime without `ROOT_PHONE_HMAC_KEY` must fail when a phone fingerprint is required. Preserve only `phone_masked` plus the versioned HMAC in `userContactMethods`.

- [x] **Step 5: Run focused and backend tests**

Run: `node --test backend/tests/credential_protection.test.js backend/tests/domain.test.js && npm test --prefix backend`

Expected: all pass; persisted snapshot serialization contains neither a newly issued bearer token nor an unmasked contact phone in `phone_hash`.

### Task 4: Admin Authorization Module coverage

**Files:**
- Modify: `backend/src/adminAccessControl.js`
- Modify: `backend/src/app.js`
- Modify: focused tests selected by implementation

- [x] **Step 1: Add denial tests**

For task completion/resolution and refund/coupon writes, prove a valid viewer or wrong-capability principal receives `40301` and produces no state mutation.

- [x] **Step 2: Verify tests fail before routing changes**

Run the focused `node --test` command reported in the task diff.

- [x] **Step 3: Route every command through authorization**

Use precise resource/action capabilities; preserve `requestId`, `operatorId`, and audit records. Do not add a broad wildcard capability.

- [x] **Step 4: Run focused and complete backend tests**

Run: `npm test --prefix backend`

Expected: all backend tests pass and denial tests prove no mutation.

### Task 5: Runtime Persistence Guard

**Files:**
- Create: `backend/src/runtimePersistenceGuard.js`
- Create: `backend/tests/runtime_persistence_guard.test.js`
- Modify: `backend/src/server.js`
- Modify: `backend/src/app.js`

- [x] **Step 1: Add fail-close tests**

Cover production and CloudBase runtime with no Store configuration, local/test memory allowance, and `/ready` returning `503` for a non-persistent Adapter in a persistent-required runtime.

- [x] **Step 2: Verify tests fail**

Run: `node --test backend/tests/runtime_persistence_guard.test.js`

- [x] **Step 3: Implement the guard Interface**

```js
function getRuntimePersistenceStatus({ env, storeAdapter }) {
  return { required, allowed, reason, transactional, multiInstanceSafe };
}
```

`server.js` throws before listening when `required && !allowed`; `createApp()` marks readiness unavailable under the same policy. Memory remains available only for explicit local/test use.

- [x] **Step 4: Run focused and complete backend tests**

Run: `node --test backend/tests/runtime_persistence_guard.test.js backend/tests/api.test.js && npm test --prefix backend`

### Task 6: Continuous Integration Gate

**Files:**
- Create: `.github/workflows/ci.yml`

- [x] **Step 1: Add a least-privilege workflow**

Use `permissions: contents: read`, Node 20, `timeout-minutes`, concurrency cancellation, and `npm ci` for each existing lockfile root（当前只有 `backend/package-lock.json` 与 `admin/package-lock.json`；仓库根目录没有 lockfile，因此不得虚构根目录 `npm ci`）。Run only `npm run verify`; do not reference deployment secrets or release actions.

- [x] **Step 2: Validate the workflow locally**

Parse the YAML with an available parser or verify its structure through a focused Node/static test. Confirm every `working-directory` and lockfile path exists.

- [x] **Step 3: Run the same command CI will execute**

Run: `npm run verify`

Expected: all verification items pass.

### Task 7: Integration and adversarial review

**Files:**
- Modify: `docs/v1.0.0_technical_review_2026-07-15.md`
- Modify: this plan checkbox state

- [x] **Step 1: Run the complete verification matrix**

Run:

```bash
npm test --prefix backend
npm run v1:routes:check
npm run verify
git diff --check
```

- [x] **Step 2: Attack the implementation**

Verify at least these five failure paths: spoofed WeChat header, viewer Admin write, missing production Store, raw bearer persistence, and missing phone HMAC key in production/cloud runtime.

- [x] **Step 3: Update the technical record**

For each original P0, mark `CLOSED_IN_CODE`, `PARTIAL`, or `OPEN`; do not use `CLOSED` until CI has run remotely and platform/production evidence exists.

- [x] **Step 4: Record residual Gate state**

后续 Command/Event 计划已建立 scoped command 与孤立状态转换合同；下一步仍是命令 crash recovery、直接关系 Adapter、主事实/outbox 同事务、dispatcher 与真实 MySQL 多实例故障注入。Named baseline sign-off、平台断言与远端 required check 仍是外部证据，不是本代码 diff 可以制造的事实。
