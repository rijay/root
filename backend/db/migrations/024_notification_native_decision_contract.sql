-- Native decision semantics changed from the provisional v0 values. Existing
-- rows require an explicit migration decision and must never be reclassified.
DROP TEMPORARY TABLE IF EXISTS migration_024_notification_native_preflight;

CREATE TEMPORARY TABLE migration_024_notification_native_preflight (
  guard_id TINYINT UNSIGNED PRIMARY KEY
) ENGINE = InnoDB;

INSERT INTO migration_024_notification_native_preflight (guard_id) VALUES (1);

INSERT INTO migration_024_notification_native_preflight (guard_id)
SELECT 1 FROM notification_subscription_attempt_v1 LIMIT 1;

DROP TEMPORARY TABLE migration_024_notification_native_preflight;

ALTER TABLE notification_subscription_attempt_v1
  DROP CHECK chk_notification_subscription_attempt_v1_decision,
  MODIFY COLUMN native_decision VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ADD CONSTRAINT chk_notification_subscription_attempt_v1_decision
    CHECK (native_decision IN ('ACCEPTED', 'REJECTED', 'PLATFORM_DISABLED', 'OUTCOME_UNKNOWN')),
  ADD CONSTRAINT chk_notification_subscription_attempt_v1_reason
    CHECK (
      (native_decision = 'ACCEPTED' AND reason_code IS NULL)
      OR (native_decision = 'REJECTED' AND reason_code IS NOT NULL AND reason_code = 'USER_REJECTED')
      OR (native_decision = 'PLATFORM_DISABLED' AND reason_code IS NOT NULL AND reason_code = 'PLATFORM_DISABLED')
      OR (native_decision = 'OUTCOME_UNKNOWN' AND reason_code IS NOT NULL AND reason_code = 'OUTCOME_UNKNOWN')
    );
