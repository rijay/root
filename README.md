# myRoot 小程序与服务端

当前代码包含微信小程序、Node.js API 和 Vue 运营后台。可执行入口分别是 `miniprogram/app.json`、`backend/src/app.js` 和 `admin/src/App.vue`。历史 7 日打卡、Day4/Day8 问卷及旧后台已退出当前运行范围，旧方案文档只作历史参考。

## 开始开发

在本任务的 Git 工作树根目录执行，Node 版本与 CI 一致：

```bash
nvm install
nvm use
npm run setup
npm run admin:build
npm run doctor
npm run dev:local
```

`setup` 按后端和后台锁文件安装依赖，不运行依赖安装脚本。`doctor` 显示当前目录、分支、提交、小程序版本、依赖和本地构建状态。

`dev:local` 启动 `127.0.0.1:8787` 上的合成数据服务，使用当前工作树 `.local-state/devtools/` 中的独立 SQLite 文件和本地评测题库。它使用显式本地配置，不读取 Keychain 或云端凭据。后台入口为 `http://127.0.0.1:8787/admin/`。不要向这个本地演示环境复制真实用户数据。

后台热更新另开终端运行：

```bash
npm run dev:admin
```

然后打开 `http://127.0.0.1:5177/admin/`。微信开发者工具应导入**当前工作树的 `miniprogram/`**，使用已配置的 AppID。当前配置 `urlCheck=true`；模拟器本地开发如需关闭域名校验，只在工具的本地设置中调整。仅 `develop + devtools` 使用本机 API；体验版、正式版和手机运行继续使用云托管。

## 验证

```bash
npm run qa:local
npm run verify -- --only=backend,miniprogram,admin
npm run verify
```

- `qa:local`：用小程序真实请求与评测 Module，替换微信传输层，连接随机回环端口上的真实 HTTP API 和临时 SQLite。覆盖登录、隐私授权、草稿、完成与幂等、重启持久化、历史、后台标签及撤回。
- `verify -- --only=...`：按本次修改选择阶段；可用 `routes,backend,miniprogram,admin,build,tooling,evidence`。
- `verify`：顺序执行全部 7 个阶段，包括脚本测试和本地 QA。每阶段开始即输出状态，完整日志与 `summary.json` 写到 `.local-state/verification/run-*/`。默认单阶段超时 180 秒，可用 `--timeout-ms=...` 调整；中断后清理阶段进程组并停止后续阶段。
- 小程序检查自动发现 `scripts/*.test.js`，新增测试不会因漏改串联命令而漏跑。

本地环境需要允许回环监听。出现 `listen EPERM` 时先检查运行权限；`EADDRINUSE` 时用 `lsof -nP -iTCP:8787 -sTCP:LISTEN` 核对已有服务归属，不随意终止其他任务。

只有 `evidence` 报过期时，先检查具体差异，再刷新计算产物并复核：

```bash
npm run evidence:local:write
git diff -- docs/evidence
npm run verify -- --only=evidence
```

该命令更新本地计算快照；设备、候选查询和浏览器证据的缺失状态保持缺失，不能据此声称真实验收通过。

## 代码与操作入口

| 位置 | 用途 |
| --- | --- |
| `miniprogram/` | 页面、组件、请求层、渠道和测评交互 |
| `backend/src/` | API、业务逻辑、持久化和外部 Adapter |
| `admin/src/` | Vue 运营后台源码 |
| `backend/public/admin-dist/` | 已打包的部署后台，更新需使用现有构建流程 |
| `backend/db/migrations/` | 有校验和的版本化 MySQL 迁移 |
| `scripts/` | 本地工作流、验证、证据与发布准备 |
| `docs/` | 需求、决策、历史证据与运行说明 |

工作树、调试和完整 QA 清单见 [开发与验证流程](docs/development.md)。MySQL 的专用一次性数据库检查仍由 `.github/workflows/ci.yml` 中的 schema、迁移及集成阶段负责；常规本地测试可能明确跳过它们。发布准备见 [DEPLOY.md](DEPLOY.md)。本地门禁、远端 CI、体验版、设备验收和正式发布分别记录。
