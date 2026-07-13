const { request } = require("./request");

async function joinCampaign(options = {}) {
  return request({
    url: "/api/v1/campaigns/join",
    method: "POST",
    data: { campaignId: options.campaignId || "" },
  });
}

module.exports = {
  joinCampaign,
};
