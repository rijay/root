# v1 Route Registry Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a non-runtime v1.0.0 Route Registry contract and deterministic validator that proves every canonical route, v1 fallback, legacy fallback, parameter allowlist and redirect override before any v1 page or production behavior is enabled.

**Architecture:** A versioned JSON document is the sole source for route facts. A deep Route Registry Module loads, expands and validates that source through one Interface, while a CLI Adapter and Node test Adapter exercise the same Interface. This first slice intentionally does not change `app.json`, client navigation, backend responses, feature flags, persistence, cloud configuration or production traffic.

**Tech Stack:** Node.js 20 CommonJS, `node:test`, JSON, SHA-256 from `node:crypto`, existing npm verification harness.

---

## File map

- Create `contracts/route-registry/v1.0.0-draft.8.json`: canonical source document containing the 47 PRD core rows, three class defaults, complete legacy fallback projection, three legacy redirect overrides, and the frozen v0.5.13 route snapshot.
- Create `scripts/lib/route-registry.js`: Route Registry Module with load, expansion, validation, stable serialization and digest behavior behind one Interface.
- Create `scripts/route-registry-v1.test.js`: PRD table alignment, positive and mutation tests for schema, route graph, legacy compatibility, redirect safety and digest determinism.
- Create `scripts/validate-v1-route-registry.js`: read-only CLI Adapter that prints the validated contract summary and exits non-zero on any violation.
- Modify `package.json`: expose `v1:routes:check`.
- Modify `scripts/final-verification.js`: include the contract check in the existing local verification report.
- Create `docs/v1.0.0_technical_review_2026-07-15.md`: evidence-backed technical review, scorecard, Gate decision and implementation record.

### Task 1: Lock the source contract and write failing tests

**Files:**
- Create: `contracts/route-registry/v1.0.0-draft.8.json`
- Create: `scripts/route-registry-v1.test.js`

- [x] **Step 1: Add the complete source document**

Transcribe all 47 core records from PRD section 7.5. Store `resourceOwnerModules`, `parameterAllowlist`, and `acceptanceCriteriaIds` as arrays. Store class-derived fields only in `classDefaults`, and store the frozen legacy snapshot as the 27 sorted paths plus SHA-256 `41cf898a7c9e201767b214c8b7251cfa9bcf8b1bb43c3c57b26524d5454aede8`.

- [x] **Step 2: Write positive contract tests**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadAndValidateRegistry } = require("./lib/route-registry");

const sourcePath = path.resolve(__dirname, "../contracts/route-registry/v1.0.0-draft.8.json");
const appJsonPath = path.resolve(__dirname, "../miniprogram/app.json");

test("v1 route registry expands 47 complete logical records", () => {
  const result = loadAndValidateRegistry(sourcePath, { appJsonPath });
  assert.equal(result.routes.length, 47);
  assert.equal(result.fieldNames.length, 15);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
});
```

- [x] **Step 3: Write mutation tests**

Compare route ID/path/fallback/class against the complete PRD 7.5 table. Then use deep-cloned source objects and assert that validation rejects: a duplicate `routeId`, an unknown class, a missing allowlist, an undeclared fallback, a fallback cycle, a legacy target outside the frozen app route snapshot, a missing redirect override, an override with `writeReplay !== "DENY"`, and a changed legacy snapshot digest.

- [x] **Step 4: Run the test and verify it fails**

Run: `node --test scripts/route-registry-v1.test.js`

Expected: FAIL because `scripts/lib/route-registry.js` does not exist.

### Task 2: Implement the Route Registry Module

**Files:**
- Create: `scripts/lib/route-registry.js`
- Test: `scripts/route-registry-v1.test.js`

- [x] **Step 1: Define the Interface and invariants**

```js
const FIELD_NAMES = Object.freeze([
  "routeId", "canonicalPath", "pageOwnerModule", "resourceOwnerModules", "isTab",
  "accessRule", "parameterAllowlist", "fallbackRouteId", "legacyFallbackRouteId",
  "legacyAdapter", "minAppVersion", "introducedVersion", "deprecatedAfter",
  "uedScreenId", "acceptanceCriteriaIds",
]);

function validateRegistryDocument(document, options = {}) {}
function loadAndValidateRegistry(sourcePath, options = {}) {}

