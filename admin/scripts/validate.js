import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const sourceFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const absolutePath = path.join(directory, entry.name);
  if (entry.isDirectory()) return sourceFiles(absolutePath);
  return /\.(?:js|vue)$/.test(entry.name) ? [absolutePath] : [];
});

const requiredFiles = [
  "index.html",
  "package.json",
  "vite.config.js",
  "config/performance-budgets.json",
  "src/main.js",
  "src/App.vue",
  "src/api/client.js",
  "src/modules/access.js",
  "src/modules/release/ReleaseWorkbench.vue",
  "src/modules/publish/PublishConfirmationDialog.vue",
  "src/modules/content/WelcomeContentPage.vue",
  "src/modules/content/HomeCarouselPage.vue",
  "src/modules/content/SharedDetailPage.vue",
  "src/modules/content/adminContentApi.js",
  "src/modules/activities/ActivityManagementPage.vue",
  "src/modules/activities/ActivityRegistrationsPage.vue",
  "src/modules/activities/adminActivityApi.js",
  "src/modules/health/InitializationPage.vue",
  "src/modules/health/ScaleManagementPage.vue",
  "src/modules/health/RecommendationRulesPage.vue",
  "src/modules/health/LifestyleAdvicePage.vue",
  "src/modules/health/adminHealthApi.js",
  "src/modules/users/UserQueryPage.vue",
  "src/modules/users/adminUserQueryApi.js",
  "src/modules/audit/OperationAuditPage.vue",
  "src/modules/audit/adminAuditApi.js",
  "src/styles/theme.css",
];

for (const file of requiredFiles) {
  assert.equal(fs.existsSync(path.join(root, file)), true, `${file} must exist`);
}

const removedFiles = [
  "src/modules/activities/ActivityWorkbench.vue",
  "src/modules/config/ConfigWorkbench.vue",
  "src/modules/config/adminConfigApi.js",
  "src/modules/adapters/AdapterRunPage.vue",
  "src/modules/adapters/adminAdapterApi.js",
  "src/modules/analytics/OperationalAnalytics.vue",
  "src/modules/analytics/adminAnalyticsApi.js",
  "src/modules/users/UserLifecycle.vue",
  "src/modules/users/adminLifecycleApi.js",
];
for (const file of removedFiles) {
  assert.equal(fs.existsSync(path.join(root, file)), false, `${file} must stay removed`);
}

const pkg = JSON.parse(read("package.json"));
assert.equal(pkg.dependencies.vue.startsWith("^3"), true);
assert.equal(pkg.dependencies["element-plus"].startsWith("^2"), true);
assert.equal(pkg.scripts.check.includes("scripts/validate.js"), true);

const app = read("src/App.vue");
const main = read("src/main.js");
assert.equal(main.includes("import ElementPlus from"), false, "Admin must not register all Element Plus components");
for (const file of sourceFiles(path.join(root, "src"))) {
  assert.equal(fs.readFileSync(file, "utf8").includes('from "element-plus"'), false, `${path.relative(root, file)} must use a direct Element Plus import`);
}
for (const component of ["ElTable", "ElForm", "ElDialog", "ElLoading"]) {
  assert.equal(main.includes(component), true, `Admin must explicitly register ${component}`);
}
for (const value of [
  "defineAsyncComponent",
  "loadHomeCarouselPage",
  "requestIdleCallback",
  "scheduleHomeCarouselPreload",
  "发布工作台",
  "内容运营",
  "活动运营",
  "健康运营",
  "用户查询",
  "操作审计",
  "UserQueryPage",
  "ActivityManagementPage",
  "ActivityRegistrationsPage",
  "InitializationPage",
  "ScaleManagementPage",
  "RecommendationRulesPage",
  "LifestyleAdvicePage",
  "ReleaseWorkbench",
  "WelcomeContentPage",
  "HomeCarouselPage",
  "SharedDetailPage",
  "OperationAuditPage",
]) assert.equal(app.includes(value), true, `App must include ${value}`);
for (const value of [
  "ConfigWorkbench",
  "UserLifecycle",
  "AdapterRunPage",
  "OperationalAnalytics",
  "运营配置",
  "用户生命周期",
  "Adapter 运行",
  "运营数据",
]) assert.equal(app.includes(value), false, `App must not expose ${value}`);

