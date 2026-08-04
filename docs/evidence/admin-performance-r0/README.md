# 运营后台性能证据说明（R0）

本目录用于收集 myRoot 正式上线候选版本的运营后台性能证据。后台现阶段按 **2 名核心运营、最多 5 个浏览器会话**设计，不以大规模并发为目标。

## 三类必要证据

1. **构建证据**：运行 `npm run build:verify --prefix admin`。检查首屏、单个异步页面及全部静态资源的 gzip 体积；任何硬上限超标都会阻断本地门禁。
2. **查询证据**：使用 `ADMIN_PERFORMANCE_R0` 固定数据规模，为列表、详情、写入、审计四类场景各采集至少 20 次，记录 `version`、`environment`、`datasetVersion`、`scenario`、`durationMs`、`responseBytes`。使用 `--query-events` 生成 P75、P95 与响应体报告。
3. **浏览器证据**：覆盖 Chrome、Edge、标准办公网络和弱网，记录冷启动、缓存刷新、已加载菜单切换、首次异步页面四类场景；同时记录 DOM 节点、最长同步任务、最长卡顿、稳定内存、菜单循环后的内存增长、帧率和持续操作时间。使用 `--browser-events` 汇总。

候选报告命令示例：

```sh
node scripts/admin-performance-report.js \
  --candidate \
  --query-events docs/evidence/admin-performance-r0/query-events.json \
  --browser-events docs/evidence/admin-performance-r0/browser-events.json \
  --output docs/evidence/admin-performance-r0/candidate-report.json
```

`npm run evidence:local:write` 会生成当前构建快照，并把缺失的查询与浏览器证据保持为 `BLOCK`；`npm run evidence:local:check` 校验这些本地证据是否仍与当前构建和 20 个 UED 映射一致。

本地开发可先运行：

```sh
npm run evidence:admin-query:rehearse
node scripts/admin-performance-report.js \
  --rehearsal \
  --query-events docs/evidence/admin-performance-r0/query-rehearsal-events.json
```

该命令只启动进程内存储和本机 HTTP 服务，按固定规模采集列表、用户详情、审计与草稿写入各 20 次，不连接候选或生产环境。输出结构可直接被候选报告复用，但其 `environment=local-fixed-fixture`，只能作为 `LOCAL_REHEARSAL` 排障材料，不关闭候选查询 Gate。

## 判定边界

- 构建通过只说明静态资源未越过硬上限，不等于正式上线性能门禁通过。
- 查询和浏览器样本缺失、样本数不足或任一硬上限超标时，候选报告必须失败。
- 旧后台、本地临时数据和人工主观感受只能作为参考，不可作为候选版本通过证据。
- 本阶段不设置“运营操作 Gate”，也不引入 Redis、WebSocket、APM、虚拟列表或复杂全局状态管理。
- 报告不包含手机号、健康答案、令牌或其他个人信息；正式证据只保留性能维度和版本标识。
- 固定数据由 `backend/tests/fixtures/adminPerformanceFixture.js` 生成：用户 10,000、活动报名 5,000、审计 20,000、内容版本 1,000、量表题目 100；不得用生产数据替代。
