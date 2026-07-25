# myRoot v1.0.0 Relational Outbox Dispatcher Core Plan

> **Execution method:** Implement task by task with TDD. This slice is a pure MySQL state-transition core. It must not call WeChat, Enterprise WeChat, coupon, export, object-storage, HTTP, message-queue or any other external delivery Interface.

**Goal:** Turn the existing relational `outbox_event` producer facts into a locally testable, crash-recoverable dispatcher core with database-time eligibility, strict partition ordering, claim/lease-generation fencing, retry/backoff, atomic dead-letter transition and database commit ACK-unknown convergence.

**PRD relationship:** This is the next unblocked subset of `V1-T04`. Completing it does not close `V1-T04`, because durable inbox processing, contiguous consumer checkpoint/gap handling, dead-letter replay governance, reminder-specific unique constraints, external-effect outcome recovery and real MySQL multi-instance evidence remain outside this slice.

**Current inputs:**

- `backend/db/migrations/006_command_event_foundation.sql` owns the existing `outbox_event` and `event_dead_letter` target facts.
- `backend/src/mysqlEventTransportAdapter.js` is the producer-side transaction Adapter and remains focused on staging/flushing new envelopes.
- `backend/src/eventTransport.js` supplies a pure snapshot-era transition contract for test lineage only; it is not the relational runtime authority.
- migrations `006`, `007` and `008` are immutable. Any required dispatcher schema evolution is append-only migration `009`.

**Status label on completion:** `RELATIONAL_OUTBOX_DISPATCHER_CORE_LOCAL_COMPLETE / INBOX_EXTERNAL_DELIVERY_REAL_MYSQL_EVIDENCE_PENDING`.

**Execution constraints:** No production database connection or DDL, no Docker start, no external send, no provider mock server, no reward issuance, no export delivery, no candidate/deploy, no version bump, no commit or push. Keep `P0-07=PARTIAL`, `V1-T04=OPEN`, formal M1 `NO-GO`.

## Current local execution record (2026-07-16)

- Task 1 is locally complete. Migration `009` is append-only, includes lease recovery plus separate pending/retry due indexes, byte-exact payload digests and a positive partition-position constraint; checksum is `a897d65edf8b5b87e5394264536e4c1998906d94d9b45e941ac8ca0f09183d54`.
- Immutable migration evidence remains unchanged: `006=723c148f...e44857`, `007=0916e7f8...b9504d`, `008=b8ce188a...14b2a`.
- Task 1 focused evidence: schema/immutability `9/9`, migration-list projection `1/1`, production-canary verifier `5/5`.
- Task 2 is locally complete. `outbox-retry-v1` focused evidence is `7/7`, covering frozen base/cap, deterministic capped exponential delay, persisted-attempt decisions, safe reason allowlist and invalid/overflowing policy input.
- Tasks 3–6 are locally complete. The transaction-bound Adapter and deep Core now cover database-time claim/recovery, generation fencing, retry/dead-letter, exact immutable envelopes and terminal facts, session timezone, uncertain-connection destruction and commit ACK-unknown readback. A default Core → real Adapter transaction-snapshot integration suite is included.
- Focused local evidence is `79/79 PASS` across schema, retry policy, singleton task producer, Adapter, recovery, Core, ACK-unknown and default-Core integration tests. This remains fake-connection evidence, not real MySQL execution proof.
- The current v1 `task_event` producer owns singleton partitions only: `source_name=myroot-api`, `partition_key=task_event:<task_event_id>`, `partition_position=1`, `aggregate_version=1`. Caller-controlled source/position options are rejected and SQL adds `partition_position >= 1`. This path-level invariant does not prove generic multi-position ordering; any such producer must reopen the partition cursor/lock Gate.
- Task 7 is locally complete. Repository evidence: backend `480/480 PASS`, Route Registry `16/16 PASS`, repository verification `17/17 PASS` with `276` JavaScript syntax checks and `9` migration checksums, plus `git diff --check` PASS.
- Status is `RELATIONAL_OUTBOX_DISPATCHER_CORE_LOCAL_COMPLETE / INBOX_EXTERNAL_DELIVERY_REAL_MYSQL_EVIDENCE_PENDING`. No production database connection, DDL apply, external send, candidate, deploy, version bump, commit or push was performed.

