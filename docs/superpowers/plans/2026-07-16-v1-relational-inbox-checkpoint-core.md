# myRoot v1.0.0 Relational Inbox and Checkpoint Core

> **Execution record, 2026-07-16:** This plan is calibrated to the checked-in migrations, Modules and directed tests. The relational Inbox and Checkpoint Core now has a repository-owned static Handler Registry, a privacy-minimized SHARE completion projection handler, handler-local behavior identity, protected payload/result persistence and an opt-in local worker harness. The harness remains disabled by default and has no scheduler, Outbox-to-Inbox bridge, governed replay, real MySQL or release evidence.

**Goal:** Provide a relational consumer Core that receives byte-exact event envelopes, fences claims across workers, applies replay-safe database work in the same transaction as successor outbox staging and receipt completion, advances only a contiguous per-consumer/per-source/per-partition checkpoint, records positional gaps and terminal holds, schedules retry, dead-letters atomically and converges database commit ACK-unknown outcomes.

**PRD relationship:** This is an implemented subset of `V1-T04`. It proves the transaction shape for `inbox_receipt + registered DATABASE_ONLY target fact + successor outbox + consumer_checkpoint` and exercises one concrete, privacy-minimized myRoot SHARE event projection in local relational fault tests. It does **not** prove runtime delivery, governed replay, external effect exactly-once, multi-instance behavior on real MySQL, reminder uniqueness, complete write-route migration or operational readiness. Therefore `P0-07=PARTIAL`, `V1-T04=OPEN` and formal M1 remains `NO-GO`.

**Status label:** `LOCAL_STATIC_HANDLER_TRANSACTION_PROOF / WORKER_HARNESS_DISABLED_PENDING_RUNTIME_GATES`.

**Implementation authority:**

- `backend/db/migrations/010_durable_inbox_checkpoint.sql`
- `backend/db/migrations/011_durable_consumer_checkpoint.sql`
- `backend/db/migrations/012_durable_inbox_dead_letter.sql`
- `backend/db/migrations/013_inbox_content_protection_metadata.sql`
- `backend/db/migrations/014_inbox_handler_identity.sql`
- `backend/db/migrations/015_task_share_completion_projection.sql`
- `backend/src/inboxContentProtection.js`
- `backend/src/inboxHandlerRegistry.js`
- `backend/src/inboxHandlers/taskShareCompletionProjectionV1.js`
- `backend/src/inboxRetryPolicy.js`
- `backend/src/mysqlInboxCheckpointAdapter.js`
- `backend/src/mysqlInboxCheckpoint.js`
- `backend/src/mysqlInboxWorkerHarness.js`
- `contracts/inbox-handler-registry/v1.0.0.json`
- `backend/tests/inbox_retry_policy.test.js`
- `backend/tests/inbox_content_protection.test.js`
- `backend/tests/mysql_inbox_checkpoint_adapter.test.js`
- `backend/tests/mysql_inbox_checkpoint.test.js`
- `backend/tests/mysql_inbox_checkpoint_integration.test.js`
- `backend/tests/inbox_handler_registry.test.js`
- `backend/tests/mysql_inbox_worker_harness.test.js`
- `backend/tests/command_event_schema.test.js`

Migrations `006` through `013` remain immutable. Permanent Inbox authority DDL is restartably split so each migration owns one permanent change: `010` owns `inbox_receipt`, `011` owns `consumer_checkpoint`, `012` owns the INBOX additions to `event_dead_letter`, `013` owns content-protection metadata, `014` binds each receipt to an exact static handler registration, and `015` creates the privacy-minimized SHARE completion projection. Each migration runs its applicable fail-closed preflight and deliberately does not guess how to migrate incompatible operational state. The checked-in schema version is `15`; these files still require isolated real-MySQL execution evidence.

**Execution constraints:** No production DDL, Docker start, external Adapter call, real provider effect, candidate/deploy, version bump, commit or push was authorized by this slice. Runtime remains `0.5.13`. Only synthetic, privacy-minimized handler facts are used in tests.

---

## 1. Frozen architecture and Interfaces

### 1.1 Inbox Retry Policy Module

The Module validates `inbox-retry-v1` and returns a deterministic decision from persisted attempt facts.

