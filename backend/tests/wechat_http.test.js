const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { fetchWechatJson } = require("../src/wechatHttp");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("WeChat JSON POST sends an explicit byte length instead of chunked transfer", async (t) => {
  let receivedHeaders = {};
  let receivedBody = "";
  const server = http.createServer((req, res) => {
    receivedHeaders = req.headers;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      receivedBody += chunk;
    });
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      res.end('{"errcode":0,"errmsg":"ok"}');
    });
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));
  const body = JSON.stringify({ message: "ROOT身体记录" });

  const payload = await fetchWechatJson(`${baseUrl}/cgi-bin/message/subscribe/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  assert.equal(payload.errcode, 0);
  assert.equal(receivedBody, body);
  assert.equal(receivedHeaders["content-length"], String(Buffer.byteLength(body)));
  assert.equal(receivedHeaders["transfer-encoding"], undefined);
});

test("WeChat non-JSON HTTP failures preserve only bounded sanitized diagnostics", async (t) => {
  const server = http.createServer((req, res) => {
    req.resume();
    res.statusCode = 412;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Request-Id", "wx-trace-412");
    res.end(
      `precondition failed access_token=secret-token openid=oSensitiveOpenidValue123456789 ${"diagnostic ".repeat(1000)}`
    );
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  await assert.rejects(() => fetchWechatJson(`${baseUrl}/cgi-bin/message/subscribe/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }), (error) => {
    assert.equal(error.code, 1006);
    assert.equal(error.externalHttpStatus, "412");
    assert.equal(error.externalCode, undefined);
    assert.match(error.message, /微信接口请求失败：HTTP 412/);
    assert.match(error.message, /content-type=text\/plain/);
    assert.match(error.message, /trace=wx-trace-412/);
    assert.match(error.message, /access_token=\[REDACTED\]/);
    assert.match(error.message, /openid=\[REDACTED\]/);
    assert.doesNotMatch(error.message, /secret-token|oSensitiveOpenidValue/);
    assert.ok(error.message.length <= 480);
    return true;
  });
});

test("WeChat successful HTTP with invalid JSON remains an ambiguous sanitized failure", async (t) => {
  const server = http.createServer((req, res) => {
    req.resume();
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html");
    res.end("upstream page token=secret-token-value-1234567890");
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  await assert.rejects(() => fetchWechatJson(`${baseUrl}/probe`), (error) => {
    assert.equal(error.code, 1006);
    assert.equal(error.externalHttpStatus, "200");
    assert.equal(error.externalCode, undefined);
    assert.match(error.message, /微信接口响应无法解析：HTTP 200/);
    assert.match(error.message, /token=\[REDACTED\]/);
    assert.doesNotMatch(error.message, /secret-token-value/);
    return true;
  });
});

test("WeChat JSON business errors keep their stable code without sensitive fields", async (t) => {
  const server = http.createServer((req, res) => {
    req.resume();
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      errcode: 47003,
      errmsg: "invalid data openid=oSensitiveOpenidValue123456789 access_token=secret-token",
    }));
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  await assert.rejects(() => fetchWechatJson(`${baseUrl}/probe`), (error) => {
    assert.equal(error.code, 1006);
    assert.equal(error.externalCode, "47003");
    assert.match(error.message, /invalid data/);
    assert.match(error.message, /openid=\[REDACTED\]/);
    assert.match(error.message, /access_token=\[REDACTED\]/);
    assert.doesNotMatch(error.message, /secret-token|oSensitiveOpenidValue/);
    return true;
  });
});
