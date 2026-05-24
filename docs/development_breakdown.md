# ROOT 7 日试饮打卡流程更新开发拆单

版本：V0.29
日期：2026-05-16
依据：[flow_update_prd.md](./flow_update_prd.md)
状态：核心流程、上线前自动验收、灰度 JSON 文件 Adapter、SQLite Adapter、真实样本导入校验、表格取样入口、取样模板、取样评审台账、未知枚举映射、Adapter 准入、上线闸口、真实平台 Adapter Seam、Adapter 运行可靠性、三类可配置 HTTP Implementation、Adapter 上线校准包、发布记录 Module、命令行发布校准工具、命令行样本准入工具、真实 Adapter 小批量运行工具和最终开发验收工具已完成；正式上线前需要用真实账号执行校准流程并完成发布记录签字

## 0. P0 修订记录

本版吸收 [development_breakdown_review.md](./development_breakdown_review.md) 的 P0 评审结论，完成三处前置修正：

1. 将隐私授权与数据最小化前置为 `DEV-0004`。
2. 将最小 Operation Task Module 前置为 `DEV-1004A`，避免 Batch 1 绕过 Module 直接写待办数据。
3. 将旧免单申请路径退役前置为 `DEV-2005A`，避免用户绕过 Day8 收尾问卷进入退款。

## 0.1 P1 修订记录

本版继续吸收评审中的 P1 建议，完成五处修正：

1. 新增 `DEV-0005 数据仓库 Implementation 决策`，明确演示与上线两种路径。
2. 新增 `DEV-1003A Flow View Presenter Module`，让 `flowView` 成为稳定 Interface，而不是散落在页面逻辑里。
3. 新增 `DEV-1003B 人工异常路径闭环`，补齐无订单、物流异常、手机号冲突后的用户端与后台动作。
4. 扩展 `DEV-2001` 的问卷题型、校验、版本兼容和幂等规则。
5. 收窄 `DEV-3003` 为后台最小运营视图，并把用户详情聚合调整为 Batch 3.5。

## 0.2 P2 修订记录

本版补齐三处开发执行护栏：

1. 新增 `DEV-0006 小程序页面 Canonical 路径确认与旧页面处置`，明确分包打卡页为 Canonical。
2. 新增最小上线手工验收矩阵，让验证更接近真实运营流程。
3. 新增 Batch 回滚点，避免某一批次异常时只能整体回退。

## 0.3 第一段实现记录

本轮完成 `DEV-1001` 到 `DEV-1003` 的第一段代码实现：

1. 扩展 seed 和 `schema.sql`，新增身份、线索、物流履约和运营待办数据对象。
2. 新增 Identity Module，集中处理收货手机号绑定、企业微信线索和身份 warning。
3. 修改订单匹配：匹配成功只绑定订单和返回下一步，不再自动创建 7 天打卡周期。
4. 修改启动打卡：必须已匹配订单且物流为 `DELIVERED`，否则不能启动 Day1。
5. 更新订单匹配页和首页启动文案，避免继续表达“匹配即开始”。
6. 后端测试和小程序静态检查已通过。

## 0.4 第二段实现记录

本轮完成 `DEV-1003A`、`DEV-1004A`、`DEV-1003B`、`DEV-1004` 的代码实现：

1. 新增 Flow View Presenter Module，`getUserState` 返回 `flowView`、`allowedActions` 和 `homeView`。
2. 新增最小 Operation Task Module，支持创建、查询和完成 open 待办，并按同日同类型去重。
3. 新增 Order Fulfillment Module，支持物流更新、手工订单同步和已送达待开始用户查询。
4. 订单无匹配、订单冲突、物流异常和无订单强行开始都会进入 `MANUAL_REVIEW_REQUIRED` 待办。
5. 后台 Dashboard 增加运营待办和已送达待开始列表。
6. 小程序首页增加人工确认视图。
7. 后端测试和小程序静态检查已通过。

## 0.5 Batch 2 实现记录

本轮完成 `DEV-2001` 到 `DEV-2006` 的代码实现：

1. 新增 Questionnaire Module，支持问卷定义、必填校验、题型校验、状态查询和幂等提交。
2. 新增 Refund Work Item Module，退款资格改为订单有效、物流送达、7 天完成、断卡未超规则、Day8 已完成。
3. Day4 打卡后生成中期问卷动作和待办，但不阻塞 Day5。
4. Day7 完成后进入 Day8 收尾问卷，Day8 未提交时旧免单路径不能创建退款工作项。
5. Day8 提交后自动创建人工退款工作项，重复申请不会重复创建。
6. 小程序新增问卷页，并更新退款申请与退款状态页文案。
7. 后端测试和小程序静态检查已通过。

## 0.6 Batch 3 实现记录

本轮完成 `DEV-3001`、`DEV-3002`、`DEV-3003`、`DEV-3005` 的代码实现：

1. 扩展 Operation Task Module，支持按状态/类型/用户/订单/日期查询，支持 `DONE` 和 `SKIPPED` 两种处理结果，并记录备注、metadata 和建议话术。
2. 同一日期同一触发条件不重复创建待办；已经完成或跳过的待办不会在同一天被重新打开。
3. 扩展 `runDailyAudit`，生成未打卡、连续未打卡、Day4 待问卷、Day8 待问卷和退款待处理等待办。
4. `runDailyAudit` 返回并写入 `dailySummaries`，Summary 覆盖今日应打卡、已打卡、未打卡、问卷待处理、退款待处理、open 待办和生成待办数。
5. 修正 daily audit 同日重复执行导致 `miss_count` 重复累加的风险，通过 `audited_miss_days` 保持同一漏打日期只计一次。
6. 后台新增今日 Summary、待办类型筛选、完成/跳过操作，并展示用户、原因、建议动作和建议话术。
7. 后端测试和小程序静态检查已通过。

## 0.7 Batch 3.5 实现记录

本轮完成 `DEV-3004` 的代码实现：

1. 新增后台用户详情 Interface，单次返回身份、线索、订单、物流、画像、打卡、问卷、反馈、退款资格和相关待办。
2. 后台用户、运营待办、已送达待开始列表均可打开用户详情。
3. 用户详情集中展示打卡反馈、问卷反馈和日常打卡反馈，并保留图片反馈入口数据。
4. 用户详情可从单条反馈生成 `FEEDBACK_FOLLOW` 待办，且按反馈来源去重，避免同一反馈重复开待办。
5. `operation_task` 增加 `dedupe_key`，让通用待办去重和反馈级去重可以共存。
6. 后端测试和小程序静态检查已通过。

## 0.8 Batch 4 实现记录

本轮完成 `DEV-4001` 到 `DEV-4004` 的代码实现：

1. 新增 Coupon Module，支持 Day6 触发、实验分组、领取、核销、复购点击和优惠券状态查询。
2. Day6 打卡后触发 `DAY6_REPURCHASE` 优惠券；Day6 前用户端不展示，领取后不阻塞 Day7 打卡和 Day8 问卷。
3. 小程序首页新增复购礼卡片，支持领取、展示券码和跳转店铺；Day6 打卡完成后以轻提示引导回首页领取。
4. 后台新增优惠券转化区，展示发券、领取率、使用率、对照组人数和优惠券事件列表。
5. 已领取未使用优惠券会在 daily audit 中生成 `COUPON_UNUSED` 待办；后台标记使用后自动关闭对应待办。
6. 复购点击会记录在优惠券事件里，并生成 `REPURCHASE_INTENT` 待办。
7. 后端测试和小程序静态检查已通过。

## 0.9 上线前验收记录

本轮完成上线前自动验收和发布文档整理：

1. 新增 `backend/tests/release_readiness.test.js`，覆盖等待物流、送达后启动、Day4、Day8、退款、Day6 优惠券、优惠券待办和 canonical 路径。
2. 新增 `docs/release_readiness.md`，沉淀自动验收、手工验收矩阵、真实 Adapter 对接清单、发布前阻塞项和推荐发布顺序。
3. 更新 `README.md`、`backend/README.md`、`DEPLOY.md`，去掉旧项目路径，补齐当前流程、优惠券和发布前检查。
4. 当前结论：演示/灰度试跑可继续；正式上线前必须完成数据仓库 Implementation、有赞订单 Adapter、物流 Adapter、企业微信线索 Adapter、微信正式登录密钥和 HTTPS 合法域名。

## 0.10 数据仓库 Seam 实现记录

本轮完成数据仓库 Seam 的第一段 Implementation：

