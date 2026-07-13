const assert = require("node:assert/strict");

const requestPath = require.resolve("../utils/request.js");
const joinPath = require.resolve("../utils/campaign-join.js");
const requestModule = require(requestPath);
const originalRequest = requestModule.request;

function loadJoinModule(request) {
  requestModule.request = request;
  delete require.cache[joinPath];
  return require(joinPath);
}

async function run() {
  let requestOptions = null;
  const expected = { created: true, campaign: { campaignId: "ROOT_7D_RESET" } };
  let join = loadJoinModule(async (options) => {
    requestOptions = options;
    return expected;
  });

  const result = await join.joinCampaign({ campaignId: "ROOT_7D_RESET" });
  assert.deepEqual(requestOptions, {
    url: "/api/v1/campaigns/join",
    method: "POST",
    data: { campaignId: "ROOT_7D_RESET" },
  });
  assert.equal(result, expected);

  join = loadJoinModule(async (options) => options.data);
  assert.deepEqual(await join.joinCampaign(), { campaignId: "" });

  console.log("campaign join scenarios: 2/2 PASS");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    requestModule.request = originalRequest;
    delete require.cache[joinPath];
  });
