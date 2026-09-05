#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createApp } = require("../backend/src/app");
const { createSqliteStore } = require("../backend/src/store");
const { seedLocalMiniprogramDevData } = require("../backend/src/localMiniprogramDevSeed");

// Explicit local configuration: this entrypoint never loads ambient cloud credentials or Keychain.
function createLocalServer({ directory = path.resolve(__dirname, "../.local-state/devtools") } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const env = {
    NODE_ENV: "development", ROOT_ENV: "development", ROOT_LISTEN_HOST: "127.0.0.1",
    ROOT_STORE_ADAPTER: "sqlite", ROOT_SQLITE_FILE: path.join(directory, "myroot-v070-devtools.sqlite"),
    ROOT_ALLOW_OPENID_LOGIN: "true", ROOT_LOCAL_MINIPROGRAM_DEV_SEED: "true",
    ROOT_REQUIRE_HEALTH_CONSENT: "true", ROOT_PRIVACY_CONTROLLER_NAME: "myRoot 本地合成数据 QA",
    ROOT_PRIVACY_CONTACT: "qa@example.com", ROOT_HEALTH_DATA_RETENTION_DAYS: "180",
    ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED: "true",
  };
  const storeAdapter = createSqliteStore(env.ROOT_SQLITE_FILE);
  try {
    const seed = seedLocalMiniprogramDevData(storeAdapter.data, { env, storeAdapter });
    if (seed.changed) storeAdapter.save();
    return createApp({ storeAdapter, env });
  } catch (error) {
    storeAdapter.close();
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: npm run dev:local -- [--port=8787]\nLocal synthetic SQLite runtime; no cloud or Keychain access. DevTools expects port 8787.");
    return;
  }
  if (args.some((arg) => !/^--port=\d+$/.test(arg)) || args.length > 1) throw new Error("Use --port=8787 or --help");
  const port = args.length ? Number(args[0].slice(7)) : 8787;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Port must be 1..65535");
  const server = createLocalServer();
  try {
    await server.readyPromise;
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  } catch (error) {
    server.storeAdapter.close();
    if (error.code === "EADDRINUSE") throw new Error(`Port ${port} is in use. Inspect its owner with lsof -nP -iTCP:${port} -sTCP:LISTEN; keep the existing task intact.`);
    throw error;
  }
  console.log(`Local synthetic runtime: http://127.0.0.1:${port}/admin/`);
  console.log(`SQLite: ${server.storeAdapter.filePath}`);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => server.storeAdapter.close());
    server.closeIdleConnections();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { createLocalServer };
