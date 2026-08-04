# 运营后台性能证据说明（R0）

本目录用于收集 myRoot 正式上线候选版本的运营后台性能证据。后台现阶段按 **2 名核心运营、最多 5 个浏览器会话**设计，不以大规模并发为目标。

## 三类必要证据

1. **构建证据**：运行 `npm run build:verify --prefix admin`。检查首屏、单个异步页面及全部静态资源的 gzip 体积；任何硬上限超标都会阻断本地门禁。
2. **查询证据**：使用 `ADMIN_PERFORMANCE_R0` 固定数据规模，为列表、详情、写入、审计四类场景各采集至少 20 次，记录 `version`、`environment`、`datasetVersion`、`scenario`、`durationMs`、`responseBytes`。使用 `--query-events` 生成 P75、P95 与响应体报告。
3. **浏览器证据**：覆盖 Chrome、标准办公网络和弱网，记录冷启动、缓存刷新、已加载菜单切换、首次异步页面四类场景；同时记录 DOM 节点、最长同步任务、最长卡顿、稳定内存、菜单循环后的内存增长、帧率和持续操作时间。使用 `--browser-events` 汇总。Edge 不在首发支持与验收范围内。

候选查询与浏览器证据必须同时携带 `evidenceClass=FORMAL_LAUNCH_CANDIDATE`、非本机 HTTPS `targetOrigin`、完整 40 位 Git `artifactCommit` 和由 `/health` 回读的显式 `releaseId`。两类证据的目标 Origin、提交和 `releaseId` 必须完全一致；本地、测试、开发环境或回环地址即使指标全部达标，也不能关闭候选 Gate。

候选报告命令示例：

```sh
node scripts/admin-performance-report.js \
  --candidate \
  --query-events docs/evidence/admin-performance-r0/query-events.json \
  --browser-events docs/evidence/admin-performance-r0/browser-events.json \
  --output docs/evidence/admin-performance-r0/candidate-report.json
```

## 候选采集入口

候选采集分为四步，默认命令不连接网络：

1. **零网络预检**：校验 HTTPS 候选 Origin、完整 40 位 Git 提交、环境、版本和显式 `releaseId`，并提示候选运行时必须配置 `ROOT_ADMIN_PERFORMANCE_DATASET_VERSION=ADMIN_PERFORMANCE_R0`；只报告四项敏感环境变量是否已配置，不打印其值。
2. **查询采集**：取得单独候选写入授权后，先从 `/health` 回读版本和显式 `releaseId`，再采集列表、精确用户查询、审计和草稿写入各 20 次。写入只对 `ROOT_ADMIN_PERFORMANCE_DRAFT_ID` 指定的专用欢迎页草稿保存相同内容，不发布、不下线，但会产生 20 次 revision 和审计记录。
3. **浏览器封装**：按 `candidate-browser-capture.template.json` 完成 Chrome、两个网络档位、五会话、两类冲突和 30 分钟稳定性原始记录；封装器拒绝原始文件自行声明候选来源，只接受查询采集产生的 `/health` 回读。
4. **报告**：查询和浏览器证据绑定同一 Origin、Git 提交和 `releaseId` 后，再由 `--candidate` 生成三层报告。

预检命令：

```sh
npm run evidence:admin-candidate:query -- \
  --preflight \
  --target https://candidate.example.com \
  --artifact-commit FULL_40_CHAR_GIT_COMMIT \
  --environment candidate-staging \
  --version 0.5.13 \
  --release-id myroot-candidate-COMMIT_PREFIX
```

如果候选与稳定版共用 CloudBase 公网 Origin，并通过 0% URL 参数定向路由，预检和执行命令还必须同时增加：

```sh
  --route-file /private/tmp/myroot-api-NNN-route.json \
  --expected-route-version myroot-api-NNN
```

路由文件必须是位于系统私有临时目录中的普通文件，权限为 `0600` 或更严格，结构与受控体验码路由文件一致。采集器会把路由参数附加到 `/health` 和全部后台请求，但只输出候选版本名及路由指纹，不会把路由值写入日志、证据或报告。独立候选 Origin 不需要这两个参数。

查询执行还要求以下值由受控凭据渠道注入环境，禁止把真实值写入仓库、证据文件或命令历史：

- `ROOT_ADMIN_PERFORMANCE_TOKEN`：候选后台测试口令；
- `ROOT_ADMIN_PERFORMANCE_TEST_PHONE`：固定测试用户手机号；
- `ROOT_ADMIN_PERFORMANCE_DRAFT_ID`：专用、可产生 revision 的欢迎页草稿；
- `ROOT_ADMIN_PERFORMANCE_CANDIDATE_WRITE_ACK=I_UNDERSTAND_CANDIDATE_DRAFT_WILL_BE_REVISED`：本次写入确认。

候选运行时的 `ROOT_ADMIN_PERFORMANCE_DATASET_VERSION=ADMIN_PERFORMANCE_R0` 不是秘密，但必须随候选部署显式配置并由 `/health` 回读；缺失或不一致时，查询采集器在任何后台读写前停止。

取得明确授权后，将预检命令中的 `--preflight` 改为 `--execute-query`，并增加全新的 `--output-dir`。采集器使用独占创建，拒绝覆盖已有证据文件。

