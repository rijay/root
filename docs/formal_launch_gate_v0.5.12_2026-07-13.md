# myRoot 正式上线 Gate

日期：2026-07-13

历史说明：本文保留 `027 / v0.5.12` 的行动时证据。当前本地候选已升级为 v0.5.13，执行状态与顺序以 [v0.5.13 正式上线 Gate](./formal_launch_gate_v0.5.13_2026-07-14.md) 为准；不得把本文的 027 发布级证明复用到新候选。

状态：`BLOCKED / INTERNAL_TRIAL_CAN_CONTINUE / STABLE_TRAFFIC_UNCHANGED / FUNCTION_ALIGNMENT_PREFLIGHT_PASS / TRIAL_PREFLIGHT_PASS`

当前生产候选：`myroot-api-027 / v0.5.12 / URL_PARAMS / 0%`

候选来源：`ef9fab932a08 / releaseId=v0.5.12+ef9fab932a08`

## 1. 实际读取来源

1. 当前工作树的发布 Gate、生产环境矩阵、外部 Adapter 校准、发布证据包、Admin 迁移、Root 会员中心跳转和签字 Module。
2. CloudBase 生产环境 `myroot-prod-d5gl3gzg7115f149a` 的 027 候选、发布单、Store、两个 Cloud Function 和脱敏 Admin 发布记录只读回读。
3. 2026-07-14 刷新有赞云应用中心后，`myRoot会员数据对接` 不再显示“审核中”并可进入正式概览；App Id、`client_id`、`client_secret` 字段已生成。凭据值未记录，当前 secret 因临时截图暴露必须轮换。
4. 本地定向测试、Admin 构建和完整 `npm run verify`。

## 2. 缺失材料与工作假设

1. 有赞云自用型应用已审核通过；仍缺凭据轮换、质量负责人、ROOT 店铺授权、`API 套餐包`与额度、能力范围、消费者隐私数据加密状态、token 管理和只读样本，因此有赞订单、客户、商品和券动作不能做真实校准。当前代码没有有赞通知接收 Interface，回调地址明确留空，不作为主动拉取链路的完成条件。
2. 缺少企业微信正式 CorpID、凭据、客户联系与标签/回写 Interface 配置；因此企微真实 Adapter 仍阻塞。
3. 缺少物流正式数据源选择、地址与密钥；因此履约 Adapter 仍阻塞。
4. 缺少同版本体验版真机记录、Root 会员中心商品跳转证明和次日提醒实际送达证明。
5. 本地完整业务回滚演练已 `9/9 PASS`；仍缺生产候选的 MySQL 快照、流量、Cloud Function 和运营手工回退联合演练，以及外部告警负责人姓名/联系方式、Webhook、5% 灰度观察和三方签字。
6. 以上缺口不阻塞继续内部体验，但任何一个都不能用本地测试或配置存在性替代为正式发布证明。
7. 两个 Cloud Function 当前代码包仍为 `0.5.10`；v0.5.12 只更新代码预检已通过，但云端更新和 11 Job 生产 dry-run 尚未取得行动时确认。
8. 微信开发者工具 CLI 当前未登录；小程序 v0.5.12 上传包与普通小程序 `getQRCode(env_version=trial)` 带参小程序码方案预检已通过，但尚未上传或生成小程序码。

## 3. 当前只读结论