1. 新增 Store Module，提供内存 Adapter 和 JSON 文件 Adapter，两者共享同一个数据形状。
2. `createApp` 改为接收 `storeAdapter`，HTTP Interface 请求结束后统一触发保存，调用方不需要知道底层 Implementation。
3. `server.js` 支持通过 `ROOT_STORE_FILE` 切换到 JSON 文件 Adapter；不设置时继续使用内存 Adapter。
4. JSON 文件 Adapter 启动时会补齐缺失的 seed 数据结构，并用临时文件重命名方式写入，降低半写入风险。
5. 新增 HTTP 持久化测试，验证用户资料修改后，重启新的 app 实例仍能从 JSON 文件恢复。
6. 当前判断：JSON 文件 Adapter 可用于内部灰度和运营试跑；正式上线仍需要 MySQL/PostgreSQL 等生产级 Adapter。

## 0.11 真实 Adapter 样本校验记录

本轮完成有赞订单、物流状态和企业微信线索的真实样本导入校验：

1. 新增 External Adapter Sample Module，负责字段别名映射、必填校验、状态枚举归一和导入结果回显。
2. 新增 `POST /api/v1/admin/external-samples/preview`，用于预览真实样本映射结果，不写入数据。
3. 新增 `POST /api/v1/admin/external-samples/import`，导入可识别样本，并复用已有 Order Fulfillment Module 和 Operation Task Module。
4. 后台新增「真实样本导入」面板，可粘贴 JSON 数组并先预览后导入。
5. 企业微信线索无法匹配用户时，自动生成 `LEAD_NEEDS_MATCHING` 待办。
6. 新增 [external_adapter_samples.md](./external_adapter_samples.md)，记录三类样本的最小字段、可识别字段名、状态映射和验收口径。

## 0.12 表格取样入口实现记录

本轮继续降低真实平台取样成本：

1. External Adapter Sample Module 支持直接解析 JSON 数组、CSV 文本和从表格复制出来的 TSV 文本。
2. 样本预览和导入路径都支持 `samples` 或 `text` 两种输入，后台不再要求运营把导出内容手工改成 JSON。
3. 后台「真实样本导入」面板的输入说明改为支持 JSON、CSV 或表格文本。
4. 新增测试覆盖有赞订单 CSV 和物流 TSV 的导入链路。

## 0.13 取样评审台账实现记录

本轮完成真实 Adapter 取样评审台账：

1. 每次样本预览或导入都会生成 `externalSampleReviews` 记录，并在 JSON 文件 Adapter 模式下持久保存。
2. 评审记录包含来源、输入类型、样本量、可导入数、已导入数、错误数、提醒数、字段覆盖率、缺失项和未知状态枚举。
3. 决策状态分为 `READY`、`NEEDS_REVIEW`、`NEEDS_MAPPING`、`BLOCKED`，用于判断真实平台 Adapter 是否可继续开发。
4. 后台「真实样本导入」面板新增「取样评审台账」，展示最近评审记录和覆盖率低的字段。
5. 未知订单/物流状态会阻止导入，并进入 `NEEDS_MAPPING`，避免把未确认枚举写入订单履约数据。

## 0.14 未知枚举映射实现记录

本轮完成 `NEEDS_MAPPING` 的闭环处理：

1. 新增可配置状态映射，默认状态映射仍保留，后台新增映射优先生效。
2. 新增 `POST /api/v1/admin/external-status-mappings`，支持把真实样本里的原始状态映射到内部订单或物流状态。
3. 后台「取样评审台账」对未知枚举显示映射选择和保存按钮。
4. 新增测试覆盖 `派送失败 -> EXCEPTION` 的映射流程，映射后同一 CSV 样本可继续预览和导入。
5. 当前支持 `deliveryStatus` 和 `orderStatus` 两类映射；企业微信添加状态暂只记录原文，不参与打卡启动和退款资格判断。

## 0.15 上线闸口实现记录

本轮完成正式上线前的只读准入检查：

1. 新增 Launch Readiness Module，集中检查数据仓库 Adapter、微信登录密钥、正式域名和三类真实样本评审状态。
2. 新增 `GET /api/v1/admin/launch-readiness`，支持按 `target=gray` 或 `target=production` 查看准入结论。
3. 后台管理台新增「上线闸口」，直接显示 `READY`、`NEEDS_REVIEW`、`BLOCKED` 以及阻塞/提醒/通过数量。
4. 灰度试跑允许 JSON 文件 Adapter，但正式上线会阻塞内存 Adapter 和 JSON 文件 Adapter。
5. 若样本评审仍为 `NEEDS_MAPPING` 或 `BLOCKED`，灰度和正式上线都会被阻塞，避免跳过字段确认。

## 0.16 SQLite Adapter 实现记录

本轮完成数据仓库 Adapter 的生产化过渡：

1. 新增 SQLite Adapter，继续满足现有 Store Module Interface，避免业务 Module 在本轮被迫感知数据仓库 Implementation。
2. `server.js` 支持通过 `ROOT_SQLITE_FILE` 启用 SQLite Adapter，且优先级高于 `ROOT_STORE_FILE`。
3. SQLite Adapter 使用 `root_store_snapshot` 表、WAL 和事务写入整块 Store 数据，降低 JSON 文件半写入和重启恢复风险。
4. 上线闸口中，`sqlite` 不再触发数据仓库阻塞；它适合单实例小范围上线前验证。
5. 新增 HTTP 持久化测试，验证 SQLite Adapter 在 app 重启后仍能恢复用户资料。
6. 多实例、高并发或需要逐表审计时，仍应把同一个 Store Module Seam 后面的 Adapter 迁移到 PostgreSQL/MySQL。

## 0.17 Adapter 准入实现记录

本轮把真实平台 Adapter 开发前的样本准入做成可视化检查：

1. External Adapter Sample Module 新增 Adapter Readiness 汇总，按有赞订单、物流状态和企业微信线索分别计算准入状态。
2. 准入规则要求每个来源最新评审至少 3 条样本、必填字段覆盖 100%、无未知枚举或阻塞错误。
3. 后台「真实样本导入」新增「Adapter 准入」面板，直接展示 `READY`、`NEEDS_REVIEW`、`BLOCKED`、样本数和下一步动作。
4. 上线闸口改为复用 Adapter Readiness，不再只看“最新评审是否存在”，避免 1 条样本误判为可进入真实 Adapter 开发。
5. 新增测试覆盖 1 条样本不足和三类样本全部达标后的上线闸口结果。

## 0.18 取样模板实现记录

本轮把“补齐真实样本”变成后台可执行动作：

1. External Adapter Sample Module 新增三类取样模板，包含必填字段、建议字段、CSV 表头和运营取样注意事项。
2. 新增 `GET /api/v1/admin/external-samples/template`，支持按来源获取取样模板，也支持返回全部模板。
3. 后台「真实样本导入」新增取样模板展示和「填入模板」按钮，运营可以先填入表头，再补真实数据。
4. 后台空输入不再自动使用演示样本，避免误把演示数据写入取样评审台账。
5. 新增 HTTP 测试覆盖物流取样模板路径。

## 0.19 真实平台 Adapter Seam 实现记录

本轮把真实平台接入从“样本导入能力”推进到“Adapter Seam 可替换”：

1. 新增 External Platform Adapter Module，统一管理 `MANUAL_SAMPLE`、有赞开放平台、物流推送和企业微信客户联系 Adapter。
2. `MANUAL_SAMPLE` Adapter 复用现有样本解析、预览、导入、评审和准入 Interface，作为当前可执行 Implementation。
3. 真实平台 Adapter 先进入配置可视化：缺少凭证时展示 `NEEDS_CONFIG`，凭证齐全但拉取 Implementation 未启用时展示 `CONFIG_READY`。
4. 新增 `GET /api/v1/admin/external-adapters` 和 `POST /api/v1/admin/external-adapters/run`，用于后台查看 Adapter 状态并执行取样预览或导入。
5. 后台「真实 Adapter 接入」展示每个 Adapter 的状态、缺失配置、下一步动作和最近运行记录。
6. 新增 Domain 与 HTTP 测试，验证手工 Adapter 能走同一个 Adapter Interface 完成预览/导入，并留下运行和评审记录。

## 0.20 Adapter 运行可靠性实现记录

本轮补齐真实平台 Adapter 接入前必须有的运行底座：

1. External Platform Adapter Module 新增 `externalAdapterCursors`，保存每个真实 Adapter 的增量游标和最后成功运行。
2. Adapter 运行记录扩展为成功和失败都落账，包含 `FAILED`、错误码、错误文案、外部返回数量、请求数量、游标前后值和是否还有下一页。
3. 真实 Adapter 缺少配置或 Implementation 未启用时，不再只返回错误，也会在后台留下失败记录，便于排查。
4. 后台「真实 Adapter 接入」展示最近运行状态、失败原因和已保存游标。
5. Adapter catalog 可根据是否注入真实 Implementation 把有赞/物流/企业微信 Adapter 标成 `READY` 或 `CONFIG_READY`。
6. 新增测试覆盖缺配置失败落账，以及有赞真实 Adapter Implementation 注入后导入样本并推进游标。

