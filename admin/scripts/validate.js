#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(__dirname, "..");

const requiredFiles = [
  "index.html",
  "package.json",
  "vite.config.js",
  "src/main.js",
  "src/App.vue",
  "src/api/client.js",
  "src/modules/access.js",
  "src/modules/adapters/adminAdapterApi.js",
  "src/modules/adapters/AdapterRunPage.vue",
  "src/modules/analytics/adminAnalyticsApi.js",
  "src/modules/analytics/OperationalAnalytics.vue",
  "src/modules/audit/adminAuditApi.js",
  "src/modules/audit/AuditLogPage.vue",
  "src/modules/config/adminConfigApi.js",
  "src/modules/config/ConfigWorkbench.vue",
  "src/modules/release/adminReleaseApi.js",
  "src/modules/release/ReleaseWorkbench.vue",
  "src/modules/users/adminLifecycleApi.js",
  "src/modules/users/UserLifecycle.vue",
  "src/styles/theme.css",
];

function read(relativePath) {
  return fs.readFileSync(path.join(adminRoot, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validatePackage() {
  const pkg = JSON.parse(read("package.json"));
  const vite = read("vite.config.js");
  assert(pkg.dependencies && pkg.dependencies.vue, "package.json must depend on vue");
  assert(pkg.dependencies && pkg.dependencies["element-plus"], "package.json must depend on element-plus");
  assert(pkg.scripts && pkg.scripts.dev && pkg.scripts.build && pkg.scripts.check, "package.json must expose dev/build/check scripts");
  assert(vite.includes('base: "/admin/"'), "vite config must build Element Plus Admin assets under /admin/");
}

function validateSourceContracts() {
  const client = read("src/api/client.js");
  const access = read("src/modules/access.js");
  const api = read("src/modules/config/adminConfigApi.js");
  const page = read("src/modules/config/ConfigWorkbench.vue");
  const app = read("src/App.vue");
  const adapterApi = read("src/modules/adapters/adminAdapterApi.js");
  const adapterPage = read("src/modules/adapters/AdapterRunPage.vue");
  const analyticsApi = read("src/modules/analytics/adminAnalyticsApi.js");
  const analyticsPage = read("src/modules/analytics/OperationalAnalytics.vue");
  const auditApi = read("src/modules/audit/adminAuditApi.js");
  const auditPage = read("src/modules/audit/AuditLogPage.vue");
  const releaseApi = read("src/modules/release/adminReleaseApi.js");
  const releasePage = read("src/modules/release/ReleaseWorkbench.vue");
  const lifecycleApi = read("src/modules/users/adminLifecycleApi.js");
  const lifecyclePage = read("src/modules/users/UserLifecycle.vue");

  assert(client.includes("X-Admin-Token") && client.includes("X-ROOT-ADMIN-TOKEN"), "admin client must send admin token headers");
  assert(client.includes("/api/v1/admin/me") && client.includes("fetchAdminProfile"), "admin client must read the admin profile Interface");
  assert(access.includes("ADMIN_CAPABILITIES") && access.includes("createAdminAccess") && access.includes("useAdminAccess"), "admin access Module must expose capability helpers");
  assert(access.includes("CONFIG_WRITE") && access.includes("REVIEW_RESOLVE") && access.includes("REWARD_DELIVERY_WRITE") && access.includes("SETTLEMENT_EXECUTE") && access.includes("DATA_EXPORT_APPROVE"), "admin access Module must mirror backend capabilities");
  assert(api.includes("/api/v1/admin/config-workbench"), "config Module must read the backend config workbench Interface");
  assert(api.includes("/api/v1/admin/campaign-rules/publish"), "config Module must publish rule versions through backend Interface");
  assert(api.includes("/api/v1/admin/manual-reviews/"), "config Module must resolve manual reviews through backend Interface");
  assert(api.includes("/api/v1/admin/manual-reviews/batch-resolve") && api.includes("X-Request-Id"), "config Module must resolve manual review batches with request id");
  assert(api.includes("/api/v1/admin/reward-delivery/execute") && api.includes("X-Request-Id"), "config Module must execute reward delivery with request id");
  assert(api.includes("/api/v1/admin/reward-delivery/status-query") && api.includes("queryRewardDeliveryStatus"), "config Module must query reward delivery external status");
  assert(api.includes("/api/v1/admin/products/sync-preview"), "config Module must preview product sync through backend Interface");
  assert(api.includes("/api/v1/admin/products/sync-execute") && api.includes("X-Request-Id"), "config Module must execute product sync with request id");
  assert(api.includes("/api/v1/admin/settlement/batch-preview"), "config Module must preview batch settlement through backend Interface");
  assert(api.includes("/api/v1/admin/settlement/batch-execute") && api.includes("X-Request-Id"), "config Module must execute batch settlement with request id");
  assert(page.includes("<el-tabs") && page.includes("<el-form") && page.includes("<el-table"), "config page must use Element Plus tabs, forms and tables");
  assert(page.includes("productSyncForm") && page.includes("productSyncResult") && page.includes("submitProductSyncExecute"), "config page must expose product sync controls");
  assert(page.includes("ruleBuilder") && page.includes("applyRuleBuilder") && page.includes("完成任一互动") && page.includes("QUESTIONNAIRE_COMPLETED"), "config page must expose AND/OR settlement rule builder controls");
  assert(
    page.includes("ruleTree")
    && page.includes("draggable=\"true\"")
    && page.includes("startRuleDrag")
    && page.includes("dropRuleNode")
    && page.includes("addRootGroup")
    && page.includes("TASK_STREAK"),
    "config page must expose draggable settlement rule tree editor controls",
  );
  assert(page.includes("rewardStockLimit") && page.includes("stockLimit") && page.includes("quotaKey"), "config page must expose reward quota controls in the rule builder");
  assert(page.includes("freeOrderChancePercent") && page.includes("chanceRate"), "config page must expose free order lottery controls in the rule builder");
  assert(page.includes("confirmRisk") && page.includes("batchSettlementForm"), "config page must require batch settlement confirmation");
  assert(page.includes("batchReviewForm") && page.includes("selectedReviewIds"), "config page must expose batch manual review controls");
  assert(page.includes("publicNote") && page.includes("expectedResolutionAt"), "config page must expose manual review public notes and SLA time");
  assert(page.includes("explanationTitle") && page.includes("operatorGuidance") && page.includes("review-explainer"), "config page must expose manual review explanation template and operator guidance");
  assert(page.includes("manualReviewExplanationTemplates") && page.includes("templateIssues") && page.includes("复核解释模板校准"), "config page must expose manual review explanation template validation");
  assert(page.includes("deliveryForm") && page.includes("selectedDeliveryJobIds") && page.includes("deliveryMode"), "config page must expose reward delivery controls");
  assert(page.includes("statusQueryForm") && page.includes("selectedStatusJobIds") && page.includes("externalStatus"), "config page must expose reward status query controls");
  assert(
    page.includes("selectedWeworkTagJobIds")
    && page.includes("externalContactId")
    && page.includes("tagId")
    && page.includes("tagName")
    && page.includes("fillWeworkTagForm")
    && page.includes("WEWORK_TAG"),
    "config page must expose WeWork tag delivery controls",
  );
  assert(app.includes("activeModule") && app.includes("UserLifecycle") && app.includes("AuditLogPage") && app.includes("AdapterRunPage") && app.includes("OperationalAnalytics") && app.includes("ReleaseWorkbench"), "admin shell must expose a module routing seam");
  assert(app.includes("ADMIN_MODULES") && app.includes("visibleModules") && app.includes("capabilities") && app.includes("principal-tags"), "admin shell must hide modules by admin capabilities and show the current principal");
  assert(app.includes("createAdminAccess") && app.includes("ADMIN_ACCESS_KEY") && app.includes("provide("), "admin shell must provide admin access Interface to child modules");
  assert(page.includes("useAdminAccess") && page.includes("requireCapability") && page.includes("canConfigWrite"), "config page must gate write buttons through admin access Interface");
  assert(page.includes("canReviewResolve") && page.includes("canRewardDeliveryWrite") && page.includes("canSettlementExecute"), "config page must gate review, reward, and settlement actions by capability");
  assert(!app.includes('index="adapters" disabled'), "admin shell must enable the Adapter run Module");
  assert(!app.includes('index="analytics" disabled'), "admin shell must enable the analytics Module");
  assert(!app.includes('index="release" disabled'), "admin shell must enable the release Module");
  assert(adapterApi.includes("/api/v1/admin/external-adapters"), "adapter Module must read the backend adapter catalog Interface");
  assert(adapterApi.includes("/api/v1/admin/orders/increment-preview"), "adapter Module must preview order increment sync through backend Interface");
  assert(adapterApi.includes("/api/v1/admin/orders/increment-execute") && adapterApi.includes("X-Request-Id"), "adapter Module must execute order increment sync with request id");
  assert(adapterApi.includes("/api/v1/admin/external-adapters/run") && adapterApi.includes("runExternalAdapter"), "adapter Module must rerun adapters through backend Interface");
  assert(adapterApi.includes("/api/v1/admin/external-adapters/retry-due") && adapterApi.includes("runDueExternalAdapterRetries"), "adapter Module must execute due adapter retries through backend Interface");
  assert(adapterApi.includes("/api/v1/admin/external-adapters/rollback") && adapterApi.includes("rollbackExternalAdapterRun"), "adapter Module must rollback adapter runs through backend Interface");
  assert(adapterApi.includes("/api/v1/admin/external-sample-reviews") && adapterApi.includes("fetchExternalSampleReviews"), "adapter Module must read sample review detail through backend Interface");
  assert(adapterApi.includes("/api/v1/admin/youzan-customers") && adapterApi.includes("fetchYouzanCustomers"), "adapter Module must read Youzan customer mirror through backend Interface");
  assert(adapterPage.includes("orderForm") && adapterPage.includes("YOUZAN_OPEN") && adapterPage.includes("MANUAL_SAMPLE"), "adapter page must expose order increment controls");
  assert(adapterPage.includes("useAdminAccess") && adapterPage.includes("canConfigWrite") && adapterPage.includes("requireConfigWrite"), "adapter page must gate write actions through admin access Interface");
  assert(adapterPage.includes("filteredRuns") && adapterPage.includes("runFilters") && adapterPage.includes("cursor_value"), "adapter page must expose run ledger filters and cursors");
  assert(adapterPage.includes("<el-drawer") && adapterPage.includes("selectedRun") && adapterPage.includes("rerunAdapter"), "adapter page must expose run detail and retry actions");
  assert(adapterPage.includes("rollbackRun") && adapterPage.includes("canRollbackRun") && adapterPage.includes("rollback_targets"), "adapter page must expose adapter rollback actions");
  assert(adapterPage.includes("retry_status") && adapterPage.includes("next_retry_at") && adapterPage.includes("retrySourceRunId"), "adapter page must expose adapter retry strategy and retry lineage");
  assert(adapterPage.includes("retryScheduler") && adapterPage.includes("previewDueRetries") && adapterPage.includes("executeDueRetries"), "adapter page must expose due retry scheduler controls");
  assert(adapterPage.includes("selectedReview") && adapterPage.includes("field_coverage") && adapterPage.includes("missing_required_fields"), "adapter page must expose sample review detail");
  assert(adapterPage.includes("reviewRowFilters") && adapterPage.includes("filteredReviewRows") && adapterPage.includes("selectedReviewRow"), "adapter page must expose sample review row troubleshooting");
  assert(adapterPage.includes("syncRunDeepLink") && adapterPage.includes("runId") && app.includes("initialModule"), "adapter page must support run_id deep links");
  assert(adapterPage.includes("youzanCustomers") && adapterPage.includes("customerFilters") && adapterPage.includes("linkStatus") && adapterPage.includes("orderSummary"), "adapter page must expose Youzan customer mirror troubleshooting");
  assert(analyticsApi.includes("/api/v1/admin/operational-analytics") && analyticsApi.includes("fetchOperationalAnalytics"), "analytics Module must read the backend operational analytics Interface");
  assert(analyticsApi.includes("/api/v1/admin/operational-analytics/export") && analyticsApi.includes("exportOperationalAnalyticsCsv"), "analytics Module must export operational analytics CSV");
  assert(analyticsApi.includes("/api/v1/admin/operational-alert-rules/upsert") && analyticsApi.includes("upsertOperationalAlertRule"), "analytics Module must configure operational alert rules through backend Interface");
  assert(analyticsApi.includes("/api/v1/jobs/operational-alerts") && analyticsApi.includes("runOperationalAlertJob"), "analytics Module must run the operational alert job Interface");
  assert(analyticsPage.includes("stages") && analyticsPage.includes("bottlenecks") && analyticsPage.includes("recentActivity"), "analytics page must expose funnel stages, bottlenecks, and recent activity");
  assert(analyticsPage.includes("useAdminAccess") && analyticsPage.includes("canConfigWrite") && analyticsPage.includes("requireConfigWrite"), "analytics page must gate alert write actions through admin access Interface");
  assert(analyticsPage.includes("alerts") && analyticsPage.includes("trend") && analyticsPage.includes("downloadCsv") && analyticsPage.includes("autoRefresh"), "analytics page must expose alerts, trend, CSV export and auto refresh");
  assert(analyticsPage.includes("retentionSegments") && analyticsPage.includes("funnelBars") && analyticsPage.includes("trendSeriesRows") && analyticsPage.includes("segmentBars"), "analytics page must expose chart and segment retention views");
  assert(analyticsPage.includes("alertRuleForm") && analyticsPage.includes("submitAlertRule") && analyticsPage.includes("previewAlertJob") && analyticsPage.includes("executeAlertJob"), "analytics page must expose alert threshold and job controls");
  assert(
    analyticsPage.includes("ownerRole") &&
      analyticsPage.includes("ownerContact") &&
      analyticsPage.includes("routeKey") &&
      analyticsPage.includes("externalRef") &&
      analyticsPage.includes("error") &&
      analyticsPage.includes("ADAPTER_RETRY_EXHAUSTED") &&
      analyticsPage.includes("LIFECYCLE_SETTLEMENT_JOB_FAILED") &&
      analyticsPage.includes("LIFECYCLE_SETTLEMENT_JOB_STALLED") &&
      analyticsPage.includes("CONSULTATION_SLA_OVERDUE") &&
      analyticsPage.includes("CONSULTATION_SLA_ESCALATION"),
    "analytics page must expose alert owner routing controls, lifecycle settlement job targets and consultation SLA targets",
  );
  assert(analyticsPage.includes("campaignId") && analyticsPage.includes("dateFrom") && analyticsPage.includes("dateTo"), "analytics page must expose campaign and date filters");
  assert(auditApi.includes("/api/v1/admin/audit-logs"), "audit Module must read the backend audit log Interface");
  assert(auditPage.includes("<el-drawer") && auditPage.includes("request_id") && auditPage.includes("BATCH_MANUAL_REVIEW_RESOLVE") && auditPage.includes("REWARD_DELIVERY_BATCH_EXECUTE"), "audit page must expose searchable audit detail");
  assert(releaseApi.includes("/api/v1/admin/release-record") && releaseApi.includes("fetchReleaseRecord"), "release Module must read the release record Interface");
  assert(releaseApi.includes("/api/v1/admin/launch-readiness") && releaseApi.includes("fetchLaunchReadiness"), "release Module must read the launch readiness Interface");
  assert(releaseApi.includes("/api/v1/admin/action-adapter-calibration") && releaseApi.includes("fetchActionAdapterCalibration"), "release Module must read the action adapter calibration Interface");
  assert(releaseApi.includes("/api/v1/admin/cloudbase-identity-probe") && releaseApi.includes("X-WX-OPENID") && releaseApi.includes("X-WX-UNIONID"), "release Module must run the CloudBase identity probe Interface");
  assert(releasePage.includes("probeForm") && releasePage.includes("runProbe") && releasePage.includes("readyForUnionPrimaryKey"), "release page must expose CloudBase identity probe controls");
  assert(releasePage.includes("releaseBlockers") && releasePage.includes("readinessChecks") && releasePage.includes("productionEnvMatrix"), "release page must expose release blockers, readiness checks, and production env matrix status");
  assert(releasePage.includes("actionAdapterCalibrationGate") && releasePage.includes("外部动作 Adapter 校准") && releasePage.includes("actionAdapterCalibrationActions"), "release page must expose action adapter calibration readiness");
  assert(releasePage.includes("productionEvidenceIntake") && releasePage.includes("生产证据收口") && releasePage.includes("productionEvidenceItems"), "release page must expose production evidence intake readiness");
  assert(releasePage.includes("legacyMigrationGate") && releasePage.includes("旧数据迁移评估") && releasePage.includes("legacyMigrationRows") && releasePage.includes("submitLegacyDecision") && releasePage.includes("submitLegacyExecution"), "release page must expose legacy data migration assessment, decision recording, and execution history recording");
  assert(releaseApi.includes("/api/v1/admin/legacy-data-migration-decisions") && releaseApi.includes("recordLegacyDataMigrationDecision"), "release Module must record legacy data migration decisions through backend Interface");
  assert(releaseApi.includes("/api/v1/admin/legacy-data-migration-executions") && releaseApi.includes("recordLegacyDataMigrationExecution"), "release Module must record legacy data migration execution history through backend Interface");
  assert(releaseApi.includes("/api/v1/admin/admin-legacy-deprecation-decisions") && releaseApi.includes("recordAdminLegacyDeprecationDecision"), "release Module must record admin legacy deprecation decisions through backend Interface");
  assert(releasePage.includes("adminLegacyDecisionForm") && releasePage.includes("submitAdminLegacyDecision") && releasePage.includes("下线决策"), "release page must expose admin legacy deprecation decision recording");
  assert(releasePage.includes("cloudbaseStoreGate") && releasePage.includes("CloudBase Store 决策") && releasePage.includes("cloudbaseStoreChecks"), "release page must expose CloudBase Store decision readiness");
  assert(releasePage.includes("rootMemberCenterGate") && releasePage.includes("Root 会员中心购买跳转") && releasePage.includes("rootMemberCenterProducts") && releasePage.includes("submitRootJumpProof"), "release page must expose Root member center purchase jump readiness and proof recording");
  assert(releaseApi.includes("/api/v1/admin/root-member-center-jump-proofs") && releaseApi.includes("recordRootMemberCenterJumpProof"), "release Module must record Root member center jump proofs through backend Interface");
  assert(lifecycleApi.includes("/api/v1/admin/lifecycle-users"), "lifecycle Module must read the backend lifecycle Interface");
  assert(lifecycleApi.includes("/api/v1/admin/lifecycle-users/export") && lifecycleApi.includes("exportLifecycleUsersCsv"), "lifecycle Module must export filtered lifecycle CSV");
  assert(lifecycleApi.includes("/api/v1/admin/consultation-wework-writebacks") && lifecycleApi.includes("recordConsultationWeworkWriteback"), "lifecycle Module must record consultation WeWork writeback through backend Interface");
  assert(lifecycleApi.includes("/api/v1/admin/consultation-advisor-assignments") && lifecycleApi.includes("assignConsultationAdvisor"), "lifecycle Module must assign consultation advisors through backend Interface");
  assert(lifecycleApi.includes("/api/v1/admin/consultation-sla") && lifecycleApi.includes("fetchConsultationSla"), "lifecycle Module must read consultation SLA through backend Interface");
  assert(lifecycleApi.includes("/api/v1/admin/consultation-sla-escalations") && lifecycleApi.includes("fetchConsultationSlaEscalations"), "lifecycle Module must read consultation SLA escalations through backend Interface");
  assert(lifecycleApi.includes("/api/v1/admin/consultation-advisor-workbench") && lifecycleApi.includes("fetchConsultationAdvisorWorkbench"), "lifecycle Module must read consultation advisor workbench through backend Interface");
  assert(
    lifecycleApi.includes("/api/v1/admin/lifecycle-user-exports") &&
      lifecycleApi.includes("/api/v1/admin/lifecycle-user-exports/create") &&
      lifecycleApi.includes("/api/v1/admin/lifecycle-user-exports/review") &&
      lifecycleApi.includes("/api/v1/admin/lifecycle-user-exports/deliver") &&
      lifecycleApi.includes("/download") &&
      lifecycleApi.includes("fetchLifecycleUserExports") &&
      lifecycleApi.includes("createLifecycleUserExport") &&
      lifecycleApi.includes("reviewLifecycleUserExport") &&
      lifecycleApi.includes("deliverLifecycleUserExport") &&
      lifecycleApi.includes("downloadLifecycleUserExportCsv"),
    "lifecycle Module must expose scheduled lifecycle export records through backend Interface",
  );
  assert(
      lifecycleApi.includes("/api/v1/admin/lifecycle-filter-presets") &&
      lifecycleApi.includes("/api/v1/admin/lifecycle-filter-presets/upsert") &&
      lifecycleApi.includes("/api/v1/admin/lifecycle-filter-presets/copy") &&
      lifecycleApi.includes("/api/v1/admin/lifecycle-filter-presets/delete") &&
      lifecycleApi.includes("fetchLifecycleFilterPresets") &&
      lifecycleApi.includes("upsertLifecycleFilterPreset") &&
      lifecycleApi.includes("copyLifecycleFilterPreset") &&
      lifecycleApi.includes("deleteLifecycleFilterPreset"),
    "lifecycle Module must persist operator filter presets through backend Interface",
  );
  assert(
    lifecyclePage.includes("teamShared") &&
      lifecyclePage.includes("presetForm.pinned") &&
      lifecyclePage.includes("sortOrder") &&
      lifecyclePage.includes("copySelectedPreset") &&
      lifecyclePage.includes("selectedPresetReadonly") &&
      lifecyclePage.includes("presetOptionLabel"),
    "lifecycle Module must expose team shared, pinned, sorted, copyable filter presets with readonly protection",
  );
  assert(
      lifecyclePage.includes("sensitivityLabel") &&
      lifecyclePage.includes("字段策略") &&
      lifecyclePage.includes("字段默认脱敏") &&
      lifecyclePage.includes("approvalLabel") &&
      lifecyclePage.includes("deliveryLabel") &&
      lifecyclePage.includes("reviewLifecycleExport") &&
      lifecyclePage.includes("deliverLifecycleExportRecord") &&
      lifecyclePage.includes("DATA_EXPORT_APPROVE"),
    "lifecycle Module must expose lifecycle export field sensitivity, approval and delivery status",
  );
  assert(
    lifecyclePage.includes("questionnaireSummary") &&
      lifecyclePage.includes("新版问卷答卷") &&
      lifecyclePage.includes("answerSummary"),
    "lifecycle Module must expose new questionnaire answers in user detail",
  );
  assert(
    lifecycleApi.includes("/api/v1/admin/settlement/batch-preview") &&
      lifecycleApi.includes("/api/v1/admin/settlement/batch-execute") &&
      lifecycleApi.includes("previewLifecycleSettlementBatch") &&
      lifecycleApi.includes("executeLifecycleSettlementBatch"),
    "lifecycle Module must route current results into settlement batch Interface",
  );
  assert(
    lifecycleApi.includes("/api/v1/admin/lifecycle-users/settlement-batch-preview") &&
      lifecycleApi.includes("/api/v1/admin/lifecycle-users/settlement-batch-execute") &&
      lifecycleApi.includes("previewLifecycleFilterSettlementBatch") &&
      lifecycleApi.includes("executeLifecycleFilterSettlementBatch"),
    "lifecycle Module must route filtered results into settlement batch Interface",
  );
  assert(
    lifecycleApi.includes("/api/v1/admin/lifecycle-settlement-jobs") &&
      lifecycleApi.includes("/api/v1/admin/lifecycle-settlement-jobs/create") &&
      lifecycleApi.includes("/api/v1/admin/lifecycle-settlement-jobs/run") &&
      lifecycleApi.includes("/api/v1/admin/lifecycle-settlement-jobs/cancel") &&
    lifecycleApi.includes("/api/v1/admin/lifecycle-settlement-jobs/retry-failed") &&
      lifecycleApi.includes("/api/v1/jobs/lifecycle-settlement-due") &&
      lifecycleApi.includes("/api/v1/jobs/lifecycle-settlement-cleanup") &&
      lifecycleApi.includes("fetchLifecycleSettlementJobs") &&
      lifecycleApi.includes("createLifecycleSettlementJob") &&
      lifecycleApi.includes("runLifecycleSettlementJob") &&
      lifecycleApi.includes("cancelLifecycleSettlementJob") &&
      lifecycleApi.includes("retryFailedLifecycleSettlementJob") &&
      lifecycleApi.includes("runLifecycleSettlementScheduler") &&
      lifecycleApi.includes("runLifecycleSettlementCleanup"),
    "lifecycle Module must expose settlement job queue, scheduler, and cleanup Interface",
  );
  assert(lifecyclePage.includes("<el-drawer") && lifecyclePage.includes("<el-progress") && lifecyclePage.includes("unionidStatus"), "lifecycle page must expose identity, progress, and detail views");
  assert(lifecyclePage.includes("consultationSummary") && lifecyclePage.includes("pendingConsultations"), "lifecycle page must expose consultation follow-up status");
  assert(lifecyclePage.includes("consultationSla") && lifecyclePage.includes("loadConsultationSlaForSelected") && lifecyclePage.includes("slaOverdueMinutes"), "lifecycle page must expose consultation SLA status and refresh controls");
  assert(lifecyclePage.includes("advisorWorkbench") && lifecyclePage.includes("openAdvisorWorkbench") && lifecyclePage.includes("selectAdvisorWorkbenchAdvisor"), "lifecycle page must expose consultation advisor workbench summary and advisor filters");
  assert(lifecyclePage.includes("consultationEscalations") && lifecyclePage.includes("loadConsultationEscalations") && lifecyclePage.includes("escalationAction"), "lifecycle page must expose consultation SLA escalation chain");
  assert(lifecyclePage.includes("advisorAssignmentForm") && lifecyclePage.includes("submitAdvisorAssignment") && lifecyclePage.includes("assignmentMode") && lifecyclePage.includes("REVIEW_RESOLVE"), "lifecycle page must expose consultation advisor assignment controls gated by review capability");
  assert(lifecyclePage.includes("weworkWritebackForm") && lifecyclePage.includes("submitWeworkWriteback") && lifecyclePage.includes("WEWORK_CONTACT_WRITEBACK") && lifecyclePage.includes("REVIEW_RESOLVE"), "lifecycle page must expose consultation WeWork writeback controls gated by review capability");
  assert(
    lifecyclePage.includes("campaignId") &&
      lifecyclePage.includes("taskProgress") &&
      lifecyclePage.includes("consultationStatus") &&
      lifecyclePage.includes("settlementStatus") &&
      lifecyclePage.includes("rewardStatus") &&
      lifecyclePage.includes("openTasks") &&
      lifecyclePage.includes("resetFilters") &&
      lifecyclePage.includes("downloadCsv") &&
      lifecyclePage.includes("exportLoading") &&
      lifecyclePage.includes("createLifecycleUserExportRecord") &&
      lifecyclePage.includes("loadLifecycleUserExports") &&
      lifecyclePage.includes("downloadStoredLifecycleExport") &&
      lifecyclePage.includes("lifecycleExportDrawerVisible") &&
      lifecyclePage.includes("exportRecordLoading") &&
      lifecyclePage.includes("filterPresets") &&
      lifecyclePage.includes("saveCurrentPreset") &&
      lifecyclePage.includes("applySelectedPreset") &&
      lifecyclePage.includes("deleteSelectedPreset") &&
      lifecyclePage.includes("previewBatchSettlement") &&
      lifecyclePage.includes("executeBatchSettlement") &&
      lifecyclePage.includes("previewFilterBatchSettlement") &&
      lifecyclePage.includes("executeFilterBatchSettlement") &&
      lifecyclePage.includes("selectionLimit") &&
      lifecyclePage.includes("batchSize") &&
      lifecyclePage.includes("createFilterSettlementJob") &&
      lifecyclePage.includes("loadSettlementJobs") &&
      lifecyclePage.includes("runSettlementJob") &&
      lifecyclePage.includes("cancelSettlementJob") &&
      lifecyclePage.includes("retrySettlementJob") &&
      lifecyclePage.includes("previewSettlementScheduler") &&
      lifecyclePage.includes("executeSettlementScheduler") &&
      lifecyclePage.includes("previewSettlementCleanup") &&
      lifecyclePage.includes("executeSettlementCleanup") &&
      lifecyclePage.includes("settlementSchedulerResult") &&
      lifecyclePage.includes("settlementCleanupResult") &&
      lifecyclePage.includes("settlementJobDrawerVisible") &&
      lifecyclePage.includes("SETTLEMENT_EXECUTE") &&
      lifecyclePage.includes("batchSettlementResult"),
    "lifecycle page must expose complete operational filters, CSV export, settlement batch actions and queue actions",
  );
  assert(!page.includes("localStorage.setItem(\"rootUsers\""), "admin page must not store backend domain data directly");
}

function main() {
  for (const file of requiredFiles) {
    assert(fs.existsSync(path.join(adminRoot, file)), `missing required file: ${file}`);
  }
  validatePackage();
  validateSourceContracts();
  process.stdout.write("admin validation ok\n");
}

try {
  main();
} catch (error) {
  process.stderr.write(`admin validation failed: ${error.message}\n`);
  process.exitCode = 1;
}
