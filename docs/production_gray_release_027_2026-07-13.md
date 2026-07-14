# myRoot CloudBase 0% 候选 027 证据

执行时间：2026-07-13 23:07-23:27 +08:00

状态：`DEPLOYED_AT_ZERO_PERCENT_DIRECTED / RUNTIME_GATES_PASS / FUNCTIONS_DRY_RUN_LOCKED / FORMAL_PROOFS_NOT_WRITTEN`

## 1. 实际读取来源

1. 本地提交 `7190d44`、`ef9fab9`，`v0.5.12` 后端候选 ZIP、发布说明、正式上线 Gate 和 026 历史证据。
2. CloudBase `DescribeReleaseOrder`、`DescribeCloudRunDeployRecord`、`DescribeVersionDetail`、`DescribeServerManageTask`、027 定向生产发布记录与两个 Cloud Function 的行动时回读。
3. 027 条件路由下的 `/health`、`/ready`、`/api/v1/privacy/notice`、`/admin` 与首个 Admin 静态资源，以及 15 次无参数 `/health`。
4. 两个 Cloud Function 的状态、运行时、变量数量、dry-run 开关、定向路由匹配和启用触发器数量。

路由键值、环境变量值、VPC/子网 ID、数据库配置、微信凭据和 Job token 均未写入仓库或本证据。

## 2. 发布对象

| 项目 | 结果 |
| --- | --- |
| 环境 | `myroot-prod-d5gl3gzg7115f149a` |
| 应用 | `myroot-api` |
| 默认版本 | `myroot-api-012 / normal` |
| 新候选 | `myroot-api-027 / normal` |
| 应用版本 | `0.5.12` |
| releaseId | `v0.5.12+ef9fab932a08` |
| BuildId | `2601322251` |
| 发布任务 | `1721741` |
| 路由 | `URL_PARAMS / flowRatio=0 / one condition present` |
| 发布单 | `grayStatus=success / IsReleasing=true` |
| 本地来源 | `ef9fab932a08cb2f48f63b04605e6ac9c94c8c19`；本轮未 push |

## 3. 工件与配置

1. 后端 ZIP：188 个条目、179 个文件、1,076,513 bytes，SHA-256 `ff4491fafa36f8dc68b12593c46ac258397c24bce89c780228d6aa1242b586cc`。
2. 工件由 `git archive HEAD:backend` 生成；包版本为 `0.5.12`，包含 5 个迁移、Dockerfile、后端入口和 Admin dist，不包含禁止路径。
3. 全工件 179 个文本文件的凭据模式扫描为 0 项；本机未安装 `gitleaks` 或 `trufflehog`，因此该结果不是绝对泄露保证。
4. 027 共 49 个环境变量，显式 `ROOT_RELEASE_ID` 与目标一致；VPC 已配置，规格为 `1 CPU / 2 GB / min 1 / max 2 / port 80`。
5. 完整 `npm run verify` 为 `15/15 PASS`，覆盖 228 个 JavaScript 文件、5 个迁移、11 个 Job、Admin 构建和 157 个小程序发布源文件。

## 4. 部署顺序与写入结果

1. 预检确认 012 为稳定版，026 为 `URL_PARAMS / 0%` 活动候选，两个 Cloud Function 均为全局 dry-run。
2. 先以 `go_back` 结束 026 灰度任务；026 历史版本未删除，012 默认流量未改变。
3. 精确上传候选 ZIP 后，`UpdateCloudRunServer` 请求 `74493469-a400-406d-bb26-6e1bcdf2bd80`、任务 `1721741` 成功提交，平台分配 `myroot-api-027`。
4. 027 于 `2026-07-13 23:07:56` 回读为 `normal`；49 个变量、releaseId、VPC、规格和端口通过回读。
5. 首次 `ReleaseGray` 请求 `806db926-9e38-4e57-9552-e5b0afa05b2a` 建立 `URL_PARAMS / 0%` 发布单，但定向探针 120 次未命中 027；默认流量没有变化。
6. 对照上一版成功请求后确认 `VersionFlowItems` 顺序和优先级漂移。一次大小写错误的修正没有获得有效 Interface 响应，随后的只读回读确认状态未改变，因此没有盲目重复。
7. 使用候选优先、候选 `Priority=1`、稳定版默认且省略稳定版优先级的历史成功形状重新提交；请求 `7d810cbb-a99a-4b24-9432-4778910ecde0` 成功，定向探针随即首请求命中 027。