## 0.21 有赞订单 HTTP Implementation 实现记录

本轮把有赞订单从“待实现”推进到“可配置 HTTP 拉取”：

1. 新增 Youzan Open Adapter Module，负责构造有赞订单请求、读取 JSON 响应、抽取订单数组、映射字段和返回下一页游标。
2. `YOUZAN_OPEN` 在配置 `YOUZAN_ACCESS_TOKEN` 和 `YOUZAN_ORDER_LIST_URL` 后会进入 `READY`，可通过 Adapter Interface 执行 `PREVIEW` 或 `IMPORT`。
3. 请求方法、limit 参数名、cursor 参数名、token 位置、额外请求参数、订单数组路径、游标路径和 hasMore 路径均支持环境变量配置。
4. 字段映射支持默认候选路径，也支持 `YOUZAN_ORDER_FIELD_MAP` 按真实返回结构覆盖。
5. 有赞拉取结果继续进入 External Adapter Sample Module，不绕过必填校验、状态枚举、评审台账、Adapter 准入和上线闸口。
6. 新增测试覆盖可配置 HTTP 响应映射、订单导入和游标推进。

## 0.22 物流 HTTP Implementation 实现记录

本轮把物流状态从“待实现”推进到“可配置 HTTP 拉取”：

1. 新增 Fulfillment HTTP Adapter Module，负责构造物流状态请求、读取 JSON 响应、抽取物流事件数组、字段映射和返回下一页游标。
2. 新增 External Adapter Implementations Module，统一注册有赞和物流的默认真实 Implementation，避免 External Platform Adapter Module 感知平台细节。
3. `FULFILLMENT_PUSH` 在配置 `ROOT_FULFILLMENT_SECRET` 和 `ROOT_FULFILLMENT_LIST_URL` 后会进入 `READY`。
4. 请求方法、limit 参数名、cursor 参数名、密钥位置、额外请求参数、事件数组路径、游标路径和 hasMore 路径均支持环境变量配置。
5. 字段映射支持默认候选路径，也支持 `ROOT_FULFILLMENT_FIELD_MAP` 按真实返回结构覆盖。
6. 物流拉取结果继续进入 External Adapter Sample Module，再复用 Order Fulfillment Module 更新签收、异常件和已送达待开始待办。
7. 新增测试覆盖可配置 HTTP 响应映射、物流状态更新和游标推进。

## 0.23 企业微信 HTTP Implementation 实现记录

本轮把企业微信线索从“待实现”推进到“可配置 HTTP 拉取”：

1. 新增 WeWork Contact Adapter Module，负责构造企业微信线索请求、读取 JSON 响应、抽取外部联系人数组、字段映射和返回下一页游标。
2. `WEWORK_CONTACT` 在配置 `WEWORK_CONTACT_LIST_URL`，并提供 `WEWORK_ACCESS_TOKEN` 或 `WEWORK_CONTACT_SECRET` 后会进入 `READY`。
3. 请求方法、limit 参数名、cursor 参数名、token 位置、secret 位置、额外请求参数、线索数组路径、游标路径和 hasMore 路径均支持环境变量配置。
4. 字段映射支持默认候选路径，也支持 `WEWORK_CONTACT_FIELD_MAP` 按真实返回结构覆盖。
5. 企业微信拉取结果继续进入 External Adapter Sample Module，再复用 Lead Profile 写入和 `LEAD_NEEDS_MATCHING` 待办。
6. 新增测试覆盖可配置 HTTP 响应映射、线索导入和游标推进。

## 0.24 Adapter 上线校准包实现记录

本轮把真实账号接入前的校准步骤做成可执行检查：

1. 新增 Adapter Calibration Module，按有赞订单、物流状态和企业微信线索分别检查样本准入、运行配置、真实 Adapter 状态、最近成功运行和增量游标。
2. 新增 `GET /api/v1/admin/adapter-calibration`，提供只读校准结果。
3. 后台新增「Adapter 校准」面板，展示三类 Adapter 的阻塞、提醒、通过数量、缺失配置、校准检查和回滚方式。
4. 新增 [adapter_calibration_playbook.md](./adapter_calibration_playbook.md)，沉淀真实账号配置表、校准顺序、灰度试跑标准和回滚判断。
5. 新增测试覆盖校准缺配置、成功运行和游标检查。

## 0.25 发布记录 Module 实现记录

本轮把上线决策凭证从文档提醒推进到后台只读记录：

1. 新增 Release Record Module，汇总上线闸口、Adapter 校准、最近 Adapter 运行、增量游标、数据仓库 Adapter、环境变量存在性和运营风险。
2. 新增 `GET /api/v1/admin/release-record`，支持 `target=gray` 或 `target=production`。
3. 后台新增「发布记录」面板，展示发布建议、阻塞项、灰度确认项、签字位和最近运行。
4. 新增 [release_record_template.md](./release_record_template.md)，作为评审会议和上线复盘的填写模板。
5. 新增测试覆盖发布记录的阻塞判断、灰度目标、运行证据和回滚动作。

## 0.26 命令行发布校准工具实现记录

本轮把后台只读检查扩展成可在发布前执行的命令：

1. 新增 `scripts/release-calibration.js`，通过后台 HTTP Interface 拉取发布记录、上线闸口、Adapter 校准和真实 Adapter 运行台账。
2. 新增 `npm run calibrate`，支持 `--base-url`、`--target gray|production`、`--strict`、`--json` 和 `--allow-blocked`。
3. 报告输出必须修复项、灰度确认项、缺失环境变量、最近运行和回滚动作。
4. 退出码区分后台不可访问、`BLOCKED` 和 strict 模式下的 `NEEDS_REVIEW`。
5. 新增测试覆盖报告生成和退出码判断。

## 0.27 命令行样本准入工具实现记录

本轮把真实导出文件的取样评审扩展成可批量执行的命令：

1. 新增 `scripts/sample-calibration.js`，支持从本地 CSV、TSV 或 JSON 文件读取有赞订单、物流状态和企业微信线索样本。
2. 新增 `npm run samples`，支持 `--mode preview|import`、`--youzan-file`、`--fulfillment-file`、`--wework-file`、`--require-all-ready`、`--strict` 和 `--json`。
3. 命令会复用后台样本预览/导入 Interface，并在执行后拉取 Adapter 准入和 Adapter 校准结果。
4. 默认只判断本次传入文件是否存在错误或未知枚举；发布前可加 `--require-all-ready` 要求三类样本准入都不再阻塞。
5. 新增测试覆盖样本报告、单类样本通过和全量准入仍阻塞的退出码。

## 0.28 真实 Adapter 小批量运行工具实现记录

本轮把真实 Adapter 运行从后台按钮扩展成发布前可执行命令：

1. 新增 `scripts/adapter-runner.js`，通过后台 Adapter Interface 执行 `YOUZAN_OPEN`、`FULFILLMENT_PUSH` 或 `WEWORK_CONTACT`。
2. 新增 `npm run adapters`，支持 `--source youzan|fulfillment|wework`、`--mode preview|import`、`--limit`、`--cursor`、`--commit-cursor` 和 `--json`。
3. 命令会输出运行 ID、状态、外部数量、样本数量、导入数量、错误、提醒、游标和 Adapter 校准状态。
4. 缺配置或运行失败会返回退出码 `2`，样本错误会返回退出码 `3`，并保留后台运行台账。
5. 新增 HTTP 测试覆盖缺配置失败、运行台账、报告生成和退出码。

## 0.29 最终开发验收工具实现记录

本轮把代码侧开发测试收口成一条顶层命令：

1. 新增 `scripts/final-verification.js`，提供最终开发验收 Module。
2. 新增顶层 `npm run verify`，一次性执行 JavaScript 语法检查、后端测试、小程序校验和 HTTP Interface 冒烟。
3. HTTP 冒烟会启动临时 SQLite 后台实例，验证 `/health`、dashboard、样本预览、真实 Adapter 失败落账、发布记录和 Adapter 校准。
4. 验收脚本不依赖当前本地 8788 进程，避免开发数据污染验收结论。
5. 顶层 README 新增最终验收命令说明。

## 1. Harness

- Goal: 把流程更新 PRD 拆成可执行、可验收、可分批上线的开发任务。
- Artifact: 本开发拆单文档。
- Acceptance criteria: 每个任务都有目标、触达文件、Interface 变化、验收方式和依赖；任务之间顺序明确；不把所有新状态塞入 `user.state`。
- Worker batch: 先产出 Batch 0 到 Batch 4 的完整拆单，再对风险和遗漏做 Verifier 检查。
- Verifier gate: 检查是否覆盖 PRD 的身份识别、订单物流、问卷、待办、退款、优惠券；检查是否保持 Module 的 Depth 和 Locality。
- External check: 对照当前 `backend/`、`miniprogram/`、`docs/` 文件结构。
- Retry rule: 本文档完成 P0-P2 修订后进入开发评审；若品牌、断卡规则或真实外部字段未确认，先用本地 Adapter 和人工录入。

