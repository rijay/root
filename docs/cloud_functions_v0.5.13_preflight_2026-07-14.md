# myRoot Cloud Function v0.5.13 对齐预检

日期：2026-07-14

状态：`PREFLIGHT_PASS / ONLINE_BASELINE_DOWNLOADED / PRODUCTION_UNCHANGED / ACTION_CONFIRMATION_REQUIRED`

## 1. 实际读取来源

1. 当前工作树 `cloudfunctions/myroot-job-dispatcher/index.js`、`package.json`、`cloudbaserc.json`、专向测试和 11 Job Manifest。
2. CloudBase CLI 完整权限会话中，生产环境 `myroot-prod-d5gl3gzg7115f149a` 的 `myroot-job-dispatcher` 与 `myroot-health-retention` 详情。
3. 两个 Function 最新线上代码包，只读下载到 `/private/tmp/myroot-job-dispatcher-live-20260714` 与 `/private/tmp/myroot-health-retention-live-20260714`。
4. 受控 canary 路由文件 `/private/tmp/myroot-api-023-route.json`，仅用于等值比较；未输出路由值。

环境变量值、路由值、Job token、Admin token 和任何外部凭据均未写入仓库或输出。本轮没有更新 Function、调用 Job、修改变量或触发器。

## 2. 线上详情回读

| 项目 | 主调度 | 健康保留 |
| --- | --- | --- |
| 状态 | `Active / Available` | `Active / Available` |
| Runtime / Handler | `Nodejs18.15 / index.main` | `Nodejs18.15 / index.main` |
| 规格 | `256 MB / 30s` | `256 MB / 30s` |
| CodeSize | `3398` | `3398` |
| 修改时间 | `2026-07-13 17:16:38` | `2026-07-13 17:17:22` |
| 环境变量 | 6 个；键集合一致 | 6 个；键集合一致 |
| dry-run | `ROOT_JOB_DRY_RUN=true` | `ROOT_JOB_DRY_RUN=true` |
| 路由 | 与受控既有 canary 精确匹配 | 与受控既有 canary 精确匹配 |
| 触发器 | 10/10 启用 | 1/1 启用 |
| 线上包版本 | `0.5.10` | `0.5.10` |

两个 Function 的六项环境变量完整集合哈希均为 `c6dfdc6e2f5ab2fe55c34459a7fcb3033939404f727ab97d97300a1f04c60fd7`，证明值集合一致；哈希不能替代更新后的 11/11 Job 端到端验证。

## 3. 包级比对

1. 两个线上下载目录都仅包含 `index.js` 与 `package.json`，目录间 `diff -rq` 为零差异。
2. 线上两个 `index.js` 与本地 v0.5.13 `index.js` 的 SHA-256 均为 `506e23926bc927fda3b9b22673e1f99746334e8c29c8f5b8ba498d23a06df927`。
3. 线上两个 `package.json` 的 SHA-256 均为 `0520b045c61117f524cc54e0c7085c16b33d32bef86dbb11db6ee1ed635d82d2`，版本为 `0.5.10`。
4. 本地 `package.json` 的 SHA-256 为 `0e6f4b0fde96a1e3d3303fb8a6093d3c4b00bcdd02cc66a5d1d737bea66d17dd`，版本为 `0.5.13`。
5. 当前唯一包级差异是版本清单；线上下载目录同时构成本轮只读回滚基线。实际更新前必须再次校验目录存在、哈希和云端修改时间。

## 4. 本地验证

1. 完整 `npm run verify`：`16/16 PASS`。
2. JavaScript 语法：232 个文件通过。
3. CloudBase 两 Function、11 Job 拓扑、触发器上限与 Manifest：通过。
4. Job Dispatcher 专向测试已包含在后端测试中；本版没有修改 `index.js` 行为。

## 5. 获确认后的最小执行范围

1. 只使用 `fn code update` 更新明确的两个 Function，不执行 `fn deploy`，不提交 `cloudbaserc.json` 中的配置，不改变量或触发器。
2. 先更新一个 Function，立即回读状态、6 个变量名、变量集合哈希、dry-run、canary 路由、原触发器数量和下载包版本；任一漂移立即停止并回滚该 Function。
3. 第一个通过后才更新第二个；两个都回读为 v0.5.13 后，逐条调用 11 个 Job。
4. 每个 Job 必须为 HTTP 200、业务码 0、`releaseVersion=0.5.13`、`dryRun=true`；不使用批量循环掩盖首个失败。
5. 不开启 execute，不发送提醒，不执行健康数据清理、发券、企微写入、导出交付或任何外部动作。

## 6. 回滚与停止规则

1. 使用刚下载的对应线上目录，通过 `fn code update <Function> --dir <线上基线目录>` 仅恢复受影响 Function。
2. 回滚后重新下载并核对 `package.json=0.5.10`、两个文件哈希、状态、dry-run、路由、变量集合哈希和触发器数量。
3. 任一 Job 返回非 dry-run、版本不一致、错误或不明确结果时停止，不继续下一个生产动作。
4. Function 对齐不关闭 CloudBase 到期、028 运行、体验版、提醒、外部 Adapter、联合回滚、灰度或签字 Gate。

## 7. 结论

CloudBase 身份恢复后，先前缺失的线上包级证明已经补齐。两个 Function 仍为完全一致的 v0.5.10 包，配置与 canary 基线未漂移；本地 v0.5.13 只改变包版本。对齐预检通过，但生产更新与 11/11 dry-run 仍需单独行动时确认。