const releasePage = read("src/modules/release/ReleaseWorkbench.vue");
const publishDialog = read("src/modules/publish/PublishConfirmationDialog.vue");
const releaseApi = read("src/modules/release/adminReleaseApi.js");
for (const value of [
  "未发布修改",
  "发布阻断",
  "未来 7 天定时上线",
  "草稿",
  "系统校验",
  "小程序预览",
  "二次确认并发布",
  "outcomeUnknown",
]) assert.equal(releasePage.includes(value), true, `release workbench must include ${value}`);
for (const value of ["确认发布内容版本", "不代表代码部署、微信审核、正式发布或流量切换", "previewConfirmed", "canConfirm"]) {
  assert.equal(publishDialog.includes(value), true, `publish confirmation must include ${value}`);
}
for (const value of [
  "外部动作 Adapter 校准",
  "生产证据收口",
  "发布证据包",
  "发布签字",
  "身份探针",
  "运营 Gate",
]) assert.equal(releasePage.includes(value), false, `release workbench must not expose ${value}`);
assert.equal(releaseApi.includes("/api/v1/admin/content-release/publish"), true);

const welcomePage = read("src/modules/content/WelcomeContentPage.vue");
const carouselPage = read("src/modules/content/HomeCarouselPage.vue");
const detailPage = read("src/modules/content/SharedDetailPage.vue");
const contentApi = read("src/modules/content/adminContentApi.js");
for (const value of ["[emptyScreen(1), emptyScreen(2)]", "不支持新增第三屏", "600KB", "安全区", "保存草稿"]) {
  assert.equal(welcomePage.includes(value), true, `welcome content must include ${value}`);
}
for (const value of ["搜索内部名称或展示文案", "关联共用详情", "2 行", "3 行", "600KB", "500KB", "安全区", "AbortController", "300", "contentReady", "requestAnimationFrame", "initialLoadFrame"]) {
  assert.equal(carouselPage.includes(value), true, `home carousel must include ${value}`);
}
for (const value of [
  "MINIPROGRAM_PAGE",
  "ROOT_MEMBER_CENTER",
  "WEBVIEW_ALLOWLIST",
  "热点只负责内容跳转",
  "安全区",
  "AbortController",
  "startHotspot",
  "validationStatus !== \"PASS\"",
]) assert.equal(detailPage.includes(value), true, `shared detail must include ${value}`);
for (const [name, source] of [["welcome", welcomePage], ["home carousel", carouselPage], ["shared detail", detailPage]]) {
  assert.equal(source.includes("expectedRevision"), true, `${name} editor must preserve optimistic concurrency revision`);
  assert.equal(source.includes("error.status === 409"), true, `${name} editor must show revision conflicts`);
}
for (const value of ["script", "style", "javascript:"]) {
  assert.equal(contentApi.includes(value), false, `content Interface must not expose arbitrary ${value}`);
}
for (const route of [
  "/api/v1/admin/content/welcome",
  "/api/v1/admin/content/home-carousel",
  "/api/v1/admin/content/shared-details",
  "/api/v1/admin/content/targets/validate",
  "/api/v1/admin/content/assets",
]) assert.equal(contentApi.includes(route), true, `content Interface must include ${route}`);

const access = read("src/modules/access.js");
for (const capability of [
  "ADMIN_READ",
  "AUDIT_READ",
  "ACTIVITY_CONTENT_WRITE",
  "ACTIVITY_PUBLISH",
  "ACTIVITY_SESSION_CONTROL",
  "ACTIVITY_ENROLLMENT_REVIEW",
]) assert.equal(access.includes(capability), true, `access must include ${capability}`);
for (const capability of [
  "CONFIG_WRITE",
  "REVIEW_RESOLVE",
  "REWARD_DELIVERY_WRITE",
  "SETTLEMENT_EXECUTE",
  "DATA_EXPORT_APPROVE",
]) assert.equal(access.includes(capability), false, `access must remove ${capability}`);

const client = read("src/api/client.js");
for (const value of ["ROOT_ADMIN_TOKEN", "sessionStorage", "outcomeUnknown", "postAdminRead", "postAdminForm", "ADMIN_ABORTED", "readOnly: true", "MAX_CONCURRENT_ADMIN_READS", "ADMIN_READ_TIMEOUT_MS", "ADMIN_WRITE_TIMEOUT_MS"]) {
  assert.equal(client.includes(value), true, `admin request module must include ${value}`);
}

const activityApi = read("src/modules/activities/adminActivityApi.js");
const activityPage = read("src/modules/activities/ActivityManagementPage.vue");
const registrationsPage = read("src/modules/activities/ActivityRegistrationsPage.vue");
for (const route of [
  "/api/v1/admin/activities",
  "/api/v1/admin/activity-sessions",
  "/api/v1/admin/formal-activities/draft",
  "/api/v1/admin/activity-enrollments/query",
  "/api/v1/admin/activity-enrollments/export",
]) assert.equal(activityApi.includes(route), true, `activity query module must include ${route}`);
assert.equal(activityApi.includes("adminRequest(`/api/v1/admin/formal-activities"), false, "activity reads must not call the retired formal-activities route");
assert.equal(activityApi.includes("postAdminRead"), true, "activity phone search must avoid URL query logging");
for (const value of ["活动主视觉", "180KB", "报名规则", "发布共用详情", "报名时段", "AbortController"]) {
  assert.equal(activityPage.includes(value), true, `activity management must include ${value}`);
}
for (const value of ["手机号", "默认脱敏", "不显示会员资产或健康答案", "查看状态审计", "导出当前名单", "AbortController"]) {
  assert.equal(registrationsPage.includes(value), true, `activity registrations must include ${value}`);
}

