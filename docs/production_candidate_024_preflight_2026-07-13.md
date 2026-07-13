# myRoot CloudBase 候选 024 上线前预检

日期：2026-07-13

状态：`EXECUTED_AS_024_ZERO_PERCENT_CANDIDATE`

## 1. 实际读取来源

1. 当前 Git 工作树、`v0.5.7` 版本文件、有赞奖励 Adapter Implementation、发布说明和正式发布检查点。
2. CloudBase CLI `3.5.7` 的 `cloudrun deploy` Implementation，以及腾讯云官方 CloudBase Run 版本、灰度发布和回滚说明。
3. 生产环境 `myroot-prod-d5gl3gzg7115f149a` 的 `DescribeCloudRunServerDetail` 与 `DescribeReleaseOrder` 只读结果；环境变量只统计名称，不输出值。
4. macOS 钥匙串条目 `com.root.myroot.production.cloudbase / myroot-api-object-storage` 的元数据；未读取 Key 值。
5. 重新生成的后端候选 ZIP、小程序源文件清单及凭据模式扫描结果。

## 2. 当前生产状态

| 项目 | 只读回读 | 结论 |
| --- | --- | --- |
| CloudRun 应用 | `myroot-api / normal / container` | `READY` |
| 默认版本 | `myroot-api-012 / normal` | `STABLE` |
| 条件候选 | `myroot-api-023 / normal` | `ACTIVE_ZERO_PERCENT_CANDIDATE` |
| 发布单 | `grayStatus=success / releaseStatus=gray / IsReleasing=true` | `ACTIVE_RELEASE_ORDER` |
| 路由 | `URL_PARAMS / flowRatio=0 / myroot_canary / value present` | `DIRECTED_ONLY` |
| 运行配置 | `1 CPU / 2 GB / min 1 / max 2 / port 80 / VPC present` | `READY` |
| 开放方式 | `MINIAPP / OA / PUBLIC` | `READY` |
| 运行变量 | 48 个名称，无重复；隐私、180 天、提醒模板和对象存储 Key 名称存在 | `READY_EXISTING` |
| 对象存储 Key | 钥匙串元数据存在，创建时间 `2026-07-12 19:19:10 +08:00` | `READY_EXISTING` |

路由值、VPC ID、子网 ID、数据库配置、Admin/Job token 和对象存储 Key 值均未输出或写入仓库。只读响应在生成脱敏摘要后已从 `/tmp` 删除。

## 3. v0.5.7 候选工件

| 工件 | 当前证据 |
| --- | --- |
| 后端 ZIP | `/tmp/myroot-api-0.5.7-local-20260713-r6.zip` |
| 后端条目与大小 | 181 个条目；1,048,548 bytes |
| 后端 SHA-256 | `abde4fd1d30a7543a2c10e9c6fbdf41b7b582cf29e69e3ae7c9ab69d5cf2bb62` |
| 干净源码目录 | `/tmp/myroot-cloudrun-candidate-0.5.7`；172 个文件 |
| 源码内容清单 | `/tmp/myroot-cloudrun-candidate-0.5.7.manifest.json`；SHA-256 `f436464ab91485f0ddb6bcadd488e95191fda4b5509b88c2724d1d9fcfe69b61` |
| 小程序清单 | `/tmp/myroot-miniprogram-0.5.7-20260713.sha256` |
| 小程序文件与大小 | 155 个文件；496,769 bytes |
| 小程序清单 SHA-256 | `38a2553de2f784f3f984fd759186277022e549d7a45238ae2c2e9aa595f01eeb` |
| 凭据扫描 | 唯一命中为对象存储测试中的合成 Bearer 哨兵；无真实凭据证据 |
| 本地验证 | `npm run verify = 15/15 PASS / 216 JavaScript files`；准备脚本自测 4/4；隔离容器四个入口为 HTTP 200 |

CloudBase CLI 会重新压缩源码目录，不能把上表 ZIP SHA-256 直接宣称为平台实际上传包 SHA-256。执行时必须从该 ZIP 解压到全新的临时目录，再由 CLI 打包，确保输入文件集合一致；发布证据同时记录源 ZIP 哈希、提交 ID、平台 BuildId 和运行版本回读。

## 4. 平台约束与正确执行顺序

腾讯云支持一个应用保留多个历史版本，但灰度时最多两个版本接入流量。当前 012 与 023 已占用活动发布单，并且 `IsReleasing=true`。CloudBase CLI 的更新 Implementation 在这种状态下可能返回 `ResourceInUse`，继续操作会取消现有灰度任务。

因此不能把 024 描述为“在不触碰 023 的情况下新增活动灰度候选”。行动时必须作为一次明确的候选替换：

1. 重新只读回读 012/023、发布单、48 个变量名和当前路由值存在性；任一项漂移立即停止。
2. 创建 `v0.5.7` 本地提交，不 push；记录提交 ID、两个工件哈希和 `git diff --check` 结果。
3. 归档 023 最终脱敏证据，确认无随机流量且 012 正常。
4. 经行动时授权结束 023 的 0% 条件灰度；立即回读 012 仍为默认版本。
5. 从已校验 ZIP 解压出的干净临时目录部署 024，发布类型保持 `GRAY`；禁止选择 `FULL`。
6. 024 为 `normal` 后，复用原 `myroot_canary` 路由键和值配置 `URL_PARAMS / 0%`；不得生成新明文路由值或写入仓库。
7. 定向验证 `/health`、`/ready`、隐私说明和对象存储精确写删；无参数 `/health` 至少 15 次不得命中 `0.5.7`。
8. Cloud Function 继续 `ROOT_JOB_DRY_RUN=true`；路由更新到 024 后执行 11/11 dry-run，不执行真实提醒、清理、发券、企微或物流动作。

## 5. 影响与回滚

- 影响：023 的条件候选会被 024 替代；012 的默认流量、生产 MySQL 数据和 Cloud Function execute 状态不变。
- 024 构建失败：停止并放弃 024，保持 012 默认流量；根据 023 版本仍可用情况恢复原条件路由。
- 024 运行探针失败：立即结束 024 条件路由，默认流量继续由 012 承接；不上传小程序。
- 路由误命中默认请求：立即放弃 024 灰度并回读至少 15 次无参数 `/health`，确认全部回到 012。
- 不删除 012、023 或历史版本，不轮换/撤销现有对象存储 Key，不执行数据库回滚。

## 6. 执行后仍未满足 Gate

1. 024 已按本预检顺序完成部署、条件路由、运行探针和默认流量保护，详见 [024 生产证据](./production_gray_release_024_2026-07-13.md)。
2. 两个 Cloud Function 部署包仍为 0.5.6；仓库包为 0.5.7，需单独授权部署并保持 10+1 触发器和全局 dry-run。
3. 尚未配置和校准真实有赞、企微、物流、告警与外部履约凭据。
4. 尚未上传 `v0.5.7` 体验版或完成真机登录、隐私、订阅、媒体、结算和 Root 会员中心跳转证明。
5. 尚未执行 5% 灰度、完整业务回滚演练、最终证据包留档和产品/运营/研发三方签字。

在以上 Gate 关闭前，正式发布状态保持 `BLOCKED`。
