const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const healthConsentPath = require.resolve(path.join(root, "utils/health-consent.js"));
const requestPath = require.resolve(path.join(root, "utils/request.js"));
const homePath = require.resolve(path.join(root, "pages/home/index.js"));

const requests = [];
let storedToken = "";

require.cache[healthConsentPath] = {
  id: healthConsentPath,
  filename: healthConsentPath,
  loaded: true,
  exports: { ensureHealthConsent: async () => true },
};

require.cache[requestPath] = {
  id: requestPath,
  filename: requestPath,
  loaded: true,
  exports: {
    clearToken() { storedToken = ""; },
    getToken() { return storedToken; },
    async request(options) {
      requests.push(options);
      if (options.url === "/api/v1/auth/login") {
        return { token: "verified-token", nextRoute: "/pages/home/index" };
      }
      if (options.url === "/api/v1/user/state") {
        return { user: { state: "UNREGISTERED" }, flowView: "", homeView: null };
      }
      throw new Error(`unexpected request: ${options.url}`);
    },
    setToken(token) { storedToken = token; },
    stringifyError(value) { return value && value.message ? value.message : String(value || ""); },
  },
};

let agreementModal = null;
global.wx = {
  showModal(options) {
    agreementModal = options;
    options.success({ confirm: true });
  },
  login(options) {
    options.success({ code: "reviewer-login-code" });
  },
};

let pageDefinition;
global.Page = (definition) => { pageDefinition = definition; };
require(homePath);
delete global.Page;

function createPage() {
  return {
    ...pageDefinition,
    data: JSON.parse(JSON.stringify(pageDefinition.data)),
    dataHistory: [],
    setData(patch) {
      this.dataHistory.push({ ...patch });
      Object.assign(this.data, patch);
    },
  };
}

async function run() {
  const page = createPage();
  await page.loginWithWechat();

  assert.equal(agreementModal.title, "登录 ROOT");
  assert.equal(agreementModal.confirmText, "同意并进入");
  assert.equal(page.data.agreed, true);
  assert.equal(storedToken, "verified-token");
  assert.deepEqual(requests.map(({ url }) => url), [
    "/api/v1/auth/login",
    "/api/v1/user/state",
  ]);
  assert.equal(requests[0].data.wxCode, "reviewer-login-code");
  assert.equal(page.data.viewType, "register");
  assert.equal(page.data.loading, false);
  assert.ok(page.dataHistory.some(({ loginStatusText }) => loginStatusText === "正在验证会员身份…"));
  assert.ok(page.dataHistory.some(({ loginStatusText }) => loginStatusText === "身份验证完成，正在加载首页…"));

  delete global.wx;
  console.log("home login interaction scenario: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
