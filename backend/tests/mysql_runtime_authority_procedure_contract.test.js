const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  createMysqlRuntimePrincipalBootstrapPlan,
} = require("../src/mysqlRuntimePrincipalBootstrap");
const { ROUTINES } = require("../src/mysqlRuntimeAlertAuthorityPolicy");

const MIGRATIONS_DIRECTORY = path.join(__dirname, "../db/migrations");
const LEDGER_ADAPTER = path.join(__dirname, "../src/mysqlV1RuntimeControlLedger.js");
const DELIVERY_ADAPTER = path.join(
  __dirname,
  "../src/mysqlV1RuntimeAlertDeliveryAdapter.js"
);

function procedureNames(fileName) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, fileName), "utf8");
  const names = Array.from(
    sql.matchAll(/CREATE\s+PROCEDURE\s+([a-z0-9_]+)\s*\(/gi),
    (match) => match[1]
  );
  assert.equal(new Set(names).size, names.length, `${fileName} repeats a procedure name`);
  return new Set(names);
}

function set(values) {
  return new Set(values);
}

function sorted(values) {
  return [...values].sort();
}

function assertSameSet(actual, expected, message) {
  assert.deepEqual(sorted(actual), sorted(expected), message);
}

function principalInput(registrationMode) {
  return {
    database: "myroot_runtime_principal_it_123_0123456789abcdef",
    registrationMode,
    principals: {
      DEFINER: {
        username: "contract_definer",
        host: "127.0.0.1",
        password: "contract-definer-local-0123456789abcdef",
      },
      REGISTRAR: {
        username: "contract_registrar",
        host: "127.0.0.1",
        password: "contract-registrar-local-0123456789abcdef",
      },
      WORKER: {
        username: "contract_worker",
        host: "127.0.0.1",
        password: "contract-worker-local-0123456789abcdef",
      },
      INSPECTOR: {
        username: "contract_inspector",
        host: "127.0.0.1",
        password: "contract-inspector-local-0123456789abcdef",
      },
    },
  };
}

function grantedProcedures(plan) {
  return new Set(plan.runtimeGrantStatements.flatMap((statement) => {
    const match = statement.sql.match(
      /^GRANT EXECUTE ON PROCEDURE `[^`]+`\.`([^`]+)` TO /
    );
    return match ? [match[1]] : [];
  }));
}

function ledgerProcedureCatalog(source) {
  const block = source.match(
    /const PROCEDURES = Object\.freeze\(\{([\s\S]*?)\}\);/
  );
  assert.ok(block, "Control Ledger Adapter procedure catalog is missing");
  return new Map(Array.from(
    block[1].matchAll(/([A-Z][A-Z_]+):\s*"([a-z0-9_]+)"/g),
    (match) => [match[1], match[2]]
  ));
}

function calledProcedures(source, prefix) {
  return new Set(Array.from(
    source.matchAll(new RegExp(`\\bCALL\\s+(${prefix}[a-z0-9_]+)\\s*\\(`, "gi")),
    (match) => match[1]
  ));
}

const ledgerMigrationProcedures = procedureNames(
  "064_v1_runtime_control_ledger_database_authority.sql"
);
const registrationMigrationProcedures = procedureNames(
  "066_v1_runtime_alert_delivery_severity_slo_authority.sql"
);
const migrationProcedures = new Set([
  ...ledgerMigrationProcedures,
  ...registrationMigrationProcedures,
]);

test("064 and 066 procedure sets equal the Authority Policy role partition", () => {
  const ledgerPolicy = new Set([
    ...ROUTINES.CONTROL_LEDGER_REGISTRAR,
    ...ROUTINES.INSPECTOR.filter((name) => (
      name.startsWith("v1_runtime_control_ledger_")
    )),
  ]);
  assertSameSet(
    ledgerPolicy,
    ledgerMigrationProcedures,
    "every 064 procedure must belong to exactly one runtime role Interface"
  );
  assertSameSet(
    Object.values(ROUTINES.REGISTRAR),
    registrationMigrationProcedures,
    "066 registration procedures must equal the fixed-mode Registrar Interface"
  );
  assert.equal(
    ROUTINES.CONTROL_LEDGER_REGISTRAR.some((name) => ROUTINES.INSPECTOR.includes(name)),
    false,
    "Control Ledger mutation/read and inspection grants must not overlap"
  );
});

test("bootstrap grants every 064 procedure and only the selected 066 mode", () => {
  for (const mode of ["DRY_RUN", "CONTROLLED"]) {
    const grants = grantedProcedures(createMysqlRuntimePrincipalBootstrapPlan(
      principalInput(mode)
    ));
    const relevantGrants = new Set([...grants].filter((name) => (
      name.startsWith("v1_runtime_control_ledger_")
      || name.startsWith("v1_runtime_alert_delivery_register_")
    )));
    assertSameSet(relevantGrants, new Set([
      ...ledgerMigrationProcedures,
      ROUTINES.REGISTRAR[mode],
    ]), `${mode} bootstrap grant set drifted from migrations 064/066`);
    const otherMode = mode === "DRY_RUN" ? "CONTROLLED" : "DRY_RUN";
    assert.equal(grants.has(ROUTINES.REGISTRAR[otherMode]), false);
  }
});

test("Adapters call the complete 064 and 066 procedure Interfaces", () => {
  const ledgerSource = fs.readFileSync(LEDGER_ADAPTER, "utf8");
  const deliverySource = fs.readFileSync(DELIVERY_ADAPTER, "utf8");
  const ledgerCatalog = ledgerProcedureCatalog(ledgerSource);
  const ledgerValues = new Set(ledgerCatalog.values());
  assertSameSet(
    ledgerValues,
    ledgerMigrationProcedures,
    "Control Ledger Adapter procedure catalog drifted from migration 064"
  );
  for (const [key, procedure] of ledgerCatalog) {
    const references = ledgerSource.match(new RegExp(`PROCEDURES\\.${key}\\b`, "g")) || [];
    assert.equal(
      references.length,
      1,
      `${procedure} must be crossed exactly once through the procedureSql seam`
    );
  }
  assertSameSet(
    calledProcedures(deliverySource, "v1_runtime_alert_delivery_register_"),
    registrationMigrationProcedures,
    "Alert Delivery Adapter calls drifted from migration 066"
  );
});
