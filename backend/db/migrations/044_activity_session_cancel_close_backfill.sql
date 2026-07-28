-- Idempotent DML stage. Replaying this statement after an unknown
-- acknowledgement is safe because only NULL rows are updated.

UPDATE activity_session
SET cancel_close_at = registration_close_at
WHERE cancel_close_at IS NULL;