## 2. 总体开发策略

### 2.1 批次顺序

1. Batch 0：开发前决策和基础约束。
2. Batch 1：流程地基，拆开订单匹配、物流送达和打卡启动。
3. Batch 2：Day4、Day8 问卷和退款资格。
4. Batch 3：运营待办、后台 Summary 和反馈 follow。
5. Batch 4：Day6 优惠券和转化实验。

### 2.2 保持的设计原则

1. 用户主状态继续保持粗粒度，不新增十几个 `user.state`。
2. 新流程通过独立 Module 接入：
   - Identity Module
   - Order Fulfillment Module
   - Questionnaire Module
   - Operation Task Module
   - Refund Work Item Module
   - Coupon Module
3. 每个 Module 暴露稳定 Interface，页面和后台只依赖 Interface，不依赖内部实现细节。
4. 有赞、物流、企业微信先做本地或人工 Adapter。等真实字段确认后，再替换 Adapter 的 Implementation。
5. 每个批次必须有后端测试和小程序静态检查。

### 2.3 当前关键风险

1. 当前 `matchOrder` 会在订单匹配成功后直接创建打卡周期，这是本次最先要改的行为。
2. 当前 `checkin_session` 只有 7 天打卡状态，没有物流、问卷和退款工作项。
3. 当前退款只依赖完成 7 天，尚未要求 Day8 收尾问卷。
4. 当前后台只展示简易用户状态和免单审核，不能支撑每日运营动作。
5. 当前 README 仍有旧路径残留，开发时不要把它当作项目混用证据。

### 2.4 Canonical 页面路径

当前 `app.json` 注册的是分包打卡页：

1. `root_seven_day_checkin/miniprogram/subpkg/checkin/pages/today/index.*`
2. `root_seven_day_checkin/miniprogram/subpkg/checkin/pages/history/index.*`
3. `root_seven_day_checkin/miniprogram/subpkg/checkin/pages/result/index.*`

因此本轮新流程以分包打卡页作为 Canonical。主包旧路径 `root_seven_day_checkin/miniprogram/pages/checkin/*` 不承接新能力；若仍被历史入口引用，必须重定向到 Canonical 页面或在确认无引用后删除。开发任务不得同时维护两套打卡页逻辑。

## 3. Batch 0：开发前决策和基础约束

目标：在写业务代码前，锁定容易导致返工的规则。

### DEV-0001 品牌与权益口径确认

类型：产品决策

触达文件：

1. `root_seven_day_checkin/docs/flow_update_prd.md`
2. `root_seven_day_checkin/docs/development_breakdown.md`
3. 后续所有用户端文案文件

待确认：

1. 对外品牌名使用 ROOT 还是 LinkVital。
2. 活动名称是否固定为“7 日身体重启计划”。
3. “免单”是否改称“人工退款”或“免单处理”。

验收：

1. 评审记录里有最终品牌口径。
2. 后续开发不再同时出现 ROOT 和 LinkVital 的用户可见主品牌。

依赖：无。

### DEV-0002 打卡和补卡规则确认

类型：产品决策

待确认：

1. 断卡是“达到 3 次失效”还是“超过 3 次失效”。
2. 补卡窗口是否仍为次日 23:59 前。
3. 用户未服用但填写打卡时，是否允许保存为失败记录，还是继续保持现有“不计入成功打卡”。
4. Day8 是 Day7 完成后立即可填，还是自然日次日可填。

验收：

1. `flow_update_prd.md` 风险项被更新为明确规则。
2. 后续测试用例可按固定规则编写。

依赖：DEV-0001。

### DEV-0003 外部字段最小集确认

类型：数据决策

待确认：

1. 有赞订单可导入字段：
   - 订单号
   - 商品
   - 金额
   - 下单时间
   - 收货人
   - 收货手机号
   - 地址
   - 订单状态
2. 物流可导入字段：
   - 快递公司
   - 运单号
   - 物流状态
   - 签收时间
3. 企业微信可先手工记录字段：
   - 外部联系人标识
   - 备注名
   - 来源活动
   - 运营备注

验收：

1. 如果真实字段未确认，开发默认使用人工导入 Adapter。
2. Adapter Interface 不依赖具体平台字段名。

依赖：无。

### DEV-0004 隐私授权与数据最小化确认

类型：产品 + 数据决策

触达文件：

1. `root_seven_day_checkin/docs/flow_update_prd.md`
2. `root_seven_day_checkin/docs/development_breakdown.md`
3. `root_seven_day_checkin/miniprogram/pages/home/index.*`
4. `root_seven_day_checkin/miniprogram/pages/login/index.*`
5. 后续所有收集收货手机号、身体记录、图片和反馈的页面

待确认：

1. 收货手机号的收集目的：订单匹配、物流识别、打卡权益判断。
2. 身体记录、便型、反馈和图片的收集目的：试饮记录、运营跟进、退款资格判断。
3. 地址是否入库。默认不入库；若真实业务必须入库，需要单独确认字段、展示范围和保留期限。
4. 企业微信备注和来源活动是否入库，以及后台可见范围。
5. 试饮结束后的数据保留期限和删除方式。

开发要求：

1. 用户端同意文案覆盖新增数据用途。
2. 后台列表默认手机号脱敏。
3. 地址默认不展示、不保存；只在外部订单原始数据里保留，除非业务明确要求。
4. 图片只在反馈处理和用户详情中可见，不进入公共汇总。
5. 文案不得暗示诊断、治疗或确定功效。

验收：

1. 新增个人信息字段都有收集目的。
2. 用户端能在开始前看到新增用途说明。
3. 后台列表默认脱敏。
4. 开发测试覆盖“未同意隐私授权不可继续提交新增敏感信息”。

依赖：DEV-0001、DEV-0003。

### DEV-0005 数据仓库 Implementation 决策

类型：技术决策

背景：

当前后端使用内存数据仓库，`schema.sql` 只是建表脚本。新流程会新增身份、物流、问卷、待办、退款工作项和优惠券事件。如果目标是演示，可以继续内存 Implementation；如果目标是上线，需要在 Batch 1 前确认仓储 Module。

待确认：

1. 本轮是演示版还是上线版。
2. 若为演示版：接受重启后数据丢失，并在文档和后台显式提示。
3. 若为上线版：选择 SQLite、MySQL 或 PostgreSQL 作为数据仓库 Implementation。
4. 是否需要迁移现有内存种子数据到真实表结构。

建议 Interface：

1. `createRepository(config)`
2. `userRepository`
3. `orderRepository`
4. `checkinRepository`
5. `questionnaireRepository`
6. `operationTaskRepository`
7. `refundRepository`

验收：

1. 明确演示或上线目标。
2. 若选择上线版，测试主要穿过仓储 Interface，不直接依赖内存数组。
3. 若选择演示版，后续任务不得声称数据可长期保留。

依赖：DEV-0003、DEV-0004。

### DEV-0006 小程序页面 Canonical 路径确认与旧页面处置

类型：小程序 + 技术决策

触达文件：

1. `root_seven_day_checkin/miniprogram/app.json`
2. `root_seven_day_checkin/miniprogram/utils/router.js`
3. `root_seven_day_checkin/miniprogram/pages/checkin/*`
4. `root_seven_day_checkin/miniprogram/subpkg/checkin/pages/*`

当前判断：

1. `app.json` 当前只注册分包打卡页。
2. 分包路径作为本轮 Canonical：
   - `subpkg/checkin/pages/today/index`
   - `subpkg/checkin/pages/history/index`
   - `subpkg/checkin/pages/result/index`
3. 主包 `pages/checkin/*` 视为旧页面，不新增 Day4、Day8、退款和物流相关能力。

目标行为：

1. 所有新增打卡、问卷、结果和历史入口都指向 Canonical 页面。
2. `router.js` 统一暴露跳转方法，页面不手写旧路径。
3. 若主包旧页面仍有入口，改为重定向到 Canonical 页面。
4. 若确认没有入口引用，旧页面标记待删或直接删除。

验收：

1. `rg "pages/checkin" root_seven_day_checkin/miniprogram` 没有新增业务引用。
2. 首页、订单匹配页、退款状态页都通过同一跳转方法进入打卡页。
3. 小程序静态检查通过。

依赖：DEV-0005。

## 4. Batch 1：流程地基

目标：订单匹配不再等于打卡启动；物流送达成为启动前置条件；后台能看到“送达但未开始”的人。

### DEV-1001 扩展数据模型和种子数据

类型：后端

触达文件：

1. `root_seven_day_checkin/backend/db/schema.sql`
2. `root_seven_day_checkin/backend/src/seed.js`
3. `root_seven_day_checkin/backend/tests/domain.test.js`

