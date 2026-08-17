const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  MYSQL_MIGRATION_STRUCTURE_STATES,
  inspectMysqlMigrationStructure,
  mysqlMigrationStructureSuccessor,
} = require("../src/mysqlMigrationStructureGuard");
const {
  applyMysqlMigrations,
  listMigrationFiles,
  migrationChecksum,
  splitSqlStatements,
} = require("../src/mysqlMigrations");

const MIGRATIONS_DIR = path.join(__dirname, "..", "db", "migrations");
const GUARDED_MIGRATIONS = [
  "014_inbox_handler_identity.sql",
  "015_task_share_completion_projection.sql",
  "016_inbox_replay_run.sql",
  "017_task_share_completion_shadow_projection.sql",
  "018_notification_subscription_attempt.sql",
  "019_notification_subscription_grant.sql",
  "020_notification_job.sql",
  "021_notification_send_attempt.sql",
  "022_notification_send_attempt_transition.sql",
  "023_inbox_replay_executor_identity.sql",
  "024_notification_native_decision_contract.sql",
  "025_notification_job_request_identity.sql",
  "026_notification_send_attempt_receipt_metadata.sql",
  "027_notification_send_transition_receipt_metadata.sql",
  "028_migration_contract_registry.sql",
  "029_migration_run.sql",
  "030_migration_lineage.sql",
  "031_task_share_migration_projection.sql",
  "032_v1_runtime_cycle.sql",
  "033_v1_runtime_alert.sql",
  "035_activity_publication_session_event.sql",
  "036_activity_enrollment_event_generation_stage.sql",
  "038_activity_enrollment_event_generation_enforce.sql",
  "039_activity_session_event.sql",
  "040_activity_p0_content_and_session_policy.sql",
  "041_task_activity_assignment.sql",
  "042_task_source_invalidation_event.sql",
  "043_activity_session_cancel_close_stage.sql",
  "044_activity_session_cancel_close_backfill.sql",
  "045_activity_session_policy_enforce.sql",
  "046_task_event_idempotency_scope_stage.sql",
  "048_task_event_idempotency_scope_enforce.sql",
  "049_wechat_unionid_provenance_stage.sql",
  "051_wechat_unionid_provenance_enforce.sql",
  "052_notification_recipient_binding_legacy_stage.sql",
  "053_notification_recipient_binding_v1_stage.sql",
  "056_notification_recipient_binding_legacy_enforce.sql",
  "057_notification_recipient_binding_v1_enforce.sql",
  "058_notification_provider_call_fence_stage.sql",
  "060_notification_provider_call_fence_enforce.sql",
  "061_v1_runtime_alert_delivery.sql",
  "062_settlement_source_authority.sql",
];

