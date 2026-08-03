const test = require("node:test");
const assert = require("node:assert/strict");

const domain = require("../src/domain");
const { buildProductionEnvMatrix } = require("../src/productionEnvMatrix");
const {
  buildReleaseEvidencePack,
  buildReleaseEvidencePackReport,
  validateReleaseEvidencePack,
} = require("../src/releaseEvidencePack");
const {
  buildCloudbaseJobManifest,
  validateCloudbaseJobManifest,
} = require("../scripts/cloudbase-job-manifest");
const {
  determineExitCode,
  parseArgs,
  resolveBaseUrl,
} = require("../scripts/release-evidence-pack");

test("release evidence pack summarizes launch evidence without leaking secrets", () => {
  const store = domain.createStore();
  const releaseRecord = domain.getReleaseRecord(store, { env: {}, target: "production" }).data;
  const adapterCalibration = domain.getAdapterCalibration(store, { env: {} }).data;
  const productionEnvMatrix = buildProductionEnvMatrix({}, { target: "production" });
  const cloudbaseJobManifest = buildCloudbaseJobManifest({
    baseUrl: "https://admin:real-password@root.example.com/prod?token=real-token",
  });
  const cloudbaseJobValidation = validateCloudbaseJobManifest(cloudbaseJobManifest, { strict: true });
  const pack = buildReleaseEvidencePack({
    target: "production",
    baseUrl: "https://admin:real-password@root.example.com/prod?token=real-token",
    releaseRecord,
    adapterCalibration,
    productionEnvMatrix,
    cloudbaseJobManifest,
    cloudbaseJobValidation,
    calibrationReport: "# calibration",
  });
  const validation = validateReleaseEvidencePack(pack);
  const report = buildReleaseEvidencePackReport(pack, validation);
  const serialized = JSON.stringify(pack);

  assert.equal(pack.status, "BLOCKED");
  assert.equal(pack.baseUrl, "https://root.example.com/prod");
  assert.equal(pack.sanitization.secretValuesIncluded, false);
  assert.equal(validation.status, "PASS");
  assert.ok(validation.warnings.some((item) => item.includes("阻塞项")));
  assert.ok(pack.evidence.commands.some((item) => item.includes("release:evidence")));
  assert.ok(pack.evidence.externalChannelReadiness.alertOwnerRoutes.some((item) => item.targetType === "LIFECYCLE_EXPORT_DELIVERY_HEALTH"));
  assert.equal(pack.summary.signoffGateStatus, "BLOCKED");
  assert.equal(pack.evidence.signoffGate.summary.pendingCount, 3);
  assert.equal(pack.summary.actionAdapterCalibrationStatus, "BLOCKED");
  assert.equal(pack.evidence.actionAdapterCalibration.actions.length, 1);
  assert.ok(["BLOCKED", "NEEDS_REVIEW", "READY"].includes(pack.summary.adminTransitionStatus));
  assert.equal(pack.evidence.adminTransitionReadiness.summary.requiredModuleCount, 6);
  assert.equal(pack.evidence.adminTransitionReadiness.legacyDeprecationDecision.status, "PENDING");
  assert.equal(pack.summary.productionCutoverStatus, "BLOCKED");
  assert.equal(pack.evidence.productionCutoverReadiness.summary.requiredProofCount, 13);
  assert.equal(pack.summary.productionEvidenceIntakeStatus, "BLOCKED");
  assert.equal(pack.evidence.productionEvidenceIntake.items.length, 12);
  assert.ok(pack.evidence.productionEvidenceIntake.items.some((item) => item.backlogId === "T-001"));
  assert.equal(pack.summary.cloudbaseStoreStatus, "BLOCKED");
  assert.equal(pack.evidence.cloudbaseStoreReadiness.selectedDecision, "UNDECIDED");
  assert.equal(pack.summary.rootMemberCenterStatus, "BLOCKED");
  assert.equal(pack.evidence.rootMemberCenterReadiness.summary.missingAppIdCount, 1);
  assert.ok(pack.evidence.rootMemberCenterReadiness.checks.some((item) => item.id === "trial_jump_proof"));
  assert.match(report, /ROOT 发布证据包/);
  assert.match(report, /发布签字/);
  assert.match(report, /动作 Adapter 校准/);
  assert.match(report, /Admin 迁移 Gate/);
  assert.match(report, /下线决策/);
  assert.match(report, /生产切换 Gate/);
  assert.match(report, /生产证据收口/);
  assert.match(report, /CloudBase Store 决策/);
  assert.match(report, /Root 会员中心购买跳转/);
  assert.match(report, /脱敏策略/);
  assert.equal(serialized.includes("real-password"), false);
  assert.equal(serialized.includes("real-token"), false);
});

test("release evidence pack CLI args and exit codes stay release-gate friendly", () => {
  const env = {
    ROOT_RELEASE_EVIDENCE_BASE_URL: "https://root.example.com",
    ROOT_ADMIN_JOB_TOKEN: "job-token",
  };
  const args = parseArgs(["--target", "gray", "--strict", "--allow-blocked"], env);

  assert.equal(resolveBaseUrl(env), "https://root.example.com");
  assert.equal(args.target, "gray");
  assert.equal(args.strict, true);
  assert.equal(args.allowBlocked, true);
  assert.equal(args.adminToken, "job-token");
  assert.equal(determineExitCode({ status: "BLOCKED" }, args, { status: "PASS" }), 0);
  assert.equal(determineExitCode({ status: "BLOCKED" }, { allowBlocked: false }, { status: "PASS" }), 2);
  assert.equal(determineExitCode({ status: "NEEDS_REVIEW" }, { strict: true }, { status: "PASS" }), 3);
  assert.equal(determineExitCode({ status: "READY" }, {}, { status: "FAIL" }), 1);
});