新增数据对象：

1. `identity_links`
2. `leadProfiles`
3. `orderFulfillments`
4. `operationTasks`

建议字段：

1. `identity_links`
   - `identity_link_id`
   - `user_id`
   - `receiver_phone`
   - `external_contact_id`
   - `wechat_remark_name`
   - `match_confidence`
   - `warnings`
   - `created_at`
   - `updated_at`
2. `leadProfiles`
   - `lead_id`
   - `user_id`
   - `source_channel`
   - `offline_event_name`
   - `corp_wechat_status`
   - `rule_sent_at`
   - `operator_note`
3. `orderFulfillments`
   - `fulfillment_id`
   - `order_id`
   - `receiver_name`
   - `receiver_phone`
   - `delivery_status`
   - `tracking_company`
   - `tracking_no`
   - `shipped_at`
   - `delivered_at`
4. `operationTasks`
   - `task_id`
   - `user_id`
   - `order_id`
   - `task_type`
   - `task_date`
   - `dedupe_key`
   - `reason`
   - `suggested_action`
   - `suggested_script`
   - `status`
   - `due_date`
   - `handled_at`
   - `operator_note`

Interface 变化：

1. `createStore()` 返回新增集合。
2. 种子数据新增至少 3 类用户：
   - `DELIVERED` 且未启动。
   - `SHIPPED` 且未送达。
   - 订单手机号冲突或需人工确认。

验收：

1. 测试可读取新增集合。
2. 不破坏当前登录、画像和打卡测试。
3. `schema.sql` 和内存数据字段保持同名或可清晰映射。

依赖：DEV-0003、DEV-0004、DEV-0005。

### DEV-1002 新建 Identity Module

类型：后端

触达文件：

1. `root_seven_day_checkin/backend/src/domain.js`
2. 可选新增 `root_seven_day_checkin/backend/src/identity.js`
3. `root_seven_day_checkin/backend/tests/domain.test.js`

Interface：

1. `bindReceiverPhone(data, token, body)`
2. `identifyUser(data, token)`
3. `linkWechatLead(data, body)`
4. `getIdentityWarnings(data, userId)`

行为：

1. 微信手机号仍可作为登录入口。
2. 收货手机号独立存储，作为订单匹配主依据。
3. 用户可在小程序确认或修改收货手机号。
4. 后台可人工关联企业微信线索。
5. 同一手机号多订单或多用户时返回 warning，不自动覆盖。

验收：

1. 登录手机号和收货手机号可以不同。
2. 微信昵称不参与强匹配。
3. 已被其他用户绑定的订单不会被静默抢占。
4. 单元测试覆盖手机号冲突。

依赖：DEV-0004、DEV-1001。

### DEV-1003 拆分订单匹配和打卡启动

类型：后端

触达文件：

1. `root_seven_day_checkin/backend/src/domain.js`
2. `root_seven_day_checkin/backend/src/app.js`
3. `root_seven_day_checkin/backend/tests/domain.test.js`
4. `root_seven_day_checkin/backend/tests/api.test.js`

当前问题：

1. `matchOrder` 成功后直接调用 `createCheckinSession`。
2. `SHIPPED` 订单也可能进入打卡。

目标行为：

1. `matchOrderByReceiverPhone` 只绑定订单，不创建打卡周期。
2. `confirmReceivedAndStart` 才创建打卡周期。
3. `confirmReceivedAndStart` 默认要求订单 `DELIVERED`。
4. 没有订单但用户坚持开始时，进入人工异常路径，不进入正常退款资格。

建议 Interface：

1. `POST /api/v1/order/match` 的语义改为“绑定订单并返回物流状态”。
2. `POST /api/v1/checkin/start` 接收 `orderId` 和 `confirmReceived`。
3. `GET /api/v1/user/state` 只透出 Flow View Presenter Module 计算后的 `flowView` 和 `allowedActions`。

验收：

1. 匹配 `SHIPPED` 订单后，用户仍不是 `CHECKIN_ACTIVE`。
2. 匹配 `DELIVERED` 订单后，首页显示待开始。
3. 用户确认开始后才创建 `checkin_session`。
4. 旧的“完成 7 天后退款”测试按新规则更新或标注旧行为已替换。

依赖：DEV-1001、DEV-1002。

### DEV-1003A 新建 Flow View Presenter Module

类型：后端 + 小程序

触达文件：

1. `root_seven_day_checkin/backend/src/domain.js`
2. 可选新增 `root_seven_day_checkin/backend/src/flowView.js`
3. `root_seven_day_checkin/backend/src/app.js`
4. `root_seven_day_checkin/backend/tests/domain.test.js`
5. `root_seven_day_checkin/miniprogram/pages/home/index.js`
6. `root_seven_day_checkin/miniprogram/utils/router.js`

目标：

1. 让首页、订单页、退款页和后台都通过同一个 Interface 判断用户当前流程视图。
2. 避免页面各自拼接 `user.state`、物流、问卷和退款规则。
3. 把允许动作集中在一个地方，减少后续 Day8、退款、人工异常的重复判断。

Interface：

1. `getFlowView(data, userId, dateText)`
2. `getAllowedActions(flowView)`
3. `getHomeViewModel(data, userId, dateText)`

flowView 枚举：

1. `REGISTER_PROFILE`
2. `ORDER_PENDING`
3. `WAITING_DELIVERY`
4. `READY_TO_START`
5. `MANUAL_REVIEW_REQUIRED`
6. `CHECKIN_ACTIVE`
7. `DAY4_PENDING`
8. `DAY8_PENDING`
9. `REFUND_PENDING`
10. `REFUNDED`
11. `DAILY`

验收：

1. 每个 `flowView` 都有明确 `allowedActions`。
2. 首页只根据 `getHomeViewModel` 渲染主动作。
3. 路由守卫不再只依赖 `user.state` 判断关键流程动作。
4. 测试覆盖订单待匹配、等待物流、已送达待开始、人工异常、Day8 待完成和退款处理中。

依赖：DEV-1001、DEV-1002、DEV-1003。

### DEV-1004A 前置最小 Operation Task Module

类型：后端

触达文件：

1. `root_seven_day_checkin/backend/src/domain.js`
2. 可选新增 `root_seven_day_checkin/backend/src/operationTask.js`
3. `root_seven_day_checkin/backend/src/app.js`
4. `root_seven_day_checkin/backend/tests/domain.test.js`

目标：

1. 在 Batch 1 先提供最小待办 Interface，支撑已送达未开始、人工异常、物流异常这些基础运营动作。
2. 避免 Order Fulfillment Module 直接操作 `operationTasks` 数据结构。
3. 为 Batch 3 的完整待办、Summary、筛选和处理记录保留扩展空间。

最小 Interface：

1. `createOperationTaskOnce(data, task)`
2. `listOpenOperationTasks(data, query)`
3. `completeOperationTask(data, taskId, body)`

最小待办类型：

1. `DELIVERED_NOT_STARTED`
2. `FULFILLMENT_EXCEPTION`
3. `MANUAL_REVIEW_REQUIRED`

去重规则：

1. 同一 `task_type + user_id + order_id + task_date` 只能生成一条 open 待办。
2. 已完成待办不在同一天重复打开，除非触发原因变化。

验收：

1. `READY_TO_START` 待办由 Operation Task Module 生成。
2. 同一用户同一订单同一天不会重复生成待办。
3. 后续 DEV-3001 可以扩展 Interface，而不是重写这套 Implementation。

依赖：DEV-1001、DEV-1003、DEV-1003A。

### DEV-1003B 人工异常路径闭环

类型：后端 + 小程序 + 后台页面

触达文件：

1. `root_seven_day_checkin/backend/src/domain.js`
2. `root_seven_day_checkin/backend/src/app.js`
3. `root_seven_day_checkin/backend/public/admin.*`
4. `root_seven_day_checkin/miniprogram/pages/home/index.*`
5. `root_seven_day_checkin/miniprogram/pages/order/match.*`
6. `root_seven_day_checkin/backend/tests/domain.test.js`

触发场景：

1. 没有订单但用户坚持开始。
2. 订单手机号冲突。
3. 物流异常。
4. 订单已被其他用户绑定。
5. 运营需要补充订单信息后再允许开始。

目标行为：

1. Flow View Presenter Module 返回 `MANUAL_REVIEW_REQUIRED`。
2. Operation Task Module 生成 `MANUAL_REVIEW_REQUIRED` 待办。
3. 用户端展示“已提交人工确认，请联系企业微信”，不直接启动 Day1。
4. 后台可执行三种处理：
   - 允许开始。
   - 拒绝开始。
   - 补充订单信息后开始。

验收：

1. 人工异常用户不能进入正常退款资格。
2. 后台允许开始后，用户端进入 `READY_TO_START`。
3. 后台拒绝开始后，用户端展示明确原因。
4. 测试覆盖无订单、订单冲突和物流异常三类路径。

