-- Root was not formally launched before this rebuild. The owner confirmed on
-- 2026-08-04 that the inventoried Campaign, legacy notification and task data
-- is pre-launch test/demo data. This migration removes only that exact bounded
-- shape, or empty tables from a fresh install. Any later or differently sized
-- dataset fails closed and requires a new read-only disposition decision.

DELIMITER $$

DROP PROCEDURE IF EXISTS prune_confirmed_prelaunch_snapshot$$
CREATE PROCEDURE prune_confirmed_prelaunch_snapshot()
BEGIN
  DECLARE snapshot_row_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE invalid_collection_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE unexpected_dependency_count BIGINT UNSIGNED DEFAULT 0;

  SELECT COUNT(*) INTO unexpected_dependency_count
  FROM information_schema.key_column_usage
  WHERE table_schema = DATABASE()
    AND referenced_table_name IN (
      'campaign_definition',
      'campaign_participant',
      'campaign_rule_version',
      'notification_delivery',
      'notification_job',
      'notification_subscription',
      'notification_subscription_grant',
      'notification_template',
      'task_definition',
      'task_event',
      'task_progress_snapshot'
    )
    AND table_name NOT IN (
      'campaign_definition',
      'campaign_participant',
      'campaign_rule_version',
      'notification_delivery',
      'notification_job',
      'notification_subscription',
      'notification_subscription_grant',
      'notification_template',
      'task_definition',
      'task_event',
      'task_progress_snapshot'
    );

  IF unexpected_dependency_count <> 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '068 cleanup blocked: unexpected inbound dependency';
  END IF;

  SELECT COUNT(*) INTO snapshot_row_count
  FROM root_store_snapshot
  WHERE store_key = 'root-checkin';

  IF snapshot_row_count > 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = '068 cleanup blocked: unexpected snapshot row count';
  END IF;

  IF snapshot_row_count = 1 THEN
    SELECT COUNT(*) INTO invalid_collection_count
    FROM root_store_snapshot
    WHERE store_key = 'root-checkin'
      AND (
        (JSON_CONTAINS_PATH(payload_json, 'one', '$.campaignDefinitions') = 1
          AND (JSON_TYPE(JSON_EXTRACT(payload_json, '$.campaignDefinitions')) <> 'ARRAY'
            OR JSON_LENGTH(JSON_EXTRACT(payload_json, '$.campaignDefinitions')) NOT IN (0, 1)))
        OR (JSON_CONTAINS_PATH(payload_json, 'one', '$.campaignParticipants') = 1
          AND (JSON_TYPE(JSON_EXTRACT(payload_json, '$.campaignParticipants')) <> 'ARRAY'
            OR JSON_LENGTH(JSON_EXTRACT(payload_json, '$.campaignParticipants')) NOT IN (0, 3)))
        OR (JSON_CONTAINS_PATH(payload_json, 'one', '$.campaignRuleVersions') = 1
          AND (JSON_TYPE(JSON_EXTRACT(payload_json, '$.campaignRuleVersions')) <> 'ARRAY'
            OR JSON_LENGTH(JSON_EXTRACT(payload_json, '$.campaignRuleVersions')) NOT IN (0, 1)))
        OR (JSON_CONTAINS_PATH(payload_json, 'one', '$.notificationDeliveries') = 1
          AND (JSON_TYPE(JSON_EXTRACT(payload_json, '$.notificationDeliveries')) <> 'ARRAY'
            OR JSON_LENGTH(JSON_EXTRACT(payload_json, '$.notificationDeliveries')) NOT IN (0, 2)))
        OR (JSON_CONTAINS_PATH(payload_json, 'one', '$.notificationJobs') = 1
          AND (JSON_TYPE(JSON_EXTRACT(payload_json, '$.notificationJobs')) <> 'ARRAY'
            OR JSON_LENGTH(JSON_EXTRACT(payload_json, '$.notificationJobs')) NOT IN (0, 2)))
        OR (JSON_CONTAINS_PATH(payload_json, 'one', '$.notificationSubscriptionGrants') = 1
          AND (JSON_TYPE(JSON_EXTRACT(payload_json, '$.notificationSubscriptionGrants')) <> 'ARRAY'
            OR JSON_LENGTH(JSON_EXTRACT(payload_json, '$.notificationSubscriptionGrants')) NOT IN (0, 3)))
        OR (JSON_CONTAINS_PATH(payload_json, 'one', '$.notificationSubscriptions') = 1
          AND (JSON_TYPE(JSON_EXTRACT(payload_json, '$.notificationSubscriptions')) <> 'ARRAY'
            OR JSON_LENGTH(JSON_EXTRACT(payload_json, '$.notificationSubscriptions')) NOT IN (0, 2)))
        OR (JSON_CONTAINS_PATH(payload_json, 'one', '$.notificationTemplates') = 1
          AND (JSON_TYPE(JSON_EXTRACT(payload_json, '$.notificationTemplates')) <> 'ARRAY'
            OR JSON_LENGTH(JSON_EXTRACT(payload_json, '$.notificationTemplates')) NOT IN (0, 1)))
        OR (JSON_CONTAINS_PATH(payload_json, 'one', '$.taskDefinitions') = 1
          AND (JSON_TYPE(JSON_EXTRACT(payload_json, '$.taskDefinitions')) <> 'ARRAY'
            OR JSON_LENGTH(JSON_EXTRACT(payload_json, '$.taskDefinitions')) NOT IN (0, 6)))
        OR (JSON_CONTAINS_PATH(payload_json, 'one', '$.taskEvents') = 1
          AND (JSON_TYPE(JSON_EXTRACT(payload_json, '$.taskEvents')) <> 'ARRAY'
            OR JSON_LENGTH(JSON_EXTRACT(payload_json, '$.taskEvents')) NOT IN (0, 1)))
        OR (JSON_CONTAINS_PATH(payload_json, 'one', '$.taskProgressSnapshots') = 1
          AND (JSON_TYPE(JSON_EXTRACT(payload_json, '$.taskProgressSnapshots')) <> 'ARRAY'
            OR JSON_LENGTH(JSON_EXTRACT(payload_json, '$.taskProgressSnapshots')) NOT IN (0, 5)))
      );

    IF invalid_collection_count <> 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = '068 cleanup blocked: snapshot inventory drifted';
    END IF;

    UPDATE root_store_snapshot
    SET payload_json = JSON_REMOVE(
          payload_json,
          '$.campaignDefinitions',
          '$.campaignParticipants',
          '$.campaignRuleVersions',
          '$.notificationDeliveries',
          '$.notificationJobs',
          '$.notificationSubscriptionGrants',
          '$.notificationSubscriptions',
          '$.notificationTemplates',
          '$.taskDefinitions',
          '$.taskEvents',
          '$.taskProgressSnapshots'
        ),
        revision = revision + 1,
        updated_at = CURRENT_TIMESTAMP(3)
    WHERE store_key = 'root-checkin'
      AND JSON_CONTAINS_PATH(
        payload_json,
        'one',
        '$.campaignDefinitions',
        '$.campaignParticipants',
        '$.campaignRuleVersions',
        '$.notificationDeliveries',
        '$.notificationJobs',
        '$.notificationSubscriptionGrants',
        '$.notificationSubscriptions',
        '$.notificationTemplates',
        '$.taskDefinitions',
        '$.taskEvents',
        '$.taskProgressSnapshots'
      ) = 1;
  END IF;