const healthApi = read("src/modules/health/adminHealthApi.js");
const initializationPage = read("src/modules/health/InitializationPage.vue");
const scalePage = read("src/modules/health/ScaleManagementPage.vue");
const recommendationPage = read("src/modules/health/RecommendationRulesPage.vue");
const lifestylePage = read("src/modules/health/LifestyleAdvicePage.vue");
for (const route of [
  "/api/v1/admin/formal-health/initialization",
  "/api/v1/admin/formal-health/initialization/draft",
  "/api/v1/admin/formal-health/initialization/publish",
  "/api/v1/admin/formal-health/scales",
  "/api/v1/admin/formal-health/scales/draft",
  "/api/v1/admin/formal-health/scales/publish",
  "/api/v1/admin/formal-health/recommendation-rules",
  "/api/v1/admin/formal-health/recommendation-rules/draft",
  "/api/v1/admin/formal-health/recommendation-rules/publish",
  "/api/v1/admin/formal-health/lifestyle-advice",
  "/api/v1/admin/formal-health/lifestyle-advice/draft",
  "/api/v1/admin/formal-health/lifestyle-advice/publish",
]) assert.equal(healthApi.includes(route), true, `health Interface must include ${route}`);
for (const value of ["12 问", "安全分流", "固定指引版本", "联合签署", "发布当前草稿", "expectedRevision", "AbortController", "300"]) {
  assert.equal(initializationPage.includes(value), true, `initialization page must include ${value}`);
}
for (const value of ["题目与选项", "计分与结果分层", "适用与版本", "建议内容版本", "确认发布", "expectedRevision", "100", "20 题", "AbortController"]) {
  assert.equal(scalePage.includes(value), true, `scale page must include ${value}`);
}
for (const value of ["主分类", "辅助标签", "不使用手机号、昵称或原始健康答案", "最多 3", "已发布且有效", "确认发布", "expectedRevision", "AbortController"]) {
  assert.equal(recommendationPage.includes(value), true, `recommendation page must include ${value}`);
}
for (const value of ["建议生成方式", "不接入模型", "匹配依据", "固定三条", "固定建议内容", "健康安全", "确认发布", "expectedRevision", "AbortController"]) {
  assert.equal(lifestylePage.includes(value), true, `lifestyle page must include ${value}`);
}
for (const [name, source] of [["initialization", initializationPage], ["scale", scalePage], ["recommendation", recommendationPage], ["lifestyle", lifestylePage]]) {
  assert.equal(source.includes("error.status === 409"), true, `${name} editor must show revision conflicts`);
}
for (const forbidden of ["apiKey", "apiSecret", "modelSecret", "type=\"password\""]) {
  assert.equal(lifestylePage.includes(forbidden), false, `lifestyle page must not expose ${forbidden}`);
}

const userApi = read("src/modules/users/adminUserQueryApi.js");
const userPage = read("src/modules/users/UserQueryPage.vue");
assert.equal(userApi.includes("postAdminRead"), true);
assert.equal(userApi.includes("/api/v1/admin/formal-users/query"), true);
assert.equal(userPage.includes("^1\\d{10}$"), true);
for (const value of ["maskedPhone", "rootUserId", "profileComplete", "accountStatus"]) {
  assert.equal(userPage.includes(value), true, `user query must show ${value}`);
}
for (const value of ["task", "reward", "settlement", "birthDate", "gender"]) {
  assert.equal(userPage.includes(value), false, `user query must not include legacy/private field ${value}`);
}

const auditPage = read("src/modules/audit/OperationAuditPage.vue");
for (const value of ["BATCH_SETTLEMENT_EXECUTE", "REWARD_DELIVERY_BATCH_EXECUTE", "PUBLISH_CAMPAIGN_RULE_VERSION"]) {
  assert.equal(auditPage.includes(value), false, `audit filters must not prescribe ${value}`);
}
for (const value of ["pageSize: 20", "AbortController", "300", "request_id", "outcome_unknown", "selectedLog.summary", "暂无审计记录"]) {
  assert.equal(auditPage.includes(value), true, `operation audit must include ${value}`);
}
for (const value of ["selectedLog.before", "selectedLog.after", "selectedLog.metadata"]) {
  assert.equal(auditPage.includes(value), false, `operation audit must not expose ${value}`);
}

console.log("admin validation ok");