function splitTopLevel(value) {
  const segments = [];
  let current = "";
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "'") {
      current += character;
      if (quoted && value[index + 1] === "'") {
        current += value[index + 1];
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (!quoted && character === "(") depth += 1;
    if (!quoted && character === ")") depth -= 1;
    if (!quoted && depth === 0 && character === ",") {
      if (current.trim()) segments.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

function parenthesizedBody(sql, startAt) {
  const start = sql.indexOf("(", startAt);
  let depth = 1;
  let quoted = false;
  for (let index = start + 1; index < sql.length; index += 1) {
    const character = sql[index];
    if (character === "'") {
      if (quoted && sql[index + 1] === "'") {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0) return sql.slice(start + 1, index);
  }
  throw new Error("unbalanced test DDL");
}

function columnRow(name, definition, ordinal) {
  const compact = definition.replace(/\s+/g, " ").trim();
  const type = compact.match(/^((?:var)?char\(\d+\)|tinyint(?:\(\d+\))?(?: unsigned)?|(?:int|bigint)(?: unsigned)?|datetime\(\d+\)|date|json)/i);
  assert.ok(type, `missing type for ${name}`);
  const charset = compact.match(/CHARACTER SET (\w+)/i);
  const collation = compact.match(/COLLATE (\w+)/i);
  const defaultValue = compact.match(/\bDEFAULT\s+([^ ]+)/i);
  return {
    column_name: name,
    ordinal_position: ordinal,
    column_type: type[1].toLowerCase(),
    is_nullable: /\bNOT NULL\b/i.test(compact) ? "NO" : "YES",
    column_default: defaultValue ? defaultValue[1].replace(/^'|'$/g, "") : null,
    character_set_name: charset
      ? charset[1].toLowerCase()
      : (collation && collation[1].toLowerCase().startsWith("utf8mb4_") ? "utf8mb4" : null),
    collation_name: collation ? collation[1].toLowerCase() : null,
    extra: "",
    generation_expression: "",
  };
}

function checkClauses(sql) {
  const rows = [];
  const expression = /CONSTRAINT\s+([A-Za-z0-9_]+)\s+CHECK\s*\(/g;
  let match;
  while ((match = expression.exec(sql))) {
    let depth = 1;
    let quoted = false;
    let end = expression.lastIndex;
    for (; end < sql.length; end += 1) {
      const character = sql[end];
      if (character === "'") {
        if (quoted && sql[end + 1] === "'") {
          end += 1;
          continue;
        }
        quoted = !quoted;
        continue;
      }
      if (quoted) continue;
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (depth === 0) break;
    }
    rows.push({ constraint_name: match[1], check_clause: sql.slice(expression.lastIndex, end) });
    expression.lastIndex = end + 1;
  }
  return rows;
}

function indexRows(segments) {
  const rows = [];
  for (const segment of segments) {
    let match = segment.match(/^(?:ADD\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/i);
    let indexName = "PRIMARY";
    let nonUnique = 0;
    if (!match) {
      match = segment.match(/^(?:ADD\s+)?UNIQUE\s+KEY\s+([A-Za-z0-9_]+)\s*\(([^)]+)\)/i);
      if (match) {
        indexName = match[1];
        match = [match[0], match[2]];
      }
    }
    if (!match) {
      match = segment.match(/^(?:ADD\s+)?KEY\s+([A-Za-z0-9_]+)\s*\(([^)]+)\)/i);
      if (match) {
        indexName = match[1];
        nonUnique = 1;
        match = [match[0], match[2]];
      }
    }
    if (!match) continue;
    match[1].split(",").map((item) => item.trim().replace(/`/g, "")).forEach((columnName, index) => {
      rows.push({
        index_name: indexName,
        non_unique: nonUnique,
        seq_in_index: index + 1,
        column_name: columnName,
        sub_part: null,
        index_type: "BTREE",
      });
    });
  }
  return rows;
}

function foreignKeyMetadata(segments) {
  const columns = [];
  const rules = [];
  for (const segment of segments) {
    const match = segment.match(
      /^CONSTRAINT\s+([A-Za-z0-9_]+)\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([A-Za-z0-9_]+)\s*\(([^)]+)\)[\s\S]*?ON\s+UPDATE\s+(\w+)[\s\S]*?ON\s+DELETE\s+(\w+)/i
    );
    if (!match) continue;
    const localColumns = match[2].split(",").map((item) => item.trim().replace(/`/g, ""));
    const referencedColumns = match[4].split(",").map((item) => item.trim().replace(/`/g, ""));
    localColumns.forEach((columnName, index) => columns.push({
      constraint_name: match[1],
      ordinal_position: index + 1,
      column_name: columnName,
      referenced_table_name: match[3],
      referenced_column_name: referencedColumns[index],
    }));
    rules.push({ constraint_name: match[1], update_rule: match[5], delete_rule: match[6] });
  }
  return { columns, rules };
}

function metadataFixtures(migrationName) {
  if (migrationName === "062_settlement_source_authority.sql") {
    return [
      metadataFixture(migrationName, "settlement_source_authority"),
      metadataFixture(migrationName, "settlement_source_resolution_audit"),
      metadataFixture(migrationName, "manual_review_item"),
    ];
  }
  return [metadataFixture(migrationName)];
}

function metadataFixture(migrationName, targetTableName = "") {
  if (migrationName === "044_activity_session_cancel_close_backfill.sql") {
    return metadataFixture("043_activity_session_cancel_close_stage.sql");
  }
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, migrationName), "utf8");
  const statements = splitSqlStatements(sql);
  const targetExpression = targetTableName
    ? new RegExp(`(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE)\\s+${targetTableName}\\b`, "i")
    : /(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE)\s+[A-Za-z0-9_]+/i;
  const ddl = statements.find((statement) => targetExpression.test(statement)) || sql;
  const createMatch = ddl.match(/CREATE TABLE IF NOT EXISTS\s+([A-Za-z0-9_]+)/i);
  const alterMatch = ddl.match(/ALTER TABLE\s+([A-Za-z0-9_]+)/i);
  const tableName = (createMatch || alterMatch)[1];
  const segments = createMatch
    ? splitTopLevel(parenthesizedBody(ddl, createMatch.index))
    : splitTopLevel(ddl.slice(alterMatch.index + alterMatch[0].length));
  const columns = [];
  if (alterMatch) {
    const anchors = {
      "023_inbox_replay_executor_identity.sql": [
        "execution_handler_version",
        "VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL",
      ],
      "024_notification_native_decision_contract.sql": [
        "grant_request_id",
        "VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL",
      ],
      "025_notification_job_request_identity.sql": ["due_at", "DATETIME(3) NOT NULL"],
      "026_notification_send_attempt_receipt_metadata.sql": [
        "provider_receipt_digest",
        "CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL",
      ],
      "027_notification_send_transition_receipt_metadata.sql": [
        "provider_receipt_digest",
        "CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL",
      ],
      "035_activity_publication_session_event.sql": [
        "publish_owner_signer_ref",
        "VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NULL",
      ],
      "036_activity_enrollment_event_generation_stage.sql": [
        "root_user_id",
        "VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL",
      ],
      "038_activity_enrollment_event_generation_enforce.sql": [
        "root_user_id",
        "VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL",
      ],
      "040_activity_p0_content_and_session_policy.sql": [
        "summary",
        "VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL",
      ],
      "043_activity_session_cancel_close_stage.sql": [
        "registration_close_at",
        "DATETIME(3) NOT NULL",
      ],
      "045_activity_session_policy_enforce.sql": [
        "registration_close_at",
        "DATETIME(3) NOT NULL",
      ],
      "046_task_event_idempotency_scope_stage.sql": [
        "idempotency_key",
        "VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL",
      ],
      "048_task_event_idempotency_scope_enforce.sql": [
        "payload_json",
        "JSON NULL",
      ],
      "049_wechat_unionid_provenance_stage.sql": [
        "unionid_status",
        "VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL",
      ],
      "051_wechat_unionid_provenance_enforce.sql": [
        "unionid_status",
        "VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL",
      ],
      "052_notification_recipient_binding_legacy_stage.sql": [
        "source_channel", "VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL",
      ],
      "053_notification_recipient_binding_v1_stage.sql": [
        "review_required_at", "DATETIME(3) NULL",
      ],
      "056_notification_recipient_binding_legacy_enforce.sql": [
        "source_channel", "VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL",
      ],
      "057_notification_recipient_binding_v1_enforce.sql": [
        "review_required_at", "DATETIME(3) NULL",
      ],
      "058_notification_provider_call_fence_stage.sql": [
        "request_digest", "CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL",
      ],
      "060_notification_provider_call_fence_enforce.sql": [
        "request_digest", "CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL",
      ],
    };
    const requiredBeforeAnchor = {
      "035_activity_publication_session_event.sql": [
        ["status", "VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL"],
        ["content_approval_ref", "VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL"],
      ],
      "036_activity_enrollment_event_generation_stage.sql": [
        ["activity_enrollment_id", "VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL"],
        ["activity_session_id", "VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL"],
      ],
      "038_activity_enrollment_event_generation_enforce.sql": [
        ["activity_enrollment_id", "VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL"],
        ["activity_session_id", "VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL"],
      ],
      "043_activity_session_cancel_close_stage.sql": [
        ["activity_version_id", "VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL"],
        ["registration_open_at", "DATETIME(3) NOT NULL"],
        ["session_start_at", "DATETIME(3) NOT NULL"],
      ],
      "045_activity_session_policy_enforce.sql": [
        ["activity_version_id", "VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL"],
        ["registration_open_at", "DATETIME(3) NOT NULL"],
        ["session_start_at", "DATETIME(3) NOT NULL"],
      ],
      "046_task_event_idempotency_scope_stage.sql": [
        ["root_user_id", "VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL"],
        ["payload_json", "JSON NULL"],
      ],
      "048_task_event_idempotency_scope_enforce.sql": [
        ["root_user_id", "VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL"],
      ],
      "049_wechat_unionid_provenance_stage.sql": [
        ["root_user_id", "VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL"],
      ],
      "051_wechat_unionid_provenance_enforce.sql": [
        ["root_user_id", "VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL"],
      ],
    };
    for (const [name, definition] of requiredBeforeAnchor[migrationName] || []) {
      columns.push(columnRow(name, definition, columns.length + 1));
    }
    const [anchorColumn, anchorDefinition] = anchors[migrationName] || [
      "handler_version",
      "VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL",
    ];
    columns.push(columnRow(
      anchorColumn,
      anchorDefinition,
      columns.length + 1
    ));
  }
  for (const segment of segments) {
    if (/^(?:(?:ADD\s+)?(?:PRIMARY|UNIQUE|KEY|CONSTRAINT)|DROP\s+(?:CHECK|INDEX))\b/i.test(segment)) continue;
    const match = segment.match(/^(?:(?:ADD|MODIFY)\s+COLUMN\s+)?([a-z][a-z0-9_]*)\s+([\s\S]+)$/i);
    if (!match || /^(?:PRIMARY|UNIQUE|KEY|CONSTRAINT)$/i.test(match[1])) continue;
    columns.push(columnRow(match[1], match[2], columns.length + 1));
  }
  if (migrationName === "040_activity_p0_content_and_session_policy.sql") {
    const bindingVersionIndex = columns.findIndex(
      (item) => item.column_name === "prebound_task_definition_version"
    );
    assert.notEqual(bindingVersionIndex, -1);
    columns.splice(
      bindingVersionIndex,
      0,
      columnRow(
        "prebound_task_definition_id",
        "VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL",
        bindingVersionIndex + 1
      )
    );
    columns.forEach((item, index) => { item.ordinal_position = index + 1; });
  }
  if ([
    "036_activity_enrollment_event_generation_stage.sql",
    "038_activity_enrollment_event_generation_enforce.sql",
  ].includes(migrationName)) {
    columns.push(columnRow("event_sequence", "INT UNSIGNED NOT NULL", columns.length + 1));
    columns.push(columnRow(
      "operation",
      "VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL",
      columns.length + 1
    ));
  }
  if (migrationName === "048_task_event_idempotency_scope_enforce.sql") {
    const stagedProvenanceIndex = columns.findIndex(
      (item) => item.column_name === "occurred_at_client_supplied"
    );
    if (stagedProvenanceIndex >= 0) columns.splice(stagedProvenanceIndex, 1);
    for (const [name, definition] of [
      ["request_canonical_version", "VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL"],
      ["request_digest", "CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL"],
      ["request_digest_scheme", "VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL"],
      ["request_digest_key_id", "VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL"],
      ["occurred_at_client_supplied", "TINYINT(1) NULL"],
    ]) {
      columns.push(columnRow(name, definition, columns.length + 1));
    }
  }
  if (migrationName === "051_wechat_unionid_provenance_enforce.sql") {
    for (const [name, definition] of [
      ["unionid_provenance_source", "VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL"],
      ["unionid_verified_at", "DATETIME(3) NULL"],
      ["unionid_provenance_canonical_version", "VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL"],
      ["unionid_provenance_digest", "CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL"],
      ["unionid_provenance_digest_scheme", "VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL"],
      ["unionid_provenance_key_id", "VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL"],
    ]) {
      if (!columns.some((item) => item.column_name === name)) {
        columns.push(columnRow(name, definition, columns.length + 1));
      }
    }
  }
  if ([
    "056_notification_recipient_binding_legacy_enforce.sql",
    "057_notification_recipient_binding_v1_enforce.sql",
  ].includes(migrationName)) {
    const stagedColumns = [
      ["recipient_wechat_identity_id", "VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL"],
      ["recipient_app_code", "VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL"],
      ["recipient_binding_canonical_version", "VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL"],
      ["recipient_binding_digest", "CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL"],
      ["recipient_binding_digest_scheme", "VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL"],
      ["recipient_binding_key_id", "VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL"],
    ];
    for (const [name, definition] of stagedColumns) {
      if (!columns.some((item) => item.column_name === name)) {
        columns.push(columnRow(name, definition, columns.length + 1));
      }
    }
  }
  if (migrationName === "060_notification_provider_call_fence_enforce.sql") {
    const providerColumnNames = new Set([
      "provider_call_state",
      "provider_call_owner",
      "provider_call_lease_expires_at",
      "provider_call_generation",
      "provider_call_started_at",
    ]);
    for (let index = columns.length - 1; index >= 0; index -= 1) {
      if (providerColumnNames.has(columns[index].column_name)) columns.splice(index, 1);
    }
    const anchorIndex = columns.findIndex((item) => item.column_name === "request_digest");
    assert.notEqual(anchorIndex, -1);
    columns.splice(anchorIndex + 1, 0, ...[
      ["provider_call_state", "VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL"],
      ["provider_call_owner", "VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL"],
      ["provider_call_lease_expires_at", "DATETIME(3) NULL"],
      ["provider_call_generation", "BIGINT UNSIGNED NOT NULL DEFAULT 0"],
      ["provider_call_started_at", "DATETIME(3) NULL"],
    ].map(([name, definition], offset) => columnRow(name, definition, anchorIndex + offset + 2)));
    columns.forEach((item, index) => { item.ordinal_position = index + 1; });
  }
  const indexes = indexRows(segments);
  const foreignKeys = foreignKeyMetadata(segments);
  for (const foreignKey of foreignKeys.rules) {
    const localColumns = foreignKeys.columns
      .filter((item) => item.constraint_name === foreignKey.constraint_name)
      .map((item) => item.column_name);
    const hasCoveringIndex = [...new Set(indexes.map((item) => item.index_name))].some((name) => {
      const indexColumns = indexes
        .filter((item) => item.index_name === name)
        .sort((left, right) => left.seq_in_index - right.seq_in_index)
        .map((item) => item.column_name);
      return localColumns.every((columnName, index) => indexColumns[index] === columnName);
    });
    if (!hasCoveringIndex) {
      localColumns.forEach((columnName, index) => indexes.push({
        index_name: foreignKey.constraint_name,
        non_unique: 1,
        seq_in_index: index + 1,
        column_name: columnName,
        sub_part: null,
        index_type: "BTREE",
      }));
    }
  }

  const checks = checkClauses(ddl);
  const constraints = [];
  for (const name of new Set(indexes.filter((item) => Number(item.non_unique) === 0).map((item) => item.index_name))) {
    constraints.push({ constraint_name: name, constraint_type: name === "PRIMARY" ? "PRIMARY KEY" : "UNIQUE" });
  }
  checks.forEach((item) => constraints.push({ constraint_name: item.constraint_name, constraint_type: "CHECK" }));
  foreignKeys.rules.forEach((item) => constraints.push({ constraint_name: item.constraint_name, constraint_type: "FOREIGN KEY" }));
  return {
    tableName,
    table: [{
      table_name: tableName,
      engine: "InnoDB",
      table_collation: /activity/.test(migrationName)
        || /task_event_idempotency_scope/.test(migrationName)
        || /wechat_unionid_provenance/.test(migrationName)
        || migrationName === "042_task_source_invalidation_event.sql"
        || migrationName === "062_settlement_source_authority.sql"
        ? "utf8mb4_unicode_ci"
        : "utf8mb4_0900_bin",
    }],
    columns,
    indexes,
    constraints,
    checks,
    foreignKeyColumns: foreignKeys.columns,
    foreignKeyRules: foreignKeys.rules,
  };
}

function metadataConnection(fixture, options = {}) {
  const fixtures = new Map();
  for (const item of (Array.isArray(fixture) ? fixture : [fixture])) {
    if (!fixtures.has(item.tableName)) {
      fixtures.set(item.tableName, item);
      continue;
    }
    const existing = fixtures.get(item.tableName);
    const anchor = item.columns[0] && item.columns[0].column_name;
    const columns = [...existing.columns];
    let insertAt = existing.columns.findIndex((column) => column.column_name === anchor);
    if (insertAt < 0 && item.columns[0]) {
      columns.push({ ...item.columns[0], ordinal_position: columns.length + 1 });
      insertAt = columns.length;
    } else {
      insertAt += 1;
    }
    for (const overlay of item.columns.slice(1)) {
      const existingIndex = columns.findIndex((column) => column.column_name === overlay.column_name);
      if (existingIndex >= 0) {
        columns[existingIndex] = { ...overlay, ordinal_position: existingIndex + 1 };
        insertAt = existingIndex + 1;
      } else {
        columns.splice(insertAt, 0, overlay);
        insertAt += 1;
      }
    }
    columns.forEach((column, index) => { column.ordinal_position = index + 1; });
    const overlayRows = (left, right, key) => [
      ...left.filter((row) => !right.some((candidate) => candidate[key] === row[key])),
      ...right,
    ];
    fixtures.set(item.tableName, {
      ...existing,
      columns,
      indexes: overlayRows(existing.indexes, item.indexes, "index_name"),
      constraints: overlayRows(existing.constraints, item.constraints, "constraint_name"),
      checks: overlayRows(existing.checks, item.checks, "constraint_name"),
      foreignKeyColumns: overlayRows(
        existing.foreignKeyColumns,
        item.foreignKeyColumns,
        "constraint_name"
      ),
      foreignKeyRules: overlayRows(
        existing.foreignKeyRules,
        item.foreignKeyRules,
        "constraint_name"
      ),
    });
  }
  const calls = [];
  return {
    calls,
    async execute(sql, values = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ compact, values });
      if (compact.includes("FROM activity_session")
        && compact.includes("cancel_close_at IS NULL")) {
        return [options.dataViolation ? [{ violation: 1 }] : [], []];
      }
      assert.equal(values.length, 1, "metadata lookup must bind exactly one table name");
      const active = fixtures.get(values[0]);
      assert.ok(active, `unexpected guarded table: ${values[0]}`);
      const absent = options.absent === true
        || (options.absent instanceof Set && options.absent.has(active.tableName));
      if (compact.includes("FROM information_schema.tables")) return [absent ? [] : active.table, []];
      if (compact.includes("JOIN information_schema.check_constraints")) return [active.checks, []];
      if (compact.includes("FROM information_schema.columns")) return [active.columns, []];
      if (compact.includes("FROM information_schema.statistics")) return [active.indexes, []];
      if (compact.includes("FROM information_schema.table_constraints")) return [active.constraints, []];
      if (compact.includes("FROM information_schema.key_column_usage")) return [active.foreignKeyColumns, []];
      if (compact.includes("FROM information_schema.referential_constraints")) return [active.foreignKeyRules, []];
      throw new Error(`unexpected metadata query: ${compact}`);
    },
  };
}

test("guarded migrations match their exact information_schema postconditions", async () => {
  for (const migrationName of GUARDED_MIGRATIONS) {
    const connection = metadataConnection(metadataFixtures(migrationName));
    const result = await inspectMysqlMigrationStructure(connection, migrationName);
    assert.equal(result.supported, true, migrationName);
    assert.equal(result.state, MYSQL_MIGRATION_STRUCTURE_STATES.COMPLETE, `${migrationName}: ${result.differences}`);
    assert.match(result.structureDigest, /^[0-9a-f]{64}$/);
    assert.equal(
      connection.calls.every((item) => (
        item.compact.includes("FROM activity_session")
          ? item.values.length === 0
          : item.values.length === 1
      )),
      true
    );
  }
});

test("MySQL REGEXP_LIKE check metadata is canonicalized without weakening literals", async () => {
  const migrationName = "014_inbox_handler_identity.sql";
  const fixture = metadataFixture(migrationName);
  fixture.checks = fixture.checks.map((item) => {
    const match = item.check_clause.trim().match(/^([a-z_]+)\s+REGEXP\s+('(?:''|[^'])*')$/i);
    return match
      ? {
        ...item,
        check_clause: `regexp_like(\`${match[1]}\`, _latin1\\${match[2].replace(/'$/, "\\'")})`,
      }
      : item;
  });
  const inspection = await inspectMysqlMigrationStructure(
    metadataConnection(fixture),
    migrationName
  );
  assert.equal(
    inspection.state,
    MYSQL_MIGRATION_STRUCTURE_STATES.COMPLETE,
    inspection.differences.join(",")
  );

  fixture.checks = fixture.checks.map((item) => (
    item.constraint_name === "chk_inbox_handler_id_supported"
      ? { ...item, check_clause: item.check_clause.replace("{0,95}", "{0,94}") }
      : item
  ));
  const drift = await inspectMysqlMigrationStructure(
    metadataConnection(fixture),
    migrationName
  );
  assert.equal(drift.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
  assert.equal(drift.differences.includes("checks"), true);
});

test("MySQL comparison grouping is removed only around atomic predicates", async () => {
  const migrationName = "015_task_share_completion_projection.sql";
  const fixture = metadataFixture(migrationName);
  const mysqlClauses = {
    chk_task_share_projection_source_contract:
      "((`source_event_type` = _utf8mb4\\'task.event.recorded.v1\\') and "
      + "(`source_schema_version` = _utf8mb4\\'1\\') and "
      + "(`source_name` = _utf8mb4\\'myroot-api\\') and "
      + "(`source_partition_key` = concat(_utf8mb4\\'task_event:\\',`task_event_id`)) and "
      + "(`source_partition_position` = 1) and (`source_aggregate_version` = 1))",
    chk_task_share_projection_outcome_contract:
      "((`task_type` = _utf8mb4\\'SHARE\\') and "
      + "(`completion_event_type` = _utf8mb4\\'SHARE_COMPLETED\\'))",
    chk_task_share_projection_handler_version:
      "(`handler_version` = _utf8mb4\\'task-share-completion-v1\\')",
    chk_task_share_projection_registration_digest:
      "regexp_like(`handler_registration_digest`,_utf8mb4\\'^[0-9a-f]{64}$\\')",
  };
  fixture.checks = fixture.checks.map((item) => (
    mysqlClauses[item.constraint_name]
      ? { ...item, check_clause: mysqlClauses[item.constraint_name] }
      : item
  ));
  const inspection = await inspectMysqlMigrationStructure(
    metadataConnection(fixture),
    migrationName
  );
  assert.equal(
    inspection.state,
    MYSQL_MIGRATION_STRUCTURE_STATES.COMPLETE,
    inspection.differences.join(",")
  );

  fixture.checks = fixture.checks.map((item) => (
    item.constraint_name === "chk_task_share_projection_outcome_contract"
      ? { ...item, check_clause: item.check_clause.replace("SHARE_COMPLETED", "SHARE_FAILED") }
      : item
  ));
  const drift = await inspectMysqlMigrationStructure(
    metadataConnection(fixture),
    migrationName
  );
  assert.equal(drift.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
  assert.equal(drift.differences.includes("checks"), true);
});

test("known absent structures are safe to apply while any owned partial or drifted structure fails closed", async () => {
  const migrationName = "016_inbox_replay_run.sql";
  const fixture = metadataFixture(migrationName);
  const absent = await inspectMysqlMigrationStructure(metadataConnection(fixture, { absent: true }), migrationName);
  assert.equal(absent.state, MYSQL_MIGRATION_STRUCTURE_STATES.ABSENT);

  const driftedFixture = metadataFixture(migrationName);
  driftedFixture.columns = driftedFixture.columns.map((item) => (
    item.column_name === "policy_registry_version" ? { ...item, column_type: "bigint unsigned" } : item
  ));
  const drifted = await inspectMysqlMigrationStructure(metadataConnection(driftedFixture), migrationName);
  assert.equal(drifted.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
  assert.equal(drifted.differences.includes("columns"), true);

  const partialFixture = metadataFixture("014_inbox_handler_identity.sql");
  partialFixture.columns = partialFixture.columns.filter((item) => item.column_name !== "handler_registration_digest");
  const partial = await inspectMysqlMigrationStructure(metadataConnection(partialFixture), "014_inbox_handler_identity.sql");
  assert.equal(partial.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
  assert.equal(partial.differences.includes("columns"), true);

  const ownershipFixture = metadataFixture("020_notification_job.sql");
  ownershipFixture.constraints = ownershipFixture.constraints.filter(
    (item) => item.constraint_name !== "fk_notification_job_grant"
  );
  ownershipFixture.foreignKeyColumns = [];
  ownershipFixture.foreignKeyRules = [];
  const ownershipDrift = await inspectMysqlMigrationStructure(
    metadataConnection(ownershipFixture),
    "020_notification_job.sql"
  );
  assert.equal(ownershipDrift.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
  assert.equal(ownershipDrift.differences.includes("foreignKeys"), true);
  assert.equal(ownershipDrift.differences.includes("constraints"), true);

  const executorIdentityFixture = metadataFixture("023_inbox_replay_executor_identity.sql");
  executorIdentityFixture.columns = executorIdentityFixture.columns.map((item) => (
    item.column_name === "execution_executor_registration_digest"
      ? { ...item, collation_name: "ascii_general_ci" }
      : item
  ));
  executorIdentityFixture.checks = executorIdentityFixture.checks.map((item) => (
    item.constraint_name === "chk_inbox_replay_executor_identity"
      ? { ...item, check_clause: item.check_clause.replace(/[a-f0-9]{64}/, "f".repeat(64)) }
      : item
  ));
  const executorIdentityDrift = await inspectMysqlMigrationStructure(
    metadataConnection(executorIdentityFixture),
    "023_inbox_replay_executor_identity.sql"
  );
  assert.equal(executorIdentityDrift.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
  assert.equal(executorIdentityDrift.differences.includes("columns"), true);
  assert.equal(executorIdentityDrift.differences.includes("checks"), true);

  const literalMutationFixture = metadataFixture("023_inbox_replay_executor_identity.sql");
  literalMutationFixture.checks = literalMutationFixture.checks.map((item) => (
    item.constraint_name === "chk_inbox_replay_executor_identity"
      ? { ...item, check_clause: item.check_clause.replace("'SHADOW_REBUILD'", "'SHADOW_OTHER'") }
      : item
  ));
  const literalMutation = await inspectMysqlMigrationStructure(
    metadataConnection(literalMutationFixture),
    "023_inbox_replay_executor_identity.sql"
  );
  assert.equal(literalMutation.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
  assert.equal(literalMutation.differences.includes("checks"), true);

  const charsetIntroducerFixture = metadataFixture("023_inbox_replay_executor_identity.sql");
  charsetIntroducerFixture.checks = charsetIntroducerFixture.checks.map((item) => (
    item.constraint_name === "chk_inbox_replay_executor_identity"
      ? { ...item, check_clause: item.check_clause.replace("'SHADOW_REBUILD'", "_utf8mb4'SHADOW_REBUILD'") }
      : item
  ));
  const charsetIntroducerEquivalent = await inspectMysqlMigrationStructure(
    metadataConnection(charsetIntroducerFixture),
    "023_inbox_replay_executor_identity.sql"
  );
  assert.equal(charsetIntroducerEquivalent.state, MYSQL_MIGRATION_STRUCTURE_STATES.COMPLETE);
});

test("notification ALTER predecessors are exact safe-to-apply states while any partial successor is drift", async () => {
  for (const [predecessor, successor] of [
    ["018_notification_subscription_attempt.sql", "024_notification_native_decision_contract.sql"],
    ["020_notification_job.sql", "025_notification_job_request_identity.sql"],
    ["021_notification_send_attempt.sql", "026_notification_send_attempt_receipt_metadata.sql"],
    ["022_notification_send_attempt_transition.sql", "027_notification_send_transition_receipt_metadata.sql"],
  ]) {
    const predecessorFixture = metadataFixture(predecessor);
    const inspection = await inspectMysqlMigrationStructure(
      metadataConnection(predecessorFixture),
      successor
    );
    assert.equal(inspection.state, MYSQL_MIGRATION_STRUCTURE_STATES.ABSENT, successor);
  }

  const partial = metadataFixture("026_notification_send_attempt_receipt_metadata.sql");
  partial.columns = partial.columns.filter((item) => item.column_name !== "provider_receipt_digest_key_id");
  const drift = await inspectMysqlMigrationStructure(
    metadataConnection(partial),
    "026_notification_send_attempt_receipt_metadata.sql"
  );
  assert.equal(drift.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
  assert.equal(drift.differences.includes("columns"), true);
});

test("activity generation staging accepts only its nullable precondition or exact enforced successor", async () => {
  const nullable = metadataFixture("036_activity_enrollment_event_generation_stage.sql");
  const nullableForEnforce = await inspectMysqlMigrationStructure(
    metadataConnection(nullable),
    "038_activity_enrollment_event_generation_enforce.sql"
  );
  assert.equal(nullableForEnforce.state, MYSQL_MIGRATION_STRUCTURE_STATES.ABSENT);

  const enforced = metadataFixture("038_activity_enrollment_event_generation_enforce.sql");
  const enforcedForStage = await inspectMysqlMigrationStructure(
    metadataConnection(enforced),
    "036_activity_enrollment_event_generation_stage.sql"
  );
  assert.equal(enforcedForStage.state, MYSQL_MIGRATION_STRUCTURE_STATES.COMPLETE);

  const requiredColumnDrift = metadataFixture("036_activity_enrollment_event_generation_stage.sql");
  requiredColumnDrift.columns = requiredColumnDrift.columns.filter(
    (item) => item.column_name !== "operation"
  );
  const missingRequiredColumn = await inspectMysqlMigrationStructure(
    metadataConnection(requiredColumnDrift),
    "036_activity_enrollment_event_generation_stage.sql"
  );
  assert.equal(missingRequiredColumn.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
  assert.equal(missingRequiredColumn.differences.includes("required.columns"), true);

  const collationDrift = metadataFixture("035_activity_publication_session_event.sql");
  collationDrift.table[0].table_collation = "utf8mb4_0900_bin";
  const wrongBaseCollation = await inspectMysqlMigrationStructure(
    metadataConnection(collationDrift),
    "035_activity_publication_session_event.sql"
  );
  assert.equal(wrongBaseCollation.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
  assert.equal(wrongBaseCollation.differences.includes("required.table.collation"), true);
});

test("activity P0 migration stages distinguish absent, complete, partial, data-backfill, and enforced states", async () => {
  const complete040 = metadataFixture("040_activity_p0_content_and_session_policy.sql");
  const partial040 = {
    ...complete040,
    columns: complete040.columns.filter(
      (item) => item.column_name !== "prebound_task_definition_version"
    ),
  };
  const partialInspection = await inspectMysqlMigrationStructure(
    metadataConnection(partial040),
    "040_activity_p0_content_and_session_policy.sql"
  );
  assert.equal(partialInspection.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
  assert.equal(
    partialInspection.differences.includes("structures.partial")
      || partialInspection.differences.some(
        (difference) => difference.startsWith("activity_definition_version.")
      ),
    true
  );

  const staged = metadataFixture("043_activity_session_cancel_close_stage.sql");
  const pendingBackfill = await inspectMysqlMigrationStructure(
    metadataConnection(staged, { dataViolation: true }),
    "044_activity_session_cancel_close_backfill.sql"
  );
  assert.equal(pendingBackfill.state, MYSQL_MIGRATION_STRUCTURE_STATES.ABSENT);
  const completedBackfill = await inspectMysqlMigrationStructure(
    metadataConnection(staged),
    "044_activity_session_cancel_close_backfill.sql"
  );
  assert.equal(completedBackfill.state, MYSQL_MIGRATION_STRUCTURE_STATES.COMPLETE);

  const stagedForEnforce = await inspectMysqlMigrationStructure(
    metadataConnection(staged),
    "045_activity_session_policy_enforce.sql"
  );
  assert.equal(stagedForEnforce.state, MYSQL_MIGRATION_STRUCTURE_STATES.ABSENT);

  const enforced = metadataFixture("045_activity_session_policy_enforce.sql");
  for (const predecessor of [
    "043_activity_session_cancel_close_stage.sql",
    "044_activity_session_cancel_close_backfill.sql",
  ]) {
    const recovered = await inspectMysqlMigrationStructure(
      metadataConnection(enforced),
      predecessor
    );
    assert.equal(recovered.state, MYSQL_MIGRATION_STRUCTURE_STATES.COMPLETE, predecessor);
  }
});

test("provider-call fencing distinguishes exact stage, enforced successor, and DML backfill roles", async () => {
  const stageName = "058_notification_provider_call_fence_stage.sql";
  const backfillName = "059_notification_provider_call_fence_backfill.sql";
  const enforceName = "060_notification_provider_call_fence_enforce.sql";
  const staged = metadataFixture(stageName);
  const enforced = metadataFixture(enforceName);

  const stagedForEnforce = await inspectMysqlMigrationStructure(
    metadataConnection(staged),
    enforceName
  );
  assert.equal(stagedForEnforce.state, MYSQL_MIGRATION_STRUCTURE_STATES.ABSENT);

  const enforcedForStage = await inspectMysqlMigrationStructure(
    metadataConnection(enforced),
    stageName
  );
  assert.equal(enforcedForStage.state, MYSQL_MIGRATION_STRUCTURE_STATES.COMPLETE);

  const partialStage = metadataFixture(stageName);
  partialStage.columns = partialStage.columns.filter(
    (item) => item.column_name !== "provider_call_owner"
  );
  const partialStageInspection = await inspectMysqlMigrationStructure(
    metadataConnection(partialStage),
    stageName
  );
  assert.equal(partialStageInspection.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
  assert.equal(partialStageInspection.differences.includes("columns"), true);

  const nullableGeneration = metadataFixture(enforceName);
  nullableGeneration.columns = nullableGeneration.columns.map((item) => (
    item.column_name === "provider_call_generation"
      ? { ...item, is_nullable: "YES" }
      : item
  ));
  const nullableGenerationInspection = await inspectMysqlMigrationStructure(
    metadataConnection(nullableGeneration),
    enforceName
  );
  assert.equal(nullableGenerationInspection.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
  assert.equal(nullableGenerationInspection.differences.includes("columns"), true);

  const reorderedFence = metadataFixture(enforceName);
  const owner = reorderedFence.columns.find(
    (item) => item.column_name === "provider_call_owner"
  );
  const leaseExpiry = reorderedFence.columns.find(
    (item) => item.column_name === "provider_call_lease_expires_at"
  );
  [owner.ordinal_position, leaseExpiry.ordinal_position] = [
    leaseExpiry.ordinal_position,
    owner.ordinal_position,
  ];
  const reorderedFenceInspection = await inspectMysqlMigrationStructure(
    metadataConnection(reorderedFence),
    enforceName
  );
  assert.equal(reorderedFenceInspection.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
  assert.equal(reorderedFenceInspection.differences.includes("columns.order"), true);

  const missingRecoveryIndex = metadataFixture(enforceName);
  missingRecoveryIndex.indexes = missingRecoveryIndex.indexes.filter(
    (item) => item.index_name !== "idx_notification_provider_call_recovery"
  );
  const missingRecoveryIndexInspection = await inspectMysqlMigrationStructure(
    metadataConnection(missingRecoveryIndex),
    enforceName
  );
  assert.equal(missingRecoveryIndexInspection.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
  assert.equal(missingRecoveryIndexInspection.differences.includes("indexes"), true);

  const weakenedCheck = metadataFixture(enforceName);
  weakenedCheck.checks = weakenedCheck.checks.map((item) => (
    item.constraint_name === "chk_notification_provider_call_fence"
      ? { ...item, check_clause: item.check_clause.replace("'STARTED'", "'STARTING'") }
      : item
  ));
  const weakenedCheckInspection = await inspectMysqlMigrationStructure(
    metadataConnection(weakenedCheck),
    enforceName
  );
  assert.equal(weakenedCheckInspection.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
  assert.equal(weakenedCheckInspection.differences.includes("checks"), true);

  const backfillInspection = await inspectMysqlMigrationStructure(
    { async execute() { throw new Error("DML backfill must not query structural metadata"); } },
    backfillName
  );
  assert.equal(backfillInspection.supported, false);
  assert.equal(backfillInspection.state, MYSQL_MIGRATION_STRUCTURE_STATES.UNSUPPORTED);
  assert.equal(mysqlMigrationStructureSuccessor(stageName), enforceName);
  assert.equal(mysqlMigrationStructureSuccessor(backfillName), enforceName);
});

test("runtime alert delivery guard rejects weakened uniqueness, state, crypto, and receipt shapes", async () => {
  const migrationName = "061_v1_runtime_alert_delivery.sql";
  const exact = metadataFixture(migrationName);
  const complete = await inspectMysqlMigrationStructure(
    metadataConnection(exact),
    migrationName
  );
  assert.equal(complete.state, MYSQL_MIGRATION_STRUCTURE_STATES.COMPLETE);

  const cases = [
    {
      difference: "indexes",
      mutate(fixture) {
        fixture.indexes = fixture.indexes.filter(
          (row) => row.index_name !== "uk_v1_runtime_alert_delivery_alert_authority"
        );
        fixture.constraints = fixture.constraints.filter(
          (row) => row.constraint_name !== "uk_v1_runtime_alert_delivery_alert_authority"
        );
      },
    },
    {
      difference: "checks",
      mutate(fixture) {
        fixture.checks = fixture.checks.map((row) => (
          row.constraint_name === "chk_v1_runtime_alert_delivery_state"
            ? { ...row, check_clause: row.check_clause.replace("status = 'UNKNOWN'", "status = 'DELIVERED'") }
            : row
        ));
      },
    },
    {
      difference: "checks",
      mutate(fixture) {
        fixture.checks = fixture.checks.map((row) => (
          row.constraint_name === "chk_v1_runtime_alert_delivery_authority"
            ? { ...row, check_clause: row.check_clause.replace("'DRY_RUN'", "'PROMOTABLE'") }
            : row
        ));
      },
    },
    {
      difference: "columns",
      mutate(fixture) {
        fixture.columns = fixture.columns.map((row) => (
          row.column_name === "receipt_digest_key_id"
            ? { ...row, is_nullable: "NO" }
            : row
        ));
      },
    },
    {
      difference: "foreignKeys",
      mutate(fixture) {
        fixture.foreignKeyColumns = [];
        fixture.foreignKeyRules = [];
      },
    },
  ];
  for (const item of cases) {
    const fixture = metadataFixture(migrationName);
    item.mutate(fixture);
    const drift = await inspectMysqlMigrationStructure(
      metadataConnection(fixture),
      migrationName
    );
    assert.equal(drift.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
    assert.equal(
      drift.differences.includes(item.difference)
        || (item.difference === "foreignKeys" && drift.differences.includes("constraints")),
      true,
      `${item.difference}: ${drift.differences.join(",")}`
    );
  }
});

test("task-event idempotency staging accepts only its exact precondition or enforced successor", async () => {
  const staged = metadataFixture("046_task_event_idempotency_scope_stage.sql");
  const stagedForEnforce = await inspectMysqlMigrationStructure(
    metadataConnection(staged),
    "048_task_event_idempotency_scope_enforce.sql"
  );
  assert.equal(stagedForEnforce.state, MYSQL_MIGRATION_STRUCTURE_STATES.ABSENT);

  const enforced = metadataFixture("048_task_event_idempotency_scope_enforce.sql");
  const enforcedForStage = await inspectMysqlMigrationStructure(
    metadataConnection(enforced),
    "046_task_event_idempotency_scope_stage.sql"
  );
  assert.equal(enforcedForStage.state, MYSQL_MIGRATION_STRUCTURE_STATES.COMPLETE);

  const partial = metadataFixture("046_task_event_idempotency_scope_stage.sql");
  partial.columns = partial.columns.filter(
    (item) => item.column_name !== "request_digest_key_id"
  );
  const partialInspection = await inspectMysqlMigrationStructure(
    metadataConnection(partial),
    "046_task_event_idempotency_scope_stage.sql"
  );
  assert.equal(partialInspection.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
  assert.equal(partialInspection.differences.includes("columns"), true);

  const wrongKeyCollation = metadataFixture("048_task_event_idempotency_scope_enforce.sql");
  wrongKeyCollation.columns = wrongKeyCollation.columns.map((item) => (
    item.column_name === "idempotency_key"
      ? { ...item, character_set_name: "utf8mb4", collation_name: "utf8mb4_unicode_ci" }
      : item
  ));
  const keyDrift = await inspectMysqlMigrationStructure(
    metadataConnection(wrongKeyCollation),
    "048_task_event_idempotency_scope_enforce.sql"
  );
  assert.equal(keyDrift.state, MYSQL_MIGRATION_STRUCTURE_STATES.DRIFTED);
  assert.equal(keyDrift.differences.includes("columns"), true);
});

test("unknown migrations retain the legacy path and are never mistaken for an absent guarded migration", async () => {
  const connection = {
    async execute() {
      throw new Error("unknown migrations must not query information_schema through the guard");
    },
  };
  const result = await inspectMysqlMigrationStructure(connection, "999_legacy_extension.sql");
  assert.deepEqual(result, {
    supported: false,
    migrationName: "999_legacy_extension.sql",
    state: MYSQL_MIGRATION_STRUCTURE_STATES.UNSUPPORTED,
    structureDigest: "",
    differences: [],
  });
});

test("migration runner reconciles a missing ledger row only after a COMPLETE structural readback", async () => {
  const target = "014_inbox_handler_identity.sql";
  const fixtures = GUARDED_MIGRATIONS.flatMap(metadataFixtures);
  const ledger = new Map();
  for (const migrationName of listMigrationFiles(MIGRATIONS_DIR)) {
    if (migrationName === target) continue;
    ledger.set(migrationName, migrationChecksum(fs.readFileSync(path.join(MIGRATIONS_DIR, migrationName), "utf8")));
  }
  const calls = [];
  const connection = {
    ...metadataConnection(fixtures),
    async query(sql) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ kind: "query", compact });
      if (compact.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) return [{ affectedRows: 0 }, []];
      if (compact.startsWith("SELECT version, checksum, applied_at FROM schema_migrations")) {
        return [[...ledger].sort(([left], [right]) => left.localeCompare(right, "en")).map(([version, checksum]) => ({ version, checksum, applied_at: "2026-07-17 00:00:00.000" })), []];
      }
      throw new Error(`DDL must not run while structure is complete: ${compact}`);
    },
    async execute(sql, values = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ kind: "execute", compact, values });
      if (compact.startsWith("SELECT GET_LOCK")) return [[{ acquired: 1 }], []];
      if (compact.startsWith("SELECT RELEASE_LOCK")) return [[{ released: 1 }], []];
      if (compact.startsWith("INSERT INTO schema_migrations")) {
        assert.deepEqual(values.slice(0, 1), [target]);
        ledger.set(values[0], values[1]);
        return [{ affectedRows: 1 }, []];
      }
      if (compact.includes("column_name = 'revision'")) return [[{ column_count: 1 }], []];
      const metadata = metadataConnection(fixtures);
      return metadata.execute(sql, values);
    },
    release() {
      calls.push({ kind: "release" });
    },
  };
  const pool = { async getConnection() { return connection; } };
  const result = await applyMysqlMigrations(pool, { migrationsDir: MIGRATIONS_DIR, database: "guard-test" });
  assert.deepEqual(result.applied, []);
  assert.equal(result.reconciled.length, 1);
  assert.deepEqual(result.reconciled[0], {
    version: target,
    checksum: ledger.get(target),
    structureDigest: result.reconciled[0].structureDigest,
    reason: "STRUCTURE_COMPLETE_LEDGER_MISSING",
  });
  assert.match(result.reconciled[0].structureDigest, /^[0-9a-f]{64}$/);
  assert.equal(calls.some((item) => item.kind === "query" && /^ALTER TABLE inbox_receipt/i.test(item.compact)), false);
});

test("migration runner fails before DDL and ledger repair when a guarded structure has drifted", async () => {
  const target = "017_task_share_completion_shadow_projection.sql";
  const fixtures = GUARDED_MIGRATIONS.flatMap(metadataFixtures);
  const fixture = fixtures.find((item) => item.tableName === "task_share_completion_shadow_projection");
  fixture.indexes = fixture.indexes.filter((item) => item.index_name !== "uk_task_share_shadow_source_event");
  const ledger = new Map();
  for (const migrationName of listMigrationFiles(MIGRATIONS_DIR)) {
    if (migrationName === target) continue;
    ledger.set(migrationName, migrationChecksum(fs.readFileSync(path.join(MIGRATIONS_DIR, migrationName), "utf8")));
  }
  let wroteLedger = false;
  let ranDdl = false;
  const connection = {
    async query(sql) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) return [{ affectedRows: 0 }, []];
      if (compact.startsWith("SELECT version, checksum, applied_at FROM schema_migrations")) {
        return [[...ledger].map(([version, checksum]) => ({ version, checksum, applied_at: "2026-07-17 00:00:00.000" })), []];
      }
      ranDdl = true;
      return [{ affectedRows: 0 }, []];
    },
    async execute(sql, values = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT GET_LOCK")) return [[{ acquired: 1 }], []];
      if (compact.startsWith("SELECT RELEASE_LOCK")) return [[{ released: 1 }], []];
      if (compact.startsWith("INSERT INTO schema_migrations")) {
        wroteLedger = true;
        return [{ affectedRows: 1 }, []];
      }
      return metadataConnection(fixtures).execute(sql, values);
    },
    release() {},
  };
  await assert.rejects(
    () => applyMysqlMigrations({ async getConnection() { return connection; } }, { migrationsDir: MIGRATIONS_DIR }),
    (error) => error.code === "MYSQL_MIGRATION_STRUCTURE_DRIFT"
      && error.migrationName === target
      && error.differences.includes("indexes")
  );
  assert.equal(wroteLedger, false);
  assert.equal(ranDdl, false);
});

test("an existing ledger row never masks a missing guarded structure", async () => {
  const target = "039_activity_session_event.sql";
  const fixtures = GUARDED_MIGRATIONS.flatMap(metadataFixtures);
  const ledger = new Map(listMigrationFiles(MIGRATIONS_DIR).map((migrationName) => [
    migrationName,
    migrationChecksum(fs.readFileSync(path.join(MIGRATIONS_DIR, migrationName), "utf8")),
  ]));
  let ranDdl = false;
  const metadata = metadataConnection(fixtures, {
    absent: new Set(["activity_session_event"]),
  });
  const connection = {
    async query(sql) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) return [{ affectedRows: 0 }, []];
      if (compact.startsWith("SELECT version, checksum, applied_at FROM schema_migrations")) {
        return [[...ledger].map(([version, checksum]) => ({ version, checksum, applied_at: "2026-07-17 00:00:00.000" })), []];
      }
      ranDdl = true;
      return [{ affectedRows: 0 }, []];
    },
    async execute(sql, values = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT GET_LOCK")) return [[{ acquired: 1 }], []];
      if (compact.startsWith("SELECT RELEASE_LOCK")) return [[{ released: 1 }], []];
      return metadata.execute(sql, values);
    },
    release() {},
  };
  await assert.rejects(
    () => applyMysqlMigrations({ async getConnection() { return connection; } }, { migrationsDir: MIGRATIONS_DIR }),
    (error) => error.code === "MYSQL_MIGRATION_STRUCTURE_DRIFT"
      && error.migrationName === target
      && error.differences.includes("ledger.structure.absent")
  );
  assert.equal(ranDdl, false);
});

test("a lost DDL acknowledgement converges on the next run without replaying the completed ALTER", async () => {
  const target = "014_inbox_handler_identity.sql";
  const completeFixtures = GUARDED_MIGRATIONS.flatMap(metadataFixtures);
  const completeTarget = completeFixtures.find((item) => item.tableName === "inbox_receipt");
  const absentTarget = {
    ...completeTarget,
    columns: completeTarget.columns.filter((item) => item.column_name === "handler_version"),
    indexes: [],
    constraints: [],
    checks: [],
  };
  const ledger = new Map();
  for (const migrationName of listMigrationFiles(MIGRATIONS_DIR)) {
    if (migrationName === target) continue;
    ledger.set(migrationName, migrationChecksum(fs.readFileSync(path.join(MIGRATIONS_DIR, migrationName), "utf8")));
  }
  let alterAttempts = 0;
  let destroyedConnections = 0;
  let releasedConnections = 0;

  function runnerConnection(fixtures, loseAlterAcknowledgement) {
    const metadata = metadataConnection(fixtures);
    return {
      async query(sql) {
        const compact = String(sql).replace(/\s+/g, " ").trim();
        if (compact.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) return [{ affectedRows: 0 }, []];
        if (compact.startsWith("SELECT version, checksum, applied_at FROM schema_migrations")) {
          return [[...ledger].map(([version, checksum]) => ({ version, checksum, applied_at: "2026-07-17 00:00:00.000" })), []];
        }
        if (/^ALTER TABLE inbox_receipt/i.test(compact)) {
          alterAttempts += 1;
          if (loseAlterAcknowledgement) {
            const error = new Error("simulated DDL acknowledgement loss");
            error.code = "PROTOCOL_CONNECTION_LOST";
            throw error;
          }
        }
        return [{ affectedRows: 0 }, []];
      },
      async execute(sql, values = []) {
        const compact = String(sql).replace(/\s+/g, " ").trim();
        if (compact.startsWith("SELECT GET_LOCK")) return [[{ acquired: 1 }], []];
        if (compact.startsWith("SELECT RELEASE_LOCK")) return [[{ released: 1 }], []];
        if (compact.startsWith("INSERT INTO schema_migrations")) {
          ledger.set(values[0], values[1]);
          return [{ affectedRows: 1 }, []];
        }
        if (compact.includes("column_name = 'revision'")) return [[{ column_count: 1 }], []];
        return metadata.execute(sql, values);
      },
      release() { releasedConnections += 1; },
      destroy() { destroyedConnections += 1; },
    };
  }

  const firstFixtures = completeFixtures.map((item) => (
    item.tableName === "inbox_receipt" ? absentTarget : item
  ));
  await assert.rejects(
    () => applyMysqlMigrations({
      async getConnection() { return runnerConnection(firstFixtures, true); },
    }, { migrationsDir: MIGRATIONS_DIR }),
    (error) => error.code === "PROTOCOL_CONNECTION_LOST"
  );
  assert.equal(ledger.has(target), false);
  assert.equal(alterAttempts, 1);
  assert.equal(destroyedConnections, 1);
  assert.equal(releasedConnections, 0);

  const recovered = await applyMysqlMigrations({
    async getConnection() { return runnerConnection(completeFixtures, false); },
  }, { migrationsDir: MIGRATIONS_DIR });
  assert.equal(alterAttempts, 1, "the second run must reconcile the ledger without replaying ALTER TABLE");
  assert.deepEqual(recovered.applied, []);
  assert.deepEqual(recovered.reconciled.map((item) => item.version), [target]);
  assert.equal(ledger.has(target), true);
  assert.equal(destroyedConnections, 1);
  assert.equal(releasedConnections, 1);
});

test("a lost CREATE TABLE acknowledgement converges on exact structure without replaying the table creation", async () => {
  const target = "039_activity_session_event.sql";
  const fixtures = GUARDED_MIGRATIONS.flatMap(metadataFixtures);
  const targetFixture = fixtures.find((item) => item.tableName === "activity_session_event");
  const ledger = new Map();
  for (const migrationName of listMigrationFiles(MIGRATIONS_DIR)) {
    if (migrationName === target) continue;
    ledger.set(migrationName, migrationChecksum(fs.readFileSync(path.join(MIGRATIONS_DIR, migrationName), "utf8")));
  }
  let createAttempts = 0;
  let destroyedConnections = 0;
  let releasedConnections = 0;

  function runnerConnection(targetAbsent, loseCreateAcknowledgement) {
    const metadata = metadataConnection(fixtures, {
      absent: targetAbsent ? new Set([targetFixture.tableName]) : new Set(),
    });
    return {
      async query(sql) {
        const compact = String(sql).replace(/\s+/g, " ").trim();
        if (compact.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) return [{ affectedRows: 0 }, []];
        if (compact.startsWith("SELECT version, checksum, applied_at FROM schema_migrations")) {
          return [[...ledger].map(([version, checksum]) => ({
            version,
            checksum,
            applied_at: "2026-07-17 00:00:00.000",
          })), []];
        }
        if (/^CREATE TABLE IF NOT EXISTS activity_session_event/i.test(compact)) {
          createAttempts += 1;
          if (loseCreateAcknowledgement) {
            const error = new Error("simulated CREATE TABLE acknowledgement loss");
            error.code = "PROTOCOL_CONNECTION_LOST";
            throw error;
          }
        }
        return [{ affectedRows: 0 }, []];
      },
      async execute(sql, values = []) {
        const compact = String(sql).replace(/\s+/g, " ").trim();
        if (compact.startsWith("SELECT GET_LOCK")) return [[{ acquired: 1 }], []];
        if (compact.startsWith("SELECT RELEASE_LOCK")) return [[{ released: 1 }], []];
        if (compact.startsWith("INSERT INTO schema_migrations")) {
          ledger.set(values[0], values[1]);
          return [{ affectedRows: 1 }, []];
        }
        if (compact.includes("column_name = 'revision'")) return [[{ column_count: 1 }], []];
        return metadata.execute(sql, values);
      },
      release() { releasedConnections += 1; },
      destroy() { destroyedConnections += 1; },
    };
  }

  await assert.rejects(
    () => applyMysqlMigrations({
      async getConnection() { return runnerConnection(true, true); },
    }, { migrationsDir: MIGRATIONS_DIR }),
    (error) => error.code === "PROTOCOL_CONNECTION_LOST"
  );
  assert.equal(createAttempts, 1);
  assert.equal(ledger.has(target), false);
  assert.equal(destroyedConnections, 1);
  assert.equal(releasedConnections, 0);

  const recovered = await applyMysqlMigrations({
    async getConnection() { return runnerConnection(false, false); },
  }, { migrationsDir: MIGRATIONS_DIR });
  assert.equal(createAttempts, 1, "the second run must reconcile the ledger without replaying CREATE TABLE");
  assert.deepEqual(recovered.applied, []);
  assert.deepEqual(recovered.reconciled.map((item) => item.version), [target]);
  assert.equal(ledger.has(target), true);
  assert.equal(destroyedConnections, 1);
  assert.equal(releasedConnections, 1);
});

test("a lost migration ledger acknowledgement retires the connection and exact readback prevents a duplicate write", async () => {
  const target = "024_notification_native_decision_contract.sql";
  const fixtures = GUARDED_MIGRATIONS.flatMap(metadataFixtures);
  const ledger = new Map();
  for (const migrationName of listMigrationFiles(MIGRATIONS_DIR)) {
    if (migrationName === target) continue;
    ledger.set(migrationName, migrationChecksum(fs.readFileSync(path.join(MIGRATIONS_DIR, migrationName), "utf8")));
  }
  let ledgerWrites = 0;
  let destroyedConnections = 0;
  let releasedConnections = 0;

  function runnerConnection(loseLedgerAcknowledgement) {
    const metadata = metadataConnection(fixtures);
    return {
      async query(sql) {
        const compact = String(sql).replace(/\s+/g, " ").trim();
        if (compact.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) return [{ affectedRows: 0 }, []];
        if (compact.startsWith("SELECT version, checksum, applied_at FROM schema_migrations")) {
          return [[...ledger].map(([version, checksum]) => ({
            version,
            checksum,
            applied_at: "2026-07-17 00:00:00.000",
          })), []];
        }
        throw new Error(`ledger recovery must not run DDL: ${compact}`);
      },
      async execute(sql, values = []) {
        const compact = String(sql).replace(/\s+/g, " ").trim();
        if (compact.startsWith("SELECT GET_LOCK")) return [[{ acquired: 1 }], []];
        if (compact.startsWith("SELECT RELEASE_LOCK")) return [[{ released: 1 }], []];
        if (compact.startsWith("INSERT INTO schema_migrations")) {
          ledgerWrites += 1;
          ledger.set(values[0], values[1]);
          if (loseLedgerAcknowledgement) {
            const error = new Error("simulated ledger acknowledgement loss");
            error.fatal = true;
            throw error;
          }
          return [{ affectedRows: 1 }, []];
        }
        if (compact.includes("column_name = 'revision'")) return [[{ column_count: 1 }], []];
        return metadata.execute(sql, values);
      },
      release() { releasedConnections += 1; },
      destroy() { destroyedConnections += 1; },
    };
  }

  await assert.rejects(
    () => applyMysqlMigrations({
      async getConnection() { return runnerConnection(true); },
    }, { migrationsDir: MIGRATIONS_DIR }),
    (error) => error.fatal === true
  );
  assert.equal(ledger.get(target), migrationChecksum(fs.readFileSync(path.join(MIGRATIONS_DIR, target), "utf8")));
  assert.equal(ledgerWrites, 1);
  assert.equal(destroyedConnections, 1);
  assert.equal(releasedConnections, 0);

  const recovered = await applyMysqlMigrations({
    async getConnection() { return runnerConnection(false); },
  }, { migrationsDir: MIGRATIONS_DIR });
  assert.equal(ledgerWrites, 1, "authoritative ledger readback must not repeat the INSERT");
  assert.deepEqual(recovered.applied, []);
  assert.deepEqual(recovered.reconciled, []);
  assert.equal(destroyedConnections, 1);
  assert.equal(releasedConnections, 1);
});

test("any RELEASE_LOCK failure retires the session instead of returning a possibly locked connection", async () => {
  const fixtures = GUARDED_MIGRATIONS.flatMap(metadataFixtures);
  const metadata = metadataConnection(fixtures);
  const ledger = new Map(listMigrationFiles(MIGRATIONS_DIR).map((migrationName) => [
    migrationName,
    migrationChecksum(fs.readFileSync(path.join(MIGRATIONS_DIR, migrationName), "utf8")),
  ]));
  let releaseLockAttempts = 0;
  let destroyedConnections = 0;
  let releasedConnections = 0;
  const connection = {
    async query(sql) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) {
        return [{ affectedRows: 0 }, []];
      }
      if (compact.startsWith("SELECT version, checksum, applied_at FROM schema_migrations")) {
        return [[...ledger].map(([version, checksum]) => ({
          version,
          checksum,
          applied_at: "2026-07-17 00:00:00.000",
        })), []];
      }
      throw new Error(`fully applied migrations must not execute DDL: ${compact}`);
    },
    async execute(sql, values = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT GET_LOCK")) return [[{ acquired: 1 }], []];
      if (compact.startsWith("SELECT RELEASE_LOCK")) {
        releaseLockAttempts += 1;
        throw new Error("release acknowledgement unavailable");
      }
      if (compact.includes("column_name = 'revision'")) return [[{ column_count: 1 }], []];
      return metadata.execute(sql, values);
    },
    destroy() { destroyedConnections += 1; },
    release() { releasedConnections += 1; },
  };

  const result = await applyMysqlMigrations({
    async getConnection() { return connection; },
  }, { migrationsDir: MIGRATIONS_DIR });
  assert.equal(result.latestVersion, "071_product_analytics.sql");
  assert.equal(releaseLockAttempts, 1);
  assert.equal(destroyedConnections, 1);
  assert.equal(releasedConnections, 0);
});

test("RELEASE_LOCK zero, NULL, and malformed acknowledgements all retire the session", async () => {
  const fixtures = GUARDED_MIGRATIONS.flatMap(metadataFixtures);
  const ledger = new Map(listMigrationFiles(MIGRATIONS_DIR).map((migrationName) => [
    migrationName,
    migrationChecksum(fs.readFileSync(path.join(MIGRATIONS_DIR, migrationName), "utf8")),
  ]));
  for (const releaseRows of [[{ released: 0 }], [{ released: null }], []]) {
    const metadata = metadataConnection(fixtures);
    let destroyedConnections = 0;
    let releasedConnections = 0;
    const connection = {
      async query(sql) {
        const compact = String(sql).replace(/\s+/g, " ").trim();
        if (compact.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) {
          return [{ affectedRows: 0 }, []];
        }
        if (compact.startsWith("SELECT version, checksum, applied_at FROM schema_migrations")) {
          return [[...ledger].map(([version, checksum]) => ({
            version,
            checksum,
            applied_at: "2026-07-17 00:00:00.000",
          })), []];
        }
        throw new Error(`fully applied migrations must not execute DDL: ${compact}`);
      },
      async execute(sql, values = []) {
        const compact = String(sql).replace(/\s+/g, " ").trim();
        if (compact.startsWith("SELECT GET_LOCK")) return [[{ acquired: 1 }], []];
        if (compact.startsWith("SELECT RELEASE_LOCK")) return [releaseRows, []];
        if (compact.includes("column_name = 'revision'")) return [[{ column_count: 1 }], []];
        return metadata.execute(sql, values);
      },
      destroy() { destroyedConnections += 1; },
      release() { releasedConnections += 1; },
    };
    const result = await applyMysqlMigrations({
      async getConnection() { return connection; },
    }, { migrationsDir: MIGRATIONS_DIR });
    assert.equal(result.latestVersion, "071_product_analytics.sql");
    assert.equal(destroyedConnections, 1, JSON.stringify(releaseRows));
    assert.equal(releasedConnections, 0, JSON.stringify(releaseRows));
  }
});