END$$

DROP PROCEDURE IF EXISTS assert_confirmed_prelaunch_table$$
CREATE PROCEDURE assert_confirmed_prelaunch_table(
  IN target_table VARCHAR(64),
  IN confirmed_row_count BIGINT UNSIGNED,
  IN confirmed_last_at DATETIME(3)
)
BEGIN
  DECLARE target_exists BIGINT UNSIGNED DEFAULT 0;
  DECLARE failure_message VARCHAR(128);

  SELECT COUNT(*) INTO target_exists
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = target_table
    AND table_type = 'BASE TABLE';

  IF target_exists = 1 THEN
    CASE target_table
      WHEN 'campaign_definition' THEN
        SET @inventory_sql = 'SELECT COUNT(*), MAX(COALESCE(updated_at, created_at)) INTO @actual_row_count, @actual_last_at FROM `campaign_definition`';
      WHEN 'campaign_participant' THEN
        SET @inventory_sql = 'SELECT COUNT(*), MAX(COALESCE(updated_at, created_at)) INTO @actual_row_count, @actual_last_at FROM `campaign_participant`';
      WHEN 'campaign_rule_version' THEN
        SET @inventory_sql = 'SELECT COUNT(*), MAX(COALESCE(updated_at, created_at)) INTO @actual_row_count, @actual_last_at FROM `campaign_rule_version`';
      WHEN 'notification_delivery' THEN
        SET @inventory_sql = 'SELECT COUNT(*), MAX(COALESCE(delivered_at, created_at)) INTO @actual_row_count, @actual_last_at FROM `notification_delivery`';
      WHEN 'notification_job' THEN
        SET @inventory_sql = 'SELECT COUNT(*), MAX(COALESCE(updated_at, sent_at, skipped_at, created_at)) INTO @actual_row_count, @actual_last_at FROM `notification_job`';
      WHEN 'notification_subscription' THEN
        SET @inventory_sql = 'SELECT COUNT(*), MAX(COALESCE(updated_at, created_at)) INTO @actual_row_count, @actual_last_at FROM `notification_subscription`';
      WHEN 'notification_subscription_grant' THEN
        SET @inventory_sql = 'SELECT COUNT(*), MAX(COALESCE(updated_at, invalidated_at, released_at, consumed_at, reserved_at, granted_at, created_at)) INTO @actual_row_count, @actual_last_at FROM `notification_subscription_grant`';
      WHEN 'notification_template' THEN
        SET @inventory_sql = 'SELECT COUNT(*), MAX(COALESCE(updated_at, created_at)) INTO @actual_row_count, @actual_last_at FROM `notification_template`';
      WHEN 'task_definition' THEN
        SET @inventory_sql = 'SELECT COUNT(*), MAX(COALESCE(updated_at, created_at)) INTO @actual_row_count, @actual_last_at FROM `task_definition`';
      WHEN 'task_event' THEN
        SET @inventory_sql = 'SELECT COUNT(*), MAX(COALESCE(occurred_at, created_at)) INTO @actual_row_count, @actual_last_at FROM `task_event`';
      WHEN 'task_progress_snapshot' THEN
        SET @inventory_sql = 'SELECT COUNT(*), MAX(COALESCE(updated_at, computed_at, created_at)) INTO @actual_row_count, @actual_last_at FROM `task_progress_snapshot`';
      ELSE
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = '068 cleanup blocked: table is not allowlisted';
    END CASE;

    SET @actual_row_count = NULL;
    SET @actual_last_at = NULL;
    PREPARE inventory_statement FROM @inventory_sql;
    EXECUTE inventory_statement;
    DEALLOCATE PREPARE inventory_statement;

    IF @actual_row_count NOT IN (0, confirmed_row_count) THEN
      SET failure_message = CONCAT('068 cleanup blocked: row count drifted for ', target_table);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = failure_message;
    END IF;

    IF @actual_row_count = confirmed_row_count
      AND (@actual_last_at IS NULL OR @actual_last_at > confirmed_last_at) THEN
      SET failure_message = CONCAT('068 cleanup blocked: timestamp drifted for ', target_table);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = failure_message;
    END IF;

  END IF;
