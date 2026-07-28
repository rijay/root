# myRoot v1.0.0 Command and Event Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace request-id-only process logic at the current HTTP write Seam with scoped command identity, and freeze an isolated Event Transport state-transition contract plus target relational schema. This plan does not prove command crash recovery, background dispatch, or multi-instance runtime correctness.

**Architecture:** A Command Idempotency Module owns command scope, request digest, replay, and conflict semantics at the current snapshot Seam. An isolated, pure-state Event Transport Module defines outbox/inbox/dead-letter/checkpoint transitions over snapshot arrays and does not yet have a business call path or dispatcher. Migration `006` freezes target relational seams and uniqueness for a later direct Adapter; schema presence does not make the current runtime relational or multi-instance safe.

**Tech Stack:** Node.js 20, CommonJS, `node:test`, current snapshot/MySQL Store, immutable SQL migrations, SHA-256 canonical request digests.

**Execution constraints:** No production migration, external send, reward issuance, candidate, deployment, version change, commit, or push. Business Module integration is limited to the generic HTTP command seam; health/activity/reward semantics remain blocked until their facts are frozen.

**Local execution status:** `LOCAL_CONTRACT_FOUNDATION_COMPLETE / OUTBOX_DISPATCHER_CORE_LOCAL_COMPLETE / INBOX_EXTERNAL_DELIVERY_REAL_MYSQL_PENDING`。本地 scoped command、状态转换合同、migration `006`–`009`、首个 direct command/producer 与纯关系 outbox dispatcher core 已完成；V1-T04 仍未因本计划自动关闭。

---

### Task 1: Command Idempotency Module

**Files:**
- Create: `backend/src/commandIdempotency.js`
- Create: `backend/tests/command_idempotency.test.js`

- [x] **Step 1: Write the failing contract tests**

Cover canonical digest stability, scope separation, successful replay without invoking the action twice, digest conflict, async success, and failed-attempt retry.

```js
const input = {
  commandName: "TASK_COMPLETE",
  actorId: "operator-1",
  idempotencyKey: "request-1",
  request: { taskId: "task-1", status: "DONE" },
};
```

Same scope/key/digest must return the persisted success. Same scope/key with a different request digest must return code `40901` with HTTP 409.

- [x] **Step 2: Implement the deep Interface**

Expose `digestCommandRequest(value)` and `executeIdempotentCommand(data, input, action, context)`. Persist the equivalent camel-case snapshot facts in `commandIdempotencyRecords`; migration `006` freezes their relational column names.

- [x] **Step 3: Run focused tests**

Run: `node --test backend/tests/command_idempotency.test.js`

Expected: all pass.

### Task 2: Isolated Event Transport State-Transition Module

**Files:**
- Create: `backend/src/eventTransport.js`
- Create: `backend/tests/event_transport.test.js`

- [x] **Step 1: Write failure-injection tests**

Cover duplicate enqueue, conflicting event digest, lease claim/reclaim, retry, max-attempt dead-letter, inbox duplicate, inbox digest conflict, failed receipt retry, and checkpoint gap handling.

- [x] **Step 2: Implement outbox and inbox facts**

Expose explicit pure-state functions for enqueue, claim, sent/retry/dead-letter, inbox begin/complete/fail, and checkpoint calculation over snapshot arrays. No function may call a network or external Adapter；本 Task 不建立业务调用路径、dispatcher 或直接关系 Adapter。

- [x] **Step 3: Enforce contiguous checkpoint progression**

For one consumer and aggregate, completed sequences `1,2,4` produce checkpoint `2`; completing sequence `3` advances it to `4`. Failed/dead-letter receipts do not get skipped automatically.

- [x] **Step 4: Run focused tests**

Run: `node --test backend/tests/event_transport.test.js`

Expected: all pass.

### Task 3: Relational target schema

**Files:**
- Create: `backend/db/migrations/006_command_event_foundation.sql`
- Modify: `backend/db/migrations/checksums.json`
- Modify: `backend/src/store.js`
- Verify unchanged: `backend/src/mysqlProjection.js`
- Create: `backend/tests/command_event_schema.test.js`

- [x] **Step 1: Write schema contract tests**

Assert all five tables, their primary keys, scope uniqueness, due/lease indexes, consumer-event uniqueness, dead-letter lookup, and consumer checkpoint uniqueness.

- [x] **Step 2: Add immutable migration 006**

Create `command_idempotency`, `outbox_event`, `inbox_receipt`, `event_dead_letter`, and `consumer_checkpoint`. Use JSON for request/result/payload/error detail, DATETIME(3), explicit statuses, and unique keys matching Module scope.

- [x] **Step 3: Update projection and checksum authority**

