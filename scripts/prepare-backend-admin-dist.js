#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { version: adminReleaseVersion } = require("../admin/package.json");

const ADMIN_BUILD_MANIFEST_FILENAME = "admin-build-manifest.json";
const REQUIRED_ADMIN_MODULES = Object.freeze([
  { key: "release", label: "发布工作台", file: "modules/release/ReleaseWorkbench.vue" },
  { key: "welcome", label: "欢迎页", file: "modules/content/WelcomeContentPage.vue" },
  { key: "home", label: "首页轮播", file: "modules/content/HomeCarouselPage.vue" },
  { key: "details", label: "共用详情", file: "modules/content/SharedDetailPage.vue" },
  { key: "activities", label: "活动管理", file: "modules/activities/ActivityManagementPage.vue" },
  { key: "registrations", label: "报名记录", file: "modules/activities/ActivityRegistrationsPage.vue" },
  { key: "profile", label: "初始化建档", file: "modules/health/InitializationPage.vue" },
  { key: "scales", label: "量表管理", file: "modules/health/ScaleManagementPage.vue" },
  { key: "recommendations", label: "推荐规则", file: "modules/health/RecommendationRulesPage.vue" },
  { key: "lifestyle", label: "生活方式建议", file: "modules/health/LifestyleAdvicePage.vue" },
  { key: "users", label: "用户查询", file: "modules/users/UserQueryPage.vue" },
  { key: "audit", label: "操作审计", file: "modules/audit/AuditLogPage.vue" },
]);

const projectRoot = path.resolve(__dirname, "..");
const defaultSourceDir = path.join(projectRoot, "admin", "dist");
const defaultTargetDir = path.join(projectRoot, "backend", "public", "admin-dist");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    sourceDir: defaultSourceDir,
    targetDir: defaultTargetDir,
    clean: false,
    check: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") options.sourceDir = path.resolve(argv[++index]);
    else if (arg === "--target") options.targetDir = path.resolve(argv[++index]);
    else if (arg === "--clean") options.clean = true;
    else if (arg === "--check") options.check = true;
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function listRelativeFiles(dir, prefix = "") {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(prefix, entry.name);
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listRelativeFiles(fullPath, relativePath));
    else files.push(relativePath);
  }
  return files.sort();
}

function validateAdminDist(dir) {
  const indexPath = path.join(dir, "index.html");
  const assetDir = path.join(dir, "assets");
  const files = listRelativeFiles(dir);
  const assets = files.filter((file) => file.startsWith(`assets${path.sep}`) || file.startsWith("assets/"));
  const jsAssets = assets.filter((file) => file.endsWith(".js"));
  const cssAssets = assets.filter((file) => file.endsWith(".css"));
  const indexHtml = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
  const ready = Boolean(
    fs.existsSync(indexPath) &&
      fs.existsSync(assetDir) &&
      jsAssets.length > 0 &&
      indexHtml.includes("/admin/assets/")
  );
  return {
    dir: path.resolve(dir),
    ready,
    indexPath,
    indexExists: fs.existsSync(indexPath),
    assetCount: assets.length,
    jsAssetCount: jsAssets.length,
    cssAssetCount: cssAssets.length,
    usesAdminBase: indexHtml.includes("/admin/assets/"),
    files,
  };
}

function prepareBackendAdminDist(options = {}) {
  const sourceDir = path.resolve(options.sourceDir || defaultSourceDir);
  const targetDir = path.resolve(options.targetDir || defaultTargetDir);
  const source = validateAdminDist(sourceDir);
  if (!source.ready) {
    const message = `Admin dist is not ready at ${sourceDir}. Run: npm run build --prefix admin`;
    const error = new Error(message);
    error.summary = { source, target: validateAdminDist(targetDir), copied: false };
    throw error;
  }

  if (!options.check) {
    if (options.clean && fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(sourceDir, targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, ADMIN_BUILD_MANIFEST_FILENAME), `${JSON.stringify({
      schemaVersion: 1,
      releaseVersion: adminReleaseVersion,
      modules: REQUIRED_ADMIN_MODULES.map(({ key, label, file }) => ({ key, label, file })),
    }, null, 2)}\n`);
  }

  const target = validateAdminDist(targetDir);
  if (!target.ready) {
    const message = options.check
      ? `Bundled backend admin dist is not ready at ${targetDir}. Run: npm run deploy:prepare-admin`
      : `Failed to prepare backend admin dist at ${targetDir}`;
    const error = new Error(message);
    error.summary = { source, target, copied: !options.check };
    throw error;
  }

  return {
    source,
    target,
    copied: !options.check,
  };
}

function main() {
  const options = parseArgs();
  try {
    const summary = prepareBackendAdminDist(options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      return;
    }
    process.stdout.write(`Admin dist ready for backend deploy: ${summary.target.dir}\n`);
    process.stdout.write(`Files: ${summary.target.files.length}, JS assets: ${summary.target.jsAssetCount}\n`);
  } catch (error) {
    if (options.json && error.summary) {
      process.stdout.write(`${JSON.stringify(error.summary, null, 2)}\n`);
    }
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  defaultSourceDir,
  defaultTargetDir,
  parseArgs,
  prepareBackendAdminDist,
  validateAdminDist,
};
