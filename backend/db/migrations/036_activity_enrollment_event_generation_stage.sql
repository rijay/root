-- Stage the generation projection as nullable. Existing events are not assigned
-- a guessed default: migration 037 derives every value from the immutable ENROLL
-- sequence before migration 038 makes the column mandatory.

ALTER TABLE activity_enrollment_event
  ADD COLUMN attempt_generation INT UNSIGNED NULL AFTER root_user_id;
