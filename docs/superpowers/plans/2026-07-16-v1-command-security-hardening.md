# myRoot v1.0.0 Command Security Hardening Slice

**Goal:** Close the remaining local cross-actor replay and silent plaintext downgrade risks before relational command recovery is connected to additional write routes.

**Architecture:** Migration `008` freezes exact binary command scope and records crypto/retention metadata without editing migrations `006/007`. The Command Request Digest Module owns canonicalization plus versioned keyed HMAC. The MySQL Command Idempotency Adapter receives mandatory digest/result codecs at construction, byte-checks every selected scope, and no longer lets callers choose protection per method call. This increases Module Depth: callers provide a command intent and cannot bypass the protection policy.

**Status label on completion:** `COMMAND_SECURITY_HARDENING_LOCAL_COMPLETE / REAL_MYSQL_MIGRATION_ROTATION_RETENTION_EVIDENCE_PENDING`.

**Constraints:** No production connection, real migration apply, secret creation, key rotation, external send, deploy, version bump, commit or push. Keep `P0-07=PARTIAL`, `V1-T04=OPEN`, formal M1 `NO-GO`.

## Current local execution record (2026-07-16)

- Local implementation status: `COMMAND_SECURITY_HARDENING_LOCAL_COMPLETE`.
- Migration `008`, versioned request HMAC, constructor-mandatory request/result codecs, exact post-SELECT scope checks, result-envelope metadata checks and legacy relational digest upgrade are present in the working tree.
- Local verification evidence: focused security/recovery matrix `60/60 PASS`; HTTP/transaction matrix `31/31 PASS`; backend full suite `415/415 PASS`; Route Registry `16/16 PASS`; repository verification `17/17 PASS` with `267` JavaScript syntax checks and `8` immutable migration checksums; `git diff --check` PASS. These are local contract and failure-injection results, not real MySQL or release evidence.
- No production connection, DDL apply, secret creation, rotation, external send, deploy, version bump, commit or push was performed by this slice.
- Gates that remain open: real MySQL collation/locking and multi-worker evidence; production DDL approval/apply; request/result keyring rotation and historical-key replay; retention/tombstone/GC Job; lazy-imported snapshot legacy-record scrub; and keyed HMAC protection for the original business idempotency-key token (the persisted token is still an unkeyed SHA-256 derivative).

## Task 1: Append migration 008

- [x] Freeze exact collations for command scope/digest columns.
- [x] Add digest, result, retention and tombstone metadata plus indexes.
- [x] Update immutable checksum registry and local schema version.
- [x] Prove `006/007` remain byte-identical and migrations remain ordered.

## Task 2: Add versioned request digest codec

- [x] Freeze `canonical-json:v1` and `hmac-sha256:v1` domain separation.
- [x] Fail closed in protected runtime without a valid active key.
- [x] Support legacy `sha256:v0` verification only for compatibility.
- [x] Use timing-safe comparison and generic errors.

## Task 3: Make protection mandatory at the Adapter seam

- [x] Inject request digest and result codecs when constructing each transaction-generation Adapter.
- [x] Remove optional per-call result codec selection from relational methods.
- [x] Reject missing/invalid codecs before SQL.
- [x] Persist crypto metadata and cross-check envelope key metadata.

## Task 4: Enforce exact scope twice

- [x] Use binary database collation.
- [x] After every scope SELECT, byte-compare stored command name, actor id and tokenized key with the requested descriptor.
- [x] Fail closed on case, accent, NFC/NFD or whitespace mismatch.

## Task 5: Verify and record Gates

- [x] Run the final combined focused tests, full backend tests, route verification, final verification, checksum and diff checks; record the exact local counts above.
- [x] Record the final exact local evidence in the technical review.
- [x] Leave real MySQL collation/locking, keyring rotation, retention policy/GC, legacy scrub, business-key-token HMAC and production DDL as explicit Gates.
