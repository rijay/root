const assert = require("node:assert/strict");
const {
  PAGE_SIZE,
  buildEnrollmentsUrl,
  cancellationSheet,
  decorateEnrollment,
  groupEnrollments,
  mergeEnrollments,
  paginationFrom,
  rawSessionIndex,
} = require("../subpkg/activity/pages/enrollments/model");

const now = Date.parse("2026-08-15T00:00:00.000Z");
const upcomingLater = decorateEnrollment({
  enrollmentId: "enrollment_b",
  enrollmentStatus: "CONFIRMED",
  listingState: "AVAILABLE",
}, {
  sessionStartAt: "2026-08-20T00:00:00.000Z",
  sessionEndAt: "2026-08-20T02:00:00.000Z",
}, now);
const upcomingSooner = decorateEnrollment({
  enrollmentId: "enrollment_a",
  enrollmentStatus: "PENDING",
  listingState: "AVAILABLE",
}, {
  sessionStartAt: "2026-08-18T00:00:00.000Z",
  sessionEndAt: "2026-08-18T02:00:00.000Z",
}, now);
const endedOlder = decorateEnrollment({
  enrollmentId: "enrollment_c",
  enrollmentStatus: "CONFIRMED",
  listingState: "ENDED",
}, {
  sessionStartAt: "2026-07-01T00:00:00.000Z",
  sessionEndAt: "2026-07-01T02:00:00.000Z",
}, now);
const endedRecent = decorateEnrollment({
  enrollmentId: "enrollment_d",
  enrollmentStatus: "CONFIRMED",
  listingState: "ENDED",
}, {
  sessionStartAt: "2026-08-01T00:00:00.000Z",
  sessionEndAt: "2026-08-01T02:00:00.000Z",
}, now);
const canceled = decorateEnrollment({
  enrollmentId: "enrollment_e",
  enrollmentStatus: "CANCELED",
  listingState: "AVAILABLE",
}, {
  sessionStartAt: "2026-08-25T00:00:00.000Z",
  sessionEndAt: "2026-08-25T02:00:00.000Z",
}, now);

assert.equal(PAGE_SIZE, 10);
assert.equal(buildEnrollmentsUrl(2), "/api/v1/activities/enrollments?page=2&pageSize=10");
assert.deepEqual(paginationFrom({}, 1, 3), { page: 1, total: 3, hasMore: false });
assert.deepEqual(paginationFrom({ pagination: { page: 2, total: 22, hasNextPage: true } }, 2, 10), {
  page: 2,
  total: 22,
  hasMore: true,
});
assert.equal(rawSessionIndex({
  enrollments: [{ activity: { session: { sessionId: "session_001", sessionStartAt: "2026-08-01" } } }],
}).session_001.sessionStartAt, "2026-08-01");

const merged = mergeEnrollments(
  [upcomingLater, endedOlder],
  [upcomingSooner, endedRecent, canceled, { ...upcomingLater, title: "updated" }],
);
assert.deepEqual(merged.map((item) => item.enrollmentId), [
  "enrollment_a",
  "enrollment_b",
  "enrollment_d",
  "enrollment_c",
  "enrollment_e",
]);
assert.equal(merged[1].title, "updated");
const groups = groupEnrollments(merged);
assert.deepEqual(groups.map((group) => group.key), ["UPCOMING", "ENDED", "CANCELED"]);
assert.deepEqual(groups[0].items.map((item) => item.enrollmentId), ["enrollment_a", "enrollment_b"]);
assert.deepEqual(groups[1].items.map((item) => item.enrollmentId), ["enrollment_d", "enrollment_c"]);
assert.equal(cancellationSheet({ enrollmentId: "enrollment_a", title: "ROOT 线下活动" }).title, "ROOT 线下活动");

console.log("activity enrollments model tests ok");
