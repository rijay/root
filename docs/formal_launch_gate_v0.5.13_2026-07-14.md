# myRoot v0.5.13 正式上线 Gate

日期：2026-07-14

状态：`BLOCKED / INTERNAL_TRIAL_CAN_CONTINUE / LOCAL_VERIFY_PASS / LOCAL_COMMITS_CREATED / CLOUDBASE_CLI_AUTH_PASS / WECHAT_DEVTOOLS_CLI_AUTH_PASS / BILLING_ASSURANCE_PASS / PRODUCTION_UNCHANGED`

当前生产候选：`myroot-api-027 / v0.5.12 / URL_PARAMS / 0%`

本地下一候选：`v0.5.13 / code commit c3d14f2 / documented in current commit / planned myroot-api-028 / NOT_PUSHED / NOT_TAGGED / NOT_DEPLOYED`

## 1. 实际读取来源

1. 当前工作树、版本文件、微信 stable token Module、后端测试、发布 Gate、生产环境矩阵、外部 Adapter 和发布证据文档。
2. 本地 `npm run verify`、`git diff --check`、版本残留检查和 Git 状态。
3. 已登录的有赞云控制台：ROOT 店铺授权、A 套餐、API 账单、597 个 Interface、能力包、回调和 IP 白名单页面。
4. CloudBase CLI 3.5.7 的完整权限登录与环境列表回读，以及微信开发者工具 CLI `islogin` 的行动时回读。
5. 027 已保存的生产运行、Function、提醒、对象存储、工件和回滚证据，以及行动时只读刷新得到的发布单、15 次默认 `/health`、`/ready` 与四组发布 Gate Interface。

## 2. 缺失与工作假设

1. CloudBase CLI 身份已恢复且可见生产环境；微信开发者工具 CLI 已完成扫码并独立回读为 `login=true`。两套身份 Gate 已关闭，但部署、Function 更新和体验版上传仍须分别确认。
2. 有赞 ROOT 店铺、A 套餐和读取 Interface 已确认；当前 secret 必须轮换，token 尚未换取，隐私字段返回形态尚未探测。
3. 优惠券管理能力包及发送、查询目标 Interface 已授权；token、活动参数、字段形状和真实回执仍未验证，不能据此执行奖励真实动作。
4. 企业微信、物流、外部告警 Webhook、负责人路由和生产联合回滚仍缺正式材料。
5. 027 只证明 v0.5.12 运行；v0.5.13 必须创建新候选并重新建立发布级证明。
6. CloudBase 计费回读为标准版预付费、`IsAutoRenew=true`、到期 `2026-07-23 23:59:59`。费用中心余额 Interface 因 CLI 权限不足未返回数据，但项目负责人已明确确认腾讯云及其他项目费用不构成上线风险，因此计费保障 Gate 已关闭；本轮不申请费用权限、不创建告警、不手工续费。

## 3. 当前 Gate 矩阵

| Gate | 当前结果 | 正式上线影响 |
| --- | --- | --- |
| v0.5.13 本地候选 | `code commit c3d14f2 / 16/16 PASS / 232 JS files` | 本地代码可追溯；尚无远端或运行证明 |
| v0.5.13 预提交工件 | 181 文件、结构/版本/凭据模式/完整性通过 | `DO_NOT_DEPLOY`；提交后必须重建 |
| 微信 stable token Module | POST 契约、缓存、并发、轮换隔离与失败关闭测试通过 | 仍需 028 运行探针和真机验证 |
| 027 生产候选 | `v0.5.12 / 0% / PASS_RUNTIME` | 历史候选，不包含 v0.5.13 |
| 027 行动时发布 Gate | `BLOCKED / 45 must-fix / 17 gray confirm / Evidence Intake 3 of 15 / Cutover 4 of 15 / Signoff 0 of 3` | 只用于定位剩余工作，不能作为 v0.5.13 证明 |
| CloudBase CLI | 已登录，可见生产环境 | `PASS_AUTH` |
| CloudBase 环境计费 | 标准版预付费，`Normal / IsAutoRenew=true`，到期 `2026-07-23 23:59:59`；负责人确认费用保障 | `PASS_OWNER_ASSURANCE` |
| 微信开发者工具 CLI | 扫码后独立回读 `login=true` | `PASS_AUTH` |
| Cloud Function | v0.5.10 线上包已重新下载；10+1 触发器、6+6 变量、全局 dry-run 与 canary 均未漂移 | 预检通过；必须单独确认对齐 v0.5.13 并复测 11/11 Job |
| 有赞店铺与套餐 | ROOT 已授权；A 套餐当前月 500,000 次、20 QPS | `PASS_CONTROL_PLANE` |
| 有赞读取 Interface | 商品、订单、客户、用户查询目标方法已授权 | 仍需 token、密文探针与最多 3 条 PREVIEW |
| 有赞优惠券 | 能力包与发送/查询目标 Interface 已授权 | `PASS_CONTROL_PLANE`；真实查询、发券与幂等回执仍阻塞 |
| 有赞隐私字段 | 返回形态未探测 | `BLOCKED_IMPORT` |
| Root 会员中心跳转 | appId、商品镜像与路径已有；v0.5.13 真机证明 0 条 | `BLOCKED` |
| 次日提醒 | 025 为 `HTTP 412 / UNKNOWN`；无 v0.5.13 真实送达 | `BLOCKED` |
| 外部读取/动作 Adapter | 027 行动时回读为读取 `0/4`、动作 `0/4`；有赞控制面前置改善，但 CloudRun 尚无有赞、企微、物流与外部告警变量 | `BLOCKED` |
| 生产联合回滚 | 本地 `9/9 PASS`，生产联合演练未做 | `BLOCKED` |
| 生产证明与签字 | 发布级证明未绑定 v0.5.13；签字 0/3 | `BLOCKED` |

