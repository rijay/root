# myRoot CloudBase 0% 候选 026 证据

执行时间：2026-07-13 20:16-20:29 +08:00

状态：`DEPLOYED_AT_ZERO_PERCENT_DIRECTED / RUNTIME_GATES_PASS / FUNCTIONS_DRY_RUN_LOCKED / NO_MINIPROGRAM_UPLOAD / NO_REMINDER_SEND`

## 1. 实际读取来源

1. 本地 `v0.5.11` 候选 ZIP、展开源码清单、发布说明、生产预检和 025 历史证据。
2. CloudBase `DescribeCloudRunServerDetail`、`DescribeReleaseOrder`、`DescribeCloudRunDeployRecord`、`DescribeVersionDetail` 与发布任务的行动时回读。
3. 026 条件路由下的 `/health`、`/ready`、`/api/v1/privacy/notice` 和 `/admin`，以及 15 次无参数 `/health`。
4. 两个 Cloud Function 的状态、运行时、变量数量、dry-run 开关、定向路由匹配和启用触发器数量。

路由值、环境变量值、VPC/子网 ID、数据库配置、微信凭据和 Job token 均未写入仓库或本证据。

## 2. 发布对象

| 项目 | 结果 |
| --- | --- |
| 环境 | `myroot-prod-d5gl3gzg7115f149a` |
| 应用 | `myroot-api` |
| 默认版本 | `myroot-api-012 / normal` |
| 新候选 | `myroot-api-026 / normal` |
| 应用版本 | `0.5.11` |
| BuildId | `2601310799` |
| 路由 | `URL_PARAMS / flowRatio=0 / myroot_canary / value present` |
| 发布单 | `grayStatus=success / releaseStatus=gray / IsReleasing=true` |
| 本地来源 | 工作树候选；本轮未 commit、未 push |

## 3. 工件与配置继承

1. 后端 ZIP：185 个条目、1,072,804 bytes，SHA-256 `bf2ad367df73161d870eff2c467aaa54f264fbbd13542d10247c2f74e6787b48`。
2. 展开源码：176 个文件，内容清单 SHA-256 `6e3bdcd940ea3826cb89c1f5cb065870ddf67af60def1d16168803429dd625bc`。
3. 上传包名为 `myroot-api.zip`，平台包版本 `1783945030`；上传返回 HTTP 200 且 ETag 存在。
4. 026 精确继承 025 的 48 个环境变量值和 VPC 配置；Store Adapter 仍为 MySQL，未增加 `ROOT_RELEASE_ID` 覆盖，运行版本继续来自包版本。
5. 规格回读为 `1 CPU / 2 GB / min 1 / max 2 / port 80`。

## 4. 部署顺序与写入结果

1. 预检确认 012 与 025 均为 `normal`，025 为 `URL_PARAMS / 0%`；稳定版 012 的 31 个变量与候选的 48 个变量是历史演进，不按错误漂移处理。
2. 上传候选包后，先结束 025 的活动灰度；025 历史版本未删除，012 的默认流量未改变。
3. `UpdateCloudRunServer` 请求 `b81f3b7a-6c94-47ed-b95b-c393079db863`、任务 `1721007` 成功提交，平台分配 `myroot-api-026`。
4. 026 于 20:20 回读为 `normal`。首次使用旧流量配置 Interface 返回 `InvalidParameter.ServiceNotExist`，行动时回读证明发布单、流量和路由均未改变，因此没有重试该 Interface。
5. 改用当前 `ReleaseGray` Interface，请求 `39cc9f98-c0e1-4b03-a916-decb4c9f21ff` 成功恢复原条件路由；路由值只做存在性与 SHA-256 前缀 `3ea2153d7996` 比对。

## 5. 运行 Gate

| Gate | 结果 |
| --- | --- |
| 候选 `/health` | HTTP 200、业务码 0、`version=0.5.11 / releaseId=0.5.11` |
| 候选 `/ready` | HTTP 200、MySQL connected、迁移 `005_notification_subscription_grants.sql` |
| MySQL 权限 | `leastPrivilegeReady=true / privilegeScope=SCHEMA / privilegePolicyEnforced=true` |
| 隐私说明 | 已配置处理者和公开联系方式；保存 180 天；政策版本 `health-sensitive-2026-07-11-v1` |
| Admin | HTTP 200、HTML 与静态资源引用存在 |
| 默认流量保护 | 15/15 无参数 `/health` 为 HTTP 200、业务码 0；026 命中 0 次 |
| 版本配置 | `normal`；48 个变量值与部署快照精确一致；VPC 精确一致 |
| 发布单 | `012 -> 026 / URL_PARAMS / flowRatio=0 / gray success` |

## 6. Cloud Function 锁

1. `myroot-job-dispatcher` 与 `myroot-health-retention` 均为 `Active / Available / Nodejs18.15`，各保留 6 个变量。
2. 两个 Function 均为 `ROOT_JOB_DRY_RUN=true`，定向路由与 026 精确匹配；分别保留 10 与 1 个启用触发器。
3. 本轮没有更新两个 Function 的代码包、变量或触发器，也没有同步调用任何 Job；代码包继续保持上一轮已验证的 `v0.5.10`。

## 7. 对抗式审查

1. **默认流量误入候选**：以 15 次无参数请求攻击该假设，026 命中为 0。
2. **候选配置静默丢失**：回读并精确比较 48 个变量值、VPC 和实例规格，均无漂移。
3. **定时任务意外真实执行**：回读两个 Function 的全局 dry-run 与 10+1 个启用触发器；本轮没有调用 Job。
4. **把部署成功误写成微信修复成功**：本轮没有向微信发起新的业务 POST，也没有发送提醒，因此只确认新 Implementation 已运行，不确认 412 根因或实际送达。
5. **旧未知结果被误重试**：没有读取后执行旧任务、请求 ID 或额度；025 的 `UNKNOWN / REVIEW_REQUIRED` 语义保持不变。

## 8. 本轮明确未执行

1. 未上传或指定新的小程序体验版，公众平台当前体验版状态未改变。
2. 未发送订阅消息，未获取或消费新的一次性订阅额度。
3. 未修改两个 Cloud Function，未运行 11 个 Job，未执行对象存储或其他外部 Adapter 动作。
4. 未进入 5% 或 100% 流量，未提交审核，未 commit、未 push，也未删除历史版本。

## 9. 结论

`myroot-api-026 / v0.5.11` 已完成 `URL_PARAMS / 0%` 候选部署并通过只读运行 Gate；默认流量继续由 012 承接，两个 Cloud Function 继续锁定 dry-run。由于本轮按授权没有发送提醒，也没有执行微信业务 POST，`Content-Length` 的线上外部结果和提醒实际送达仍未验证，正式提醒 Gate 继续为 `BLOCKED`。
