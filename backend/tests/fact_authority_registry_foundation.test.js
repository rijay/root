const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { loadAndValidateRegistry } = require("../../scripts/lib/route-registry");
const {
  createFactAuthorityRegistryFoundation,
  validateFactAuthorityRegistryForTest,
} = require("../src/factAuthorityRegistryFoundation");

const ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST_PATH = path.join(
  ROOT,
  "contracts",
  "fact-authority-registry",
  "v1.0.0-foundation.json"
);
const PRD_PATH = path.join(ROOT, "docs", "v1.0.0_product_requirements.md");
const ROUTE_PATH = path.join(ROOT, "contracts", "route-registry", "v1.0.0-draft.8.json");
const APP_PATH = path.join(ROOT, "miniprogram", "app.json");
const MIGRATION_PATH = path.join(
  ROOT,
  "contracts",
  "migration-contract-registry",
  "v1.0.0.json"
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixtures() {
  return {
    scope: "TEST_ONLY",
    manifest: JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")),
    prdBytes: fs.readFileSync(PRD_PATH),
    routeRegistry: loadAndValidateRegistry(ROUTE_PATH, { appJsonPath: APP_PATH }),
    migrationRegistry: JSON.parse(fs.readFileSync(MIGRATION_PATH, "utf8")),
  };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

test("foundation is default disabled and exposes no write Interface", () => {
  const foundation = createFactAuthorityRegistryFoundation({ env: {} });
  assert.deepEqual(Object.keys(foundation).sort(), [
    "assertReady",
    "assertStatus",
    "describe",
    "getFact",
  ]);
  expectCode(() => foundation.assertReady(), "FACT_AUTHORITY_REGISTRY_DISABLED");
  expectCode(() => foundation.describe(), "FACT_AUTHORITY_REGISTRY_DISABLED");
  assert.equal(Object.keys(foundation).some((key) => /write|route|persist/i.test(key)), false);
});

test("static manifest validates and remains a non-runtime non-signoff Foundation", () => {
  const current = fixtures();
  assert.equal(validateFactAuthorityRegistryForTest(current), true);
  assert.equal(current.manifest.status, "NON_RUNTIME_DEFAULT_DISABLED_FOUNDATION");
  assert.equal(current.manifest.runtimeIntegration, false);
  assert.equal(current.manifest.writeRoutingEnabled, false);
  assert.equal(current.manifest.gateClosureAuthorized, false);
  assert.equal(current.manifest.namedSignoffPresent, false);
  assert.deepEqual(current.manifest.coverageExceptions, [{
    prdRecordRef: "11.2:图片与附件",
    reasonCode: "NO_CENTRAL_FACT_AUTHORITY",
    authorityRule: "BUSINESS_REFERENCE_REMAINS_WITH_OWNING_FACT_MODULE",
    migrationContractId: "EXTERNAL_GATE",
  }]);
  assert.match(current.manifest.registryDigest, /^[a-f0-9]{64}$/);
});

test("every registered fact has one complete write-owner contract", () => {
  const { manifest } = fixtures();
  assert.equal(manifest.facts.length, 39);
  const internalModules = new Set([
    "Command Idempotency Module",
    "Event Transport Module",
    "Migration Execution Foundation Module",
  ]);
  const factTypes = new Set();
  for (const fact of manifest.facts) {
    assert.deepEqual(Object.keys(fact).sort(), [
      "authoritativeSource",
      "factType",
      "migrationContractId",
      "projectionParityCheckDigest",
      "projectionParityCheckId",
      "routeRefs",
      "snapshotRevisionPolicy",
      "sourceQueryDigest",
      "sourceQueryId",
      "statusRegistryRef",
      "targetRecord",
      "writeOwnerModule",
    ].sort());
    assert.equal(typeof fact.writeOwnerModule, "string");
    assert.equal(Array.isArray(fact.writeOwnerModule), false);
    assert.match(fact.sourceQueryDigest, /^[a-f0-9]{64}$/);
    assert.match(fact.projectionParityCheckDigest, /^[a-f0-9]{64}$/);
    assert.equal(fact.routeRefs.length === 0, internalModules.has(fact.writeOwnerModule));
    assert.equal(factTypes.has(fact.factType), false);
    factTypes.add(fact.factType);
  }
});

test("only the narrow TASK_SHARE fact binds the implemented migration contract", () => {
  const { manifest, migrationRegistry } = fixtures();
  assert.equal(
    manifest.bindings.migrationContractRegistryDigest,
    migrationRegistry.registryDigest
  );
  const implemented = manifest.facts.filter((fact) => fact.migrationContractId !== "EXTERNAL_GATE");
  assert.equal(implemented.length, 1);
  assert.equal(implemented[0].factType, "TASK_SHARE");
  assert.equal(implemented[0].migrationContractId, "TASK_SHARE_SYNTHETIC_V1");
  assert.equal(implemented[0].sourceQueryDigest, migrationRegistry.contracts[0].sourceQueryDigest);
  assert.equal(
    implemented[0].projectionParityCheckDigest,
    migrationRegistry.contracts[0].parityAdapterDigest
  );
  assert.equal(
    migrationRegistry.contracts[0].contractDigest,
    "9ccfe32948b5aa5bce2112d97e1a1fa0081b17fd62f5e65033aaec1fde3fdb57"
  );
});

test("PRD 11.1 record families are covered or explicitly excepted", () => {
  const { manifest } = fixtures();
  const targets = new Set(manifest.facts.map((fact) => fact.targetRecord));
  [
    "membership_record",
    "membership_link_attempt",
    "route_intent",
    "health_eligibility_event",
    "health_consent_event",
    "classification_definition/version/session",
    "assessment_definition/version/session/answer/result",
    "recommendation_bundle/version",
    "advice_viewed_event",
    "activity_definition",
    "activity_session",
    "activity_enrollment_event",
    "task_definition/event/progress",
    "settlement_record/event",
    "notification_template_version",
    "notification_subscription_attempt",
    "notification_subscription_grant",
    "notification_job/event",
    "notification_send_attempt",
    "notification_delivery_evidence",
    "reward_ledger_entry/event",
    "idempotency_record",
    "outbox_event",
    "inbox_receipt",
    "consumer_checkpoint",
    "migration_lineage",
    "privacy_request/event",
    "onboarding_progress",
  ].forEach((targetRecord) => assert.equal(targets.has(targetRecord), true, targetRecord));
  assert.equal(manifest.coverageExceptions[0].prdRecordRef, "11.2:图片与附件");
});

test("duplicate fact ownership fails closed", () => {
  const current = fixtures();
  const duplicate = clone(current.manifest.facts[0]);
  duplicate.writeOwnerModule = "Task Module";
  current.manifest.facts[current.manifest.facts.length - 1] = duplicate;
  expectCode(() => validateFactAuthorityRegistryForTest(current), "FACT_AUTHORITY_REGISTRY_INVALID");
});

test("two fact types cannot claim the same target record", () => {
  const current = fixtures();
  current.manifest.facts[1].targetRecord = current.manifest.facts[0].targetRecord;
  expectCode(
    () => validateFactAuthorityRegistryForTest(current),
    "FACT_AUTHORITY_DUPLICATE_WRITE_OWNER"
  );
});

test("unknown Module fails closed", () => {
  const current = fixtures();
  current.manifest.facts[0].writeOwnerModule = "Unknown Module";
  expectCode(() => validateFactAuthorityRegistryForTest(current), "FACT_AUTHORITY_UNKNOWN_MODULE");
});

test("unknown status registry reference fails closed", () => {
  const current = fixtures();
  current.manifest.facts[0].statusRegistryRef = "UNKNOWN_STATUS_V1";
  expectCode(
    () => validateFactAuthorityRegistryForTest(current),
    "FACT_AUTHORITY_UNKNOWN_STATUS_REGISTRY"
  );
});

test("unknown Route Registry reference fails closed", () => {
  const current = fixtures();
  current.manifest.facts[0].routeRefs = ["UNKNOWN_ROUTE"];
  expectCode(() => validateFactAuthorityRegistryForTest(current), "FACT_AUTHORITY_UNKNOWN_ROUTE");
});

test("source-query and parity identity drift fail closed", () => {
  const source = fixtures();
  source.manifest.facts[0].sourceQueryDigest = "0".repeat(64);
  expectCode(() => validateFactAuthorityRegistryForTest(source), "FACT_AUTHORITY_REGISTRY_INVALID");

  const parity = fixtures();
  parity.manifest.facts[0].projectionParityCheckDigest = "f".repeat(64);
  expectCode(() => validateFactAuthorityRegistryForTest(parity), "FACT_AUTHORITY_REGISTRY_INVALID");
});

test("frozen PRD byte drift fails closed", () => {
  const current = fixtures();
  current.prdBytes = Buffer.concat([current.prdBytes, Buffer.from("\nDRIFT\n")]);
  expectCode(() => validateFactAuthorityRegistryForTest(current), "FACT_AUTHORITY_PRD_DRIFT");
});

test("Route Registry identity drift fails closed", () => {
  const current = fixtures();
  current.routeRegistry = clone(current.routeRegistry);
  current.routeRegistry.digest = "0".repeat(64);
  expectCode(
    () => validateFactAuthorityRegistryForTest(current),
    "FACT_AUTHORITY_ROUTE_REGISTRY_DRIFT"
  );
});

test("Migration Contract Registry identity drift fails closed", () => {
  const current = fixtures();
  current.migrationRegistry.registryDigest = "0".repeat(64);
  expectCode(
    () => validateFactAuthorityRegistryForTest(current),
    "FACT_AUTHORITY_MIGRATION_REGISTRY_DRIFT"
  );
});

test("registry envelope digest drift fails closed", () => {
  const current = fixtures();
  current.manifest.registryDigest = "0".repeat(64);
  expectCode(() => validateFactAuthorityRegistryForTest(current), "FACT_AUTHORITY_REGISTRY_INVALID");
});

test("runtime status assertion accepts only a frozen status", () => {
  const foundation = createFactAuthorityRegistryFoundation({
    env: { MYROOT_FACT_AUTHORITY_REGISTRY_FOUNDATION_ENABLED: "true" },
  });
  const ready = foundation.assertReady();
  assert.equal(ready.runtimeIntegrated, false);
  assert.equal(ready.writeRoutingEnabled, false);
  assert.equal(ready.gateClosureAuthorized, false);
  assert.equal(ready.namedSignoffPresent, false);
  assert.equal(foundation.getFact("MEMBERSHIP_RECORD").writeOwnerModule, "Member Identity Module");
  assert.deepEqual(foundation.assertStatus({ factType: "MEMBERSHIP_RECORD", status: "ACTIVE" }), {
    factType: "MEMBERSHIP_RECORD",
    status: "ACTIVE",
    statusRegistryRef: "MEMBERSHIP_STATUS_V1",
  });
  expectCode(
    () => foundation.assertStatus({ factType: "MEMBERSHIP_RECORD", status: "ENABLED" }),
    "FACT_AUTHORITY_STATUS_UNSUPPORTED"
  );
  expectCode(
    () => foundation.assertStatus({ factType: "ACTIVITY_ENROLLMENT", status: "WAITLISTED" }),
    "FACT_AUTHORITY_STATUS_UNSUPPORTED"
  );
  expectCode(
    () => foundation.assertStatus({ factType: "HEALTH_JOURNEY_PROJECTION", status: "REASSESSMENT_DUE" }),
    "FACT_AUTHORITY_STATUS_UNSUPPORTED"
  );
  assert.deepEqual(
    foundation.assertStatus({ factType: "PRIVACY_RIGHTS_SLA_PROJECTION", status: "OVERDUE" }),
    {
      factType: "PRIVACY_RIGHTS_SLA_PROJECTION",
      status: "OVERDUE",
      statusRegistryRef: "PRIVACY_SLA_STATUS_V1",
    }
  );
  expectCode(
    () => foundation.assertStatus({ factType: "HEALTH_CLASSIFICATION", status: "READY" }),
    "FACT_AUTHORITY_STATUS_GATE_OPEN"
  );
});

test("unknown fact and extra input fields fail closed", () => {
  const foundation = createFactAuthorityRegistryFoundation({ env: {} });
  expectCode(
    () => createFactAuthorityRegistryFoundation({ env: {}, registry: {} }),
    "FACT_AUTHORITY_REGISTRY_INVALID"
  );
  expectCode(
    () => validateFactAuthorityRegistryForTest({ ...fixtures(), extra: true }),
    "FACT_AUTHORITY_REGISTRY_INVALID"
  );
  expectCode(() => foundation.getFact("MEMBERSHIP_RECORD"), "FACT_AUTHORITY_REGISTRY_DISABLED");
});