## 5. 运行 Gate

| Gate | 结果 |
| --- | --- |
| 候选 `/health` | HTTP 200、业务码 0、`version=0.5.12 / releaseId=v0.5.12+ef9fab932a08` |
| 候选 `/ready` | HTTP 200、MySQL connected、迁移 `005_notification_subscription_grants.sql` |
| MySQL 权限 | `leastPrivilegeReady=true / privilegeScope=SCHEMA / privilegePolicyEnforced=true` |
| 隐私说明 | 配置完整、公开联系方式有效、保存 180 天、政策版本存在 |
| Admin | `/admin` HTTP 200、挂载点存在、首个 JavaScript 资源 HTTP 200 |
| 默认流量保护 | 15/15 无参数 `/health` 为 HTTP 200、业务码 0；027 命中 0 次 |
| 版本配置 | `normal`；49 个变量；显式 releaseId；VPC 和实例规格存在 |
| 发布单 | `012 -> 027 / URL_PARAMS / flowRatio=0 / gray success` |
| 正式发布记录 | `BLOCKED / 4 of 15`；T-012、T-015 均为 `proofSource=NONE` |

对象存储探针未包含在本轮授权中，因此没有执行；025 的历史对象存储证据不能冒充 027 的候选级证明。

## 6. Cloud Function 锁

1. `myroot-job-dispatcher` 与 `myroot-health-retention` 均为 `Active / Available / Nodejs18.15`，各保留 6 个变量。
2. 两个 Function 均为 `ROOT_JOB_DRY_RUN=true`，定向路由与 027 发布单精确匹配；分别保留 10 与 1 个启用触发器。
3. 本轮没有更新两个 Function 的代码包、变量或触发器，也没有调用任何 Job；代码包继续保持上一轮已验证版本。

## 7. 对抗式审查

1. **默认流量误入候选**：15 次无参数请求中 027 命中 0 次。
2. **路由回读成功但实际不命中**：首次配置正是这种情况；最终以三个公开路径的实际版本与 releaseId 归因作为通过条件。
3. **候选配置静默丢失**：回读 49 个变量、显式 releaseId、VPC、实例规格、端口和迁移版本。
4. **定时任务意外真实执行**：两个 Function 均保持全局 dry-run，本轮未调用 11 个 Job。
5. **把运行证明误写成正式批准**：本轮没有向生产证明 Intake 写入 T-012 或 T-015；正式上线仍由同版本真机、真实提醒、5% 灰度、外部 Adapter、联合回滚和三方签字阻塞。

## 8. 本轮明确未执行

1. 未上传或指定新的小程序体验版，未提交微信审核。
2. 未发送订阅消息，未获取或消费新的一次性订阅额度。
3. 未更新两个 Cloud Function，未调用 11 个 Job，未执行对象存储或其他外部 Adapter 动作。
4. 未进入 5% 或 100% 流量，未 push，未删除历史版本，也未写入正式切换证明。

## 9. 结论

`myroot-api-027 / v0.5.12` 已完成 `URL_PARAMS / 0%` 候选部署并通过运行 Gate；默认流量继续由 012 承接，两个 Cloud Function 继续锁定 dry-run。T-012 与 T-015 已具备本地证据材料，但尚未通过正式 Evidence Intake 写入生产证明，因此正式发布状态继续为 `BLOCKED`。