## 4. 推荐执行顺序

1. 在已恢复的 CloudBase CLI 中重新下载两个线上 Function 包，只读核对版本、变量、触发器和哈希。
2. `COMPLETE_BILLING_ASSURANCE`：自动续费与到期时间已回读，负责人已确认费用保障；不再申请费用权限，不执行手工提前续费。
3. `COMPLETE_AUTH`：微信开发者工具 CLI 已完成扫码并只读回验；不因登录成功自动上传。
4. `COMPLETE_LOCAL_COMMITS`：运行候选已提交为 `c3d14f2`，本 Gate 由随后文档提交收录；未 push、未 tag、未部署。
5. 单独确认部署 `myroot-api-028 / v0.5.13 / 0%`，配置唯一 `ROOT_RELEASE_ID`，完成 T-012 与 15 次默认流量保护检查。
6. 单独确认对齐两个 Cloud Function 到 v0.5.13，保持全局 dry-run，复测 11/11 Job。
7. 单独确认上传同源 v0.5.13 体验版。028 建立后新建权限为 0600、`versionName=myroot-api-028` 的路由元数据文件；旧 `myroot-api-023-route.json` 只能提供受控 canary 值，不能直接生成 028 体验码。随后用带 028 参数的 trial 小程序码完成登录、隐私、画像、参加、打卡、订阅和 Root 会员中心跳转。
8. 轮换有赞 secret；受控换取只读 token，完成隐私字段探针与最多 3 条订单/客户 PREVIEW。IMPORT、发券、查券分别确认。
9. 使用新独立账号取得一次性订阅额度；先单任务 dry-run，再单独确认一次真实提醒。
10. 补齐企微、物流、告警负责人、Webhook、生产联合回滚与严格证据包，完成产品、运营、研发三方签字。
11. 所有 blocker 清零后，单独确认进入 5% 灰度；观察通过后再决定正式切流。

## 5. 高影响动作拆分

以下动作不能合并授权：CloudBase 手工续费、创建提交、push/tag、轮换有赞 secret、换取 token、只读真实数据探针、外部 IMPORT、CloudRun 部署、Function 更新、体验版上传、真实提醒、生产证明写入、5% 灰度、正式切流。

任一步失败即停止，不自动重试一次性发送，不删除 012、027 或历史证据，不用旧候选证明关闭 v0.5.13 Gate。

有赞当前脱敏结果见 [有赞 ROOT 店铺脱敏回读证据](./youzan_live_readback_v0.5.13_2026-07-14.md)，CloudBase 登录与到期证据见 [CLI 身份与环境到期回读](./cloudbase_cli_auth_and_expiry_v0.5.13_2026-07-14.md)，Function 基线见 [v0.5.13 对齐预检](./cloud_functions_v0.5.13_preflight_2026-07-14.md)，预提交包见 [v0.5.13 预提交候选工件](./cloudrun_candidate_v0.5.13_precommit_2026-07-14.md)，本版代码范围见 [v0.5.13 发布说明](./release_notes_v0.5.13.md)。
