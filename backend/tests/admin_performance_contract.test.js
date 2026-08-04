const test = require("node:test");
const assert = require("node:assert/strict");

const activityModule = require("../src/activityModule");
const auditLog = require("../src/auditLog");
const contentModule = require("../src/contentModule");
const formalHealthModule = require("../src/formalHealthModule");
const healthOperationsModule = require("../src/healthOperationsModule");
const { createStore } = require("../src/domain");
const {
  FIXTURE_COUNTS,
  FIXTURE_VERSION,
  createAdminPerformanceFixture,
} = require("./fixtures/adminPerformanceFixture");

const DEFAULT_PAGE_SIZE = 20;
const MAXIMUM_PAGE_SIZE = 50;

function rejectsOversizedPage(callback, code) {
  assert.throws(callback, (error) => error.code === code && error.status === 400);
}

test("fixed admin performance fixture matches the approved R0 data scale", () => {
  const fixture = createAdminPerformanceFixture();
  assert.equal(fixture.fixtureVersion, FIXTURE_VERSION);
  Object.entries(FIXTURE_COUNTS).forEach(([collection, count]) => {
    assert.equal(fixture[collection].length, count, collection);
  });
  assert.equal(fixture.users[0].root_user_id, "perf-user-00001");
  assert.equal(fixture.users.at(-1).root_user_id, "perf-user-10000");
});

test("formal admin list Modules default to 20 rows and reject more than 50", () => {
  const store = createStore();

  assert.equal(activityModule.listAdminDefinitions(store).pagination.pageSize, DEFAULT_PAGE_SIZE);
  rejectsOversizedPage(
    () => activityModule.listAdminDefinitions(store, { pageSize: MAXIMUM_PAGE_SIZE + 1 }),
    "ACTIVITY_ADMIN_QUERY_INVALID",
  );

  assert.equal(contentModule.listAdminHomeCarousel(store).pageSize, DEFAULT_PAGE_SIZE);
  rejectsOversizedPage(
    () => contentModule.listAdminHomeCarousel(store, { pageSize: MAXIMUM_PAGE_SIZE + 1 }),
    "CONTENT_QUERY_INVALID",
  );

  assert.equal(formalHealthModule.adminInitializationDefinition().pagination.pageSize, DEFAULT_PAGE_SIZE);
  rejectsOversizedPage(
    () => formalHealthModule.adminInitializationDefinition({ pageSize: MAXIMUM_PAGE_SIZE + 1 }),
    "FORMAL_HEALTH_ADMIN_QUERY_INVALID",
  );

  assert.equal(healthOperationsModule.listScales(store).pagination.pageSize, DEFAULT_PAGE_SIZE);
  rejectsOversizedPage(
    () => healthOperationsModule.listScales(store, { pageSize: MAXIMUM_PAGE_SIZE + 1 }),
    "HEALTH_CONTENT_QUERY_INVALID",
  );
});

test("audit query defaults to 20, permits 50, and rejects oversized requests", () => {
  const store = createStore();
  store.auditLogs = Array.from({ length: 60 }, (_, index) => ({
    audit_log_id: `audit-${index}`,
    action: "TEST",
    created_at: new Date(Date.UTC(2026, 7, 4, 0, index)).toISOString(),
  }));
  assert.equal(auditLog.listAuditLogs(store).length, DEFAULT_PAGE_SIZE);
  assert.equal(auditLog.listAuditLogs(store, { limit: MAXIMUM_PAGE_SIZE }).length, MAXIMUM_PAGE_SIZE);
  rejectsOversizedPage(
    () => auditLog.listAuditLogs(store, { limit: MAXIMUM_PAGE_SIZE + 1 }),
    "AUDIT_QUERY_INVALID",
  );
});
