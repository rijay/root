import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const requiredFiles = [
  "index.html",
  "package.json",
  "vite.config.js",
  "src/main.js",
  "src/App.vue",
  "src/api/client.js",
  "src/modules/access.js",
  "src/modules/release/ReleaseWorkbench.vue",
  "src/modules/content/WelcomeContentPage.vue",
  "src/modules/content/HomeCarouselPage.vue",
  "src/modules/content/SharedDetailPage.vue",
  "src/modules/content/adminContentApi.js",
  "src/modules/activities/ActivityWorkbench.vue",
  "src/modules/activities/adminActivityApi.js",
  "src/modules/users/UserQueryPage.vue",
  "src/modules/users/adminUserQueryApi.js",
  "src/modules/audit/AuditLogPage.vue",
  "src/modules/audit/adminAuditApi.js",
  "src/styles/theme.css",
];

for (const file of requiredFiles) {
  assert.equal(fs.existsSync(path.join(root, file)), true, `${file} must exist`);
}

const removedFiles = [
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
for (const value of [
  "defineAsyncComponent",
  "发布工作台",
  "内容运营",
  "活动运营",
  "健康运营",
  "用户查询",
  "操作审计",
  "UserQueryPage",
  "ActivityWorkbench",
  "ReleaseWorkbench",
  "WelcomeContentPage",
  "HomeCarouselPage",
  "SharedDetailPage",
  "AuditLogPage",
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
const releaseApi = read("src/modules/release/adminReleaseApi.js");
for (const value of [
  "未发布修改",
  "发布阻断",
  "未来 7 天定时上线",
  "草稿",
  "系统校验",
  "小程序预览",
  "二次确认并发布",
  "确认发布内容版本",
  "不代表代码部署、微信审核、正式发布或流量切换",
  "previewConfirmed",
  "outcomeUnknown",
]) assert.equal(releasePage.includes(value), true, `release workbench must include ${value}`);
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
for (const value of ["搜索内部名称或展示文案", "关联共用详情", "2 行", "3 行", "600KB", "500KB", "安全区", "AbortController", "300"]) {
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
for (const value of ["ROOT_ADMIN_TOKEN", "sessionStorage", "outcomeUnknown", "postAdminRead", "postAdminForm", "ADMIN_ABORTED", "readOnly: true"]) {
  assert.equal(client.includes(value), true, `admin request module must include ${value}`);
}

const activityApi = read("src/modules/activities/adminActivityApi.js");
const activityPage = read("src/modules/activities/ActivityWorkbench.vue");
for (const route of [
  "/api/v1/admin/activities",
  "/api/v1/admin/activities/draft",
  "/api/v1/admin/activities/submit-review",
  "/api/v1/admin/activities/publish",
  "/api/v1/admin/activity-sessions/create",
  "/api/v1/admin/activity-enrollments/review",
]) assert.equal(activityApi.includes(route), true, `activity query module must include ${route}`);
for (const value of ["idempotencyKey", "ACTIVITY_PUBLISH", "ACTIVITY_SESSION_CONTROL", "ACTIVITY_ENROLLMENT_REVIEW"]) {
  assert.equal(`${activityApi}\n${activityPage}`.includes(value), true, `activity implementation must include ${value}`);
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

const auditPage = read("src/modules/audit/AuditLogPage.vue");
for (const value of ["BATCH_SETTLEMENT_EXECUTE", "REWARD_DELIVERY_BATCH_EXECUTE", "PUBLISH_CAMPAIGN_RULE_VERSION"]) {
  assert.equal(auditPage.includes(value), false, `audit filters must not prescribe ${value}`);
}

console.log("admin validation ok");