---

## Architecture and Interfaces

### Modules and seams

1. **Outbox Retry Policy Module**
   - Interface: validate a frozen policy and return the deterministic delay for a completed attempt.
   - It owns `policyVersion`, base delay, exponential step and maximum delay.
   - It does not read the wall clock; the MySQL Adapter applies the delay relative to database time.

2. **MySQL Outbox Dispatcher Adapter**
   - Internal transaction-bound Adapter at the relational Seam.
   - Interface: select/claim due partition heads, recover expired claims, lock an owned claim, mark database success, schedule retry, atomically dead-letter, and read back a transition.
   - It accepts only a live transaction connection and is discarded after every commit, rollback, failed commit or release.
   - SQL is parameterized. Persistence errors are generic and must not expose payload, token, phone, openid/unionid, SQL text or connection detail.

3. **Relational Outbox Dispatcher Core Module**
   - External Interface for later worker orchestration:
     - `claimDue({ limit })`
     - `completeOwned(claim)`
     - `failOwned(claim, { reasonCode, retryable })`
     - `recoverExpired({ limit })`
   - The Module owns pool connections, transaction ordering, opaque claim/transition identifiers, commit ACK-unknown readback and retry of the same database transition.
   - Callers receive immutable claim facts, not a raw connection or transaction Adapter.

4. **External delivery Seam**
   - Deliberately absent in this slice. There is no HTTP/client/provider Adapter and no scheduler or job-route wiring.
   - Tests may call `completeOwned` or `failOwned` with synthetic outcomes only to prove database transitions. This is not delivery evidence.

This separation preserves Depth and Locality: the existing producer Adapter does not become a shallow mixed producer/dispatcher Module, while crash recovery remains hidden behind one dispatcher Interface.

### Frozen state machine

```text
PENDING | RETRY_PENDING --claim due--> CLAIMED
CLAIMED --database success--> SUCCEEDED
CLAIMED --retryable failure / expired lease--> RETRY_PENDING
CLAIMED --non-retryable failure / max attempts / expired final lease--> DEAD_LETTER
```

- `attempt_count` increments exactly once when a claim is acquired.
- `lease_generation` increments exactly once on every new claim or reclaim and never decreases.
- Every owned update fences on `(outbox_event_id, status=CLAIMED, lease_owner, lease_generation)`.
- Success, retry and dead-letter clear the active lease; the generation remains as audit/fencing evidence.
- `DEAD_LETTER` is terminal in this slice and blocks later positions in that partition. Replay/reopen is a separate governed slice.
- A partition may have at most one nonterminal head in flight. Position `N+1` cannot be claimed while any lower position is `PENDING`, `CLAIMED`, `RETRY_PENDING` or `DEAD_LETTER`. Different partitions may progress concurrently.

### ACK-unknown definition

`ACK-unknown` in this plan means the MySQL commit may have succeeded even though the process did not receive the commit acknowledgement. It does not mean an external provider outcome is unknown.

- Claim identifiers and transition identifiers are generated before the transaction and persisted with the row.
- After a commit error, the Module opens a fresh connection and reads authoritative rows by the same identifier.
- If the intended state and fence metadata are present, return the persisted result without repeating the transition.
- For terminal transitions only, if the row is still owned by the same claim, retry the same transition identifier.
- For claim commit uncertainty, return only an exact persisted batch. An absent, partial, extra or changed readback fails closed; no external action has occurred, so a later worker may claim through the normal recovery path with a new identifier.
- If a later generation owns the row, fail closed as lease lost; never overwrite the later worker.
- Unknown external outcomes must not be mapped to retry or success by this Module and remain a Gate.

---

## Task 1: Freeze migration 009 and schema invariants

**Files:**

- Create: `backend/db/migrations/009_outbox_dispatcher_fencing.sql`
- Modify: `backend/db/migrations/checksums.json`
- Modify: `backend/src/store.js`
- Modify: `backend/tests/command_event_schema.test.js`
- Modify: `backend/tests/api.test.js`
- Modify: `backend/tests/production_canary_verify.test.js`

