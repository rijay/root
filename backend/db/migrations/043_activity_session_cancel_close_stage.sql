-- Stage the independent cancellation cutoff as one atomic permanent DDL.
-- A lost acknowledgement is reconciled by the exact structure guard.

ALTER TABLE activity_session
  ADD COLUMN cancel_close_at DATETIME(3) NULL
    AFTER registration_close_at;