依赖：DEV-1003A、DEV-1004A。

### DEV-1004 新建 Order Fulfillment Module

类型：后端

触达文件：

1. `root_seven_day_checkin/backend/src/domain.js`
2. 可选新增 `root_seven_day_checkin/backend/src/orderFulfillment.js`
3. `root_seven_day_checkin/backend/src/app.js`
4. `root_seven_day_checkin/backend/tests/domain.test.js`

Interface：

1. `updateOrderFulfillment(data, body)`
2. `getOrderFulfillment(data, token)`
3. `getReadyToStartUsers(data, dateText)`
4. `syncManualOrder(data, body)`

行为：

1. 支持手工导入或更新订单物流。
2. 物流从 `SHIPPED` 到 `DELIVERED` 后通过 Operation Task Module 生成 `DELIVERED_NOT_STARTED` 待办。
3. 用户端能看到订单状态。
4. 后台能看到已送达未开始列表。

验收：

1. `DELIVERED` 自动生成一次待办，不重复生成。
2. `EXCEPTION` 订单进入人工处理。
3. 测试覆盖已送达未启动查询。

依赖：DEV-1003、DEV-1004A。

### DEV-1005 更新首页 flowView 渲染

类型：小程序

触达文件：

1. `root_seven_day_checkin/miniprogram/pages/home/index.js`
2. `root_seven_day_checkin/miniprogram/pages/home/index.wxml`
3. `root_seven_day_checkin/miniprogram/pages/home/index.wxss`
4. `root_seven_day_checkin/miniprogram/utils/router.js`

目标：

1. 首页不只按 `user.state` 渲染，也读取 `flowView`。
2. 新增视图：
   - 订单待匹配
   - 等待物流
   - 已送达待开始
   - Day8 待收尾
   - 待人工退款
3. 保留当前 7 天打卡和日常打卡视图。

验收：

1. `WAITING_DELIVERY` 展示预计送达和订单状态。
2. `READY_TO_START` 展示开始按钮。
3. 只有 `READY_TO_START` 或允许人工确认时可启动 Day1。
4. `npm run check --prefix root_seven_day_checkin/miniprogram` 通过。

依赖：DEV-1003A、DEV-1003B、DEV-1004。

### DEV-1006 更新订单匹配页

类型：小程序

触达文件：

1. `root_seven_day_checkin/miniprogram/pages/order/match.js`
2. `root_seven_day_checkin/miniprogram/pages/order/match.wxml`
3. `root_seven_day_checkin/miniprogram/pages/order/match.wxss`

目标：

1. 文案从“输入手机号匹配订单”调整为“确认收货手机号”。
2. 匹配后展示订单、物流状态和下一步。
3. 匹配成功后回首页，不直接展示打卡中。
4. 匹配异常时引导联系企业微信或等待人工确认。

验收：

1. `SHIPPED` 展示“等待送达”。
2. `DELIVERED` 展示“可开始”。
3. 冲突订单展示人工确认提示。

依赖：DEV-1003、DEV-1005。

### DEV-1007 扩展后台地基面板

类型：后台页面

触达文件：

1. `root_seven_day_checkin/backend/public/admin.html`
2. `root_seven_day_checkin/backend/public/admin.js`
3. `root_seven_day_checkin/backend/public/admin.css`
4. `root_seven_day_checkin/backend/src/domain.js`
5. `root_seven_day_checkin/backend/src/app.js`

目标：

1. 增加订单物流区。
2. 增加已送达未开始区。
3. 增加人工匹配入口。
4. 保留用户状态和退款审核。

验收：

1. 后台能看到 `WAITING_DELIVERY`、`READY_TO_START` 人数。
2. 运营能手动更新物流为 `DELIVERED`。
3. 更新后生成待办。

依赖：DEV-1003B、DEV-1004、DEV-1004A。

### DEV-1008 Batch 1 测试闸门

类型：验证

命令：

1. `npm test --prefix root_seven_day_checkin/backend`
2. `npm run check --prefix root_seven_day_checkin/miniprogram`

必须覆盖：

1. 订单匹配不启动打卡。
2. 物流送达后可启动。
3. 未送达不能正常启动。
4. 已送达未开始进入后台列表。
5. 手机号冲突进入 warning。
6. `DELIVERED_NOT_STARTED` 待办由 Operation Task Module 去重生成。
7. 人工异常路径进入 `MANUAL_REVIEW_REQUIRED`，不能正常启动打卡。

依赖：DEV-1001 到 DEV-1007，包含 DEV-1003A、DEV-1003B、DEV-1004A。

## 5. Batch 2：问卷和退款资格

目标：Day4 和 Day8 成为独立 Module；退款资格从“完成 Day7”升级为“完成 Day7 + Day8 收尾问卷 + 订单有效”。

### DEV-2001 新建 Questionnaire Module

类型：后端

触达文件：

1. `root_seven_day_checkin/backend/db/schema.sql`
2. `root_seven_day_checkin/backend/src/seed.js`
3. `root_seven_day_checkin/backend/src/domain.js`
4. 可选新增 `root_seven_day_checkin/backend/src/questionnaire.js`
5. `root_seven_day_checkin/backend/tests/domain.test.js`

数据对象：

1. `questionnaireDefinitions`
2. `questionnaireResponses`

题型要求：

1. `single`
2. `multi`
3. `text`
4. `scale`
5. `boolean`

定义字段：

1. `questionnaire_type`
2. `version`
3. `questions`
4. `required_fields`
5. `skip_allowed`
6. `active`

回答字段：

1. `response_id`
2. `user_id`
3. `session_id`
4. `questionnaire_type`
5. `version`
6. `answers`
7. `submitted_at`
8. `needs_follow`
9. `idempotency_key`

Interface：

1. `getQuestionnaire(data, token, type)`
2. `submitQuestionnaire(data, token, body)`
3. `getQuestionnaireStatus(data, userId, sessionId)`
4. `requiresFollow(response)`
5. `validateQuestionnaireAnswers(definition, answers)`

问卷类型：

1. `PROFILE_V2`
2. `DAY4_MIDPOINT`
3. `DAY8_SUMMARY`

验收：

1. Day4 和 Day8 有独立记录。
2. 问卷版本可扩展。
3. 负向反馈可生成运营待办。
4. 必填校验由 Questionnaire Module 完成，不散落在页面。
5. 重复提交使用幂等键返回已有结果或版本冲突。
6. 问卷提交失败不影响已经成功的当日打卡记录。

依赖：Batch 1。

### DEV-2002 更新画像问卷为种子用户画像

类型：小程序 + 后端

触达文件：

1. `root_seven_day_checkin/backend/src/domain.js`
2. `root_seven_day_checkin/miniprogram/utils/options.js`
3. `root_seven_day_checkin/miniprogram/pages/home/index.js`
4. `root_seven_day_checkin/miniprogram/pages/register/index.js`
5. `root_seven_day_checkin/miniprogram/subpkg/profile/pages/tags/index.js`

目标：

1. 增加入组原因、痛点、多选观察方向、自由描述。
2. 保留布里斯托便型。
3. 增加 `profile_version`。
4. 画像输出运营标签。

验收：

1. 旧用户画像不导致页面崩溃。
2. 新用户提交完整画像后进入订单阶段。
3. 后台能展示痛点和标签。

依赖：DEV-2001。

### DEV-2003 Day4 中期问卷触发

类型：小程序 + 后端

触达文件：

1. `root_seven_day_checkin/backend/src/domain.js`
2. `root_seven_day_checkin/backend/src/app.js`
3. `root_seven_day_checkin/miniprogram/app.json`
4. 新增 `root_seven_day_checkin/miniprogram/subpkg/checkin/pages/questionnaire/index.*`
5. `root_seven_day_checkin/miniprogram/pages/home/index.*`
6. `root_seven_day_checkin/miniprogram/subpkg/checkin/pages/today/index.js`

行为：

1. Day4 打卡成功后返回 `nextAction: DAY4_QUESTIONNAIRE`。
2. 用户可立即填写，也可稍后填写。
3. 未填写不阻塞 Day5，但进入待办。
4. 有负向反馈或“需要联系”生成 follow 待办。

验收：

1. 完成 Day4 后出现问卷入口。
2. 跳过 Day4 后首页显示提醒。
3. Day5 仍可打卡。
4. 后台能看到 Day4 待完成。

依赖：DEV-2001。

### DEV-2004 Day8 收尾问卷触发

类型：小程序 + 后端

触达文件：

1. `root_seven_day_checkin/backend/src/domain.js`
2. `root_seven_day_checkin/backend/src/app.js`
3. `root_seven_day_checkin/miniprogram/pages/home/index.*`
4. `root_seven_day_checkin/miniprogram/subpkg/checkin/pages/questionnaire/index.*`

