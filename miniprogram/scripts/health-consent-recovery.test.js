const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const healthConsentPath = require.resolve(path.join(root, "utils/health-consent.js"));
const requestPath = require.resolve(path.join(root, "utils/request.js"));
const homePath = require.resolve(path.join(root, "pages/home/index.js"));

let consentActive = false;
const navigationOptions = [];

require.cache[healthConsentPath] = {
  id: healthConsentPath,
  filename: healthConsentPath,
  loaded: true,
  exports: {
    ensureHealthConsent: async (options = {}) => {
      navigationOptions.push(options);
      return consentActive;
    },
  },
};

require.cache[requestPath] = {
  id: requestPath,
  filename: requestPath,
  loaded: true,
  exports: {
    clearToken() {},
    getToken() { return "test-token"; },
    request: async ({ url }) => {
      assert.equal(url, "/api/v1/user/state");
      return { user: { state: "UNREGISTERED" }, flowView: "", homeView: null };
    },
    setToken() {},
    stringifyError(value) { return String(value || ""); },
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
    setData(patch) { Object.assign(this.data, patch); },
  };
}

async function run() {
  const page = createPage();
  page.onLoad();

  await page.refresh();
  assert.equal(page.data.viewType, "healthConsent");
  assert.equal(navigationOptions[0].navigate, true);

  await page.refresh();
  assert.equal(page.data.viewType, "healthConsent");
  assert.equal(navigationOptions[1].navigate, false);

  consentActive = true;
  await page.refresh();
  assert.equal(page.data.viewType, "register");
  assert.equal(navigationOptions[2].navigate, false);

  console.log("health consent recovery scenarios: 3/3 PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