module.exports = { FIELD_NAMES, loadAndValidateRegistry, validateRegistryDocument };
```

- [x] **Step 2: Implement deterministic expansion**

Join every core record to exactly one known class default, exactly one legacy fallback and, only for `LEGACY_REDIRECT`, exactly one override. Return exactly the 15 `FIELD_NAMES`; keep class and override metadata outside the expanded logical route.

- [x] **Step 3: Implement graph and compatibility validation**

Reject unknown fallback route IDs, allow same-route and `SELF` terminal references, reject every other cycle, resolve each legacy fallback to a canonical path, and prove that path exists in the frozen v0.5.13 snapshot and the current `miniprogram/app.json` snapshot.

- [x] **Step 4: Implement safety validation**

Reject duplicate or empty parameters, absolute URLs, query strings embedded in canonical paths, missing owner Modules, non-array resource owners, redirect overrides that can replay writes or retain unknown parameters, and any source route count other than 47.

- [x] **Step 5: Implement stable digest**

Sort object keys recursively while preserving declared array order, serialize the expanded records plus registry metadata, and calculate SHA-256. Repeated loads of the same source must return the same digest.

- [x] **Step 6: Run the focused tests**

Run: `node --test scripts/route-registry-v1.test.js`

Expected: all Route Registry tests PASS.

### Task 3: Add the read-only CLI Adapter and verification integration

**Files:**
- Create: `scripts/validate-v1-route-registry.js`
- Modify: `package.json`
- Modify: `scripts/final-verification.js`

- [x] **Step 1: Add CLI output**

```js
const path = require("node:path");
const { loadAndValidateRegistry } = require("./lib/route-registry");

const projectRoot = path.resolve(__dirname, "..");
const result = loadAndValidateRegistry(
  path.join(projectRoot, "contracts/route-registry/v1.0.0-draft.8.json"),
  { appJsonPath: path.join(projectRoot, "miniprogram/app.json") },
);

process.stdout.write(`${JSON.stringify({
  status: "PASS",
  registryVersion: result.registryVersion,
  routeCount: result.routes.length,
  legacyRouteCount: result.legacyRegisteredPaths.length,
  digest: result.digest,
}, null, 2)}\n`);
```

- [x] **Step 2: Add npm command**

Add `"v1:routes:check": "node --test scripts/route-registry-v1.test.js && node scripts/validate-v1-route-registry.js"` to root `package.json`.

- [x] **Step 3: Add one verification result**

Insert `runCommand("v1 Route Registry contract", "npm", ["run", "v1:routes:check"])` into `runFinalVerification()` before the release manifest check.

- [x] **Step 4: Run focused and full verification**

Run: `npm run v1:routes:check`

Expected: tests PASS and CLI prints `routeCount: 47`, `legacyRouteCount: 27`, and a 64-character digest.

Run: `npm run verify`

Expected: 17/17 checks PASS with no network write, deployment or production mutation.

### Task 4: Record the technical decision and adversarial review

**Files:**
- Create: `docs/v1.0.0_technical_review_2026-07-15.md`

- [x] **Step 1: Document sources and missing evidence**

List the exact PRD, Design, structure review, Gate decision, Git baseline, package manifests, runtime route code, store/migrations, tests and release scripts read. Explicitly state that unsigned baseline, health content approvals, production privacy evidence, real activity operations, subscription delivery proof and nested mini-program Git provenance remain open.

- [x] **Step 2: Publish the nine-category maturity scorecard**

Give 0–4 ratings with file-and-line evidence for arithmetic, auditing, access control, complexity, centralized operations risk, documentation, ordering/concurrency, low-level manipulation and testing/verification. Distinguish “not applicable but checked” from “satisfactory.”

- [x] **Step 3: Decide the Gate**

Record `FOUNDATION_BOOTSTRAP_STARTED` for this non-runtime contract slice, while keeping formal M1 `NO-GO / BASELINE_SIGNOFF_PENDING` and all production/health/runtime Gates open. Do not change the app version from `0.5.13` and do not claim v1 candidate status.

- [x] **Step 4: Attack the result**

Test the five most likely failures: prose/JSON drift, old-client unsafe path, digest instability, accidental runtime activation, and inherited dirty Git state. Add the correction or containment for each.

- [x] **Step 5: Preserve branch for review**

Do not stage or commit the pre-existing PRD/UED changes. Report the dedicated branch and exact changed-file set so the user can choose integration after review.

## Self-review

- Spec coverage: this plan starts only V1-T03’s contract layer and the cross-cutting verification seam; it does not claim V1-T01, V1-T02 or V1-T04–T06 are closed.
- Placeholder scan: no `TBD`, `TODO`, “similar to,” or unspecified error-handling steps are present.
- Type consistency: all tasks use `routeId`, `canonicalPath`, `resourceOwnerModules`, `legacyFallbackRouteId`, `registryVersion`, `routes`, `legacyRegisteredPaths`, and `digest` consistently.
- Runtime safety: no step edits `miniprogram/app.json`, `backend/src/domain.js`, cloud configuration, database schema, production records or external Adapter credentials.