- base delay: 5 seconds;
- exponential doubling capped at 5 minutes;
- no jitter;
- `attempt_count` increments only when a claim is acquired;
- retry/dead-letter decisions use persisted `attemptCount` and `maxAttempts`;
- safe reason codes are exactly `INBOX_HANDLER_FAILED`, `INBOX_LEASE_EXPIRED`, `INBOX_PAYLOAD_INVALID` and `INBOX_SCHEMA_UNSUPPORTED`;
- unknown reason codes collapse to `INBOX_HANDLER_FAILED`;
- changing values requires a new policy version.

The Module does not read the JavaScript wall clock. The MySQL Adapter applies delay relative to database time.

### 1.2 Relational Inbox and Checkpoint Core Module

The public Interface is frozen as:

```text
receive(envelope)
claimNext({ sourceName, partitionKey })
completeOwned(claim)
failOwned(claim, { reasonCode, retryable })
recoverExpired({ sourceName, partitionKey })
getCheckpoint({ sourceName, partitionKey })
```

`consumerName`, `handlerVersion`, `workerId`, lease policy and transaction retry policy are construction-time facts. They are not caller-selectable per operation.

The Core owns:

- pool connections and `+08:00` session setup;
- transaction ordering and bounded commit retry;
- opaque transition identifiers;
- uncertain-connection destruction;
- authoritative ACK-unknown readback;
- immutable return values;
- rejection of `deliveryAdapter`, `externalAdapter` and `networkAdapter` injection.

Claims never expose a connection or the transaction-bound Adapter.

### 1.3 MySQL Inbox and Checkpoint Adapter

The transaction-bound Adapter exposes:

```text
receive / claimNext / completeOwned / failOwned / recoverExpired
readReceiptConvergence / readClaimByTransition / readTransition
readRecoveryByTransition / getCheckpoint / afterCommit / discard
```

It is created per live transaction connection and discarded after rollback, failed commit or unknown commit. SQL is parameterized and persistence failures are generic.

### 1.4 Static DATABASE_ONLY Handler Registry and transaction Seam

The Core resolves one repository-owned production registration from the static Registry before acquiring MySQL. Callers cannot provide a Registry, handler factory, SQL, statement id set, network capability or Delivery Adapter. Each registration freezes exact event scope, owner Module, source/assembly/descriptor/registration digests, statement definitions, parameter rules, permitted apply execution profiles, required verify statements and Outbox contracts.

For each owned completion, the Adapter creates a transaction toolbox:

```text
executeStatement(registeredStatementId, exactNamedParameters)
stageOutbox(registeredContractId, input)
```

The registered Implementation exposes only `apply`, `verify` and its exact Outbox builders. SQL and parameter rules live in the Registry rather than caller input.

Within one MySQL transaction, `completeOwned`:

1. locks the exact checkpoint and owned `CLAIMED` receipt;
2. runs `handler.apply`;
3. permits target relational writes through `execute`;
4. stages and flushes successor outbox records;
5. persists a minimized result and completion manifest plus digests;
6. marks the receipt `SUCCEEDED`;
7. advances the contiguous checkpoint;
8. commits once.

The production Registry currently contains exactly one handler: `task-share-completion-projection-v1`. It accepts only the minimal `SHARE / SHARE_COMPLETED` task-event payload, writes generation `1` of `task_share_completion_projection`, and persists no member, contact, health answer or request payload. Receipt, result evidence and target fact all bind the handler-local `registrationDigest`, which covers the registered SQL/parameter rules/contracts plus assembly and handler source evidence. No health, activity enrollment, reward, membership or notification handler is registered.

### 1.5 Inbox Content Protection Module

Durable Core and Adapter construction accepts only a content-protection Module whose status is both `ready=true` and `enabled=true`; the local plaintext compatibility mode is not a durable persistence Adapter.

- payload and result values are persisted as `A256GCM:v1` AES-256-GCM envelopes;
- payload and result integrity uses binding-scoped `hmac-sha256:v1`, rather than a public raw SHA-256 digest;
- HKDF derives separate encryption and digest subkeys from each configured secret;
- every new write uses the active key, while a bounded previous-key ring is decode-only and permits controlled historical reads;
- payload plaintext is capped at 64 KiB and result plaintext at 96 KiB before encryption; canonical base64 and ciphertext sizes are checked again during read;
- envelope purpose, scope binding, codec version, digest scheme, key id and content digest are verified on every read;
- migration `013` persists codec/key/digest-scheme metadata and constrains the JSON envelope shape for payload and successful result rows.

