const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
const routes = require("../config/formal-launch-routes");

function registeredRoutes() {
  return [
    ...app.pages,
    ...(app.subPackages || []).flatMap((pkg) => pkg.pages.map((page) => `${pkg.root}/${page}`)),
  ];
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:js|json|wxml|wxss)$/.test(entry.name) ? [absolute] : [];
  });
}

assert.deepEqual(
  app.tabBar.list.map(({ pagePath, text }) => ({ pagePath, text })),
  routes.FORMAL_TABS.map(({ pagePath, text }) => ({ pagePath, text })),
  "v0.6.0 Tab 必须精确为首页、产品、健康、活动、我的",
);
assert.equal(app.tabBar.custom, true, "v0.6.0 必须使用批准的五 Tab 自定义导航");
assert.equal(app.pages[0], routes.WELCOME_ROUTE, "欢迎页必须是首次启动入口");
assert.equal(app.lazyCodeLoading, "requiredComponents");
assert.deepEqual(Object.keys(app.usingComponents || {}), [], "低频 UI 不得注册为全局依赖");

const actualRoutes = registeredRoutes();
assert.deepEqual(actualRoutes, routes.REGISTERED_FORMAL_ROUTES);
routes.FORBIDDEN_ROUTE_PREFIXES.forEach((forbidden) => {
  assert.equal(actualRoutes.some((route) => route === forbidden || route.startsWith(`${forbidden}/`)), false);
  const legacyDirectory = path.join(root, forbidden);
  const legacySources = fs.existsSync(legacyDirectory) ? sourceFiles(legacyDirectory) : [];
  assert.deepEqual(legacySources, [], `旧切片仍存在：${forbidden}`);
});

actualRoutes.forEach((route) => {
  ["js", "json", "wxml", "wxss"].forEach((extension) => {
    assert.equal(fs.existsSync(path.join(root, `${route}.${extension}`)), true, `页面文件缺失：${route}.${extension}`);
  });
});

const welcomeScript = fs.readFileSync(path.join(root, `${routes.WELCOME_ROUTE}.js`), "utf8");
assert.equal(routes.WELCOME_STORAGE_KEY, "ROOT_WELCOME_SEEN_V1");
assert.match(welcomeScript, /WELCOME_STORAGE_KEY/);
assert.doesNotMatch(welcomeScript, /fetchUserState|decideHomeRoute|health|login/i);
assert.match(welcomeScript, /\/api\/v1\/public\/content\/welcome/);

const launchingScript = fs.readFileSync(path.join(root, "pages/launching/index.js"), "utf8");
assert.match(launchingScript, /DISPLAY_MS = 1200/);
assert.match(launchingScript, /HARD_LIMIT_MS = 2000/);

const customTabScript = fs.readFileSync(path.join(root, "custom-tab-bar/index.js"), "utf8");
assert.match(customTabScript, /wx\.switchTab/);
assert.match(customTabScript, /setSelected/);

const forbiddenReference = new RegExp(routes.FORBIDDEN_ROUTE_PREFIXES
  .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|"));
const references = sourceFiles(root)
  .filter((file) => !file.includes(`${path.sep}scripts${path.sep}`))
  .filter((file) => !file.includes(`${path.sep}fixtures${path.sep}`))
  .filter((file) => !file.includes(`${path.sep}pages${path.sep}dev-identity-probe${path.sep}`))
  .filter((file) => !file.endsWith("formal-launch-scope.test.js"))
  .filter((file) => !file.endsWith("formal-launch-routes.js"))
  .filter((file) => forbiddenReference.test(fs.readFileSync(file, "utf8")));
assert.deepEqual(references, [], `正式包仍引用旧路径：${references.join(", ")}`);

console.log("formal launch scope tests ok");
