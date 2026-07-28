-- Explicit recovery lease and fencing facts for command execution. A worker may
-- complete an attempt only while it owns the current lease_generation.

ALTER TABLE command_idempotency
  ADD COLUMN lease_owner VARCHAR(128) NULL AFTER last_attempt_request_id,
  ADD COLUMN lease_expires_at DATETIME(3) NULL AFTER lease_owner,
  ADD COLUMN lease_generation BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER lease_expires_at,
  ADD KEY idx_command_idempotency_recovery (
    status,
    lease_expires_at,
    command_idempotency_id
  );