Transport equality and persisted-content integrity remain separate: the public claim uses the raw transport payload digest recomputed after authenticated decryption, while database `payload_digest` is the keyed content digest. This prevents treating an encrypted persistence digest as an event-transport digest.

External network/provider actions are forbidden inside this transaction. They require their own outbox/Delivery Adapter/outcome ledger design.

---

## 2. Frozen data contracts

### 2.1 Event identity

Exact replay compares the complete immutable envelope byte-for-byte after canonical payload serialization:

```text
consumerName / sourceName / partitionKey / partitionPosition
eventId / eventType / schemaVersion
aggregateType / aggregateId / aggregateVersion
occurredAt / producerVersion / correlationId / causationId / idempotencyKey
handlerVersion / payloadDigest / canonical payload
```

- Receipt identity is `(consumerName, eventId)`.
- Position ownership is `(consumerName, sourceName, partitionKey, partitionPosition)`.
- Exact duplicates return the persisted receipt without changing attempts, handler version, checkpoint or dead-letter facts.
- Any changed envelope field or conflicting position fails closed.
- Case, accent, whitespace and NFC/NFD variants remain distinct.
- Positions and aggregate versions are positive safe integers.

### 2.2 Authoritative receipt states

Migrations `010`–`012` freeze exactly:

```text
RECEIVED
CLAIMED
RETRY_PENDING
SUCCEEDED
DEAD_LETTER
REVIEW_REQUIRED
```

State flow:

```text
ABSENT --receive--> RECEIVED
RECEIVED | due RETRY_PENDING --claim contiguous head--> CLAIMED(owner,generation,lease)
CLAIMED --database-only completion--> SUCCEEDED + checkpoint advance
CLAIMED --retryable failure/expiry below max--> RETRY_PENDING
CLAIMED --terminal failure/expiry--> DEAD_LETTER
ambiguous or policy-incompatible authority --> REVIEW_REQUIRED
```

- `attempt_count` starts at `0` and increments exactly once per acquired claim.
- `lease_generation` increments with each claim and never decreases.
- Owned transitions fence on receipt identity, `CLAIMED`, lease owner, lease generation and claim transition.
- Zero affected rows means lease lost; predicates are never relaxed.
- `SUCCEEDED` requires completion time, result JSON, result digest, completion manifest digest and transition identity.
- `DEAD_LETTER` and `REVIEW_REQUIRED` are terminal holds in this slice.

Snapshot-era `PENDING`, `PROCESSING`, `FAILED` or generic `BLOCKED` are not relational authority and must not appear in current acceptance language.

### 2.3 Checkpoint and gap semantics

Checkpoint scope is exactly `(consumerName, sourceName, partitionKey)`:

```text
0 <= lastContiguousPosition <= highWatermarkPosition
expectedPosition = lastContiguousPosition + 1
```

Authoritative gap states are:

| `gap_status` | Meaning |
| --- | --- |
| `CLEAR` | The expected position exists in an ordinary active/succeeded state, or no known gap remains. |
| `MISSING` | Watermark is ahead but no receipt owns the expected position. |
| `BLOCKED_DEAD_LETTER` | The expected position is a terminal dead-letter receipt. |
| `REVIEW_REQUIRED` | The expected position requires governed review. |

`RECEIVED`, `CLAIMED` and `RETRY_PENDING` are normal head states, not a generic checkpoint `BLOCKED` value. The checkpoint records positional absence or terminal hold; the receipt records in-flight processing state.

- Receive creates/locks the checkpoint and monotonically raises its high watermark in the same transaction as receipt insertion/exact replay validation.
- Only `expectedPosition` may be claimed.
- Completion advances only the exact expected position; it never uses a global cursor or `MAX(position)`.
- Higher positions never hide the first missing or terminal position.
- `state_generation`, `checkpoint_transition_id`, `gap_reason_code` and `blocked_receipt_id` support exact readback and fencing.