- [x] Write failing schema tests first. Assert migration discovery order `001` through `009`, immutable checksums for `006`–`008`, schema version `9`, and nonempty SQL statements.
- [x] Add append-only migration `009`; do not edit migrations `006`, `007` or `008`.
- [x] Add `outbox_event.lease_generation BIGINT UNSIGNED NOT NULL DEFAULT 0`.
- [x] Add `outbox_event.dispatch_transition_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL` for claim/terminal ACK-unknown readback. The value is an opaque random identifier, never an HTTP request ID or external provider identifier.
- [x] Add `outbox_event.retry_policy_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'outbox-retry-v1'`.
- [x] Freeze byte-exact outbox identity by migrating `topic`, `dedupe_key`, `source_name` and `partition_key` to binary collations. Mirror `source_name` and `partition_key` collation in `event_dead_letter`; production DDL collision preflight remains a Gate.
- [x] Add nonunique lookup indexes for `(lease_owner, status, lease_generation)`, `(dispatch_transition_id, outbox_event_id)`, strict partition-head selection `(source_name, partition_key, partition_position, status)`, and expired-lease recovery `(status, lease_expires_at, outbox_event_id)`.
- [x] Do not add a unique transition-id constraint: one claim batch may persist the same opaque transition identifier on several rows.
- [x] Regenerate only the new checksum entry and update latest-migration test fixtures to `009`; historical migration assertions remain unchanged.
- [x] Run the focused schema, migration-list and canary tests; local evidence is recorded above.

## Task 2: Implement the versioned retry/backoff policy with TDD

**Files:**

- Create: `backend/src/outboxRetryPolicy.js`
- Create: `backend/tests/outbox_retry_policy.test.js`

- [x] Write failing table-driven tests for attempts `1`, `2`, cap boundary, attempt overflow, invalid policy, max-attempt exhaustion and stable `policyVersion`.
- [x] Freeze v1 as deterministic capped exponential backoff with no random jitter. Document the exact base/cap values in the Module and tests; changing them requires a new policy version.
- [x] Return a bounded integer delay in milliseconds. Reject negative, noninteger, unsafe or overflowed values before SQL.
- [x] Determine dead-letter eligibility from the persisted `attempt_count` and `max_attempts`; do not increment attempts during failure handling.
- [x] Keep reason classification allowlisted. Unknown/internal errors become a generic `OUTBOX_DISPATCH_FAILED` reason and safe message.
- [x] Run `node --test backend/tests/outbox_retry_policy.test.js`; local evidence is `7/7`.

## Task 3: Build the transaction-bound claim and fencing Adapter

**Files:**

- Create: `backend/src/mysqlOutboxDispatcherAdapter.js`
- Create: `backend/tests/mysql_outbox_dispatcher_adapter.test.js`

- [x] Write failing fake-connection tests before Implementation for two workers, multiple partitions, one partition with positions `1/2/3`, lease-expiry equality, stale owner, stale generation and zero-row races.
- [x] Select only eligible partition heads using database time and `SELECT ... FOR UPDATE SKIP LOCKED`. Eligibility is:
  - `PENDING` with `available_at <= CURRENT_TIMESTAMP(3)`;
  - `RETRY_PENDING` with `next_retry_at <= CURRENT_TIMESTAMP(3)`;
  - expired `CLAIMED` rows handled by the recovery transition, not silently overwritten.
- [x] Prevent `SKIP LOCKED` from exposing a later position while an earlier nonterminal row exists. Locking one row must not serialize unrelated partitions. Current v1 task production is additionally frozen to singleton partitions; generic multi-position locking remains a real-MySQL/new-producer Gate.
- [x] Claim with one conditional update that sets `CLAIMED`, increments `attempt_count` and `lease_generation`, records the opaque claim transition identifier, and sets owner/expiry from database time.
- [x] Return an immutable claim containing only the row identity, envelope, owner, generation, attempt count and payload digest required by later orchestration.
- [x] Validate payload digest and byte-exact full immutable envelope after SELECT. Case, accent, NFC/NFD, whitespace or event/schema/aggregate/idempotency/release mismatch fails closed.
- [x] Fence lock, success, retry and dead-letter updates on exact row ID, `CLAIMED`, owner and generation. A zero-row update is `OUTBOX_LEASE_LOST`, not a retry with relaxed predicates.
- [x] Discard the Adapter after transaction completion; later calls fail closed.
- [x] Run: `node --test backend/tests/mysql_outbox_dispatcher_adapter.test.js`.