| Gate | 当前结果 | 正式上线影响 |
| --- | --- | --- |
| 027 候选运行 | `PASS_RUNTIME`；0% 条件路由，15 次无参数请求未命中 | T-012 运行材料已具备，正式证明尚未写入 Intake |
| CloudBase Store | `READY / 5 of 5` | 数据仓库决策已关闭 |
| Cloud Function | `0.5.10 code / Active / Available / 10+1 triggers / dry-run` | v0.5.12 对齐预检已通过，仍待单独确认更新与 11 Job 复测 |
| 本地业务回滚 | `9/9 PASS / 6 audit logs / LOCAL_SIMULATION` | Implementation 已验证；不能替代生产候选联合回滚 |
| Production Env Matrix | 21 组：9 通过、6 可选、6 阻塞；缺失 22 项 | `BLOCKED` |
| 有赞应用 E-01 | `APPROVED`；正式控制台可访问，应用字段已生成 | E-01 已关闭；当前 secret 必须轮换，ROOT 店铺授权与能力范围待回读 |
| 外部读取 Adapter | 4 个来源全部 `BLOCKED` | 不能正式同步有赞、物流、企微 |
| 外部动作 Adapter | 4 个动作全部 `BLOCKED` | 不能正式发券、查券、打标签、回写 |
| Root 会员中心 | appId、路径和商品存在；真机证明 0 条 | `BLOCKED` |
| 提醒送达 | 025 唯一发送为 `HTTP 412 / UNKNOWN`；未重试 | `BLOCKED` |
| 外部通道 | 7 条负责人路由缺姓名/联系方式，Webhook 未配置 | `NEEDS_REVIEW` |
| Admin 迁移 | 6/6 Module 和 dist 就绪；旧入口仍保留 | 安全警告，不阻塞内部体验 |
| 三方签字 | 产品、运营、研发 0/3 | `BLOCKED` |
| 生产切换证明 | 027 定向回读为 4/15；T-012、T-015 均为 `proofSource=NONE` | `BLOCKED` |
| v0.5.12 体验版 | 157 个上传源文件检查通过；Route Module 已覆盖 `onLaunch/onShow`；CLI 未登录 | `PREFLIGHT_PASS / NOT_UPLOADED` |

2026-07-13 21:36（Asia/Shanghai）再次只读复核：026 仍为 `normal / URL_PARAMS / flowRatio=0`，稳定版仍为 012；定向 `/health=200 / version=0.5.11`、`/ready=200 / mysql / migration 005`。两个 Cloud Function 仍为 `Active / Available / ROOT_JOB_DRY_RUN=true`，10+1 个触发器全部启用；本轮未调用 Job、未上传体验版、未发送提醒、未修改流量或生产配置。

2026-07-13 23:27（Asia/Shanghai）经单独确认部署 `myroot-api-027 / v0.5.12 / URL_PARAMS / flowRatio=0`。定向 `/health`、`/ready`、隐私和 Admin 首次命中即通过，三条版本响应均归因到 `releaseId=v0.5.12+ef9fab932a08`；MySQL 为 connected、迁移 005、schema 级最小权限强制执行。15 次无参数 `/health` 中 027 命中 0 次。两个 Cloud Function 仍为 `Active / Available / ROOT_JOB_DRY_RUN=true`，10+1 个触发器全部启用且路由匹配；本轮未更新 Function、未调用 Job、未上传体验版、未发送提醒、未进入 5% 流量。027 定向生产发布记录回读仍为 `BLOCKED / 4 of 15`，T-012 与 T-015 都没有正式证明来源或证据引用。完整证据见 [候选 027 证据](./production_gray_release_027_2026-07-13.md)。

2026-07-14 07:20（Asia/Shanghai）再次从 027 定向 Interface 只读复核：发布记录为 `BLOCKED`，含 45 个 must-fix 和 17 个进入灰度前确认项；上线 Gate 为 4/8 通过，Production Env Matrix 为 9 通过、6 可选、6 阻塞，读取 Adapter 0/4、动作 Adapter 0/4，生产切换证明 4/15，签字 0/3。严格证据包结构校验为 `PASS`，但包状态仍为 `BLOCKED`。两个 Function 的线上包均为 0.5.10，本地 0.5.12 仅 `package.json` 版本不同，专向测试 7/7、11 Job Manifest 和候选/回滚包校验均通过；本轮未更新云端或调用 Job。详见 [Cloud Function v0.5.12 对齐预检](./cloud_functions_v0.5.12_preflight_2026-07-14.md)。