### 2.4 Dead letter

- INBOX dead-letter rows are payload-free: `payload_json` must be `NULL`.
- The companion records source lease generation and source transition identity.
- Receipt terminal transition, dead-letter companion and checkpoint terminal hold commit atomically.
- There is no automatic skip, reopen or replay.

---

## 3. Lock order, atomicity and convergence

Every mutating transaction follows one order:

1. identify a checkpoint scope;
2. create-if-absent and lock `consumer_checkpoint` by exact scope;
3. lock or insert the relevant `inbox_receipt`;
4. for terminal failure, insert/exact-read `event_dead_letter` after the receipt lock;
5. apply target facts and stage successor outbox only for `completeOwned`;
6. update receipt, companion and checkpoint;
7. commit once.

Recovery discovers candidates, then reacquires locks per scope in fresh transactions. It never locks a receipt and reaches backward for a checkpoint. Different partitions can progress concurrently.

`ACK-unknown` means a MySQL commit may have succeeded without an acknowledgement. It does not describe an external provider outcome.

- Destroy the uncertain connection and read from a fresh primary connection.
- Receive readback verifies the full immutable envelope and monotonic checkpoint watermark.
- Claim readback verifies the exact claim transition, owner and generation.
- Success readback verifies receipt result/manifest digests, successor outbox rows, `handler.verify` target facts and checkpoint advance.
- Retry, dead-letter and recovery readback verify exact transition, generation and companion/hold facts.
- Ambiguous, partial or conflicting authority fails closed.
- An external `OUTCOME_UNKNOWN / REVIEW_REQUIRED` must never be converted to inbox success or retry.

---

## 4. Completed implementation tasks

### Task 1 — Append-only migrations 010–015

- [x] Split permanent Inbox DDL into `010_durable_inbox_checkpoint.sql`, `011_durable_consumer_checkpoint.sql` and `012_durable_inbox_dead_letter.sql`; migrations `006`–`009` remain immutable.
- [x] Kept exactly one permanent `ALTER TABLE` in each split migration, with a separate fail-closed preflight for receipt, checkpoint and historical INBOX dead-letter authority.
- [x] Froze byte-exact event/scope identity, positive positions and receipt/checkpoint/dead-letter invariants.
- [x] Added receipt retry, lease, generation, transition, result/manifest digest and terminal metadata.
- [x] Added checkpoint generation, transition, gap reason and blocked-receipt metadata.
- [x] Added `013_inbox_content_protection_metadata.sql`, which fails closed when receipts already exist and adds codec/key/digest-scheme columns, envelope checks and key-inventory indexes.
- [x] Added required due, expiry, position, transition and protection-inventory indexes.
- [x] Added `014` handler identity and handler-local registration digest to receipts, plus `015` privacy-minimized SHARE completion projection.
- [x] Advanced the checked-in schema version through `15`; checksum and migration-shape tests cover the append-only set. Real MySQL DDL execution remains a Gate.

### Task 2 — Inbox retry policy

- [x] Added deterministic versioned policy and table-driven invalid/edge coverage.
- [x] Kept inbox and outbox policy ownership separate.
- [x] Bound work independently of an untrusted large attempt count.

### Task 3 — Receive, claim and checkpoint

- [x] Added exact receive/replay validation and position conflict rejection.
- [x] Added checkpoint-first lock order and watermark/gap recomputation.
- [x] Added contiguous-head claim with owner, lease, generation and transition fencing.
- [x] Added byte-variant, out-of-order, unsafe-input and ACK-unknown coverage.

### Task 4 — Registered DATABASE_ONLY completion

- [x] Removed the caller factory from the Core/Adapter production Interface and resolved only repository-owned static registrations.
- [x] Composed synthetic target fact, successor outbox, receipt result/manifest and checkpoint in one transaction.
- [x] Added rollback proof when target work fails.
- [x] Added ACK-unknown convergence before apply and after commit without duplicate facts.
- [x] Added `verify` readback against target facts and persisted successor outbox.

### Task 5 — Retry, recovery and terminal hold

- [x] Added retry/dead-letter transitions with owner/generation fencing.
- [x] Added expired lease recovery under the same checkpoint-first lock order.
- [x] Added payload-free INBOX dead-letter companion and terminal checkpoint states.
- [x] Added stale-worker and ambiguous-readback fail-closed coverage.

