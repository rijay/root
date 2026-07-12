const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertMysqlPrivilegePolicy,
  evaluateMysqlGrantRows,
  shouldEnforceMysqlPrivilegePolicy,
} = require("../src/mysqlPrivilegePolicy");

function row(statement) {
  return { "Grants for myroot_app@%": statement };
}

test("MySQL privilege policy accepts only the required schema-scoped grants", () => {
  const status = evaluateMysqlGrantRows([
    row("GRANT USAGE ON *.* TO `myroot_app_v2`@`%`"),
    row("GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER ON `myroot-prod-d5gl3gzg7115f149a`.* TO `myroot_app_v2`@`%`"),
  ], { database: "myroot-prod-d5gl3gzg7115f149a" });

  assert.equal(status.ready, true);
  assert.equal(status.scope, "SCHEMA");
  assert.equal(status.globalPrivilegeCount, 0);
  assert.deepEqual(status.missingPrivileges, []);
});

test("MySQL privilege policy rejects global data grants and grant option", () => {
  const status = evaluateMysqlGrantRows([
    row("GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER ON *.* TO `myroot_app`@`%` WITH GRANT OPTION"),
  ], { database: "myroot-prod-d5gl3gzg7115f149a" });

  assert.equal(status.ready, false);
  assert.equal(status.scope, "GLOBAL");
  assert.equal(status.grantOption, true);
  assert.ok(status.globalPrivilegeCount > 0);
  assert.throws(
    () => assertMysqlPrivilegePolicy({ ...status, enforced: true }),
    (error) => error.code === "MYSQL_PRIVILEGE_POLICY_BLOCKED" && !JSON.stringify(error.detail).includes("myroot_app")
  );
});

test("MySQL privilege policy rejects grants on any additional schema or object", () => {
  const status = evaluateMysqlGrantRows([
    row("GRANT USAGE ON *.* TO `myroot_app_v2`@`%`"),
    row("GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER ON `myroot-prod-d5gl3gzg7115f149a`.* TO `myroot_app_v2`@`%`"),
    row("GRANT SELECT ON `analytics`.* TO `myroot_app_v2`@`%`"),
    row("GRANT UPDATE ON `operations`.`manual_review` TO `myroot_app_v2`@`%`"),
  ], { database: "myroot-prod-d5gl3gzg7115f149a" });

  assert.equal(status.ready, false);
  assert.equal(status.scope, "SCHEMA");
  assert.equal(status.unexpectedScopeCount, 2);
  assert.ok(status.issues.includes("UNEXPECTED_SCHEMA_SCOPES:2"));
});

test("MySQL privilege policy is mandatory in production", () => {
  assert.equal(shouldEnforceMysqlPrivilegePolicy({ NODE_ENV: "production" }), true);
  assert.equal(shouldEnforceMysqlPrivilegePolicy({ NODE_ENV: "test" }), false);
  assert.equal(shouldEnforceMysqlPrivilegePolicy({ NODE_ENV: "test", ROOT_ENFORCE_MYSQL_LEAST_PRIVILEGE: "true" }), true);
});
