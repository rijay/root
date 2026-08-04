const FIXTURE_VERSION = "ADMIN_PERFORMANCE_R0";
const FIXTURE_COUNTS = Object.freeze({
  users: 10000,
  activityEnrollments: 5000,
  auditLogs: 20000,
  contentVersions: 1000,
  scaleQuestions: 100,
});

function rows(count, create) {
  return Array.from({ length: count }, (_, index) => create(index + 1));
}

function createAdminPerformanceFixture() {
  return {
    fixtureVersion: FIXTURE_VERSION,
    users: rows(FIXTURE_COUNTS.users, (number) => ({
      root_user_id: `perf-user-${String(number).padStart(5, "0")}`,
      phone: `139${String(number).padStart(8, "0")}`,
    })),
    activityEnrollments: rows(FIXTURE_COUNTS.activityEnrollments, (number) => ({
      activity_enrollment_id: `perf-enrollment-${String(number).padStart(5, "0")}`,
      status: number % 2 ? "CONFIRMED" : "PENDING",
    })),
    auditLogs: rows(FIXTURE_COUNTS.auditLogs, (number) => ({
      audit_log_id: `perf-audit-${String(number).padStart(5, "0")}`,
      action: "PERFORMANCE_FIXTURE",
      created_at: "2026-08-04T00:00:00.000Z",
    })),
    contentVersions: rows(FIXTURE_COUNTS.contentVersions, (number) => ({
      versionId: `perf-content-${String(number).padStart(4, "0")}`,
      version: number,
      status: number % 5 ? "PUBLISHED" : "DRAFT",
    })),
    scaleQuestions: rows(FIXTURE_COUNTS.scaleQuestions, (number) => ({
      id: `perf-scale-question-${String(number).padStart(3, "0")}`,
      type: "single",
      required: true,
      options: [{ id: "a", score: 0 }, { id: "b", score: 1 }],
    })),
  };
}

module.exports = Object.freeze({
  FIXTURE_COUNTS,
  FIXTURE_VERSION,
  createAdminPerformanceFixture,
});