## Task 4: Implement retry and expired-lease recovery

**Files:**

- Modify: `backend/src/mysqlOutboxDispatcherAdapter.js`
- Modify: `backend/tests/mysql_outbox_dispatcher_adapter.test.js`
- Create: `backend/tests/mysql_outbox_dispatcher_recovery.test.js`

- [x] Write failing tests for retryable failure, non-retryable failure, final-attempt failure, lease expiry before max attempts, lease expiry at max attempts and database-time advancement.
- [x] For a retryable owned failure below `max_attempts`, atomically set `RETRY_PENDING`, persist the frozen retry policy version, calculate `next_retry_at` from `CURRENT_TIMESTAMP(3)`, store only allowlisted error facts and clear lease owner/expiry.
- [x] Treat an expired lease as one failed attempt already counted at claim time. Below max attempts it enters the same retry policy; at max attempts it enters dead letter.
- [x] Do not immediately reclaim an expired row in the same pass. The persisted backoff must become due first.
- [x] Prove repeated expiry recovery is idempotent, unknown retry-policy rows are untouched and two recovery workers cannot schedule different next retry times for one generation.
- [x] Prove no JavaScript wall clock is persisted in eligibility, lease expiry or retry timestamps; Core sets the MySQL session timezone before every transaction.
- [x] Run: `node --test backend/tests/mysql_outbox_dispatcher_adapter.test.js backend/tests/mysql_outbox_dispatcher_recovery.test.js`.

## Task 5: Make dead-letter creation atomic with source transition

**Files:**

- Modify: `backend/src/mysqlOutboxDispatcherAdapter.js`
- Modify: `backend/tests/mysql_outbox_dispatcher_adapter.test.js`
- Modify: `backend/tests/mysql_outbox_dispatcher_recovery.test.js`

- [x] Write failure-injection tests for dead-letter insert failure, source-row update failure, duplicate source unique key, rollback, stale generation and commit ACK unknown.
- [x] In one transaction and under the exact ownership fence:
  1. lock the owned `outbox_event`;
  2. insert or exact-read the `event_dead_letter` row using `direction='OUTBOX'` and the existing unique `(direction, source_record_id)`;
  3. update the source row to `DEAD_LETTER`, set `dead_lettered_at`, persist the transition identifier and clear its lease.
- [x] If any step fails, roll back both facts. A dead-letter row without a terminal source row, or a terminal source row without its dead-letter row, is never committed.
- [x] A duplicate dead-letter source is replay only when immutable source/event/digest/reason facts match exactly; otherwise fail closed as a persistence conflict.
- [x] Persist only safe `reason_code` and generic `error_json`. Never store stack traces, SQL errors, headers, credentials or raw provider responses.
- [x] Leave `event_dead_letter` replay/reopen fields unused. No Admin replay Interface is added by this slice.
- [x] Prove a dead-lettered partition head blocks later positions while unrelated partitions remain claimable.

## Task 6: Add the deep dispatcher core and ACK-unknown convergence

**Files:**

- Create: `backend/src/mysqlOutboxDispatcher.js`
- Create: `backend/tests/mysql_outbox_dispatcher.test.js`
- Create: `backend/tests/mysql_outbox_dispatcher_ack_unknown.test.js`

