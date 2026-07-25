-- Enforce the provider-call state machine after the convergent backfill. A
-- LEASED owner may cross the provider Seam only after atomically becoming
-- STARTED; STARTED is never eligible for takeover and must converge to a
-- terminal outcome (UNKNOWN when crash recovery cannot prove the result).
-- This migration owns exactly one permanent ALTER.
DROP TEMPORARY TABLE IF EXISTS migration_060_notification_provider_call_preflight;

CREATE TEMPORARY TABLE migration_060_notification_provider_call_preflight (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO migration_060_notification_provider_call_preflight (guard_id) VALUES (1);

INSERT INTO migration_060_notification_provider_call_preflight (guard_id)
SELECT 1
FROM notification_send_attempt
WHERE provider_call_state IS NULL
   OR provider_call_generation IS NULL
   OR NOT (
     (
       provider_call_state IN ('AVAILABLE', 'REVIEW_REQUIRED')
       AND status = 'REQUESTED'
       AND provider_call_owner IS NULL
       AND provider_call_lease_expires_at IS NULL
       AND provider_call_generation = 0
       AND provider_call_started_at IS NULL
     )
     OR (
       provider_call_state = 'LEASED'
       AND status = 'REQUESTED'
       AND provider_call_owner IS NOT NULL
       AND provider_call_lease_expires_at IS NOT NULL
       AND provider_call_generation >= 1
       AND provider_call_started_at IS NULL
     )
     OR (
       provider_call_state = 'STARTED'
       AND status = 'REQUESTED'
       AND provider_call_owner IS NOT NULL
       AND provider_call_lease_expires_at IS NOT NULL
       AND provider_call_generation >= 1
       AND provider_call_started_at IS NOT NULL
       AND provider_call_started_at < provider_call_lease_expires_at
     )
     OR (
       provider_call_state = 'COMPLETED'
       AND status <> 'REQUESTED'
       AND (
         (
           provider_call_owner IS NULL
           AND provider_call_lease_expires_at IS NULL
           AND provider_call_generation = 0
           AND provider_call_started_at IS NULL
         )
         OR (
           provider_call_owner IS NOT NULL
           AND provider_call_lease_expires_at IS NOT NULL
           AND provider_call_generation >= 1
           AND provider_call_started_at IS NOT NULL
           AND provider_call_started_at < provider_call_lease_expires_at
         )
       )
     )
   )
LIMIT 1;

DROP TEMPORARY TABLE migration_060_notification_provider_call_preflight;

ALTER TABLE notification_send_attempt
  MODIFY COLUMN provider_call_state VARCHAR(24)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN provider_call_generation BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD KEY idx_notification_provider_call_recovery (
    status,
    provider_call_state,
    provider_call_lease_expires_at,
    notification_send_attempt_id
  ),
  ADD KEY idx_notification_provider_call_owner (
    provider_call_owner,
    provider_call_generation,
    notification_send_attempt_id
  ),
  ADD CONSTRAINT chk_notification_provider_call_fence
    CHECK (
      (
        provider_call_state IN ('AVAILABLE', 'REVIEW_REQUIRED')
        AND status = 'REQUESTED'
        AND provider_call_owner IS NULL
        AND provider_call_lease_expires_at IS NULL
        AND provider_call_generation = 0
        AND provider_call_started_at IS NULL
      )
      OR (
        provider_call_state = 'LEASED'
        AND status = 'REQUESTED'
        AND provider_call_owner IS NOT NULL
        AND provider_call_lease_expires_at IS NOT NULL
        AND provider_call_generation >= 1
        AND provider_call_started_at IS NULL
      )
      OR (
        provider_call_state = 'STARTED'
        AND status = 'REQUESTED'
        AND provider_call_owner IS NOT NULL
        AND provider_call_lease_expires_at IS NOT NULL
        AND provider_call_generation >= 1
        AND provider_call_started_at IS NOT NULL
        AND provider_call_started_at < provider_call_lease_expires_at
      )
      OR (
        provider_call_state = 'COMPLETED'
        AND status <> 'REQUESTED'
        AND (
          (
            provider_call_owner IS NULL
            AND provider_call_lease_expires_at IS NULL
            AND provider_call_generation = 0
            AND provider_call_started_at IS NULL
          )
          OR (
            provider_call_owner IS NOT NULL
            AND provider_call_lease_expires_at IS NOT NULL
            AND provider_call_generation >= 1
            AND provider_call_started_at IS NOT NULL
            AND provider_call_started_at < provider_call_lease_expires_at
          )
        )
      )
    );
