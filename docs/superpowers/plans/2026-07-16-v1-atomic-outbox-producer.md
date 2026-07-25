# myRoot v1.0.0 Atomic Outbox Producer Slice

> **Execution skill:** Use `executing-plans` task by task. Independent external-delivery dispatchers are deliberately excluded from this slice.

**Goal:** Connect the first real business write path to migration `006` by persisting one `task_event` main fact and its minimized `outbox_event` envelope in the same MySQL transaction.

**Architecture:** The existing Task Module remains the transitional authority for creating an immutable `task_event`. A Task Event Outbox Module treats the outbox row as a stable obligation of every returned task fact, so command replay and domain duplicate can repair a historical missing row. The MySQL Store provides a transaction-generation-bound Event Transport Interface; its Adapter buffers a complete, privacy-minimized envelope and flushes it through the same connection after the `task_event` projection and before `COMMIT`. Replay equality uses stable business identity and payload while preserving the first row's producer/release/correlation metadata. The five operation tables from migration `006` remain permanently outside stale-delete projections. Snapshot stores use a compatible Adapter for local development, but MySQL never dual-writes the operation fact into the snapshot array.

**Status label on completion:** `ATOMIC_PRODUCER_BRIDGE_COMPLETE / DIRECT_COMMAND_AND_DISPATCH_RUNTIME_PENDING`.

**Tech stack:** Node.js 20, CommonJS, `node:test`, `mysql2`, existing snapshot/MySQL Store, migration `006`.

**Execution constraints:** No production database connection, migration apply, Docker start, external send, reward issuance, candidate, deployment, version change, commit, or push. Existing uncommitted work is preserved. This slice does not close V1-T04 or the formal-launch external-side-effect Gate.

---

## Task 1: Freeze a complete and minimized task-event envelope

**Files:**
- Create: `backend/src/taskEventOutbox.js`
- Modify: `backend/src/eventTransport.js`
- Create: `backend/tests/task_event_outbox.test.js`

- [x] Write failing tests for deterministic identity/digest, stable replay, required migration-006 fields, and payload minimization.
- [x] Prove the payload excludes `root_user_id`, health/questionnaire answers, stool type, phone, openid, unionid, token, authorization and raw request content.
- [x] Export the existing canonical payload snapshot Implementation from `eventTransport.js`; do not introduce another digest algorithm.
- [x] Build one-event aggregates only: `aggregate_type=TASK_EVENT`, `aggregate_version=1`, `partition_key=task_event:<id>`, `partition_position=1`. Do not use `MAX(position)+1`.
- [x] Derive deterministic `outbox_event_id`, dedupe key and idempotency key from the immutable task-event identity. Preserve `DATETIME(3)` input precision and normalize offset-bearing instants to the MySQL `+08:00` contract.
- [x] Run: `node --test backend/tests/task_event_outbox.test.js backend/tests/event_transport.test.js`.

## Task 2: Add the transaction-bound MySQL Event Transport Adapter

**Files:**
- Create: `backend/src/mysqlEventTransportAdapter.js`
- Create: `backend/tests/mysql_event_transport_adapter.test.js`

- [x] Write failing tests for validation-before-SQL, parameterized insert, nullable fields, semantic duplicate replay, dedupe conflict, partition-position conflict and inactive transaction fail-close.
- [x] Provide the narrow Interface `stageOutbox(envelope)`, `flushBeforeCommit()`, `afterCommit()` and `discard()`; do not expose the raw connection.
- [x] Buffer synchronously so existing Task/Command call chains do not become async merely to stage an event.
- [x] On unique conflict, read by `(topic,dedupe_key)` and compare stable event identity plus payload digest. Producer version, release batch and request correlation are provenance of the first row, not replay conflicts; business mismatches throw `OUTBOX_DEDUPE_CONFLICT`. A conflicting `(source_name,partition_key,partition_position)` throws `OUTBOX_POSITION_CONFLICT`.
- [x] Never use `INSERT IGNORE`, an overwrite upsert, or `MAX(position)+1`.
- [x] Keep errors generic and free of payload/credential detail.
- [x] Run: `node --test backend/tests/mysql_event_transport_adapter.test.js`.

## Task 3: Bind the Adapter to the MySQL transaction lifecycle