test("release evidence archive stores sanitized pack and writes audit log", () => {
  const store = domain.createStore();
  const archived = domain.archiveReleaseEvidencePack(store, {
    target: "gray",
    baseUrl: "https://root.example.com?token=secret-token",
    strict: true,
    note: "灰度前证据留档",
    requestId: "release-evidence-archive-domain-1",
    operatorId: "ops-release",
  }, {
    env: {},
    target: "gray",
    baseUrl: "https://root.example.com?token=secret-token",
    strict: true,
  }).data;
  const listed = domain.getReleaseEvidencePack(store, {
    env: {},
    target: "gray",
    baseUrl: "https://root.example.com",
    strict: true,
  }).data;
  const snapshotValidation = require("../src/store").validateSnapshot(store, { seedSampleData: true });

  assert.equal(archived.archive.status, "BLOCKED");
  assert.equal(archived.archive.operatorId, "ops-release");
  assert.equal(archived.archive.note, "灰度前证据留档");
  assert.equal(archived.archive.baseUrl, "https://root.example.com");
  assert.equal(listed.archives.length, 1);
  assert.equal(listed.archives[0].archiveId, archived.archive.archiveId);
  assert.equal(store.auditLogs[0].action, "RELEASE_EVIDENCE_ARCHIVE_CREATE");
  assert.equal(store.auditLogs[0].target_id, archived.archive.archiveId);
  assert.equal(JSON.stringify(archived).includes("secret-token"), false);
  assert.equal(snapshotValidation.valid, true);
  const archiveDetail = domain.getReleaseEvidenceArchive(store, archived.archive.archiveId).data;
  assert.equal(archiveDetail.archive.archiveId, archived.archive.archiveId);
  assert.equal(archiveDetail.pack.status, "BLOCKED");
  assert.equal(archiveDetail.validation.status, "PASS");
  assert.equal(JSON.stringify(archiveDetail).includes("secret-token"), false);
  const signoff = domain.signReleaseRecord(store, {
    target: "gray",
    role: "产品",
    status: "APPROVED",
    archiveId: archived.archive.archiveId,
    note: "产品确认灰度证据",
    requestId: "release-signoff-domain-1",
    operatorId: "product-owner",
  }).data;
  const signedRecord = domain.getReleaseRecord(store, { env: {}, target: "gray" }).data;
  const repeatedSignoff = domain.signReleaseRecord(store, {
    target: "gray",
    role: "产品",
    status: "APPROVED",
    archiveId: archived.archive.archiveId,
    note: "重复签字不应新增记录",
    requestId: "release-signoff-domain-1",
    operatorId: "product-owner",
  }).data;
  assert.equal(signoff.signoff.status, "APPROVED");
  assert.equal(signoff.signoff.role, "PRODUCT");
  assert.equal(signoff.signoff.archiveId, archived.archive.archiveId);
  assert.equal(signedRecord.signoffs.find((item) => item.role === "PRODUCT").status, "APPROVED");
  assert.equal(signedRecord.signoffs.find((item) => item.role === "PRODUCT").archiveId, archived.archive.archiveId);
  assert.equal(signedRecord.signoffGate.status, "NEEDS_REVIEW");
  assert.deepEqual(signedRecord.signoffGate.pendingRoles, ["OPERATIONS", "ENGINEERING"]);
  assert.equal(repeatedSignoff.idempotent, true);
  assert.equal(repeatedSignoff.signoff.signoffId, signoff.signoff.signoffId);
  domain.signReleaseRecord(store, {
    target: "gray",
    role: "运营",
    status: "APPROVED",
    archiveId: archived.archive.archiveId,
    note: "运营确认灰度证据",
    requestId: "release-signoff-domain-ops-1",
    operatorId: "ops-owner",
  });
  domain.signReleaseRecord(store, {
    target: "gray",
    role: "研发",
    status: "APPROVED",
    archiveId: archived.archive.archiveId,
    note: "研发确认灰度证据",
    requestId: "release-signoff-domain-eng-1",
    operatorId: "eng-owner",
  });
  const fullySignedRecord = domain.getReleaseRecord(store, { env: {}, target: "gray" }).data;
  const signedPack = domain.getReleaseEvidencePack(store, {
    env: {},
    target: "gray",
    baseUrl: "https://root.example.com",
    strict: true,
  }).data.pack;
  assert.equal(fullySignedRecord.signoffGate.status, "READY");
  assert.equal(fullySignedRecord.signoffGate.summary.allApproved, true);
  assert.equal(signedPack.summary.signoffGateStatus, "READY");
  assert.equal(signedPack.evidence.signoffGate.summary.allApproved, true);
  assert.equal(store.releaseSignoffs.length, 3);
  assert.equal(store.auditLogs[0].action, "RELEASE_SIGNOFF_RECORD");
  assert.equal(require("../src/store").validateSnapshot(store, { seedSampleData: true }).valid, true);

  const repeated = domain.archiveReleaseEvidencePack(store, {
    note: "重复留档不应新增记录",
    requestId: "release-evidence-archive-domain-1",
    operatorId: "ops-release",
  }, {
    env: {},
    target: "gray",
    baseUrl: "https://root.example.com",
    strict: true,
  }).data;
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.archive.archiveId, archived.archive.archiveId);
  assert.equal(store.releaseEvidenceArchives.length, 1);
});