Increase `MYSQL_SCHEMA_VERSION` to `6`, register snapshot compatibility arrays/duplicate checks, and regenerate only the checksum manifest entry for the immutable new file。五张操作事实表保持在会 stale-delete 的 snapshot projection 之外。

- [x] **Step 4: Run schema and checksum tests**

Run: `node --test backend/tests/command_event_schema.test.js backend/tests/api.test.js && npm run verify`

Expected: migration manifest includes six files and all checks pass.

### Task 4: Replace the HTTP command seam

**Files:**
- Modify: `backend/src/app.js`
- Modify: `backend/src/seed.js`
- Modify: `backend/src/store.js`
- Create: `backend/src/commandResultProtection.js`
- Modify: `backend/src/productionEnvMatrix.js`
- Create: `backend/tests/http_command_idempotency.test.js`
- Create: `backend/tests/command_result_protection.test.js`

- [x] **Step 1: Write HTTP conflict and replay tests**

Use one protected Admin command. Prove identical request replay returns the first result without a second state mutation, while the same `X-Request-Id` with a different body returns HTTP 409 and code `40901`.

- [x] **Step 2: Adapt `withIdempotency`**

Derive `commandName` from method/path, `actorId` from authenticated user/Admin principal, and the request digest from route/body. Delegate to the Command Idempotency Module. Legacy callers without a request id may execute only where the existing Interface permits it; protected Admin commands already require a key.

- [x] **Step 3: Preserve snapshot compatibility**

Add empty command/event arrays to seed/default data and duplicate validation。Legacy `idempotency` 保留为只读兼容字段，但其中可能承载 bearer 的旧登录 replay 条目会在 normalization 时安全失效。

- [x] **Step 4: Run focused and complete backend tests**

Run: `node --test backend/tests/http_command_idempotency.test.js && npm test --prefix backend`

Expected: all pass.

- [x] **Step 5: Protect replay results and persisted errors**

Protected runtimes encode command results behind an AES-256-GCM envelope identified by `ROOT_COMMAND_RESULT_KEY_ID` and bound to the complete command scope；跨记录串换、missing/weak/unavailable/tampered key material 均 fail-close。正式入口与 `/ready` 必须在流量前验证保护配置。Persisted command and event errors keep only safe code/generic text so bearer、token、手机号、openid/unionid 不进入错误事实。This does not replace later keyring rotation、retention、payload minimization、external-side-effect outbox/checkpoint work or historical migration.

### Task 5: Complete verification and adversarial review

- [x] **Step 1: Run the full matrix**

```bash
npm test --prefix backend
npm run v1:routes:check
npm run verify
git diff --check
```

- [ ] **Step 2: Complete crash-recovery failure paths**

已覆盖 same key/different body、duplicate outbox enqueue、inbox payload conflict、checkpoint gap、scope-bound replay encryption 和缺 key readiness。首个 `POST /api/v1/tasks/events` 直接关系 command 已在本地完成 claim-only checkpoint、lease/generation fencing、三 worker 过期接管、旧 generation 完成拒绝、业务 commit ACK unknown 与 outbox 失败注入；migration `009` 和纯关系 Outbox Dispatcher Core 进一步完成 claim/recovery、retry/dead-letter、完整 envelope/终态验证与数据库 commit ACK unknown 读回。该局部结果仍不等于完整 crash-recovery；durable inbox/checkpoint/gap、replay 治理、运行 worker/Delivery Adapter、其余写路由、真实外部副作用结果未知语义及真实 MySQL 多实例证据仍未完成，因此本步骤继续保持未勾选。

- [x] **Step 3: Record residual Gate state**

Mark generic Foundation code evidence separately from real multi-instance MySQL fault-injection, background dispatcher, external Adapter, migration dry-run, and candidate evidence. Foundation completion does not close V1-T04 by itself.

**Residual Gate:** 截至 2026-07-16，`task_event` 已作为第一个过渡业务生产者接入直接 `outbox_event` Adapter，并以同一 MySQL 连接完成 snapshot、关系投影、outbox、单次 commit 的本地故障注入；同一路由的直接关系 command recovery/security hardening 与纯关系 Outbox Dispatcher Core 也已本地完成。当前 producer 冻结为一事件一 singleton partition；通用多位置生产者不得复用该证明。这仍只关闭首路由 producer/command 与 dispatcher 数据库状态核心，不勾选本计划 Task 5 Step 2。奖励发放、企微触达/回写、导出交付等已发生外部副作用的命令不能依赖 snapshot rollback，必须使用 Delivery Adapter、外部幂等回执或专属 outcome checkpoint。durable inbox processing lease/checkpoint/gap、dead-letter replay 治理、worker/scheduler、其余命令、keyring/retention、真实 MySQL apply/dry-run 与多实例 crash/replay 均保持待完成。
