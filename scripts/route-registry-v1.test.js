const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FIELD_NAMES,
  FROZEN_LEGACY_MANIFEST_PATH,
  FROZEN_LEGACY_MANIFEST_SHA256,
  loadAndValidateRegistry,
  validateRegistryDocument,
} = require("./lib/route-registry");
const projectRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(projectRoot, "contracts/route-registry/v1.0.0-draft.8.json");
const appJsonPath = path.join(
  projectRoot,
  "miniprogram/fixtures/miniprogram-app-v1-pre-formal-rebuild.json",
);
const currentV1AppJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
const frozenLegacyAppJson = JSON.parse(fs.readFileSync(FROZEN_LEGACY_MANIFEST_PATH, "utf8"));
function sourceDocument() {
  return JSON.parse(fs.readFileSync(sourcePath, "utf8"));
}
function validateMutation(mutate) {
  const document = sourceDocument();
  mutate(document);
  return () => validateRegistryDocument(document, { frozenLegacyAppJson, currentV1AppJson });
}
function markdownCell(value) {
  return value.trim().replace(/^`|`$/g, "");
}
function routeRowsFromPrd() {
  const prd = fs.readFileSync(path.join(projectRoot, "docs/v1.0.0_product_requirements.md"), "utf8");
  const registrySection = prd
    .split("### 7.5 v1.0.0 Canonical Route Registry")[1]
    .split("路由类别默认值：")[0];
  return registrySection.split("\n")
    .filter((line) => /^\| `/.test(line))
    .map((line) => {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      return {
        routeId: markdownCell(cells[0]),
        canonicalPath: markdownCell(cells[1]),
        fallbackRouteId: markdownCell(cells[7]),
        class: cells[10],
      };
    });
}
test("v1 route registry expands 47 complete logical records", () => {
  const result = loadAndValidateRegistry(sourcePath, { appJsonPath });
  assert.equal(result.routes.length, 47);
  assert.deepEqual(result.fieldNames, FIELD_NAMES);
  assert.equal(result.fieldNames.length, 15);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
  result.routes.forEach((route) => {
    assert.deepEqual(Object.keys(route), FIELD_NAMES);
  });
});
test("frozen legacy manifest is byte-identical to origin/main d761ae2 app.json", () => {
  const raw = fs.readFileSync(FROZEN_LEGACY_MANIFEST_PATH);
  assert.equal(crypto.createHash("sha256").update(raw).digest("hex"), FROZEN_LEGACY_MANIFEST_SHA256);
  assert.equal(FROZEN_LEGACY_MANIFEST_SHA256, "b11bf61066a175ae1975d0ca1f206f7b470b16893794480564a0da2f50aea2de");
});
test("current v1 manifest is validated separately and preserves the full legacy path set", () => {
  const result = loadAndValidateRegistry(sourcePath, { appJsonPath });
  assert.equal(result.currentV1Manifest.manifestStatus, "PARTIAL_LOCAL_SHELL_NOT_CANDIDATE");
  assert.deepEqual(result.currentV1Manifest.tabPaths, [
    "/pages/home/index",
    "/pages/health/index",
    "/pages/activities/index",
    "/pages/tasks/index",
    "/pages/profile/index",
  ]);
  frozenLegacyAppJson.pages.forEach((pagePath) => {
    assert.ok(result.currentV1Manifest.registeredPaths.includes(`/${pagePath}`));
  });
});
test("current manifest cannot silently stand in for the frozen legacy manifest", () => {
  assert.throws(
    () => validateRegistryDocument(sourceDocument(), {
      frozenLegacyAppJson: currentV1AppJson,
      currentV1AppJson,
    }),
    /frozen legacy manifest paths do not match client 0\.5\.13/,
  );
});
test("v1 route source stays aligned with the current PRD route table", () => {
  const document = sourceDocument();
  const prdRows = routeRowsFromPrd();
  assert.equal(prdRows.length, 47);
  assert.deepEqual(
    document.routes.map(({ routeId, canonicalPath, fallbackRouteId, class: routeClass }) => ({
      routeId,
      canonicalPath,
      fallbackRouteId,
      class: routeClass,
    })),
    prdRows,
  );
});
test("v1 route registry digest and legacy projection are deterministic", () => {
  const first = loadAndValidateRegistry(sourcePath, { appJsonPath });
  const second = loadAndValidateRegistry(sourcePath, { appJsonPath });
  assert.equal(first.digest, second.digest);
  assert.equal(first.legacyRegisteredPaths.length, 27);
  assert.equal(first.legacyFallbackPaths.length, 47);
  assert.equal(new Set(first.legacyFallbackPaths).size, 27);
  first.legacyFallbackPaths.forEach((registeredPath) => {
    assert.ok(first.legacyRegisteredPaths.includes(registeredPath));
  });
});
test("v1 route registry rejects duplicate route IDs", () => {
  assert.throws(validateMutation((document) => {
    document.routes[1].routeId = document.routes[0].routeId;
  }), /duplicate routeId HOME/);
});
test("v1 route registry rejects an unknown class", () => {
  assert.throws(validateMutation((document) => {
    document.routes[0].class = "UNKNOWN";
  }), /unknown class UNKNOWN/);
});
test("v1 route registry rejects a missing parameter allowlist", () => {
  assert.throws(validateMutation((document) => {
    delete document.routes[0].parameterAllowlist;
  }), /routes\[0\] fields must be exactly/);
});
test("v1 route registry rejects an undeclared v1 fallback", () => {
  assert.throws(validateMutation((document) => {
    document.routes[0].fallbackRouteId = "NOT_A_ROUTE";
  }), /HOME fallbackRouteId references unknown route NOT_A_ROUTE/);
});
test("v1 route registry rejects cross-route fallback cycles", () => {
  assert.throws(validateMutation((document) => {
    document.routes.find((route) => route.routeId === "HOME").fallbackRouteId = "PROFILE";
  }), /fallback cycle HOME -> PROFILE -> HOME/);
});
test("v1 route registry accepts SELF as an explicit terminal", () => {
  const document = sourceDocument();
  document.routes.find((route) => route.routeId === "HOME").fallbackRouteId = "SELF";
  const result = validateRegistryDocument(document, { frozenLegacyAppJson, currentV1AppJson });
  assert.equal(result.routes.find((route) => route.routeId === "HOME").fallbackRouteId, "SELF");
});
test("v1 route registry rejects a legacy fallback outside the frozen app snapshot", () => {
  assert.throws(validateMutation((document) => {
    document.legacyFallbacks.HEALTH_HOME = "HEALTH_HOME";
  }), /HEALTH_HOME legacy fallback path \/pages\/health\/index is not registered by legacy client 0\.5\.13/);
});
test("v1 route registry requires one override for every legacy redirect", () => {
  assert.throws(validateMutation((document) => {
    delete document.legacyRedirectOverrides.LEGACY_ACTIVITY_ROUTER;
  }), /LEGACY_ACTIVITY_ROUTER requires exactly one legacy redirect override/);
});
test("v1 route registry forbids redirect write replay", () => {
  assert.throws(validateMutation((document) => {
    document.legacyRedirectOverrides.LEGACY_ACTIVITY_ROUTER.writeReplay = "ALLOW";
  }), /LEGACY_ACTIVITY_ROUTER override writeReplay must be DENY/);
});
test("v1 route registry rejects extra overrides on stable routes", () => {
  assert.throws(validateMutation((document) => {
    document.legacyRedirectOverrides.HOME = {
      overrideAdapter: "UNSAFE",
      targetRouteIds: ["HOME"],
      writeReplay: "DENY",
      unknownParams: "DROP",
    };
  }), /HOME must not declare a legacy redirect override/);
});
test("v1 route registry rejects a changed frozen snapshot digest", () => {
  assert.throws(validateMutation((document) => {
    document.legacyClient.registeredPathDigest = "0".repeat(64);
  }), /legacy registeredPathDigest does not match registeredPaths/);
});
test("v1 route registry rejects canonical URLs and embedded query strings", () => {
  assert.throws(validateMutation((document) => {
    document.routes[0].canonicalPath = "https://example.com/pages/home/index";
  }), /HOME canonicalPath must be a query-free mini-program path/);
  assert.throws(validateMutation((document) => {
    document.routes[0].canonicalPath = "/pages/home/index?source=unsafe";
  }), /HOME canonicalPath must be a query-free mini-program path/);
});
test("v1 route registry rejects duplicate and unsafe parameter names", () => {
  assert.throws(validateMutation((document) => {
    document.routes[0].parameterAllowlist = ["source", "source"];
  }), /HOME parameterAllowlist contains duplicate value source/);
  assert.throws(validateMutation((document) => {
    document.routes[0].parameterAllowlist = ["returnUrl"];
  }), /HOME parameterAllowlist contains unsafe name returnUrl/);
});
