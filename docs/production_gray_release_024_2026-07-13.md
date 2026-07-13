# myRoot CloudBase 灰度候选 024 证据

执行时间：2026-07-13 11:17-11:28 +08:00

状态：`DEPLOYED_AT_ZERO_PERCENT_DIRECTED`

## 1. 发布对象

| 项目 | 结果 |
| --- | --- |
| 环境 | `myroot-prod-d5gl3gzg7115f149a` |
| 应用 | `myroot-api` |
| 默认版本 | `myroot-api-012 / normal` |
| 新候选 | `myroot-api-024 / normal` |
| 应用版本 | `0.5.7` |
| 本地提交 | `af70ff9`；未 push |
| BuildId | `2601317457` |
| 路由 | `URL_PARAMS / flowRatio=0 / myroot_canary / value present` |

路由值、环境变量值、VPC/子网 ID、数据库配置、Admin/Job token 和对象存储 Key 均未写入仓库或本证据。

## 2. 工件

1. 后端 ZIP：181 个条目、1,048,548 bytes，SHA-256 `abde4fd1d30a7543a2c10e9c6fbdf41b7b582cf29e69e3ae7c9ab69d5cf2bb62`。
2. 干净 CloudRun 输入：172 个文件，源码内容清单 SHA-256 `f436464ab91485f0ddb6bcadd488e95191fda4b5509b88c2724d1d9fcfe69b61`。
3. 小程序清单：155 个文件、496,769 bytes，SHA-256 `38a2553de2f784f3f984fd759186277022e549d7a45238ae2c2e9aa595f01eeb`。
4. 完整本地验收：`15/15 PASS`，覆盖 216 个 JavaScript 文件；候选准备脚本自测 `4/4 PASS`。

## 3. 023 结束与默认流量保护

1. 023 最终证据已归档，定向 `/health`、`/ready` 和 MySQL 最小权限均通过。
2. CLI `traffic rollback` 成功结束 023 灰度；发布单回读 `IsReleasing=false / releaseStatus=fail / routeRuleCount=0`，012 保持 `normal`。
3. 结束 023 后，无参数 `/health` 连续 15 次均为 HTTP 200、稳定版响应形态，未命中 0.5.6 或 0.5.7。

## 4. 024 部署与配置

1. 从干净临时目录以 `ReleaseType=GRAY` 提交；平台生成预期版本 `myroot-api-024`。
2. 024 构建状态 `normal`，BuildId `2601317457`；初始发布单为 `FLOW / 0`，15 次无参数请求均未命中 0.5.7。
3. 024 版本回读：`1 CPU / 2 GB / min 1 / max 2 / port 80 / VPC present`，48 个环境变量名称且无重复；隐私、提醒和对象存储名称存在。
4. 使用官方 `ReleaseGray` Interface 复用原条件路由，回读 `grayStatus=success / releaseStatus=gray / URL_PARAMS / flowRatio=0 / IsReleasing=true`；012 为默认版本，024 为条件候选。
5. 配置后，无参数 `/health` 连续 15 次均为 HTTP 200、稳定版响应形态，未命中 0.5.7。

## 5. 024 定向 Gate

| Gate | 结果 |
| --- | --- |
| `/health` | HTTP 200、业务码 0、`version=0.5.7`、`releaseId=0.5.7` |
| `/ready` | HTTP 200、MySQL connected、迁移 `004_external_evidence_minimization.sql` |
| MySQL 权限 | `leastPrivilegeReady=true / privilegeScope=SCHEMA / privilegePolicyEnforced=true` |
| 隐私说明 | 已配置处理者、有效公开联系方式、180 天保存期限和政策版本 |
| 默认流量 | 路由配置后 15/15 次无参数请求未命中 0.5.7 |

## 6. 对象存储探针

- 请求 ID：`canary-object-024-1783913206733-920d1457`
- 对象键：`release-probes/2026-07-13/canary-object-024-1783913206733-920d1457.json`
- 提供方：`CLOUDBASE`
- 状态：`VERIFIED`
- 上传确认：`true`
- 精确删除确认：`true`
- 残留可能性：`false`
- 探针后直接列举 `release-probes/2026-07-13/`：`total=0`

## 7. Cloud Function dry-run

1. `myroot-job-dispatcher` 与 `myroot-health-retention` 均保持已部署状态，路由值不变并命中 024 后端。
2. 11/11 个作业全部返回 `InvokeResult=0 / dryRun=true / HTTP 200 / code=0 / ok=true`。
3. 未发送订阅消息、未清理健康数据、未执行结算写入、未调用真实有赞、企微、物流、发券或奖励动作。
4. 两个 Cloud Function 当前部署包仍报告 `releaseVersion=0.5.6`；仓库包已是 0.5.7，但本次授权不包含函数包重新部署。该版本对齐仍是正式发布 Gate，不能标记为完成。

## 8. 剩余正式 Gate

1. 经单独授权部署两个 0.5.7 Cloud Function 包，同时保持 10+1 触发器、路由和 `ROOT_JOB_DRY_RUN=true`，再执行 11/11 复测。
2. 上传同一提交的小程序体验版并完成登录、隐私、订阅、任务、媒体、结算、字体和 Root 会员中心跳转真机验证。
3. 配置并校准真实有赞、企微、物流、履约和告警通道；真实权益动作逐项取得行动时确认。
4. 完成 5% 灰度、业务回滚演练、严格证据包留档和产品/运营/研发三方签字。

在以上 Gate 关闭前，012 继续承接默认流量，024 只允许条件定向访问，不执行 100% 切流。
