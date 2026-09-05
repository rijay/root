#!/usr/bin/env node
// Local synthetic review only. Does not read a production store or write to Feishu.
const { createApp } = require("../src/app");
const { fixture, fakeAdapter } = require("../tests/fixtures/userLabelsFixture");
const data = fixture();
const adapter = fakeAdapter(); adapter.writesEnabled = false;
const server = createApp({ store: data, labelSyncAdapter: adapter, env: { ROOT_ENV: "development" } });
server.listen(5195, "127.0.0.1", () => console.log("Synthetic user-label review: http://127.0.0.1:5195/admin/?module=user-labels"));