2026-07-14 07:30（Asia/Shanghai）复核 027 运行态：定向 `/health`、`/ready` 和隐私说明均为 HTTP 200、业务码 0、`version=0.5.12` 且唯一 releaseId 匹配；MySQL connected、迁移 005、隐私保存期 180 天。额外 15 次无参数健康请求全部正常且 027 命中 0 次；稳定版旧响应不返回版本字段，因此只记录为“未命中 027”，不推断其版本。小程序上传集合专向检查通过且无候选值字面量；对抗式审查发现后台扫码唤起只触发 `App.onShow` 时原 Route Module 不会刷新路由，已在本地修复并通过 20/20 场景。微信开发者工具 CLI 当前未登录，本轮未上传、未生成体验二维码。详见 [v0.5.12 体验版预检](./miniprogram_v0.5.12_trial_preflight_2026-07-14.md)。

2026-07-14 07:40（Asia/Shanghai）复核 027 工件追溯：原始 ZIP 仍可读取，SHA-256 与发布记录一致；从 `ef9fab9` 重建的 ZIP 大小和条目结构一致，解压后逐文件比较零差异。重建 ZIP 因容器元数据不同而具有另一 SHA，不能覆盖原始哈希。`ef9fab9` 不在任何远端分支或 tag 上，原始 ZIP 也只位于本机临时目录，因此 T-012 仍待永久证据引用，T-015 继续因远端追溯阻塞；本轮未写生产证明。详见 [生产切换证明预检](./production_cutover_proof_preflight_v0.5.12_2026-07-14.md)。

2026-07-14 07:45（Asia/Shanghai）再次只读复核：两个 Function 详情未漂移，仍为 `Active / Available / CodeSize=3398 / 6 vars / dry-run / 10+1 triggers`，修改时间停留在上一轮 0.5.10 部署。最新代码下载因 CLI 身份失效未完成，未执行更新或 Job。开发者工具仍为 `login=false`。小程序目录中的旧嵌套 Git 无远端且不是发布权威来源；已把 `.git` 加入微信上传显式排除并通过专向检查，当前上传集合为 157 个文件、510,231 bytes，清单 SHA-256 为 `abbff642386d53525ae8d5338d656bbea03f1eacbb2e259b309f912869f44097`。

同一轮以 Function 受控路由请求 `/health`，成功归因到 027；Function Job token 请求 8 个 Admin GET 均返回 `40101`。该结果与 job-only 权限设计一致，但无法排除 Function/027 token 漂移，因此不作为权限或 Job 可用性通过证据；仍须在代码对齐后用 11/11 生产 dry-run 关闭。

2026-07-14 12:01（Asia/Shanghai）重新检查行动条件：CloudBase CLI 3.5.7 返回“无有效身份信息”，微信开发者工具 CLI 返回 `login=false`。没有启动任一登录流程、更新 Function、调用 Job、上传小程序或生成体验二维码。Function 候选与回滚 ZIP 均仍存在，SHA-256 分别保持 `8b4870f1b280040c18e984d349d73e0c6b31b6dc670e65d5fe95edaab0aa9ef7` 和 `00be904f5eb2914a28e4e692a34003e0e7fe2793f1eeefe16a8256806b6fdbe6`；工件未漂移不能替代云端身份恢复与线上包重新下载。

2026-07-14 12:05（Asia/Shanghai）将 027 原始部署 ZIP 字节级复制到工作区忽略目录 `release-artifacts/v0.5.12/`，副本大小 1,076,513 bytes，SHA-256 仍为 `ff4491fafa36f8dc68b12593c46ac258397c24bce89c780228d6aa1242b586cc`，与 `/private/tmp` 原件比较一致。该动作只降低系统临时目录清理风险；文件仍仅在本机，远端 commit/tag、团队工件链接和正式 `evidenceRef` 均未形成，因此 T-015 继续阻塞。详见 [发布工件本地持久化清单](./release_artifact_manifest_v0.5.12_2026-07-14.md)。

2026-07-14 12:40（Asia/Shanghai）修正 T-013 体验入口：第三方平台 `getTrialQRCode` 不适用于本项目；普通小程序官方 `getQRCode` 可用自身 `access_token`、带 query 的 `path` 与 `env_version=trial` 生成指向已上传体验版的小程序码。Route Module 无需新增 scene 解析，专向场景仍为 `20/20 PASS`。同一时点开发者工具仍为 `login=false`，CloudBase CLI 仍无有效身份；未上传、未生成小程序码、未部署 Function 或调整流量。