浏览器原始记录封装：

```sh
npm run evidence:admin-candidate:browser -- \
  --runtime-readback CANDIDATE_OUTPUT_DIR/runtime-readback.json \
  --capture BROWSER_CAPTURE.json \
  --output CANDIDATE_OUTPUT_DIR/browser-events.json
```

最终候选报告：

```sh
npm run evidence:admin-candidate:report -- \
  --query-events CANDIDATE_OUTPUT_DIR/query-events.json \
  --browser-events CANDIDATE_OUTPUT_DIR/browser-events.json \
  --output CANDIDATE_OUTPUT_DIR/candidate-report.json
```

候选查询执行属于外部、带写入的操作；本地实现和预检完成不构成执行授权。浏览器封装与报告只读本地证据文件，也不会部署、送审、发布或切流。

`npm run evidence:local:write` 会生成当前构建快照，并把缺失的查询与浏览器证据保持为 `BLOCK`；`npm run evidence:local:check` 校验这些本地证据是否仍与当前构建和 20 个 UED 映射一致。

本地开发可先运行：

```sh
npm run evidence:admin-query:rehearse
npm run evidence:admin-capacity:rehearse
node scripts/admin-performance-report.js \
  --rehearsal \
  --query-events docs/evidence/admin-performance-r0/query-rehearsal-events.json
```

该命令只启动进程内存储和本机 HTTP 服务，按固定规模采集列表、用户详情、审计与草稿写入各 20 次，不连接候选或生产环境。输出字段结构可被候选采集器复用，但事件固定标记为 `evidenceClass=LOCAL_REHEARSAL`、本机 `targetOrigin`，只能用于排障；即使把文件交给 `--candidate`，报告器也必须阻断。

`evidence:admin-capacity:rehearse` 额外启动 5 个相互独立的本地运营会话，每个会话同时发起 2 个读取请求；内存 Store Adapter 的一次性并发屏障会确认服务实际接收到合计 10 路并发读取，且每个会话不超过浏览器 4 路读取上限。随后，两名模拟运营分别对首页轮播草稿和 Root4U 量表草稿执行“同一版本读取—甲先保存—乙用旧版本保存”：乙的两次写入都必须收到 HTTP 409 和刷新提示，权威读取必须保留甲的结果。结果写入 `capacity-conflict-rehearsal.json`，不包含令牌、手机号或健康答案。

这项自动化用于提前发现服务端容量编排和乐观并发控制回归，属于本机 HTTP Interface 预演；它不等同于 5 个真实浏览器会话，也不关闭 Chrome 候选浏览器 Gate。

`browser-five-session-conflict-rehearsal.json` 记录 Chrome 受控浏览器预演：5 个独立标签页均在 `1240 × 820` 加载，首页轮播与 Root4U 量表分别由两个会话读取同一草稿，后保存者收到 HTTP 409 和“请刷新后重试”提示，编辑抽屉保留，第三个会话回读确认先保存结果未被覆盖。该材料补足本地 UI 链路排障，但标签页不是独立浏览器 Profile，且未完成网络模拟、20 次时延样本或 30 分钟稳定性，因此仍不是候选浏览器 Gate 证据。

Chrome 本地浏览器预演结果保存在 `browser-rehearsal-samples.json`，可运行：

```sh
node scripts/admin-performance-report.js \
  --rehearsal \
  --browser-events docs/evidence/admin-performance-r0/browser-rehearsal-samples.json
```

紧凑文件按浏览器会话保存公共资源指标和各旅程时长数组，报告器会展开为事件。候选 Gate 要求 Chrome × 标准办公网/完整弱网两个组合各场景至少 20 次；办公网应用时延硬上限，弱网只验证完整覆盖、等待、超时和恢复，不套用办公网时延上限。网络模拟、浏览器、会话、冲突或 30 分钟稳定性不完整时仍必须 `BLOCK`。

`browser-long-task-isolation.json` 记录 Chrome 本地生产构建中首页轮播首次异步挂载的专项排障：关闭缓存后先复现并归因，再验证空闲预取与分阶段挂载。该材料只证明本地已消除可重复的 ≥50ms 同步任务，不替代 Chrome、完整网络、五会话和 30 分钟候选证据。

## 判定边界

- 构建通过只说明静态资源未越过硬上限，不等于正式上线性能门禁通过。
- 查询和浏览器样本缺失、样本数不足或任一硬上限超标时，候选报告必须失败。
- 查询与浏览器证据来源不一致、目标为本机/测试环境、缺少候选证据类别，或未绑定同一 Git 提交和显式 `releaseId` 时，候选报告必须失败。
- 旧后台、本地临时数据和人工主观感受只能作为参考，不可作为候选版本通过证据。
- 本阶段不设置“运营操作 Gate”，也不引入 Redis、WebSocket、APM、虚拟列表或复杂全局状态管理。
- 报告不包含手机号、健康答案、令牌或其他个人信息；正式证据只保留性能维度和版本标识。
- 固定数据由 `backend/tests/fixtures/adminPerformanceFixture.js` 生成：用户 10,000、活动报名 5,000、审计 20,000、内容版本 1,000、量表题目 100；不得用生产数据替代。