END$$

CALL assert_confirmed_prelaunch_table('notification_delivery', 2, '2026-07-13 19:48:58.000')$$
CALL assert_confirmed_prelaunch_table('notification_subscription_grant', 3, '2026-07-13 19:48:58.000')$$
CALL assert_confirmed_prelaunch_table('notification_job', 2, '2026-07-13 19:48:58.000')$$
CALL assert_confirmed_prelaunch_table('notification_subscription', 2, '2026-07-13 19:28:30.000')$$
CALL assert_confirmed_prelaunch_table('notification_template', 1, '2026-07-15 17:09:05.000')$$

CALL assert_confirmed_prelaunch_table('task_event', 1, '2026-07-13 13:19:57.000')$$
CALL assert_confirmed_prelaunch_table('task_progress_snapshot', 5, '2026-07-15 17:09:04.000')$$
CALL assert_confirmed_prelaunch_table('task_definition', 6, '2026-07-11 16:15:04.000')$$

CALL assert_confirmed_prelaunch_table('campaign_participant', 3, '2026-07-15 16:47:05.000')$$
CALL assert_confirmed_prelaunch_table('campaign_rule_version', 1, '2026-07-13 12:36:05.000')$$
CALL assert_confirmed_prelaunch_table('campaign_definition', 1, '2026-07-11 16:15:04.000')$$

CALL prune_confirmed_prelaunch_snapshot()$$

DROP TABLE IF EXISTS notification_delivery$$
DROP TABLE IF EXISTS notification_subscription_grant$$
DROP TABLE IF EXISTS notification_job$$
DROP TABLE IF EXISTS notification_subscription$$
DROP TABLE IF EXISTS notification_template$$

DROP TABLE IF EXISTS task_event$$
DROP TABLE IF EXISTS task_progress_snapshot$$
DROP TABLE IF EXISTS task_definition$$

DROP TABLE IF EXISTS campaign_participant$$
DROP TABLE IF EXISTS campaign_rule_version$$
DROP TABLE IF EXISTS campaign_definition$$

DROP PROCEDURE assert_confirmed_prelaunch_table$$
DROP PROCEDURE prune_confirmed_prelaunch_snapshot$$

DELIMITER ;
