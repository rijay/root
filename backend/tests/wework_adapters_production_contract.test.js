const assert = require("node:assert/strict");
const test = require("node:test");
const { createWeworkContactImplementation } = require("../src/weworkContactAdapter");
const { createWeworkTagImplementation } = require("../src/weworkTagAdapter");
const { createWeworkContactWritebackImplementation } = require("../src/weworkContactWritebackAdapter");
const { clearWeworkAccessTokenCache } = require("../src/weworkAccessToken");

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test("official WeWork contact Adapter refreshes token, caches it, and maps nested contacts", async () => {
  clearWeworkAccessTokenCache();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/cgi-bin/gettoken")) {
      return jsonResponse({ errcode: 0, errmsg: "ok", access_token: "token-live", expires_in: 7200 });
    }
    return jsonResponse({
      errcode: 0,
      errmsg: "ok",
      external_contact_list: [{
        external_contact: {
          external_userid: "wo_root_1",
          name: "ROOT客户",
          unionid: "union_root_1",
        },
        follow_info: {
          userid: "advisor-a",
          remark: "路演客户A",
          description: "上海路演",
          remark_mobiles: ["13800000000"],
          state: "ROADSHOW_SHANGHAI",
          add_way: 1,
        },
      }],
      next_cursor: "cursor-2",
    });
  };
  const implementation = createWeworkContactImplementation({ fetchImpl });
  const env = {
    WEWORK_CORP_ID: "ww-root",
    WEWORK_CONTACT_SECRET: "secret-live",
    WEWORK_CONTACT_LIST_URL: "https://qyapi.weixin.qq.com/cgi-bin/externalcontact/batch/get_by_user",
    WEWORK_CONTACT_USERIDS: "advisor-a",
  };
  const first = await implementation({ env, cursor: "", limit: 50 });
  await implementation({ env, cursor: "cursor-2", limit: 50 });

  assert.equal(calls.filter((call) => call.url.includes("/cgi-bin/gettoken")).length, 1);
  assert.match(calls[1].url, /access_token=token-live/);
  assert.deepEqual(JSON.parse(calls[1].init.body).userid_list, ["advisor-a"]);
  assert.equal(JSON.parse(calls[1].init.body).limit, 50);
  assert.equal(first.samples[0].externalContactId, "wo_root_1");
  assert.equal(first.samples[0].userId, "union_root_1");
  assert.equal(first.samples[0].receiverPhone, "13800000000");
  assert.equal(first.samples[0].offlineEventName, "ROADSHOW_SHANGHAI");
  assert.equal(first.nextCursor, "cursor-2");
});

test("official WeWork contact Adapter rejects errcode returned with HTTP 200", async () => {
  clearWeworkAccessTokenCache();
  const implementation = createWeworkContactImplementation({
    fetchImpl: async (url) => String(url).includes("gettoken")
      ? jsonResponse({ errcode: 0, access_token: "token-live", expires_in: 7200 })
      : jsonResponse({ errcode: 60011, errmsg: "no privilege" }),
  });

  await assert.rejects(() => implementation({
    env: {
      WEWORK_CORP_ID: "ww-root-err",
      WEWORK_CONTACT_SECRET: "secret-err",
      WEWORK_CONTACT_LIST_URL: "https://qyapi.weixin.qq.com/cgi-bin/externalcontact/batch/get_by_user",
      WEWORK_CONTACT_USERIDS: "advisor-a",
    },
    limit: 10,
  }), (error) => {
    assert.equal(error.code, 60011);
    assert.match(error.message, /no privilege/);
    return true;
  });
});

test("official WeWork tag and remark Adapters emit native payloads", async () => {
  clearWeworkAccessTokenCache();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("gettoken")) return jsonResponse({ errcode: 0, access_token: "token-action", expires_in: 7200 });
    return jsonResponse({ errcode: 0, errmsg: "ok" });
  };
  const sharedEnv = {
    WEWORK_CORP_ID: "ww-root-action",
    WEWORK_CONTACT_SECRET: "secret-action",
    WEWORK_TAG_APPLY_URL: "https://qyapi.weixin.qq.com/cgi-bin/externalcontact/mark_tag",
    WEWORK_TAG_USERID: "advisor-a",
    WEWORK_CONTACT_WRITEBACK_URL: "https://qyapi.weixin.qq.com/cgi-bin/externalcontact/remark",
    WEWORK_CONTACT_WRITEBACK_USERID: "advisor-a",
  };
  const tag = createWeworkTagImplementation({ fetchImpl });
  const writeback = createWeworkContactWritebackImplementation({ fetchImpl });
  const tagResult = await tag({
    env: sharedEnv,
    grant: {
      reward_grant_id: "grant-1",
      root_user_id: "root-1",
      reward_key: "et_root_member",
      payload_json: { externalContactId: "wo_root_1" },
    },
    body: {},
  });
  const writebackResult = await writeback({
    env: sharedEnv,
    body: {
      externalContactId: "wo_root_1",
      result: "WEWORK_CONTACTED",
      note: "已完成首次咨询跟进",
    },
  });
  const actionCalls = calls.filter((call) => !call.url.includes("gettoken"));
  const tagBody = JSON.parse(actionCalls[0].init.body);
  const remarkBody = JSON.parse(actionCalls[1].init.body);

  assert.equal(tagResult.status, "DELIVERED");
  assert.deepEqual(tagBody, {
    userid: "advisor-a",
    external_userid: "wo_root_1",
    add_tag: ["et_root_member"],
    remove_tag: [],
  });
  assert.equal(writebackResult.status, "DELIVERED");
  assert.equal(remarkBody.userid, "advisor-a");
  assert.equal(remarkBody.external_userid, "wo_root_1");
  assert.equal(remarkBody.remark, "WEWORK_CONTACTED");
  assert.equal(remarkBody.description, "已完成首次咨询跟进");
});