### Task 6 — Core lifecycle and safety

- [x] Added `+08:00` session setup, bounded transaction attempts and connection retirement.
- [x] Added frozen Interface and immutable claims/results.
- [x] Rejected external Adapter injection at construction.
- [x] Added Core-to-real-Adapter synthetic relational integration tests.

### Task 7 — Durable Inbox content protection and formal-runtime fail-close

- [x] Added AES-256-GCM payload/result envelopes and binding-scoped keyed digests.
- [x] Derived separate encryption/digest keys with HKDF and allowed only a bounded decode-only previous-key ring.
- [x] Added purpose-specific plaintext/ciphertext size limits plus envelope codec, key, digest-scheme and binding verification.
- [x] Required `enabled` protection at both durable Core and Adapter construction; plaintext compatibility cannot reach durable persistence.
- [x] Added migration `013` metadata/readback checks so stored codec/key/digest facts are independently visible.
- [x] Rejected caller-provided handler factories and required the static registration before any MySQL acquisition.

### Task 8 — Static Registry, concrete SHARE handler and local worker harness

- [x] Added a versioned production Registry manifest, assembly/source/descriptor/registration digests and a standalone validator.
- [x] Added exact statement parameter rules, apply execution profiles and required read-only verify statements.
- [x] Added `task-share-completion-projection-v1` and bound Receipt, target fact and completion readback to its local behavior identity.
- [x] Added an exact, frozen worker harness Interface: `runOnce / recoverOnce / inspect`.
- [x] Kept the worker disabled unless `MYROOT_INBOX_WORKER_HARNESS_ENABLED=true`; no scheduler or environment integration was added.

---

## 5. Test evidence

The latest directed matrix covering schema, Registry, protection, Adapter, Core, concrete integration and worker harness is `81/81 PASS`; the standalone production Registry validator also passes. Final backend and repository aggregate counts are still deferred until the parent development task completes its last full verification.

This is local fake/relational-harness evidence. It is not a real MySQL execution attestation, a runtime worker proof or a release Gate closure.

---

## 6. Open Gates and next implementation slice

The following are deliberately not accepted by this plan:

1. **Runtime worker/scheduler:** the bounded local harness exists but is disabled by default; nothing schedules it, proves lag/alerts/kill switch, or joins it to the Outbox path.
2. **Governed replay:** no authorized replay run, sealed selection cursor, shadow generation, audit workflow or handler-version migration exists.
3. **Real MySQL proof:** migration preflight, DDL/check syntax, collation, optimizer/index plan, lock contention, crash/restart and multi-instance fault injection are unverified.
4. **Key inventory readiness:** metadata and indexes make key ids queryable, but no pre-start inventory scan proves that every persisted key id exists in the configured active/decode keyring before a key is removed.
5. **Least privilege and egress:** formal MySQL grants have not been reduced to the approved statement set, and runtime egress has not been proven deny-by-default.
6. **End-to-end event path:** Outbox Dispatcher Core and Inbox Core are not joined by a runtime bridge; no external effect is authorized.
7. **Business coverage:** only the privacy-minimized SHARE projection is registered; health, activity, reward, membership, reminder and other write facts remain outside this slice.
8. **Complete V1-T04 coverage:** reminder uniqueness, most write routes, durable outcome ledgers, retention/tombstone Jobs and operational alerts remain open.
9. **Release Gates:** V1-T01 named baseline signoff, privacy/health content authorization, activity operations, notification/subscription delivery, real UED handoff, trusted platform identity, candidate evidence and remote required CI remain open.

The next local slice should add governed, no-external-effect replay with a separately authorized run, sealed `(first_received_at, receipt_id)` selection cursor and generation `>=2` shadow projection. It must never reopen or mutate the original receipt/checkpoint and must not auto-promote shadow data. After that local contract exists, the path still requires isolated real MySQL migration, key-inventory, minimal-grant, egress, readback, lock and crash evidence.

No current evidence changes the release verdict: `P0-07=PARTIAL`, `V1-T04=OPEN`, M1 `NO-GO`, external actions `NOT AUTHORIZED`.
