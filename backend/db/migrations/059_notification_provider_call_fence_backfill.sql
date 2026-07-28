-- Existing REQUESTED attempts are ambiguous: a provider call may have happened
-- before this fence existed. Fail them closed for manual review. Existing
-- terminal attempts remain terminal but do not gain fabricated lease evidence.
-- This is one convergent UPDATE and is safe to replay after acknowledgement loss.

UPDATE notification_send_attempt
SET provider_call_state = CASE
      WHEN status = 'REQUESTED' THEN 'REVIEW_REQUIRED'
      ELSE 'COMPLETED'
    END,
    provider_call_owner = NULL,
    provider_call_lease_expires_at = NULL,
    provider_call_generation = 0,
    provider_call_started_at = NULL
WHERE provider_call_state IS NULL
   OR provider_call_generation IS NULL;
