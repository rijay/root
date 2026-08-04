-- Formal-launch cleanup only removes database objects whose production inventory
-- was empty on 2026-08-04. User, health, activity, campaign, task history and the
-- legacy notification history remain outside this migration.

DELIMITER $$

DROP PROCEDURE IF EXISTS assert_formal_launch_retired_tables_empty$$
CREATE PROCEDURE assert_formal_launch_retired_tables_empty()
BEGIN
  DECLARE retired_row_count BIGINT UNSIGNED DEFAULT 0;

  SELECT SUM(item_count) INTO retired_row_count
  FROM (
    SELECT COUNT(*) AS item_count FROM v1_runtime_alert_delivery
    UNION ALL SELECT COUNT(*) FROM v1_runtime_alert_registration_authority
    UNION ALL SELECT COUNT(*) FROM v1_runtime_alert
    UNION ALL SELECT COUNT(*) FROM v1_runtime_cycle
    UNION ALL SELECT COUNT(*) FROM notification_send_attempt_transition
    UNION ALL SELECT COUNT(*) FROM notification_send_attempt
    UNION ALL SELECT COUNT(*) FROM notification_job_v1
    UNION ALL SELECT COUNT(*) FROM notification_subscription_grant_v1
    UNION ALL SELECT COUNT(*) FROM notification_subscription_attempt_v1
    UNION ALL SELECT COUNT(*) FROM settlement_source_resolution_audit
    UNION ALL SELECT COUNT(*) FROM settlement_source_authority
    UNION ALL SELECT COUNT(*) FROM settlement_record
    UNION ALL SELECT COUNT(*) FROM manual_review_item
    UNION ALL SELECT COUNT(*) FROM task_source_invalidation_event
    UNION ALL SELECT COUNT(*) FROM task_activity_assignment
    UNION ALL SELECT COUNT(*) FROM task_share_completion_shadow_projection
    UNION ALL SELECT COUNT(*) FROM task_share_completion_projection
    UNION ALL SELECT COUNT(*) FROM task_share_migration_projection
    UNION ALL SELECT COUNT(*) FROM inbox_replay_run
    UNION ALL SELECT COUNT(*) FROM migration_lineage
    UNION ALL SELECT COUNT(*) FROM migration_run
    UNION ALL SELECT COUNT(*) FROM migration_contract_registry
    UNION ALL SELECT COUNT(*) FROM consumer_checkpoint
    UNION ALL SELECT COUNT(*) FROM event_dead_letter
    UNION ALL SELECT COUNT(*) FROM inbox_receipt
    UNION ALL SELECT COUNT(*) FROM outbox_event
    UNION ALL SELECT COUNT(*) FROM reward_delivery_job
    UNION ALL SELECT COUNT(*) FROM reward_recovery_record
    UNION ALL SELECT COUNT(*) FROM reward_inventory_reservation
    UNION ALL SELECT COUNT(*) FROM reward_grant
    UNION ALL SELECT COUNT(*) FROM reward_inventory_pool
  ) AS retired_inventory;

  IF retired_row_count <> 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '067 cleanup blocked: retired tables contain rows';
  END IF;
END$$

CALL assert_formal_launch_retired_tables_empty()$$
DROP PROCEDURE assert_formal_launch_retired_tables_empty$$

DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_claim$$
DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_complete_delivered$$
DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_fail_before_provider_dead$$
DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_fail_before_provider_retry$$
DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_inspect$$
DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_mark_provider_started$$
DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_mark_unknown$$
DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_recover_claim_dead$$
DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_recover_claim_retry$$
DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_recover_started_unknown$$
DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_register_controlled$$
DROP PROCEDURE IF EXISTS v1_runtime_alert_delivery_register_dry_run$$
DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_claim_cycle$$
DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_finalize_cycle$$
DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_inspect_snapshot$$
DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_lock_stale_cycles$$
DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_prepare_alert$$
DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_read_alert$$
DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_read_cycle_by_id$$
DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_read_cycle_by_schedule$$
DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_recover_stale_cycle_prepare_alert$$
DROP PROCEDURE IF EXISTS v1_runtime_control_ledger_renew_cycle$$

DELIMITER ;

DROP TABLE IF EXISTS v1_runtime_alert_delivery;
DROP TABLE IF EXISTS v1_runtime_alert_registration_authority;
DROP TABLE IF EXISTS v1_runtime_alert;
DROP TABLE IF EXISTS v1_runtime_cycle;

DROP TABLE IF EXISTS notification_send_attempt_transition;
DROP TABLE IF EXISTS notification_send_attempt;
DROP TABLE IF EXISTS notification_job_v1;
DROP TABLE IF EXISTS notification_subscription_grant_v1;
DROP TABLE IF EXISTS notification_subscription_attempt_v1;

DROP TABLE IF EXISTS settlement_source_resolution_audit;
DROP TABLE IF EXISTS settlement_source_authority;
DROP TABLE IF EXISTS settlement_record;
DROP TABLE IF EXISTS manual_review_item;

DROP TABLE IF EXISTS task_source_invalidation_event;
DROP TABLE IF EXISTS task_activity_assignment;
DROP TABLE IF EXISTS task_share_completion_shadow_projection;
DROP TABLE IF EXISTS task_share_completion_projection;
DROP TABLE IF EXISTS task_share_migration_projection;

DROP TABLE IF EXISTS inbox_replay_run;
DROP TABLE IF EXISTS migration_lineage;
DROP TABLE IF EXISTS migration_run;
DROP TABLE IF EXISTS migration_contract_registry;
DROP TABLE IF EXISTS consumer_checkpoint;
DROP TABLE IF EXISTS event_dead_letter;
DROP TABLE IF EXISTS inbox_receipt;
DROP TABLE IF EXISTS outbox_event;

DROP TABLE IF EXISTS reward_delivery_job;
DROP TABLE IF EXISTS reward_recovery_record;
DROP TABLE IF EXISTS reward_inventory_reservation;
DROP TABLE IF EXISTS reward_grant;
DROP TABLE IF EXISTS reward_inventory_pool;
