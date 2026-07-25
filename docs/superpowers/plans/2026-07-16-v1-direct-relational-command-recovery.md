# myRoot v1.0.0 Direct Relational Command Recovery Slice

> **Execution skill:** Use `executing-plans` task by task. This plan deliberately connects only the authenticated task-event command; commands with external side effects remain excluded.

**Goal:** Replace snapshot command idempotency on `POST /api/v1/tasks/events` with a crash-recoverable MySQL command authority that durably claims work, fences stale workers, and commits the task fact, protected replay result and outbox obligation in one business transaction.

**Architecture:** Migration `007` adds explicit lease and fencing facts without modifying immutable migration `006`. A transaction-bound MySQL Command Idempotency Adapter owns parameterized row operations. The MySQL Store exposes one deep Command Recovery Interface that hides three phases: durable claim commit, owned business transaction, and durable terminal state. The Interface checkpoints the claim, resumes a fresh transaction generation, locks the owned attempt, then runs the existing Task Module. A random lease owner plus monotonically increasing lease generation fences late workers. The first route only is opted in; other routes continue using the snapshot Implementation until their effects are classified. Existing snapshot records are inspected before first relational claim so a historical success is lazily imported and replayed, a digest mismatch still conflicts, and ambiguous legacy state fails closed.

**Status label on completion:** `DIRECT_RELATIONAL_COMMAND_RECOVERY_LOCAL_COMPLETE / COMMAND_COVERAGE_DISPATCH_AND_REAL_MYSQL_EVIDENCE_PENDING`.

**Tech stack:** Node.js 20, CommonJS, `node:test`, `mysql2`, existing snapshot/MySQL Store, foundation/recovery migrations `006` and `007`, plus security metadata migration `008`.

**Execution constraints:** No production database connection, real migration apply, Docker start, external send, reward issuance, export delivery, candidate, deployment, version change, commit, or push. Existing uncommitted work is preserved. This slice does not close P0-07, V1-T04, the result-key rotation Gate, or the formal-launch Gate.

## Current local execution record (2026-07-16)

- Local implementation status: `DIRECT_RELATIONAL_COMMAND_RECOVERY_LOCAL_COMPLETE` for the authenticated `POST /api/v1/tasks/events` slice only.
- The business idempotency key is supplied by the request body; `X-Request-ID` is correlation-only and may change across retries. The relational path does not create a second snapshot command record or duplicate task/outbox facts.
- Durable claim, claim-only checkpoint, resume, owner/generation fencing, stale takeover, protected replay, legacy read-only bridge, atomic task/outbox completion and generic unexpected-error redaction have local failure-injection coverage in the working tree.
- Local verification evidence: focused security/recovery matrix `60/60 PASS`; HTTP/transaction matrix `31/31 PASS`; backend full suite `415/415 PASS`; Route Registry `16/16 PASS`; repository verification `17/17 PASS` with `267` JavaScript syntax checks and `8` immutable migration checksums; `git diff --check` PASS. These are local contract and failure-injection results, not real MySQL or release evidence.
- No production database connection, DDL apply, external send, candidate, deploy, version change, commit or push was performed by this slice.
- Gates that remain open: real MySQL contention and multi-instance proof; production DDL; request/result keyring rotation; retention/tombstone/GC; keyed HMAC for the original business idempotency-key token; full write-route coverage; dispatcher; inbox/checkpoint/dead-letter; and external-effect outcome recovery.

---

## Task 1: Add explicit lease and fencing schema facts

**Files:**
- Create: `backend/db/migrations/007_command_recovery_lease.sql`
- Modify: `backend/db/migrations/checksums.json`
- Modify: `backend/src/store.js`
- Modify: `backend/tests/command_event_schema.test.js`

- [x] Write failing schema tests for `lease_owner`, `lease_expires_at`, `lease_generation`, the recovery index, schema version `7`, ordered migration discovery and immutable checksums.
- [x] Add an append-only `ALTER TABLE command_idempotency`; never edit migration `006`.
- [x] Define fencing ownership as `(command_idempotency_id, status, lease_owner, lease_generation)` and expiry as `lease_expires_at <= CURRENT_TIMESTAMP(3)`.
- [x] Keep `command_idempotency` permanently outside snapshot projections.
- [x] Add and run the focused `backend/tests/command_event_schema.test.js` coverage; final combined count remains pending in the mainline placeholder.

## Task 2: Build the transaction-bound MySQL Command Idempotency Adapter

**Files:**
- Create: `backend/src/mysqlCommandIdempotencyAdapter.js`
- Modify: `backend/src/commandIdempotency.js`
- Create: `backend/tests/mysql_command_idempotency_adapter.test.js`

- [x] Write failing contract tests before Implementation.
- [x] Reuse one canonical descriptor digest, deterministic record identity, protected-result binding and safe error shape from the existing Command Idempotency Module.
- [x] Persist a SHA-256-derived business-idempotency-key token, never the raw business key or `X-Request-ID`; keep `request_json` and `result_ref` `NULL`. Keyed HMAC for this token remains an explicit Gate.
- [x] Implement new claim, protected success replay, digest conflict, fresh `IN_PROGRESS` conflict, expired takeover, `FAILED` retry and tombstone fail-close.
- [x] Generate a cryptographically random lease owner; increment `lease_generation` and `attempt_count` exactly once for claim/retry/takeover.
- [x] Require owner plus generation on lock, completion and failure updates. Zero affected rows means lease lost and must fail closed.
- [x] Use database time for lease acquisition/expiry and parameterized SQL only. Persistence failures must be generic and surface as atomic write failures.
- [x] Decode and re-encrypt a safe legacy `SUCCEEDED` snapshot record before lazy import. A legacy digest conflict still returns `40901`; ambiguous legacy `IN_PROGRESS` fails closed.
- [x] Prove rows/log errors contain no raw request ID, body, phone, token, health answer or original error message.
- [x] Add and run focused Adapter, command-idempotency and result-protection coverage; final combined count remains pending in the mainline placeholder.