行为：

1. 完成 Day7 后进入 `CHECKIN_COMPLETED`，但 `flowView` 为 `DAY8_PENDING`。
2. Day8 问卷提交后，`flowView` 进入 `REFUND_PENDING` 或 `DAILY`。
3. Day8 中复购意向生成运营待办。

验收：

1. Day7 完成后不能直接进入退款队列。
2. Day8 完成后生成退款工作项。
3. Day8 可记录复购意向。

依赖：DEV-2003。

### DEV-2005 新建 Refund Work Item Module

类型：后端 + 后台

触达文件：

1. `root_seven_day_checkin/backend/db/schema.sql`
2. `root_seven_day_checkin/backend/src/domain.js`
3. `root_seven_day_checkin/backend/src/app.js`
4. `root_seven_day_checkin/backend/public/admin.*`
5. `root_seven_day_checkin/backend/tests/domain.test.js`

数据对象：

1. `refundWorkItems`

Interface：

1. `evaluateRefundEligibility(data, userId, sessionId)`
2. `createRefundWorkItem(data, userId, sessionId)`
3. `markRefundPaid(data, refundWorkItemId)`
4. `getRefundStatus(data, token)`

行为：

1. 资格要求订单已匹配、物流已送达、7 天完成、断卡未超规则、Day8 已完成。
2. 异常用户进入 `BLOCKED`，并说明原因。
3. 人工退款完成后可转入 `DAILY_USER`。

验收：

1. 未提交 Day8 不生成正常退款工作项。
2. 未匹配订单进入异常处理。
3. 已退款不能重复处理。
4. 用户端展示退款状态。

依赖：DEV-2004。

### DEV-2005A 退役旧免单申请路径

类型：小程序 + 后端 + 后台

触达文件：

1. `root_seven_day_checkin/backend/src/domain.js`
2. `root_seven_day_checkin/backend/src/app.js`
3. `root_seven_day_checkin/backend/public/admin.*`
4. `root_seven_day_checkin/miniprogram/pages/home/index.*`
5. `root_seven_day_checkin/miniprogram/pages/refund/apply.*`
6. `root_seven_day_checkin/miniprogram/subpkg/refund/pages/apply/index.*`
7. `root_seven_day_checkin/miniprogram/pages/refund/status.*`
8. `root_seven_day_checkin/miniprogram/subpkg/refund/pages/status/index.*`
9. `root_seven_day_checkin/backend/tests/domain.test.js`
10. `root_seven_day_checkin/backend/tests/api.test.js`

当前风险：

1. 现有用户端有“申请免单”入口。
2. 现有后端 `applyRefund` 只要求完成 7 天和订单匹配。
3. 新规则要求 Day8 收尾问卷完成后才进入人工退款队列。

目标行为：

1. 用户完成 Day7 后，首页主动作是“完成收尾问卷”，不是“申请免单”。
2. `refund/apply` 页面改为解释新规则：
   - 未完成 Day8：跳转或引导到 Day8 收尾问卷。
   - 已完成 Day8：展示已进入人工退款处理。
3. 后端 `applyRefund` 不再直接创建旧 `refund`，而是委托 Refund Work Item Module。
4. 旧路径被调用时也必须执行 Day8、订单、物流和断卡资格检查。
5. 后台人工退款只处理 `refundWorkItems`，旧 `refunds` 仅保留兼容读取或迁移用途。

验收：

1. 完成 Day7 但未提交 Day8 时，任何用户端入口都不能创建退款工作项。
2. 直接调用旧 `POST /api/v1/refund/apply` 也不能绕过 Day8。
3. Day8 完成后，系统只生成一条待人工退款工作项。
4. 已退款用户不能重复进入退款队列。
5. 用户端能清楚看到“待收尾问卷 / 待人工退款 / 已退款”三种状态。

依赖：DEV-2004、DEV-2005。

### DEV-2006 Batch 2 测试闸门

类型：验证

命令：

1. `npm test --prefix root_seven_day_checkin/backend`
2. `npm run check --prefix root_seven_day_checkin/miniprogram`

必须覆盖：

1. Day4 问卷跳过不阻塞 Day5。
2. Day8 问卷未完成不退款。
3. Day8 完成后进入退款工作项。
4. 退款完成后可进入日常打卡。
5. 旧免单申请路径不能绕过 Day8。

依赖：DEV-2001 到 DEV-2005A。

## 6. Batch 3：运营待办和后台 Summary

目标：后台每天能生成可执行 To do，运营能标记处理结果。

### DEV-3001 扩展 Operation Task Module

类型：后端

触达文件：

1. `root_seven_day_checkin/backend/src/domain.js`
2. 可选新增 `root_seven_day_checkin/backend/src/operationTask.js`
3. `root_seven_day_checkin/backend/src/app.js`
4. `root_seven_day_checkin/backend/tests/domain.test.js`

Interface：

1. `generateOperationTasks(data, dateText)`
2. `listOperationTasks(data, query)`
3. `completeOperationTask(data, taskId, body)`
4. `skipOperationTask(data, taskId, body)`
5. 继续复用 DEV-1004A 的 `createOperationTaskOnce(data, task)` 去重 Interface。

待办类型：

1. `DELIVERED_NOT_STARTED`
2. `MISSED_CHECKIN`
3. `TWO_DAY_INACTIVE`
4. `DAY4_QUESTIONNAIRE_PENDING`
5. `DAY4_NEGATIVE_FEEDBACK`
6. `QUESTIONNAIRE_FOLLOW`
7. `FEEDBACK_FOLLOW`
8. `DAY8_QUESTIONNAIRE_PENDING`
9. `REFUND_PENDING`
10. `COUPON_UNUSED`
11. `REPURCHASE_INTENT`

验收：

1. 同一触发条件同一天不重复生成。
2. 每条待办有建议动作和建议话术。
3. 待办可完成、跳过，并记录备注。
4. Batch 1 已有的 `DELIVERED_NOT_STARTED` 待办不需要迁移或重写。

依赖：Batch 2、DEV-1004A。

### DEV-3002 扩展 daily audit

类型：后端

触达文件：

1. `root_seven_day_checkin/backend/src/domain.js`
2. `root_seven_day_checkin/backend/src/app.js`
3. `root_seven_day_checkin/backend/tests/domain.test.js`

当前行为：

1. `runDailyAudit` 只累计 miss count 和失败状态。

目标行为：

1. 保留 miss count。
2. 生成未打卡、连续未打卡、Day4 待问卷、Day8 待问卷、退款待处理等待办。
3. 返回 Summary。

验收：

1. 每天运行后返回今日 Summary。
2. 待办数量和用户状态一致。
3. 已处理待办不会被错误重开，除非触发新日期或新原因。

依赖：DEV-3001。

### DEV-3003 后台最小运营视图

类型：后台页面

触达文件：

1. `root_seven_day_checkin/backend/public/admin.html`
2. `root_seven_day_checkin/backend/public/admin.js`
3. `root_seven_day_checkin/backend/public/admin.css`
4. `root_seven_day_checkin/backend/src/app.js`

目标：

1. 后台新增 Summary 区。
2. 后台新增 open 待办列表。
3. 支持按类型筛选。
4. 支持标记完成和跳过。
5. 本任务不做完整用户详情，避免 Batch 3 过大。

验收：

1. 运营打开后台能看到今天的行动清单。
2. 每条待办展示用户、原因、建议动作、建议话术。
3. 操作后状态实时更新。

依赖：DEV-3001、DEV-3002。

### DEV-3004 用户详情和反馈聚合（Batch 3.5）

类型：后台页面 + 后端

触达文件：

1. `root_seven_day_checkin/backend/src/domain.js`
2. `root_seven_day_checkin/backend/src/app.js`
3. `root_seven_day_checkin/backend/public/admin.*`

目标：

1. 后台能查看单个用户的身份、订单、物流、画像、打卡、问卷、反馈、退款状态。
2. 反馈文本和图片集中展示。
3. 强反馈可直接生成 follow 待办。
4. 本任务不阻塞 Batch 3 最小运营视图上线。

验收：

1. 用户详情能追溯退款资格。
2. 运营无需在多个列表之间来回找信息。
3. 反馈 follow 能记录处理状态。

依赖：DEV-3003、DEV-3005。

### DEV-3005 Batch 3 测试闸门

类型：验证

命令：

1. `npm test --prefix root_seven_day_checkin/backend`
2. `npm run check --prefix root_seven_day_checkin/miniprogram`

必须覆盖：

1. daily audit 生成 Summary。
2. 待办不会重复生成。
3. 待办完成后状态正确。
4. 反馈能进入 follow 待办。
5. 后台最小运营视图不依赖完整用户详情。

依赖：DEV-3001 到 DEV-3003。

## 7. Batch 4：Day6 优惠券和转化实验