**Files:**
- Modify: `backend/src/store.js`
- Modify: `backend/src/mysqlProjection.js`
- Create: `backend/tests/mysql_transactional_outbox.test.js`
- Modify: `backend/tests/command_event_schema.test.js`

- [x] Write failure-injection tests proving snapshot update, `task_event` projection and outbox insert use one connection and occur before one commit.
- [x] Prove outbox insert, projection, snapshot-update and commit failures all invoke rollback and do not expose a committed in-memory result.
- [x] Make `runRequest` expose `transactionControl.eventTransport.stageOutbox()` only while its transaction generation is active; an old reference cannot write after resume.
- [x] At commit: write snapshot, sync ordinary projections, flush staged outbox, then commit. Any failure rolls back the whole transaction.
- [x] A successful checkpoint flushes only that generation; staging is blocked between checkpoint and resume; resume creates a fresh generation. Rollback, read-only requests and connection release discard staged envelopes.
- [x] Add a runtime assertion that `command_idempotency`, `outbox_event`, `inbox_receipt`, `event_dead_letter` and `consumer_checkpoint` can never enter `PROJECTIONS`.
- [x] Preserve the existing Store Interface for callers not using Event Transport.
- [x] Run: `node --test backend/tests/mysql_transactional_outbox.test.js backend/tests/command_event_schema.test.js backend/tests/api.test.js`.

## Task 4: Connect `POST /api/v1/tasks/events`

**Files:**
- Modify: `backend/src/app.js`
- Create or modify: `backend/tests/task_event_outbox_http.test.js`

- [x] Write failing HTTP tests showing a newly created task fact stages one event, replay/domain duplicate repairs or reuses the same event without a second fact, and a rejected command stages nothing.
- [x] Stage only after `withIdempotency` has successfully produced its protected result. Do not stage inside the action before result protection completes.
- [x] Use the MySQL transaction-bound Adapter when supplied. For memory/JSON/SQLite development, use the compatible snapshot Adapter so the business path is observable without a MySQL connection.
- [x] On MySQL, do not append the direct outbox fact to `data.eventOutbox`; migration `006` is the only operation-fact authority for this path.
- [x] Preserve the public HTTP response shape.
- [x] Run: `node --test backend/tests/task_event_outbox_http.test.js backend/tests/http_command_idempotency.test.js backend/tests/api.test.js`.

## Task 5: Adversarial verification and Gate recording

**Files:**
- Modify: `docs/v1.0.0_technical_review_2026-07-15.md`
- Modify: `docs/superpowers/plans/2026-07-15-v1-command-event-foundation.md`

- [x] Run focused tests, `npm test --prefix backend`, `npm run v1:routes:check`, `npm run verify`, and `git diff --check`.
- [x] Attack at least these failure paths: same dedupe/different payload, same partition-position/different event, stage after checkpoint, projection failure, outbox insert failure, commit acknowledgement failure, sensitive payload attempt.
- [x] Record that this proves only the transitional atomic producer bridge. The Task main fact still reaches its relation through snapshot projection; command idempotency, dispatcher, inbox lease/checkpoint, dead-letter replay and external-effect receipts are not yet direct relational runtime.
- [x] Keep WeWork touch, consultation writeback, reward delivery and export delivery AUTO execution behind their existing formal-launch Gate. The next independent plan should start with per-job `wework.touch.send.requested.v1`, provider capability declaration and `OUTCOME_UNKNOWN / REVIEW_REQUIRED` semantics.

### Completion evidence — 2026-07-16

- Focused task/command/transport matrix: `126/126 PASS`.
- Backend full matrix: `354/354 PASS`.
- Route Registry: `16/16 PASS`, digest unchanged at `f43aeddbe9788b3f35d1f23a4c99bb99f30be842132986066b21a6d653a97edc`.
- Repository verification: `17/17 PASS`, `257` JavaScript files, `6` immutable migration checksums.
- `git diff --check`: PASS.
- No real MySQL, production migration, external send, candidate, deployment, version change, commit or push was performed.

## Acceptance boundary

This slice is complete only when all local tests pass and failure injection proves one-transaction ordering. It must not be described as any of the following:

- full event-driven runtime;
- direct relational command recovery;
- dispatcher or inbox completion;
- multi-instance MySQL evidence;
- external delivery exactly-once proof;
- V1-T04 closure or production launch approval.