- [x] Write failing pool/transaction tests for begin failure, claim commit failure, claim commit ACK loss, success commit ACK loss, retry commit ACK loss, dead-letter commit ACK loss, readback failure and connection retirement.
- [x] Construct a fresh transaction-bound Adapter for each generation. Never reuse one after commit/rollback/unknown commit.
- [x] Generate opaque claim and transition identifiers before each transaction. Inject deterministic factories only in tests.
- [x] On claim ACK loss, open a fresh connection and read rows by the same claim identifier; return only the exact persisted ordered batch. Absent, partial, extra or changed readback fails closed and is later recovered by the normal worker path.
- [x] On terminal transition ACK loss, read the row by ID plus transition identifier and verify status, generation, full immutable envelope, mutually-exclusive terminal facts and dead-letter companion fact where applicable.
- [x] If readback proves the intended state, return it as converged. If the same claim still owns the row, retry the same terminal transition. If a later generation exists, return lease lost without overwriting it.
- [x] Keep terminal transaction attempts bounded. Exhaustion returns a generic atomic persistence failure and never fabricates success.
- [x] Expose only `claimDue`, `completeOwned`, `failOwned` and `recoverExpired`; keep SQL and transaction Adapter methods internal.
- [x] Do not import an HTTP client, provider SDK or existing external-send Module. A dependency-closure source guard scans Core, Adapter, retry policy and event snapshot helper.
- [x] Run Core/ACK tests and the default Core → real Adapter integration suite.

## Task 7: Adversarial verification and evidence recording

**Files:**

- Modify after Implementation: `docs/v1.0.0_technical_review_2026-07-15.md`
- Modify after Implementation: `docs/superpowers/plans/2026-07-15-v1-command-event-foundation.md`
- Modify after Implementation: this plan

- [x] Run focused dispatcher/schema tests, `npm test --prefix backend`, `npm run v1:routes:check`, `npm run verify`, checksum validation and `git diff --check`.
- [x] Attack at least: two workers on one row, same partition positions `1/2/3`, unrelated partitions, lease equality, old-generation success/failure, max-attempt boundary, expired final lease, backoff cap, duplicate dead-letter, transaction rollback, uncertain connection retirement, and ACK loss on claim/success/retry/dead-letter.
- [x] Prove no dispatcher dependency path performs an external send, provider call, reward issuance or export delivery.
- [x] Record exact local counts and absence of production actions. Fake-connection evidence remains explicitly separate from real MySQL evidence.
- [x] Keep `P0-07=PARTIAL`, `V1-T04=OPEN`, M1 `NO-GO`, version `0.5.13` and production actions `NOT AUTHORIZED`.

---

## Acceptance criteria

The local slice is complete only when all of the following are true:

1. migrations `006`–`008` remain byte-identical and migration `009` is append-only with an immutable checksum;
2. two concurrent workers cannot own the same outbox generation, and an old owner/generation cannot complete, retry or dead-letter it;
3. the current v1 singleton task-event partitions cannot be extended by caller input, and persisted multi-position fixtures never expose a later nonterminal position; generic multi-position concurrency remains a new-producer/real-MySQL Gate;
4. retry timing is versioned, bounded and based on database time;
5. max attempts and non-retryable failures create exactly one matching dead-letter row in the same transaction as the source transition;
6. claim commit ACK loss returns only an exact persistent batch or fails closed, while success, retry and dead-letter commit ACK loss converge by full persistent readback without a duplicate terminal transition;
7. no external delivery Interface is called or wired;
8. all focused and repository verification commands pass locally.

## Residual Gates after local completion

- `V1-T04` remains `OPEN` until durable inbox receipt processing, per-consumer contiguous checkpoint/gap hold, handler-version transition, dead-letter replay governance and reminder-specific persistent uniqueness are implemented and fault-injected.
- Real MySQL migration `009` apply/rollback rehearsal, `SKIP LOCKED` execution-plan proof, lock contention, deadlock handling, multi-instance crash/restart and load evidence remain required.
- External delivery requires a separate Delivery Adapter and outcome ledger. Provider `OUTCOME_UNKNOWN` must not be retried automatically; this dispatcher core proves only database-transition convergence.
- Any future producer with more than one record per partition must add a partition-head/cursor Module (or equivalent monotonic allocator) and pass late-lower-position plus multi-connection tests before using this Dispatcher Interface.
- Payload minimization/encryption, outbox retention/GC, dead-letter retention/access controls, keyring rotation and security review remain open.
- Production DDL, worker enablement, scheduler wiring, external send, candidate, deployment and release require separate explicit authorization.