随后补齐本地 trial 小程序码发布工具：默认 dry-run，强制 `/private/tmp + 0600` 的 027 路由与微信凭据文件，使用与经典 token 隔离的 `stable_token(force_refresh=false)`，只接受 trial path 和单个 PNG/JPEG 响应；无网络契约测试通过。工具尚未读取真实凭据或调用微信；`40164`、凭据错误、版本漂移或非图片响应都必须首次失败关闭。

2026-07-14 15:03（Asia/Shanghai）以 synthetic 027 路由文件完成 CLI dry-run，脱敏输出为 `networkCalled=false` 且未产生图片；新增重定向拒绝和联网前输出目录可写检查后，完整 `npm run verify` 为 `16/16 PASS`、JavaScript 语法 230 文件通过。本轮仍未读取真实 AppSecret、调用微信、上传体验版或修改生产状态。

## 4. 本地 v0.5.12 Gate 修复

新增 5 个必验项，并在证据收口中加入 `T-011` 至 `T-015`：

| ID | 证明项 | 验收要点 |
| --- | --- | --- |
| T-011 | 次日打卡订阅提醒真实送达 | 新独立账号、新一次性额度、恰好一次发送、真机可见、任务与额度账本回读；`UNKNOWN` 禁止重试 |
| T-012 | CloudRun 候选运行 Gate | 版本/releaseId、0% 路由、健康/就绪、VPC/变量/规格、15 次默认流量保护 |
| T-013 | 同版本体验版真机核心流程 | 关闭调试后完成登录、隐私、健康同意、画像、参加、打卡、订阅、商品跳转 |
| T-014 | 5% 灰度观察与回滚阈值 | 备份完成、阻塞清零、至少 30 分钟、20 并发、错误率/延迟/回滚阈值 |
| T-015 | 候选工件与版本库追溯 | ZIP、SHA256、BuildId、版本号、commit/tag、可获取回滚源码一一对应 |

本地验证为 `15/15 PASS`，但这些结果只证明 Gate Implementation 正确，不代表 5 个生产证明已完成。

正式目标额外执行三项证据约束：

1. `VERIFIED` 写入必须有脱敏后的 `evidenceRef`。
2. 环境布尔值只作为灰度准备信号，不能单独关闭正式 Gate。
3. 已有证明但缺少支持变量时，正式目标仍为 `BLOCKED`。
4. 5 个发布级证明由后端自动绑定当前 `version + releaseId`；`releaseId` 必须来自显式、唯一的 `ROOT_RELEASE_ID`，版本号 fallback 不可用于正式证明。
5. 旧候选、缺字段、未显式配置 releaseId 或客户端伪造的版本绑定不能关闭当前候选 Gate。
6. 其余 10 个运行环境证明可以跨候选复用；线上已有的开放平台、UnionID、Root 会员中心 AppID 和 CloudBase Job 四条记录不需要重复录入。

2026-07-13 只读回读结果：线上 4 条记录均为 `VERIFIED` 且 `evidenceRef` 非空，均未带版本字段；四条记录全部属于运行环境证明，因此与新的版本绑定策略兼容。回读只输出证明项、状态和字段存在性，没有输出证据地址、凭据或用户数据。

## 5. 正式上线执行顺序

