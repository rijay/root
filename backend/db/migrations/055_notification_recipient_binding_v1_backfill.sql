-- Historical v1 grants cannot prove which MYROOT identity authorized
-- delivery. This single convergent UPDATE is safe to replay after an
-- acknowledgement loss or process interruption.

UPDATE notification_subscription_grant_v1
SET recipient_binding_status = 'UNVERIFIED',
    recipient_wechat_identity_id = NULL,
    recipient_app_code = NULL,
    recipient_binding_canonical_version = NULL,
    recipient_binding_digest = NULL,
    recipient_binding_digest_scheme = NULL,
    recipient_binding_key_id = NULL,
    status_reason_code = 'RECIPIENT_BINDING_UNVERIFIED',
    review_required_at = COALESCE(review_required_at, updated_at, created_at),
    status = 'REVIEW_REQUIRED'
WHERE recipient_binding_status IS NULL;