## Task 3: Add the Store Command Recovery Interface and durable claim lifecycle

**Files:**
- Modify: `backend/src/store.js`
- Create: `backend/tests/mysql_command_recovery.test.js`
- Modify: `backend/tests/mysql_transactional_outbox.test.js`

- [x] Create one transaction-bound Adapter per Store transaction generation; discard it on commit, rollback, checkpoint, failed commit and connection release.
- [x] Expose a request-scoped `transactionControl.commandRecovery.execute()` Interface, not the raw connection or generation Adapter.
- [x] Phase 1: acquire/import/take over the command row and commit the durable `IN_PROGRESS` claim through an internal claim-only checkpoint that rejects snapshot or outbox changes.
- [x] Phase 2: resume, lock the owned attempt, snapshot in-memory business state, run the action, protect the result and conditionally write `SUCCEEDED` in the same transaction as snapshot projection and staged outbox.
- [x] On action/result-protection failure, restore business state, conditionally write a safe `FAILED`, rethrow the original business error, and let the handled response commit only the failed command fact.
- [x] On SQL, projection, outbox or commit failure, roll back the business generation and leave the durable claim recoverable after lease expiry.
- [x] Block public checkpoint while command execution is active. Keep dynamic access to the current Event Transport generation so a post-claim task outbox stage does not reuse the retired facade.
- [x] Forbid new snapshot command dual-write on the relational path; legacy snapshot records are read-only bridge inputs.
- [x] Fault-inject claim checkpoint dirtiness, claim ACK unknown, action failure, result encryption failure, stale takeover, late old-worker completion, business commit ACK unknown and outbox failure.
- [x] Add and run focused recovery, checkpoint-guard and transactional-outbox coverage; final combined and loopback-enabled counts remain pending in the mainline placeholder.

## Task 4: Opt in only the authenticated task-event HTTP command

**Files:**
- Modify: `backend/src/app.js`
- Modify: `backend/tests/http_command_idempotency.test.js`
- Modify: `backend/tests/task_event_outbox_http.test.js`

- [x] Pass the Store Command Recovery Interface and a dynamic Event Transport accessor into the request context.
- [x] Set the relational executor only for `POST /api/v1/tasks/events`; all other command routes retain the existing snapshot Implementation.
- [x] Preserve the public response, `commandIdempotencyReplayed` semantics, stable Root user scope and login exclusion.
- [x] Reject anonymous actor scope on the relational route.
- [x] Derive durable identity from the explicit business idempotency key, not `X-Request-ID`; preserve the latter only as an attempt correlation identifier.
- [x] Prove first execution, same-business-key replay across different attempt IDs, changed-body conflict, failed retry and commit-ACK recovery create exactly one command row, one task fact and one outbox row.
- [x] Prove no new relational command is appended to `data.commandIdempotencyRecords`.
- [x] Keep task outbox staging inside the owned business transaction and wrap staging errors as atomic write failures.
- [x] Add and run focused HTTP idempotency, task-outbox HTTP and recovery coverage; final loopback-enabled combined count remains pending in the mainline placeholder.

## Task 5: Adversarial verification and Gate recording

**Files:**
- Modify: `docs/v1.0.0_technical_review_2026-07-15.md`
- Modify: `docs/superpowers/plans/2026-07-15-v1-command-event-foundation.md`

- [x] Run the final combined focused command/recovery/outbox tests, `npm test --prefix backend`, `npm run v1:routes:check`, `npm run verify`, migration checksum verification and `git diff --check`; record the exact local counts above.
- [x] Attack locally: lease boundary equality, three-worker takeover, old generation completion, digest conflict in every state, ciphertext tamper/wrong binding, legacy ambiguity, claim ACK unknown, success ACK unknown, outbox insert failure and sensitive header/body attempts.
- [x] Record the final exact local evidence counts in the technical review; absence of production actions is already recorded above.
- [x] Keep `P0-07=PARTIAL`, `V1-T04=OPEN`, formal M1 `NO-GO`, version `0.5.13`, production migration/external send/candidate/release `NOT AUTHORIZED`.
- [x] State explicitly that real MySQL contention, production DDL, request/result keyring rotation, retention/tombstone/GC, business-key-token HMAC, full command-route coverage, dispatcher, inbox/checkpoint/dead-letter and external-effect outcome recovery remain pending.

## Acceptance boundary

This slice is complete only when the first authenticated task-event command has local failure-injection proof for durable claim, stale takeover, fencing and atomic business completion. It must not be described as any of the following:

- full command migration or full event-driven runtime;
- real multi-instance MySQL evidence;
- external delivery exactly-once proof;
- key rotation or retention closure;
- V1-T04 closure, release candidate, production migration approval or formal launch approval.