目标：在不干扰打卡主流程的情况下，建立轻量转化观察。

### DEV-4001 新建 Coupon Module

类型：后端

触达文件：

1. `root_seven_day_checkin/backend/db/schema.sql`
2. `root_seven_day_checkin/backend/src/seed.js`
3. `root_seven_day_checkin/backend/src/domain.js`
4. 可选新增 `root_seven_day_checkin/backend/src/coupon.js`
5. `root_seven_day_checkin/backend/tests/domain.test.js`

数据对象：

1. `couponEvents`

Interface：

1. `triggerCoupon(data, userId, sessionId, reason)`
2. `claimCoupon(data, token, couponId)`
3. `markCouponUsed(data, couponId)`
4. `getCouponStatus(data, token)`

行为：

1. Day6 打卡完成后触发优惠券。
2. 优惠券可领取、可过期、可标记使用。
3. 未使用可进入运营待办。

验收：

1. Day6 之前不展示优惠券。
2. Day6 后展示但不阻塞 Day7。
3. 领取和使用状态可追踪。

依赖：Batch 2。

### DEV-4002 用户端优惠券入口

类型：小程序

触达文件：

1. `root_seven_day_checkin/miniprogram/pages/home/index.*`
2. `root_seven_day_checkin/miniprogram/subpkg/checkin/pages/today/index.js`
3. 可选新增 `root_seven_day_checkin/miniprogram/subpkg/profile/pages/coupon/index.*`
4. `root_seven_day_checkin/miniprogram/app.json`

目标：

1. Day6 打卡成功后展示轻量领取入口。
2. 首页显示优惠券状态。
3. 不在首屏强制打断打卡。

验收：

1. Day6 用户能领取。
2. Day7 用户仍可正常打卡。
3. 已领取状态不会反复弹出。

依赖：DEV-4001。

### DEV-4003 转化实验标记

类型：后端 + 后台

触达文件：

1. `root_seven_day_checkin/backend/src/domain.js`
2. `root_seven_day_checkin/backend/public/admin.*`
3. `root_seven_day_checkin/backend/tests/domain.test.js`

目标：

1. 支持简单实验分组：
   - `CONTROL`
   - `DAY6_COUPON`
2. 后台展示领取率、使用率和复购点击。
3. 复购意向用户进入待办。

验收：

1. 用户分组稳定。
2. 后台能看转化指标。
3. 不影响退款流程。

依赖：DEV-4001、DEV-4002。

### DEV-4004 Batch 4 测试闸门

类型：验证

命令：

1. `npm test --prefix root_seven_day_checkin/backend`
2. `npm run check --prefix root_seven_day_checkin/miniprogram`

必须覆盖：

1. Day6 触发优惠券。
2. 优惠券领取不阻塞打卡。
3. 已领取未使用生成待办。
4. 实验分组不改变退款资格。

依赖：DEV-4001 到 DEV-4003。

## 8. 建议实施顺序

### 8.1 第一周

1. DEV-0001 到 DEV-0003。
2. DEV-0004。
3. DEV-0005。
4. DEV-0006。
5. DEV-1001。
6. DEV-1002。
7. DEV-1003。

交付结果：后端能表达身份、订单和物流，订单匹配不再自动启动打卡。

### 8.2 第二周

1. DEV-1003A。
2. DEV-1004A。
3. DEV-1003B。
4. DEV-1004。
5. DEV-1005。
6. DEV-1006。
7. DEV-1007。
8. DEV-1008。

交付结果：用户端和后台可完整跑通“订单匹配 -> 等待送达 -> 已送达开始打卡”。

### 8.3 第三周

1. DEV-2001。
2. DEV-2002。
3. DEV-2003。
4. DEV-2004。

交付结果：Day4、Day8 问卷进入流程。

### 8.4 第四周

1. DEV-2005。
2. DEV-2005A。
3. DEV-2006。
4. DEV-3001。
5. DEV-3002。

交付结果：退款资格和待办生成可用。

### 8.5 第五周

1. DEV-3003。
2. DEV-3005。
3. DEV-3004。

交付结果：运营后台最小视图可以日常使用，用户详情作为增强能力跟进。

### 8.6 第六周

1. DEV-4001。
2. DEV-4002。
3. DEV-4003。
4. DEV-4004。

交付结果：Day6 优惠券和轻量转化实验可用。

### 8.7 Batch 回滚点

1. Batch 0：只回滚文案、配置和决策记录，不删除新增数据对象草案。
2. Batch 1：若订单物流流程异常，可临时关闭“物流送达后开始”入口，恢复旧 `matchOrder` 体验；新增订单、物流和待办数据对象保留，只停止写入新的打卡周期。
3. Batch 2：若问卷或退款规则异常，可关闭 Day4/Day8 入口；已提交问卷记录保留，旧免单路径仍不得绕过 Day8，必要时改为人工处理。
4. Batch 3：若后台待办异常，可关闭后台操作入口，保留 daily audit 只读 Summary，运营回到人工表格处理。
5. Batch 4：若优惠券实验异常，可关闭优惠券触发和分组逻辑，不影响打卡、问卷和退款资格。

## 9. 最小可上线范围

如果要压缩范围，建议第一版只做：

1. DEV-0001 到 DEV-0006。
2. DEV-1001 到 DEV-1008，包含 DEV-1003A、DEV-1003B、DEV-1004A。
3. DEV-2001、DEV-2003、DEV-2004、DEV-2005、DEV-2005A、DEV-2006。

暂缓：

1. Day6 优惠券。
2. 转化实验。
3. 复杂用户详情。
4. 企业微信真实接入。

最小可上线验收：

1. 订单匹配不误启动打卡。
2. 物流送达后才开始 Day1。
3. Day4 能记录中期反馈。
4. Day8 完成后才进入退款工作项。
5. 后台能看到待人工退款用户。
6. 旧免单入口不能绕过 Day8。
7. `flowView` 和主动作来自 Flow View Presenter Module。

### 9.1 手工验收矩阵

| 场景 | 初始条件 | 操作 | 期望结果 |
| --- | --- | --- | --- |
| 新用户等待物流 | 新用户完成授权和画像，订单状态为 `SHIPPED` | 输入收货手机号并匹配订单 | 首页显示等待物流，不启动 Day1 |
| 送达后启动 | 用户订单已匹配，运营在后台把物流改为 `DELIVERED` | 用户回到首页并点击开始 | 首页进入 Day1，后台生成且不重复生成已送达未开始待办 |
| Day4 可跳过 | 用户完成 Day4 打卡 | 用户选择稍后填写中期问卷 | Day5 仍可继续打卡，后台出现 Day4 待问卷待办 |
| Day8 阻断退款 | 用户完成 Day7，但未提交 Day8 | 用户进入旧免单入口或退款状态页 | 不生成退款工作项，提示完成收尾问卷 |
| Day8 后人工退款 | 用户完成 Day8 收尾问卷 | 运营在后台查看退款列表并标记已处理 | 生成一条退款工作项，完成后用户进入日常打卡 |
| 人工异常闭环 | 手机号冲突或订单被占用 | 用户提交人工确认，运营后台处理 | 用户端显示人工确认状态；允许后进入 `READY_TO_START`，拒绝后展示原因 |
| Canonical 路径 | 首页、订单页、退款页都有打卡入口 | 分别点击进入打卡相关页面 | 全部进入 `subpkg/checkin/pages/*`，不进入主包旧页面 |

## 10. Verifier 评审

### 10.1 覆盖检查

已覆盖：

1. 身份识别。
2. 有赞订单。
3. 物流送达。
4. 小程序首页视图。
5. 订单匹配页。
6. Day4 问卷。
7. Day8 问卷。
8. 人工退款队列。
9. 运营待办。
10. Day6 优惠券。
11. 后台 Summary。

### 10.2 架构检查

1. 没有把细分状态全部塞进 `user.state`。
2. 每个新增能力有独立 Module。
3. 有赞、物流、企业微信都通过 Adapter 接入。
4. 测试主要穿过 Module 的 Interface，而不是直接验证内部 Implementation。
5. 新 Module 通过更深的 Interface 提供 Leverage，避免页面散落重复规则。

### 10.3 主要残余风险

1. 真实有赞、物流、企业微信字段仍未验证。
2. 品牌名和权益规则未最终确认。
3. 当前项目不是 git 仓库根目录，后续开发前需要确认版本管理位置。
4. 数据仓库 Implementation 需要通过 DEV-0005 先确定演示路径或上线路径。
5. 主包旧打卡页是否可以删除，需要通过 DEV-0006 扫描引用后确认。

## 11. 下一步

下一步进入真实上线准备：先确定数据仓库 Implementation，再用真实样本确认有赞订单、物流和企业微信线索 Adapter 字段；若只做内部灰度，可先按 `docs/release_readiness.md` 的手工矩阵试跑。
