const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const checksums = require("../db/migrations/checksums.json");
const {
  QUERY,
  collectMysqlProductionPreflight,
} = require("../src/mysqlProductionPreflight");
const {
  assertReadOnlyInvocation,
} = require("../scripts/mysql-production-preflight");

const RAW_DATABASE = "candidate_secret_database";
const RAW_PRINCIPAL = "myroot_runtime_secret@%";

function env(overrides = {}) {
  return {
    ROOT_RELEASE_ID: "release-v1-20260717",
    ROOT_EVIDENCE_REFERENCE_HMAC_KEY: "evidence-reference-test-key-material-32-bytes",
    ROOT_CLOUDBASE_ENV_ID: "cloudbase-secret-environment",
    MYROOT_EVIDENCE_ENVIRONMENT_KIND: "CANDIDATE",
    MYROOT_EVIDENCE_CAPTURED_BY_SIGNER_REF: `actor:sha256:${"a".repeat(64)}`,
    MYSQL_CONNECTION_LIMIT: "10",
    MYROOT_CLOUDRUN_MAX_INSTANCES: "4",
    MYROOT_MYSQL_OTHER_CONNECTION_CONSUMERS: "5",
    MYROOT_MYSQL_RESERVED_CONTINGENCY_HEADROOM: "15",
    MYROOT_MYSQL_CONNECTION_HEADROOM: "20",
    MYROOT_MYSQL_CAPACITY_EVIDENCE_REF: `evidence:sha256:${"c".repeat(64)}`,
    K_REVISION: "myroot-api-v1-candidate",
    ...overrides,
  };
}

function fakeConnection(options = {}) {
  const migrations = Object.entries(checksums.files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([version, checksum]) => ({ version, checksum }));
  const grants = options.grants || [
    { grant: `GRANT USAGE ON *.* TO \`${RAW_PRINCIPAL.split("@")[0]}\`@\`%\`` },
    { grant: `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${RAW_DATABASE}\`.* TO \`${RAW_PRINCIPAL.split("@")[0]}\`@\`%\`` },
  ];
  return {
    async query(statement) {
      if (statement === QUERY.metadata) {
        return [[{
          mysql_version: "8.0.43",
          session_time_zone: "+00:00",
          global_time_zone: "SYSTEM",
          max_connections: 200,
          database_name: RAW_DATABASE,
          authenticated_account: RAW_PRINCIPAL,
        }]];
      }
      if (statement === QUERY.status) {
        return [[
          { Variable_name: "Threads_connected", Value: "11" },
          { Variable_name: "Threads_running", Value: "2" },
          { Variable_name: "Max_used_connections", Value: "70" },
          { Variable_name: "Connection_errors_max_connections", Value: "0" },
          { Variable_name: "Uptime", Value: "86400" },
        ]];
      }
      if (statement === QUERY.migrations) return [options.migrations || migrations];
      if (statement === QUERY.columns) {
        return [[{
          table_name: "schema_migrations",
          column_name: "version",
          column_type: "varchar(96)",
          is_nullable: "NO",
          column_default: "<NULL>",
          extra: "",
          collation_name: "utf8mb4_unicode_ci",
        }]];
      }
      if (statement === QUERY.grants) return [grants];
      throw new Error(`unexpected query: ${statement}`);
    },
  };
}

test("read-only collector emits separate Candidate evidence without raw authority names", async () => {
  const report = await collectMysqlProductionPreflight({
    connection: fakeConnection(),
    env: env(),
    now: () => "2026-07-17T14:00:00.000Z",
  });

  assert.equal(report.status, "PASS");
  assert.equal(report.environmentKind, "CANDIDATE");
  assert.equal(report.readOnly, true);
  assert.equal(report.capacity.calculatedRequirement, 60);
  assert.equal(report.capacity.perInstance, 10);
  assert.equal(report.capacity.serverMaximumConnections, 200);
  assert.equal(report.capacity.runtimeHeadroomMatches, true);
  assert.equal(report.grantSummary.globalScopePresent, false);
  assert.match(report.databaseRef, /^database:sha256:[a-f0-9]{64}$/);
  assert.match(report.databasePrincipalRef, /^principal:sha256:[a-f0-9]{64}$/);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(RAW_DATABASE), false);
  assert.equal(serialized.includes(RAW_PRINCIPAL), false);
  assert.equal(serialized.includes("cloudbase-secret-environment"), false);
  assert.equal(serialized.includes(env().ROOT_EVIDENCE_REFERENCE_HMAC_KEY), false);
});

test("capacity mismatch and cross-schema privileges fail closed", async () => {
  const report = await collectMysqlProductionPreflight({
    connection: fakeConnection({
      grants: [
        { grant: "GRANT SELECT ON \`another_database\`.* TO \`runtime\`@\`%\`" },
      ],
    }),
    env: env({ MYROOT_MYSQL_CONNECTION_HEADROOM: "19" }),
    now: () => "2026-07-17T14:00:00.000Z",
  });

  assert.equal(report.status, "BLOCKED");
  assert.deepEqual(report.blockers.sort(), [
    "CROSS_SCHEMA_PRIVILEGE_PRESENT",
    "RUNTIME_HEADROOM_MISMATCH",
  ]);
});

test("migration drift, global privilege and capacity excess remain blockers", async () => {
  const altered = Object.entries(checksums.files)
    .slice(0, -1)
    .map(([version, checksum]) => ({ version, checksum }));
  const report = await collectMysqlProductionPreflight({
    connection: fakeConnection({
      migrations: altered,
      grants: [{ grant: "GRANT ALL PRIVILEGES ON *.* TO \`runtime\`@\`%\` WITH GRANT OPTION" }],
    }),
    env: env({
      MYROOT_CLOUDRUN_MAX_INSTANCES: "20",
      MYROOT_MYSQL_CONNECTION_HEADROOM: "20",
    }),
    now: () => "2026-07-17T14:00:00.000Z",
  });

  assert.equal(report.status, "BLOCKED");
  assert.equal(report.blockers.includes("MIGRATION_SET_MISMATCH"), true);
  assert.equal(report.blockers.includes("GLOBAL_SCOPE_PRIVILEGE_PRESENT"), true);
  assert.equal(report.blockers.includes("ALL_PRIVILEGES_PRESENT"), true);
  assert.equal(report.blockers.includes("GRANT_OPTION_PRESENT"), true);
  assert.equal(report.blockers.includes("CAPACITY_EXCEEDS_SERVER_MAXIMUM"), true);
});

test("CLI needs an explicit read-only acknowledgement", () => {
  assert.equal(
    assertReadOnlyInvocation(["--read-only"], {
      MYROOT_MYSQL_PREFLIGHT_READ_ONLY_CONFIRM: "true",
    }),
    undefined
  );
  assert.throws(
    () => assertReadOnlyInvocation([], {}),
    /--read-only/
  );
  assert.throws(
    () => assertReadOnlyInvocation(["--read-only"], {}),
    /READ_ONLY_CONFIRM/
  );
});

test("fixture key is not reused as a plain SHA reference", () => {
  const plain = crypto.createHash("sha256")
    .update(env().ROOT_EVIDENCE_REFERENCE_HMAC_KEY)
    .digest("hex");
  assert.notEqual(plain, "a".repeat(64));
});