1. `COMPLETE_E01`：有赞云应用已审核通过并进入正式控制台；凭据值未保存，当前 secret 因临时截图暴露必须轮换。
2. 经单独确认轮换 secret 并配置质量负责人；回调地址保持空白。随后只读回验 ROOT 店铺授权、`API 套餐包`与额度、能力范围、消费者隐私数据加密状态、`grant_id` 与 token 管理。由唯一负责人在受控终端按官方 `POST /auth/token` 契约集中换取，首次使用 `refresh=false`，计划轮换时才使用 `refresh=true`；`client_secret` 不进入 CloudRun。再以最小权限补齐有赞变量。若授权待确认，由 ROOT 店铺管理员在店铺后台确认；先做脱敏样本评审和 PREVIEW，若出现密文则先补解密 Implementation，最后分别确认最小批量订单/客户同步和券动作。
3. 确认物流数据源；补齐正式地址、密钥、字段样本，按同样顺序完成 PREVIEW 与最小批量校准。
4. 补齐企微凭据、外部联系人、标签、回写模板与顾问路由，先读后写、逐个动作确认。
5. 为外部告警与导出交付补负责人和 Webhook；把已完成的对象存储精确写删证据录入正式切换证明。
6. 本地 `MANUAL_SAMPLE`、Adapter rollback、字段快照、游标、幂等和审计已完成；在正式候选阶段补 MySQL 快照、流量、Cloud Function 与运营人工兜底联合演练。
7. `COMPLETE_RUNTIME`：已从本地提交生成 v0.5.12 工件，配置唯一 `ROOT_RELEASE_ID`，部署 027 0% 候选并完成 T-012 运行验证；先把证据文档和候选提交形成团队可访问的永久引用，再单独确认写入 T-012。T-015 还要求已推送 commit/tag 与可获取的原始工件，当前不能写入。
8. 经单独确认对齐两个 Cloud Function 代码包，保持全局 dry-run，复测 11/11 Job。
9. 先经单独确认创建并回读本地候选 commit，确保上传包可追溯；再登录微信开发者工具并上传同版本体验版。使用普通小程序官方 `getQRCode` Interface、`env_version=trial` 和带候选参数的 `path` 生成入口，完成 T-013 和 Root 会员中心跳转证明。第三方平台 `getTrialQRCode` 不适用于本项目，默认无参体验二维码也不能建立 027 归因。
10. 使用新的独立账号取得一次性额度；先做恰好一个任务的 dry-run，再单独确认执行一次真实提醒，完成 T-011。
11. 重新生成严格证据包，清零生产 blocker，完成产品、运营、研发三方签字。
12. 经单独确认进入 5% 灰度并完成 T-014；通过后再单独决定是否全量切流。

有赞、企微、物流的精确变量、样本表头、PREVIEW/IMPORT 顺序、真实动作拆分和回滚规则见 [外部 Adapter 正式接入执行包](./external_adapter_activation_v0.5.12_2026-07-13.md)。

本地回滚演练的范围、9 项结果和不能替代的生产证明见 [v0.5.12 本地完整回滚演练](./production_rollback_drill_v0.5.12_2026-07-13.md)。

027 的提醒请求契约、HTTP 412 推断、单次复测前置和停止规则见 [027 次日打卡提醒复测就绪审查](./checkin_reminder_027_retest_readiness_2026-07-14.md)。该审查只证明可复测，不证明已送达。

## 6. 高影响确认点

以下动作不得合并授权：

1. 创建有赞云应用并提交审核。
2. 保存或轮换生产凭据。
3. 执行任一真实外部写动作。
4. 部署新 CloudRun 候选。
5. 更新两个 Cloud Function 代码包。
6. 上传小程序体验版。
7. 消费一次性订阅额度并发送提醒。
8. 调整到 5% 流量。
9. 正式切流或删除历史候选。

任一动作失败时立即停止；回滚到最近已验证状态，不自动重试一次性发送，不删除历史证据。

## 7. 下一行动

E-01 已关闭；下一项有赞动作由用户在后台完成新 secret 轮换、质量负责人、ROOT 店铺授权、`API 套餐包`与额度、商品/订单/客户/User Query/优惠券能力包和消费者隐私数据加密状态确认，回调地址保持空白。官方 token 契约已只读确认；待上述状态回读后，唯一负责人再在受控终端集中换取，不把 `client_secret` 放入 CloudRun。v0.5.12 商品展示继续由已验证镜像和真机跳转 Gate 承接，持续自动商品同步不夹带到 E-03。Cloud Function 对齐也已完成预检，仍需另一项单独确认后更新两个代码包并复测 11/11 dry-run；体验版上传、T-012/T-015 写入、commit/push 和工件远端化继续独立授权。当前不得保存旧 secret、启用真实同步或合并这些授权。
