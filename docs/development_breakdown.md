# ROOT 7 日试饮打卡流程更新开发拆单

版本：V0.29
日期：2026-05-16
依据：[flow_update_prd.md](./flow_update_prd.md)
状态：核心流程、发布证据链、Element Plus Admin、运营任务/结算/导出、新版问卷答卷 Module、问卷分支题、myRoot 活动首页改版、Settlement AND/OR 条件树、后台 AND/OR 规则生成器、规则拖拽编辑器、奖励上限保护、奖励库存预占/释放、免单抽取与黑名单、奖励售后追回/库存回补、企微自动触达队列、订单售后状态镜像与追回联动、生产切换 Gate、旧数据迁移评估、旧数据生产处置决策记录、旧数据生产处置执行历史记录、旧静态后台下线决策记录、生产证据收口、CloudBase Store 决策 Gate、Root 会员中心购买跳转 Gate 和动作 Adapter 校准 Gate 已完成；本地既定开发动作已收口，不再展开外部生产证据补录。

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

本轮完成有赞订单、有赞客户、物流状态和企业微信线索的真实样本导入校验：

1. 新增 External Adapter Sample Module，负责字段别名映射、必填校验、状态枚举归一和导入结果回显。
2. 新增 `POST /api/v1/admin/external-samples/preview`，用于预览真实样本映射结果，不写入数据。
3. 新增 `POST /api/v1/admin/external-samples/import`，导入可识别样本，并复用已有 Order Fulfillment Module 和 Operation Task Module。
4. 后台新增「真实样本导入」面板，可粘贴 JSON 数组并先预览后导入。
5. 企业微信线索无法匹配用户时，自动生成 `LEAD_NEEDS_MATCHING` 待办。
6. 新增 [external_adapter_samples.md](./external_adapter_samples.md)，记录四类样本的最小字段、可识别字段名、状态映射和验收口径。

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

1. 新增 Launch Readiness Module，集中检查数据仓库 Adapter、微信登录密钥、正式域名和四类真实样本评审状态。
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
5. 新增测试覆盖 1 条样本不足和四类样本全部达标后的上线闸口结果。

## 0.18 取样模板实现记录

本轮把“补齐真实样本”变成后台可执行动作：

1. External Adapter Sample Module 新增四类取样模板，包含必填字段、建议字段、CSV 表头和运营取样注意事项。
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
3. 后台新增「Adapter 校准」面板，展示四类 Adapter 的阻塞、提醒、通过数量、缺失配置、校准检查和回滚方式。
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
4. 默认只判断本次传入文件是否存在错误或未知枚举；发布前可加 `--require-all-ready` 要求四类样本准入都不再阻塞。
5. 新增测试覆盖样本报告、单类样本通过和全量准入仍阻塞的退出码。

## 0.28 真实 Adapter 小批量运行工具实现记录

本轮把真实 Adapter 运行从后台按钮扩展成发布前可执行命令：

1. 新增 `scripts/adapter-runner.js`，通过后台 Adapter Interface 执行 `YOUZAN_OPEN`、`YOUZAN_CUSTOMER`、`FULFILLMENT_PUSH` 或 `WEWORK_CONTACT`。
2. 新增 `npm run adapters`，支持 `--source youzan|fulfillment|wework`、`--mode preview|import`、`--limit`、`--cursor`、`--commit-cursor` 和 `--json`。
3. 命令会输出运行 ID、状态、外部数量、样本数量、导入数量、错误、提醒、游标和 Adapter 校准状态。
4. 缺配置或运行失败会返回退出码 `2`，样本错误会返回退出码 `3`，并保留后台运行台账。
5. 新增 HTTP 测试覆盖缺配置失败、运行台账、报告生成和退出码。

## 0.29 最终开发验收工具实现记录

本轮把代码侧开发测试收口成一条顶层命令：

1. 新增 `scripts/final-verification.js`，提供最终开发验收 Module。
2. 新增顶层 `npm run verify`，一次性执行 JavaScript 语法检查、后端测试、生产依赖审计、小程序校验和 HTTP Interface 冒烟。
3. HTTP 冒烟会启动临时 SQLite 后台实例，验证 `/health`、dashboard、样本预览、真实 Adapter 失败落账、发布记录和 Adapter 校准。
4. 验收脚本不依赖当前本地 8788 进程，避免开发数据污染验收结论。
5. 顶层 README 新增最终验收命令说明。

## 0.30 有赞客户镜像补链实现记录

本轮把 Root 会员中心客户数据从“待确认字段”推进到可灰度校准的 Module：

1. 新增 Youzan Customer Mirror Module，以 `youzan_yz_uid` 为外部客户键，支持通过 `unionid`、手机号或 `rootUserId` 补链内部用户。
2. 新增 Youzan Customer Adapter Implementation，支持客户列表 HTTP 拉取、字段映射、分页游标和 token 位置配置。
3. `YOUZAN_CUSTOMER` 已进入样本导入、Adapter 准入、Adapter 校准和命令行 Adapter Runner。
4. Order Fulfillment Module 导入订单时会读取 `youzanYzUid`，可先写客户镜像，再用 `AUTO_YOUZAN_CUSTOMER` 补链未绑定订单。
5. 新增 `GET /api/v1/admin/youzan-customers`，B7 后续已接入 Element Plus Admin 客户镜像排查页。
6. 最终验收脚本新增 `youzan_customer_mirror` smoke check，避免客户镜像链路在后续重构中回退。

## 0.31 有赞券状态查询实现记录

本轮把奖励发放从“确认已发出”推进到“可核验外部券状态”：

1. 新增 Youzan Coupon Status Adapter Implementation，支持状态查询 URL、method、token 位置、券码参数名和状态字段路径配置。
2. Reward Delivery Module 新增状态查询 Interface，发放动作和状态核验分离，保持 Module 的 Interface 更稳定。
3. 后台新增 `POST /api/v1/admin/reward-delivery/status-query`，要求 `request_id`，支持人工回写和自动 Adapter 查询。
4. `reward_grant` 新增外部状态、状态查询时间、外部状态 payload、核销时间和过期时间；`reward_delivery_job` 新增状态查询时间。
5. Admin Config Presenter 已返回奖励外部状态，B7 后续已在 Element Plus Admin 展示券状态列和查询按钮。
6. 最终验收脚本新增 `reward_status_query` smoke check，覆盖状态回写和审计链路。

## 0.32 企微标签发放实现记录

本轮把 `TAG` 奖励从人工占位推进到可替换的企微标签发放 Adapter：

1. 新增 WeWork Tag Adapter Implementation，支持标签写入 URL、method、token、额外参数、结果状态路径和外部凭证路径配置。
2. Reward Delivery Adapter Registry 新增 `WEWORK_TAG`，配置齐全时可通过奖励发放 Interface 自动调用真实企微标签写入。
3. Adapter 会从奖励 payload、请求 body 或 `leadProfiles.external_contact_id` 推导企微外部联系人 ID，降低运营重复录入。
4. `lead_profile` schema 补齐 `external_contact_id`、`wechat_remark_name`、`receiver_phone`，保护企微线索镜像迁移。
5. 无真实企微配置时，运营仍可通过人工确认写入外部标签凭证。
6. 最终验收脚本新增 `wework_tag_delivery` smoke check，覆盖企微标签奖励发放链路。

## 0.33 有赞订单增量运营入口实现记录

本轮把有赞订单增量同步从通用 Adapter 运行推进到后台运营专用 Interface：

1. 新增 Admin Order Increment Sync Module，复用 External Platform Adapter Module，不重复实现订单解析、导入和游标逻辑。
2. 新增 `POST /api/v1/admin/orders/increment-preview`，运营可先预览 `YOUZAN_OPEN` 或 `MANUAL_SAMPLE` 的订单增量结果，预览不写入订单。
3. 新增 `POST /api/v1/admin/orders/increment-execute`，执行时要求 `request_id` 与二次确认，导入后提交真实 Adapter 游标。
4. 执行入口写入 `YOUZAN_ORDER_INCREMENT_SYNC` 审计，并通过 `X-Request-Id` 幂等保护重复提交。
5. 后端测试覆盖角色权限、幂等、游标提交、订单导入和审计。
6. 最终验收脚本新增 `order_increment_sync` smoke check，覆盖订单增量专用 Interface 的预览、导入、幂等和审计链路。

## 0.34 Element Plus Adapter 运行页实现记录

本轮把 Adapter 运行从后端 Interface 推进到运营后台可操作页面：

1. 新增 `admin/src/modules/adapters/AdapterRunPage.vue` 和 `admin/src/modules/adapters/adminAdapterApi.js`。
2. Admin Shell 启用“Adapter 运行”菜单，复用同一个模块刷新 Interface。
3. 页面可查看 Adapter catalog、运行台账、游标记录和样本准入来源数量。
4. 有赞订单增量同步支持手工样本和 `YOUZAN_OPEN` 两种 Adapter，预览不落库，确认导入要求 `request_id` 和二次确认。
5. 运行台账支持按来源、Adapter 和状态筛选，运营可快速定位失败原因、导入数量和游标前后值。
6. Admin 自检脚本新增 Adapter Run Module 契约，避免菜单禁用、订单增量入口或台账筛选回退。

## 0.35 Adapter 运行详情与重跑动作实现记录

本轮把 Adapter 运行页从只读台账推进到可处理失败：

1. 运行台账行点击后打开详情抽屉，展示 `run_id`、来源、Adapter、模式、状态、limit、游标、review_id 和失败原因。
2. 台账行和详情抽屉均提供“重新预览”和“重试导入”动作。
3. 重跑动作复用 `POST /api/v1/admin/external-adapters/run`，并带 `X-Request-Id`，避免重复点击造成重复请求。
4. 真实 Adapter 重跑沿用历史运行的来源、Adapter、limit 和原始游标；有赞订单手工样本可用当前表单文本重跑。
5. 有赞订单重跑结果会回填订单增量结果区，方便运营继续核对导入明细。
6. Admin 自检脚本新增运行详情与重跑动作契约。

## 0.36 Adapter 评审明细与 run_id 深链实现记录

本轮把 Adapter 运行详情推进到可排查取样质量：

1. 新增 `GET /api/v1/admin/external-sample-reviews`，可按 `reviewId` 查询单条评审，也可按来源、模式和决策状态过滤评审列表。
2. `GET /api/v1/admin/external-adapters` 返回最近取样评审，页面可把运行台账中的 `review_id` 和评审明细关联。
3. Admin Shell 支持 `?module=adapters`，Adapter Run Page 支持 `?runId=...`，运营可直接打开某次运行详情。
4. 详情抽屉展示评审决策状态、样本数、可导入/已导入数量、字段覆盖率、缺失字段和未知状态枚举。
5. Admin 自检、后端测试和最终验收脚本已覆盖评审明细查询、字段覆盖率读取和深链契约。
6. 原始样本行不在运行记录中保存，后续若要做行级排查，需要单独设计脱敏样本快照或短期调试留存策略。

## 0.37 有赞客户镜像排查 UI 实现记录

本轮把客户镜像从只读 HTTP Interface 推进到运营可排查页面：

1. Youzan Customer Mirror Module 的查询 payload 新增 `linkStatus`、`nextAction` 和 `orderSummary`，集中呈现补链状态与同 `yzUid` 订单绑定情况。
2. Adapter Run Page 新增“有赞客户镜像”区域，支持按 `yzUid`、UnionID、`root_user_id`、手机号和昵称查询。
3. 客户镜像表格展示补链状态、补链证据、已绑定/未绑定订单数、最近订单和下一步动作。
4. 点击客户可打开详情抽屉查看完整镜像记录，便于排查 UnionID 认证后补链、手机号唯一性和订单自动绑定问题。
5. Admin 自检、后端测试和最终验收脚本已覆盖客户镜像排查 UI、补链状态和订单摘要。

## 0.38 有赞券状态查询 UI 实现记录

本轮把有赞券状态查询从后台 Interface 推进到运营可操作页面：

1. ConfigWorkbench 的“奖励复核”Tab 新增券状态查询工具，复用已存在的奖励发放任务表。
2. 发放任务选择逻辑拆成“发放处理”和“状态查询”两组 ID，避免把已发放券排除在状态核验之外。
3. 奖励队列和发放任务表新增外部状态、最近查询时间和券状态列。
4. 状态查询表单支持 `MANUAL` 人工回写和 `AUTO` Adapter 查询；人工模式可回写 `ISSUED`、`USED`、`EXPIRED`、`CANCELLED`。
5. Admin 自检、后端测试和最终验收脚本已覆盖状态查询 UI 契约、workbench 外部状态展示和 smoke check。

## 0.39 企微标签 UI 实现记录

本轮把 `WEWORK_TAG` 奖励发放从后台 Interface 推进到运营可操作页面：

1. Admin Config Presenter 新增 `weworkTagHint`，把标签 ID、标签名、企微外部联系人 ID 和备注集中交给页面。
2. ConfigWorkbench 的“奖励复核”Tab 新增企微标签展示列、外部联系人展示列和“填入标签”动作。
3. 奖励发放表单新增 `externalContactId`、`tagId`、`tagName`，仍复用奖励发放 Interface、`request_id` 和二次确认。
4. 页面不直接读取 `leadProfiles`，企微线索查找保持在 Presenter Module 里，真实字段调整时更有 Locality。
5. Admin 自检、后端测试和最终验收脚本已覆盖企微标签 UI 契约、workbench 标签提示和 smoke check。

## 0.40 Adapter 人工回滚动作实现记录

本轮把 Adapter `IMPORT` 运行从“只可看台账”推进到“可审计地撤回本次新增数据”：

1. External Platform Adapter Module 新增 `rollbackAdapterRun` Interface，要求 `request_id`、二次风险确认和配置写权限。
2. `YOUZAN_ORDER`、`YOUZAN_CUSTOMER`、`FULFILLMENT`、`WECHAT_LEAD` 导入行会保存可回滚目标；更新既有记录只写 `rollback_notes`，不自动恢复旧字段。
3. 回滚 Implementation 会删除本次导入新建的订单、履约、客户镜像或企微线索，并在安全条件成立时回退 Adapter 游标。
4. Element Plus Adapter 运行页新增回滚状态、目标数量、回滚结果和“回滚”动作，保持运行台账这一处 Seam。
5. 后端测试、HTTP Interface 测试、Admin 自检和最终验收脚本已覆盖角色拦截、幂等、审计、数据删除和游标回退。

## 0.41 Adapter 字段级快照回滚实现记录

本轮把回滚能力从“撤回本次新建数据”推进到“恢复本次更新前字段”：

1. External Adapter Sample Module 会在更新既有订单、有赞客户、履约和企微线索前写入 `beforeSnapshot`。
2. External Platform Adapter Module 在 rollback target 有快照时直接恢复目标记录；没有快照时才沿用新增数据删除逻辑。
3. `FULFILLMENT` 更新会同时恢复履约记录和订单 `delivery_status`，保持订单展示与物流记录一致。
4. 该能力仍收口在运行台账 Seam；页面不需要理解各类字段差异，只展示 target、状态和回滚结果。
5. 后端测试和最终验收脚本已覆盖订单、履约、有赞客户、企微线索和 `adapter_snapshot_rollback` smoke check。

## 0.42 取样评审原始行排查实现记录

本轮把取样评审从摘要推进到可定位单行字段问题：

1. External Sample Review Module 新增 `rows` 行级 payload，保留 raw、mapped、field presence、errors、warnings、imported 和 result summary。
2. `GET /api/v1/admin/external-sample-reviews?reviewId=...` 仍是唯一读取 Interface，调用方不需要另学一套行详情 Interface。
3. Element Plus Adapter 运行详情新增原始样本行排查表，支持问题行/错误/警告/已导入/全部筛选和关键字搜索。
4. 点击样本行可对照原始字段 JSON 与映射字段 JSON，用于真实有赞、企微、物流字段校准。
5. 后端测试、HTTP Interface 测试、Admin 自检和最终验收脚本已覆盖 review rows 与页面排查控件。

## 0.43 真实 Adapter 失败重试策略实现记录

本轮把真实 Adapter 失败从“只记录错误文案”推进到“可判断、可追踪、可人工重试”：

1. External Platform Adapter Module 的运行记录新增 `retry_status`、`retry_attempt`、`retry_source_run_id`、`retry_reason` 和 `next_retry_at`。
2. 缺配置、缺 Implementation、字段校准类失败进入 `MANUAL_REVIEW`；5xx、429、超时和网络抖动类真实 Adapter 失败进入 `RETRYABLE`。
3. 从失败运行重新预览或重试导入时，后台会把新运行标记为 `RETRY_SUCCEEDED` 并记录来源失败 `run_id`。
4. Element Plus Adapter 运行页新增重试状态、建议重试时间、重试来源和重试原因展示，并在重跑请求中携带 `retrySourceRunId`。
5. 后端测试、HTTP Interface 测试、Admin 自检和最终验收脚本已覆盖不可重试失败、可重试失败和重试 lineage。
6. 自动按 `next_retry_at` 扫描 `RETRYABLE` 运行的到期重试调度器已在 myRoot 重构 B7 第二十五段接入；CloudBase/cron 可调用的 Job Interface 已在 B7 第二十六段接入。

## 0.44 运营数据漏斗首版实现记录

本轮把运营数据从“后续 BI 能力”推进到后台可查看的只读漏斗：

1. 新增 Admin Analytics Presenter Module，把线索、注册、参与、商品跳转、订单、任务、结算和奖励发放汇总为同一个展示模型。
2. 新增 `GET /api/v1/admin/operational-analytics`，支持 `campaignId`、`dateFrom`、`dateTo` 查询。
3. Element Plus Admin 开启“运营数据”页，展示阶段转化、瓶颈项、任务分布、来源分布、奖励状态和最近活动。
4. 漏斗只消费既有 Store 事实，不把统计口径写入用户、任务或奖励 Module 的 Implementation，保持这些 Module 的 Locality。
5. 后端测试、HTTP Interface 测试、Admin 自检和最终验收脚本已覆盖运营漏斗契约。
6. 本段未实现时间序列趋势、导出、自动预警、定时刷新和分群留存；其中趋势、导出、页面内预警和定时刷新已在 0.45 接入，图表化和分群留存已在 0.45.1 接入，外部预警 Webhook Adapter 已在 0.45.21 接入。

## 0.45 运营数据增强首版实现记录

本轮把运营数据从“只读漏斗快照”推进到可日常巡检：

1. Admin Analytics Presenter Module 新增日期趋势、页面内预警和 CSV 导出，仍通过同一个后台展示模型给页面使用。
2. `GET /api/v1/admin/operational-analytics` 返回 `alerts`、`trend` 和刷新建议，任务趋势优先使用 `task_date`。
3. 新增 `GET /api/v1/admin/operational-analytics/export`，导出阶段、瓶颈、预警和趋势 CSV。
4. Element Plus Admin 的运营数据页新增预警表、日期趋势表、导出 CSV 和自动刷新开关。
5. 后端测试、HTTP Interface 测试、Admin 自检和最终验收脚本已覆盖趋势、预警和导出。
6. 本段未实现折线图、环比、分群留存、阈值后台配置和企微/钉钉推送；其中图表化和分群留存已在 0.45.1 接入，阈值后台配置和预警 Job 已在 0.45.2 接入，外部预警 Webhook Adapter 已在 0.45.21 接入，环比仍作为后续运营增强处理。

## 0.45.1 运营数据图表与分群留存实现记录

本轮把运营数据从“表格巡检”推进到可按来源复盘：

1. Admin Analytics Presenter Module 新增 `retentionSegments` 与 `charts`，由后台统一输出来源分群留存、漏斗图表、趋势序列和分群条形数据。
2. 分群归因按 `root_user_id` 的优先来源收口，企微线索来源优先于默认登录来源，避免用户动作被拆散到多个来源。
3. Element Plus Admin 运营数据页新增漏斗图表、趋势图表、来源分群留存表和分群任务启动图表。
4. CSV 导出新增分群与分群奖励段，便于运营下载后继续复盘路演来源。
5. 后端测试、HTTP Interface 测试、Admin 自检和最终验收脚本已覆盖图表与分群 Interface。
6. 本段未实现外部预警推送、阈值后台配置、环比和更细路演场次分组；其中阈值后台配置和预警 Job 已在 0.45.2 接入，外部预警 Webhook Adapter 已在 0.45.21 接入，环比和更细路演场次分组仍作为后续运营增强处理。

## 0.45.2 运营预警阈值配置与 Job 实现记录

本轮把运营预警从“页面内提示”推进到可配置、可调度、可留痕的运营机制：

1. 新增 Operational Alerts Module，统一承接默认预警规则、运营覆盖配置、瓶颈/转化/分群指标评估、冷却时间、通知记录和 Job 运行记录。
2. Store 和 `schema.sql` 新增 `operational_alert_rule`、`operational_alert_run`、`operational_alert_notification`，让预警规则、执行结果和通知证据可持久化。
3. `GET /api/v1/admin/operational-analytics` 返回 `alertRules`、`alertSummary`、`alertRuns` 和 `alertNotifications`，页面不需要重复拼规则状态。
4. 新增 `POST /api/v1/admin/operational-alert-rules/upsert`，运营可配置目标类型、指标、比较符、阈值、级别、渠道和冷却时间，执行要求 `request_id` 并写入审计。
5. 新增 `POST /api/v1/jobs/operational-alerts`，CloudBase 或运维 cron 可 dry-run 预览，也可执行写入通知；正式执行要求稳定 `request_id`，并复用幂等 Interface。
6. Element Plus Admin 运营数据页新增阈值表单、规则表、Job 预览/执行和通知记录，仍复用 Backend Admin Interface，保持页面 Implementation 较薄。
7. 后端测试、HTTP Interface 测试、Admin 自检和最终验收脚本已覆盖规则配置、Job dry-run/execute、通知落账和幂等。
8. 负责人路由与 Adapter 重试耗尽告警已在 0.45.3 接入；本段未接入真实企微/钉钉/短信模板和 CloudBase 正式触发器，当前 `WEBHOOK` 是通用 Adapter Seam，生产 URL、密钥和外部通道重试策略仍需上线前校准。

## 0.45.3 运营预警负责人路由实现记录

本轮把运营预警从“能发出”推进到“能明确谁处理”：

1. Operational Alerts Module 新增负责人路由字段，规则、告警、通知和 Webhook payload 均携带 `ownerRole`、`ownerName`、`ownerContact` 与 `routeKey`。
2. `operational_alert_rule` 与 `operational_alert_notification` 增加负责人和路由字段，通知记录保留当次负责人快照。
3. 新增 `ADAPTER_RETRY_EXHAUSTED` 目标类型和默认规则，真实 Adapter 失败且达到最大重试次数后会进入运营预警评估。
4. Element Plus Admin 运营数据页新增负责人、联系方式、路由 Key 与 Webhook 输入，规则表和通知表展示负责人。
5. 后端测试、HTTP Interface 测试、Admin 自检和最终验收脚本已覆盖负责人字段、Adapter 重试耗尽告警和通知落账。
6. 运营预警命令行 Job 已在 0.45.4 接入，CloudBase Job 发布 Manifest 已在 0.45.5 接入；本段未接入真实企微/钉钉/短信发送，外部通知通道仍需生产 URL、密钥、模板和正式 CloudBase 控制台配置。

## 0.45.4 运营预警命令行 Job 实现记录

本轮把运营预警从“可被 HTTP 调用”推进到 CloudBase/cron 可直接调度：

1. 新增 `backend/scripts/operational-alert-runner.js`，复用 `POST /api/v1/jobs/operational-alerts`，不绕过后台鉴权、幂等和审计。
2. 新增 `npm run operational-alerts --prefix backend`，支持 `--campaign`、`--date-from`、`--date-to`、`--dry-run`、`--execute`、`--request-id`、`--reason`、`--json` 和后台口令参数。
3. 命令行默认 dry-run，执行模式必须显式 `--execute`；若未传 `request_id`，自动生成稳定前缀的 `request_id`。
4. 报告输出命中预警、负责人、执行结果和摘要，失败时返回非零退出码，便于外部调度器做告警。
5. 后端测试和最终验收脚本已覆盖命令行参数、报告、退出码和真实 HTTP Job 调用。
6. CloudBase Job 发布 Manifest 已在 0.45.5 接入；正式控制台触发器创建、密钥注入和外部告警渠道仍需上线环境确认。

## 0.45.5 CloudBase Job 发布 Manifest 实现记录

本轮把“能运行定时 Job”推进到“能交给 CloudBase 配置和发布评审”：

1. 新增 `backend/scripts/cloudbase-job-manifest.js`，集中输出 Adapter 到期重试、运营预警、生命周期结算队列调度、生命周期结算队列超时清理和用户生命周期定时导出五个定时 Job 的频率、HTTP Interface、命令、环境变量和安全策略。
2. 新增 `npm run jobs:manifest --prefix backend`，支持 Markdown 报告和 `--json` 结构化输出；`--strict` 会要求生产 base URL 使用 HTTPS。
3. `adapter-retry` 与 `operational-alerts` runner 默认优先读取 `ROOT_JOB_BASE_URL`，再回落到校准变量、公开域名和本地端口，形成 Job 专用环境变量 Interface。
4. Manifest 校验要求 Job 都声明 `ROOT_JOB_BASE_URL` 与 `ROOT_ADMIN_JOB_TOKEN`，并显式提供 dry-run/execute 命令，避免 CloudBase 控制台只配置执行命令而没有预演路径。
5. 后端测试和最终验收脚本已覆盖 Manifest 结构、频率、命令、环境变量和严格模式。
6. Production Env Matrix 已在 0.45.6 接入；本段未创建真实 CloudBase 控制台触发器，生产执行账号、密钥注入、告警渠道和触发历史仍需上线环境人工确认。

## 0.45.6 Production Env Matrix 实现记录

本轮把生产环境变量从散落文档推进到可执行发布证据：

1. 新增 `backend/src/productionEnvMatrix.js`，按运行与微信登录、生产数据仓库、CloudBase Job、有赞订单、有赞客户、有赞优惠券、物流、企业微信线索、企业微信标签和外部预警通道分组。
2. 新增 `npm run production-env --prefix backend`，支持 `--target production|gray`、`--json` 和 `--allow-blocked`，报告输出缺失项、负责人和处理动作。
3. Release Record Module 新增 `evidence.productionEnvMatrix`，并把缺失变量合并进 `mustFixBeforeRelease` 或 `mustConfirmForGray`。
4. `release-calibration` 报告新增“生产环境矩阵”章节，让环境变量、上线闸口、Adapter 校准和运行记录共用同一发布证据链。
5. 后端测试和最终验收脚本已覆盖 READY 矩阵、生产缺失阻塞、灰度提醒、发布记录 evidence 和命令行报告。
6. 本段不写入任何真实生产密钥；真实值仍只能放 CloudBase 环境变量、密钥管理或外部平台控制台。

## 0.45.7 CloudBase 身份透传探针实现记录

本轮把两个小程序账号打通的 CloudBase header 验证从人工登录路径中拆出：

1. 新增 CloudBase Identity Probe Module，集中读取 `x-wx-openid`、`x-wx-unionid`、`x-root-app-code`，并只返回脱敏预览。
2. 新增 `GET /api/v1/admin/cloudbase-identity-probe`，复用后台 admin seam，生产配置后台口令后才能访问。
3. 探针状态分为 `READY`、`UNIONID_PENDING`、`BLOCKED`，便于微信开放平台认证前后都能留存可解释证据。
4. 探针不创建用户、不写 Store、不绕过微信登录 Module；真正登录仍走既有 Identity Resolution Module。
5. 后端测试、HTTP Interface 测试和最终验收脚本已覆盖脱敏、口令保护和 `cloudbase_identity_probe` smoke。
6. 本段未证明真实 unionid 已经可用；认证通过并绑定两个小程序后，需要在真实 CloudBase 请求里复测。

## 0.45.8 Element Plus 开发发布页实现记录

本轮把发布证据从命令行和分散后台入口推进到 Element Plus Admin：

1. 新增 `admin/src/modules/release/adminReleaseApi.js`，以一个前端 Adapter 读取发布记录、上线闸口和 CloudBase 身份透传探针 Interface。
2. 新增 `admin/src/modules/release/ReleaseWorkbench.vue`，展示发布建议、阻塞项、上线闸口检查、Production Env Matrix 摘要和探针结果。
3. `admin/src/App.vue` 左侧导航新增“开发发布”，支持 `?module=release` 直接定位。
4. `admin/scripts/validate.js` 已覆盖 release Module 文件、关键 Interface 路径、探针 header 和页面状态字段。
5. 本地自检和 Element Plus 构建已通过；真实 CloudBase unionid 仍需等待微信开放平台认证与应用绑定后复测。

## 0.45.9 Element Plus 菜单级权限实现记录

本轮把后端最小角色能力延伸到 Element Plus Admin Shell：

1. Admin Access Control Module 新增角色能力列表输出，保持权限判断和能力定义同源。
2. 新增 `GET /api/v1/admin/me`，返回 operator、role、token 配置状态和 capabilities。
3. Element Plus Admin 根据 capabilities 渲染左侧菜单，viewer/finance/operator/admin 可见入口与后端能力保持一致。
4. Admin Shell 顶部展示当前 operator、role 和 local 状态，便于多人运营时确认当前操作者。
5. 后端测试、Admin 自检和 Admin build 已覆盖 profile Interface、菜单能力契约和跨午夜运营数据测试稳定性。

## 0.45.10 Element Plus Admin 主入口实现记录

本轮把后台入口从“新旧并行”推进到 Element Plus Admin 优先：

1. `admin/vite.config.js` 已固定 `base: "/admin/"`，让 build 产物从 `/admin/assets` 读取。
2. `backend/src/app.js` 已让 `/admin` 优先服务 `admin/dist/index.html`，并在 dist 缺失时回退旧静态后台。
3. `/admin-legacy` 保留旧静态后台显式入口，便于灰度期回滚和对照。
4. 后端 HTTP 测试已用临时 dist 覆盖 `/admin`、`/admin/assets` 和 `/admin-legacy`。
5. 最终验收脚本已新增 Element Plus 主入口与 legacy 回退 smoke，避免部署时只带旧后台。

## 0.45.11 backend-only Admin build 部署包实现记录

本轮把 `/admin` 主入口从“本地可用”推进到 backend-only 云托管可发布：

1. Admin dist 解析新增 `backend/public/admin-dist` 候选目录，并支持 `ROOT_ADMIN_DIST_DIR` 运行时覆盖。
2. 新增 `scripts/prepare-backend-admin-dist.js`，复制 `admin/dist` 到后端 public 目录，形成可随 `backend/Dockerfile` 一起发布的 build 产物。
3. 根 `package.json` 新增 `admin:build` 与 `deploy:prepare-admin`，上线前命令变成 `npm run admin:build && npm run deploy:prepare-admin`。
4. 后端测试覆盖 dist 候选解析和复制脚本，最终验收新增 `Backend admin dist bundle` 检查。
5. 旧 `/admin-legacy` 回退继续保留；本段只解决新后台 build 产物能随 backend-only 镜像发布。

## 0.45.12 Element Plus 按钮级权限实现记录

本轮把菜单级权限继续下沉到页面内写入动作：

1. 新增前端 Admin Access Module，统一暴露 `ADMIN_CAPABILITIES`、`createAdminAccess` 和 `useAdminAccess`，让页面只消费稳定能力 Interface。
2. `ConfigWorkbench` 已按 `CONFIG_WRITE`、`SETTLEMENT_EXECUTE`、`REVIEW_RESOLVE`、`REWARD_DELIVERY_WRITE` 禁用并提示对应按钮，动作方法也做前端守卫。
3. `AdapterRunPage` 已把订单增量、到期重试、Adapter 重跑和回滚统一挂到 `CONFIG_WRITE`；`OperationalAnalytics` 已把预警阈值保存和预警 Job 挂到 `CONFIG_WRITE`。
4. 后端补齐订单补链确认、订单/物流手工同步、Adapter 重跑、样本导入、批次确认和修正应用的写入能力校验，避免只依赖前端。
5. Admin 自检覆盖 access Module、按钮 gating 和写权限契约；后端测试新增 viewer 禁止 Adapter 重跑的回归断言。

## 0.45.13 用户生命周期完整筛选实现记录

本轮把用户管理筛选从基础搜索推进到运营排查可用：

1. Admin Lifecycle Presenter 新增活动、任务进度、咨询状态、结算状态、奖励状态、当前卡点、严重度和待办状态过滤。
2. 生命周期行新增 `taskProgressStatus`、`consultationStatus`、`settlementStatus`、`rewardStatus` 和 `hasOpenTasks`，便于前端展示和后续批量动作复用。
3. Element Plus `UserLifecycle` 页新增完整筛选条、limit 控制和重置按钮，并在表格中展示当前筛选状态口径。
4. Domain/API 测试覆盖组合筛选和排除筛选；最终验收脚本新增 `lifecycle_filters` smoke。
5. 本段只完成查询过滤；筛选结果导出、当前列表批量结算、保存常用筛选和按筛选条件全量批量结算已在后续批次接入，异步分批队列仍作为后续效率增强。

## 0.45.14 用户生命周期筛选导出实现记录

本轮把用户管理筛选结果从页面查询推进到运营可下载：

1. Admin Lifecycle Presenter 新增 CSV 导出 Implementation，复用 `buildLifecycleWorkbench` 的筛选口径。
2. 后端新增 `GET /api/v1/admin/lifecycle-users/export`，输出身份、UnionID、openid、活动、任务进度、咨询、结算、奖励、卡点、待办和最新生命周期事件字段。
3. Element Plus `UserLifecycle` 页新增 `导出 CSV` 按钮，下载条件与当前筛选对象一致。
4. Admin 自检、Domain/API 测试和最终验收脚本新增生命周期导出覆盖。
5. 字段默认脱敏已在 0.45.26 接入，下载审批已在 0.45.27 接入，留存期限、保存常用筛选、按筛选条件全量批量结算和异步分批结算队列已在后续批次接入。

## 0.45.15 用户生命周期当前列表批量结算实现记录

本轮把用户生命周期页从查询/导出推进到可执行运营动作：

1. `adminLifecycleApi` 新增批量结算预览/执行 Adapter，复用既有后台批量结算 Interface。
2. Element Plus `UserLifecycle` 页新增当前列表批量结算操作条，展示当前列表人数、总命中人数和可结算人数。
3. 页面支持活动 ID、`request_id`、二次确认、预览结果抽屉和确认执行；执行按钮按 `SETTLEMENT_EXECUTE` capability 禁用/提示。
4. 后端仍由既有批量结算 Module 负责权限、幂等、审计、结算记录和奖励生成，生命周期页不复制结算规则判断。
5. 当前实现作用于页面当前列表；保存常用筛选、按筛选条件全量批量结算和定时导出已在后续批次接入，异步分批执行已由结算队列能力承接。

## 0.45.16 用户生命周期常用筛选实现记录

本轮把用户生命周期页的高频查询组合持久化：

1. 新增 Admin Lifecycle Filter Presets Module，按 Admin 操作人保存常用筛选，字段归一化只接受生命周期筛选白名单。
2. 后端新增 `GET /api/v1/admin/lifecycle-filter-presets`、`POST /api/v1/admin/lifecycle-filter-presets/upsert` 和 `POST /api/v1/admin/lifecycle-filter-presets/delete`。
3. 保存和删除写入 `ADMIN_LIFECYCLE_FILTER_PRESET_UPSERT` / `ADMIN_LIFECYCLE_FILTER_PRESET_DELETE` 审计，并支持 `request_id` 幂等。
4. Element Plus `UserLifecycle` 页新增常用筛选下拉、筛选名称、保存、删除和套用能力。
5. Store 默认数据、快照校验、`schema.sql`、Domain/API 测试、Admin 自检和最终验收 smoke 已覆盖常用筛选。
6. 团队共享筛选和排序置顶已在 0.45.23 接入，定时导出已在 0.45.24 接入，复制筛选已在 0.45.25 接入；按筛选条件全量批量结算已在 0.45.17 接入，异步分批队列已在 0.45.18 接入。

## 0.45.17 用户生命周期筛选全量批量结算实现记录

本轮把用户生命周期页从当前列表批量操作推进到按筛选条件全量选人：

1. Admin Lifecycle Presenter 新增 `buildLifecycleBatchSelection`，复用生命周期筛选口径，但用独立 `selectionLimit` 控制批量选人上限，避免被页面列表 `limit` 截断。
2. Domain 层新增生命周期筛选批量结算预览/执行 Interface，先生成 `rootUserIds`，再复用既有批量结算 Module，保留二次确认、幂等、审计、结算记录和奖励生成。
3. 后端新增 `POST /api/v1/admin/lifecycle-users/settlement-batch-preview` 与 `POST /api/v1/admin/lifecycle-users/settlement-batch-execute`；执行仍要求 `SETTLEMENT_EXECUTE` capability 和 `request_id`。
4. Element Plus `UserLifecycle` 页新增筛选全量上限、筛选预览、筛选执行和结果抽屉来源/命中/截断信息；原当前列表按钮保留并改名区分。
5. Domain/API 测试、Admin 自检和最终验收脚本已覆盖新入口；`limit: 1` 的测试证明筛选全量选人不受页面分页限制。
6. 同步批量入口仍可保留用于小批量；手动分批队列、失败重试、进度页和取消动作已在 0.45.18 接入，自动调度已在 0.45.19 接入，定时导出已在 0.45.24 接入。

## 0.45.18 用户生命周期结算队列实现记录

本轮把筛选全量结算推进到可追踪的后台队列：

1. 新增 Admin Lifecycle Settlement Jobs Module，创建队列时冻结生命周期筛选快照、选入用户、`selectionLimit`、每批数量和操作人。
2. 后端新增队列列表、创建、执行下一批、取消和重试失败 Interface；执行动作继续复用既有批量结算 Module，保留原结算规则、二次确认、奖励生成和 `BATCH_SETTLEMENT_EXECUTE` 审计。
3. Store 默认数据、快照校验和 SQL schema 新增 `adminLifecycleSettlementJobs` / `admin_lifecycle_settlement_job`。
4. Element Plus 用户生命周期页新增每批数量、创建队列、查看队列和队列抽屉，支持查看状态、进度、失败数、奖励数、最近请求和批次请求。
5. Domain/API 测试、Admin 自检和最终验收脚本已覆盖创建、列表、分批执行、取消、失败重试和 `lifecycle_settlement_jobs` smoke。
6. 当前队列由运营手动执行下一批；CloudBase/cron 自动调度已在 0.45.19 接入，失败项和长时间未推进的站内预警已在 0.45.20 接入，队列超时清理已在 0.45.22 接入，定时导出已在 0.45.24 接入。

## 0.45.19 用户生命周期结算队列自动调度实现记录

本轮把手动队列推进到 CloudBase/cron 可调度：

1. 新增 Admin Lifecycle Settlement Scheduler Module，只选择 `QUEUED/RUNNING` 且仍有待处理用户的队列；调度只推进已创建队列，不负责创建队列快照。
2. 后端新增 `POST /api/v1/jobs/lifecycle-settlement-due`，执行模式要求 `SETTLEMENT_EXECUTE` capability 和稳定 `request_id`，每个候选队列仍复用既有队列执行 Interface。
3. 新增 `npm run lifecycle-settlement --prefix backend` 命令行 Runner，支持 dry-run/execute、活动筛选、每批数量、每轮队列上限和报告退出码。
4. CloudBase Job Manifest 增加 `lifecycle_settlement_due`，默认 `*/15 * * * *`、每批 20 人、每轮最多 3 个队列；Production Env Matrix 增加可选 `ROOT_LIFECYCLE_SETTLEMENT_CAMPAIGN_ID`。
5. Element Plus 用户生命周期队列抽屉新增调度预览和调度执行按钮，并展示候选、执行、成功和失败摘要。
6. Domain/API 测试、Admin 自检和最终验收脚本已覆盖调度 Module、HTTP Job、命令行 Runner、CloudBase Manifest 和 `lifecycle_settlement_scheduler` smoke。
7. 真实 CloudBase 控制台触发器仍需生产配置；外部预警 Webhook Adapter 已在 0.45.21 接入，队列超时清理已在 0.45.22 接入，团队共享筛选和排序置顶已在 0.45.23 接入，定时导出已在 0.45.24 接入，真实通道值仍需生产注入。

## 0.45.20 用户生命周期结算队列失败/卡住预警实现记录

本轮把结算队列异常纳入既有 Operational Alerts：

1. Operational Alerts 新增 `LIFECYCLE_SETTLEMENT_JOB_FAILED` 和 `LIFECYCLE_SETTLEMENT_JOB_STALLED` 两个目标类型。
2. 默认规则新增结算队列失败与长时间未推进预警；失败规则按 `failedCount > 0` 触发，卡住规则按 `ageMinutes >= 60` 触发。
3. 预警 payload 保留 `lifecycleJobId`、状态、失败数、待处理数、等待分钟数和错误说明，便于运营回到队列抽屉执行重试、取消或继续调度。
4. Element Plus 运营数据页的目标类型下拉新增结算队列失败和结算队列卡住，运营可配置负责人、路由 Key、冷却时间和渠道。
5. Domain/API 测试、Admin 自检和最终验收脚本已覆盖默认规则、analytics payload、运营预警 Job 通知落账和最终验收 smoke。
6. 外部预警 Webhook Adapter 已在 0.45.21 接入，队列超时清理已在 0.45.22 接入，团队共享筛选和排序置顶已在 0.45.23 接入，定时导出已在 0.45.24 接入。

## 0.45.21 外部预警 Webhook Adapter 实现记录

本轮把运营预警外部推送从通用占位推进到可生产配置的签名 Webhook Adapter：

1. 新增 Operational Alert Webhook Adapter，外部发送统一经过一个 Interface，Operational Alerts 主 Module 不直接处理 fetch、签名、模板和超时细节。
2. `WEBHOOK` 渠道支持规则级 `webhookUrl`，也支持生产环境默认 `ROOT_OPERATIONAL_ALERT_WEBHOOK_URL`；未配置 URL 时仍保留站内通知落账并标记跳过原因。
3. 支持 `ROOT_OPERATIONAL_ALERT_WEBHOOK_SECRET` 生成 `X-Root-Alert-Signature` HMAC-SHA256 签名，并支持通道、模板和超时环境变量。
4. Webhook payload 包含 alert、rule、负责人路由、`requestId`、通道和模板，覆盖生命周期结算失败/卡住、Adapter 重试耗尽和其他 Operational Alerts 目标。
5. 通知记录新增外部回执和错误，Element Plus 运营数据页展示外部回执/错误；命令行 Job 报告也输出外部回执与失败原因。
6. Domain/API 测试、Admin 自检和最终验收脚本已覆盖默认 URL、规则级 URL、签名、成功发送、HTTP 失败落账和失败退出码。
7. 真实企微/钉钉/短信 URL、签名密钥、模板内容和负责人名单仍需上线时由 CloudBase/密钥管理注入；外部通道重试和死信队列后续再做可靠性增强。

## 0.45.22 用户生命周期结算队列超时清理实现记录

本轮把结算队列从“可预警”推进到“可保守自动修复”：

1. 新增 Admin Lifecycle Settlement Cleanup Module，提供超时候选计划和执行 Interface，默认扫描 `QUEUED/RUNNING` 且仍有待处理用户的队列。
2. 清理策略默认保守：超过 120 分钟未推进的 `RUNNING` 队列重置为 `QUEUED`，让既有调度器继续推进；老化的 `QUEUED` 队列只写清理说明，不自动取消。
3. 自动取消必须显式启用 `allowCancel` 或 `ROOT_LIFECYCLE_SETTLEMENT_ALLOW_CANCEL=true`，且达到 `cancelAfterMinutes` 硬阈值后才会改为 `CANCELLED`。
4. 后端新增 `POST /api/v1/jobs/lifecycle-settlement-cleanup`，执行模式要求 `SETTLEMENT_EXECUTE` capability、稳定 `request_id`、幂等和清理审计。
5. 新增 `npm run lifecycle-settlement-cleanup --prefix backend` 命令行 Runner，支持 dry-run/execute、活动筛选、状态筛选、超时阈值、取消阈值、候选上限、报告和退出码。
6. CloudBase Job Manifest 增加 `lifecycle_settlement_cleanup`，默认每小时执行一次；Production Env Matrix 增加清理阈值和允许取消开关变量。
7. Element Plus 用户生命周期队列抽屉新增清理预览、超时清理和最近清理说明，运营可在页面先看候选再执行。
8. Domain/API 测试、Admin 自检和最终验收脚本已覆盖清理计划、执行、环境变量默认值、HTTP Job、命令行 Runner、CloudBase Manifest 和 `lifecycle_settlement_cleanup` smoke。
9. 真实 CloudBase 控制台触发器、`ROOT_JOB_BASE_URL`、`ROOT_ADMIN_JOB_TOKEN`、清理阈值变量和执行历史仍需上线环境配置；定时导出已在 0.45.24 接入，外部通道交付重试/死信已在 0.45.34 接入；团队共享筛选和排序置顶已在 0.45.23 接入。

## 0.45.23 用户生命周期团队共享筛选与排序置顶实现记录

本轮把常用筛选从个人保存推进到团队协作可用：

1. Admin Lifecycle Filter Presets Module 新增 `scope`、`pinned`、`sortOrder` 和 `canModify` 字段；旧记录默认按个人、未置顶、排序 100 兼容。
2. 列表 Interface 同时返回当前操作人的个人筛选与团队筛选，并按置顶、排序值、更新时间和标题排序。
3. 团队筛选允许其他操作人套用，但只有创建者可以修改或删除，避免多人运营误改共享模板。
4. SQL schema 为 `admin_lifecycle_filter_preset` 新增 `scope`、`pinned`、`sort_order`。
5. Element Plus 用户生命周期页新增团队共享、置顶、排序控件，下拉项展示团队/置顶标记，选中非本人团队筛选时禁止覆盖保存和删除。
6. Domain/API 测试、Admin 自检和最终验收脚本已覆盖团队共享、置顶排序、跨操作人可见、非创建者只读保护和 `lifecycle_filter_presets` smoke。
7. CSV 默认字段脱敏已在 0.45.26 接入，下载审批已在 0.45.27 接入；定时导出、CSV 留存期限和下载审计已在 0.45.24 接入，复制筛选已在 0.45.25 接入；企业微信 SSO 和组织架构同步仍待后续，不影响当前基于 Admin Token `operatorId` 的创建者保护。

## 0.45.24 用户生命周期定时导出实现记录

本轮把生命周期导出从“即时下载”推进到“可定时、可追溯、可下载记录”：

1. 新增 Admin Lifecycle User Exports Module，复用现有生命周期筛选与 CSV 生成口径，并集中处理导出计划、记录落账、下载次数、保留期和过期清理。
2. Store、seed 和 SQL schema 新增 `adminLifecycleUserExports` / `admin_lifecycle_user_export`，记录筛选快照、导出摘要、文件名、创建时间、过期时间和下载时间。
3. 后端新增 `GET /api/v1/admin/lifecycle-user-exports`、`POST /api/v1/admin/lifecycle-user-exports/create`、下载 Interface 和 `POST /api/v1/jobs/lifecycle-users-export`，execute 模式要求稳定 `request_id`。
4. Element Plus 用户生命周期页新增“生成导出记录”和“导出记录”抽屉，可按当前筛选生成记录、查看导出人数/截断状态/过期时间并下载 CSV。
5. 新增 `npm run lifecycle-users-export --prefix backend` 命令行 Runner，支持 dry-run/execute、活动筛选、状态筛选、导出上限、保留天数、报告和退出码。
6. CloudBase Job Manifest 新增 `lifecycle_users_export`，Production Env Matrix 新增 `ROOT_LIFECYCLE_EXPORT_CAMPAIGN_ID`、`ROOT_LIFECYCLE_EXPORT_LIMIT`、`ROOT_LIFECYCLE_EXPORT_RETENTION_DAYS`。
7. Domain/API 测试、Admin 自检、最终验收脚本和 Admin build 已覆盖导出记录、下载次数、过期清理、HTTP Job、命令行 Runner 和 CloudBase Manifest。
8. 默认字段脱敏已在 0.45.26 接入，下载审批已在 0.45.27 接入；对象存储文件 Adapter、签名下载和 Webhook 投递承接已在 0.45.29、0.45.32、0.45.33 接入，真实 COS/S3 SDK、真实邮件/企微平台 URL/模板仍需等生产投递通道确认。

## 0.45.25 用户生命周期复制筛选实现记录

本轮把团队常用筛选从“只读套用”推进到“可复制后个人化调整”：

1. Admin Lifecycle Filter Presets Module 新增 `copyPreset`，允许复制自己的筛选或团队筛选，并拒绝复制其他操作人的个人筛选。
2. 复制结果默认创建个人筛选副本，标题追加“副本”，保留来源筛选条件，默认不置顶、排序 100。
3. 后端新增 `POST /api/v1/admin/lifecycle-filter-presets/copy`，Domain 写入 `ADMIN_LIFECYCLE_FILTER_PRESET_COPY` 审计并记录来源 preset。
4. Element Plus 用户生命周期页新增“复制筛选”按钮，非创建者也可以把团队模板复制成个人版本继续修改。
5. Domain/API 测试、Admin 自检和最终验收脚本已覆盖复制、只读团队模板复制、个人筛选不可越权复制和审计记录。
6. 本段未接入企业微信 SSO、组织架构同步或审批流；当前仍基于 Admin Token `operatorId` 判断个人筛选与团队筛选可见性。

## 0.45.26 用户生命周期导出字段脱敏实现记录

本轮把生命周期导出从“受后台口令保护”推进到“字段策略可审计”：

1. 新增 Admin Lifecycle Export Policy Module，集中处理 `MASKED` / `RAW` 字段策略、角色判断和具体字段遮盖。
2. 即时 CSV、导出记录、下载记录和 CloudBase/cron Job 默认使用 `MASKED`，遮盖手机号、UnionID 和 OpenID；`root_user_id`、活动、任务、咨询、结算、奖励和卡点字段保持可用于运营复盘。
3. `RAW` 只能由 admin 角色显式请求；operator 等角色请求 `RAW` 会降级为 `MASKED`，并在导出摘要中记录 `requestedSensitivity` 和 `sensitivityDowngraded`。
4. 命令行 Runner 新增 `--sensitivity` 参数，CloudBase Job Manifest 与 Production Env Matrix 新增 `ROOT_LIFECYCLE_EXPORT_SENSITIVITY`。
5. Element Plus 用户生命周期导出记录抽屉展示字段策略，Domain/API 测试、Admin 自检和最终验收脚本覆盖默认脱敏、admin 原文和 operator 降级。
6. 下载审批流已在 0.45.27 接入；对象存储文件 Adapter、签名下载和 Webhook 投递承接已在 0.45.29、0.45.32、0.45.33 接入，真实 COS/S3 SDK、真实邮件/企微平台 URL/模板和字段级审批仍待真实角色、合规口径和生产通道确认。

## 0.45.27 用户生命周期导出下载审批实现记录

本轮把生命周期导出从“字段策略可审计”推进到“高风险下载需审批”：

1. Admin Lifecycle User Exports Module 新增审批状态，默认 `MASKED` 导出为 `NOT_REQUIRED`，`RAW` 或显式 `approvalRequired` 导出为 `PENDING`。
2. 下载 Interface 在审批通过前拒绝返回 CSV；审批拒绝后继续禁止下载。
3. 后端新增 `POST /api/v1/admin/lifecycle-user-exports/review`，审批动作要求 `DATA_EXPORT_APPROVE` capability，并支持 `request_id` 幂等。
4. Admin Access Control 新增 `DATA_EXPORT_APPROVE`，默认授予 admin 和 finance；operator 不能审批导出下载。
5. Element Plus 用户生命周期导出记录抽屉展示审批状态，并为具备能力的角色提供通过/拒绝动作。
6. 命令行 Runner 新增 `--approval-required`，CloudBase Job Manifest 与 Production Env Matrix 新增 `ROOT_LIFECYCLE_EXPORT_APPROVAL_REQUIRED`。
7. Domain/API 测试、Admin 自检和最终验收脚本覆盖审批前禁止下载、finance 审批、operator 拦截、审批后下载和 `lifecycle_export_approval` smoke。
8. 外部交付 Interface 已在 0.45.28 接入，本地文件对象存储 Adapter 已在 0.45.29 接入；真实 COS/S3/CloudBase 对象存储 SDK Adapter、邮件/企微外部投递、审批通知和字段级审批策略仍待真实角色、合规口径和生产通道确认。

## 0.45.28 用户生命周期导出外部交付 Interface 实现记录

本轮把生命周期导出从“审批后可下载”推进到“审批后可交付”：

1. 新增 Admin Lifecycle Export Delivery Module，提供 `NONE`、`INTERNAL_LINK`、`WEBHOOK`、`OBJECT_STORAGE` 交付通道口径。
2. 导出记录新增交付状态、交付目标、外部引用、错误、交付时间、交付 request_id 和尝试次数；默认定时导出不外发。
3. 后端新增 `POST /api/v1/admin/lifecycle-user-exports/deliver`，要求 `DATA_EXPORT_APPROVE` capability 和稳定 `request_id`。
4. 交付动作复用审批状态，待审批或已拒绝的高风险导出不能被外部交付。
5. Element Plus 用户生命周期导出记录抽屉展示交付状态，并提供内部下载链接交付动作。
6. 命令行 Runner、CloudBase Job Manifest 与 Production Env Matrix 新增 `ROOT_LIFECYCLE_EXPORT_DELIVERY_*` 和 `ROOT_LIFECYCLE_EXPORT_OBJECT_*` 变量口径。
7. Domain/API 测试、Admin 自检和最终验收脚本覆盖默认不交付、operator 拦截、finance 交付、审批前拦截、审批后交付和 `lifecycle_export_delivery` smoke。
8. 本地文件对象存储 Adapter 已在 0.45.29 接入，Webhook 签名下载投递增强已在 0.45.33 接入；真实 COS/S3/CloudBase 对象存储 SDK Adapter、真实邮件/企微平台 URL/模板、审批通知和字段级审批策略仍待生产通道确认。

## 0.45.29 用户生命周期导出对象存储文件 Adapter 实现记录

本轮把生命周期导出交付从“对象存储口径”推进到“可验证写入”：

1. Admin Lifecycle Export Delivery Module 新增对象存储 Adapter seam，外部 Adapter 只需实现 `putObject`。
2. 配置 `ROOT_LIFECYCLE_EXPORT_OBJECT_DIR` 或请求 `objectDir` 时，`OBJECT_STORAGE` 交付会把 CSV 写入对象目录。
3. 文件 Adapter 同步写入 `.metadata.json`，记录 content type、导出元数据、审批状态、文件大小和下载路径。
4. 对象 key 统一使用 `objectPrefix/exportId/filename`，并做路径片段清洗，避免逃逸对象目录。
5. 命令行 Runner 支持 `--object-base-url`、`--object-bucket`、`--object-dir`、`--object-prefix` 参数。
6. CloudBase Job Manifest、Production Env Matrix 和最终验收脚本已纳入 `ROOT_LIFECYCLE_EXPORT_OBJECT_DIR`。
7. Domain/API 测试和最终验收脚本覆盖本地对象目录写入、CSV 内容回读、metadata 记录和 HTTP smoke。
8. 后台导出签名下载链接已在 0.45.32 接入；真实 COS/S3/CloudBase 对象存储 SDK Adapter、对象存储原生签名 URL 和对象生命周期规则仍待生产 bucket、权限和密钥方案确认；过期导出对象清理已在 0.45.30 接入。

## 0.45.30 用户生命周期导出过期清理实现记录

本轮把生命周期导出交付从“可写入对象目录”推进到“过期文件可审计清理”：

1. Admin Lifecycle Export Delivery Module 为对象存储 Adapter seam 补齐 `deleteObject`，本地文件 Adapter 会删除 CSV 与 `.metadata.json`。
2. Admin Lifecycle User Exports Module 新增过期清理行为，dry-run 只列候选，execute 才删除对象并移除记录。
3. 后端新增 `POST /api/v1/jobs/lifecycle-user-exports-cleanup`，要求 `DATA_EXPORT_APPROVE` capability 和稳定 `request_id`。
4. 新增 `npm run lifecycle-user-exports-cleanup --prefix backend` 命令行 Runner，支持对象目录、对象清理开关、候选上限、指定 now、dry-run/execute 和报告退出码。
5. CloudBase Job Manifest 增加 `lifecycle_user_exports_cleanup`，Production Env Matrix 增加 `ROOT_LIFECYCLE_EXPORT_CLEANUP_LIMIT` 与 `ROOT_LIFECYCLE_EXPORT_OBJECT_CLEANUP_ENABLED`。
6. 已过期的对象导出不会被列表/下载路径自动剪掉；页面读取时隐藏、下载/审批/交付时拒绝，保留记录等待显式清理，避免产生对象文件孤儿。
7. Domain/API 测试和最终验收脚本覆盖对象候选、权限拦截、缺 request_id 拦截、对象文件与 metadata 删除、记录移除、审计和 `lifecycle_export_cleanup` smoke。
8. Element Plus 页面入口已在 0.45.31 接入，后台导出签名下载链接已在 0.45.32 接入；真实 COS/S3/CloudBase 对象存储 SDK Adapter、对象存储原生签名 URL、对象存储生命周期规则和正式 CloudBase 触发器仍待生产环境确认。

## 0.45.31 用户生命周期导出过期清理页面入口实现记录

本轮把导出过期清理从“Job/CLI 可用”推进到“运营后台可操作”：

1. Element Plus `UserLifecycle` 导出记录抽屉新增“过期清理预览”和“过期清理”按钮。
2. 前端 API Module 新增 `runLifecycleUserExportsCleanup`，复用 `POST /api/v1/jobs/lifecycle-user-exports-cleanup`。
3. 清理预览和执行都按 `DATA_EXPORT_APPROVE` capability 禁用，保持和后端 Interface 一致。
4. 页面新增最近清理结果提示，展示候选、移除记录、删除对象、跳过对象和失败对象数。
5. 最终验收脚本会检查构建后的 Admin JS 中包含导出过期清理 endpoint 与入口文案。
6. 后台导出签名下载链接已在 0.45.32 接入；更细的清理历史、失败对象单独重试、真实 COS/S3/CloudBase 删除 Adapter 和对象存储原生签名 URL 仍作为后续增强。

## 0.45.32 用户生命周期导出签名下载链接实现记录

本轮把导出外部交付从“内部后台下载链接”推进到“可投递的短期签名下载链接”：

1. Admin Lifecycle Export Delivery Module 新增 signed download Interface，按导出记录、文件名、过期时间和密钥生成 HMAC-SHA256 签名。
2. 新增公开下载路径 `GET /api/v1/lifecycle-user-exports/:exportId/signed-download`，不要求后台 token，但必须带有效 `expires` 与 `signature`。
3. 签名下载仍复用导出审批、保留期限、下载计数和审计逻辑；`RAW` 或待审批导出不能通过签名链接绕过审批。
4. 新增 `ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET`、`ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_ENABLED` 和 `ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_TTL_SECONDS`，并纳入 CloudBase Job Manifest 与 Production Env Matrix。
5. Domain/API 测试覆盖签名生成、下载成功、坏签名、过期签名和缺密钥不生成链接；最终验收新增 `lifecycle_export_signed_download` smoke。
6. Webhook 签名下载 payload 已在 0.45.33 接入，导出交付重试/死信已在 0.45.34 接入；真实邮件/企微平台 URL/模板、对象存储 SDK Adapter、对象存储原生签名 URL、真实执行历史和外部审批通知仍待生产通道确认。

## 0.45.33 用户生命周期导出 Webhook 投递增强实现记录

本轮把导出外部交付从“可生成短期签名链接”推进到“Webhook 可承接邮件/企微投递 Adapter”：

1. `WEBHOOK` 交付 payload 新增 `signedDownloadUrl`、`signedDownloadPath` 和 `signedDownloadExpiresAt`，外部投递 Adapter 可直接使用短期下载链接，不暴露后台 admin 下载路径。
2. Webhook 请求头新增导出 ID、`request_id`、通道、模板、签名下载标记与 HMAC 签名，便于外部平台做幂等、路由和验签。
3. 交付结果记录 `webhookStatusCode`、`webhookSigned`、`webhookResponsePreview` 和 `signedDownloadUrlPreview`；预览会去掉 query，避免泄露 signature。
4. Production Env Matrix 与 CloudBase Job Manifest 新增 `ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_CHANNEL`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_TEMPLATE`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_TIMEOUT_MS`。
5. Domain/API 测试和最终验收脚本覆盖 Webhook 202、签名头、signed download payload、响应摘要和 `lifecycle_export_webhook_delivery` smoke。
6. 导出交付重试/死信已在 0.45.34 接入；真实邮件/企微 URL、模板内容、负责人名单、真实执行历史、真实 COS/S3/CloudBase SDK Adapter 和对象存储原生签名 URL 仍需生产环境注入和验收。

## 0.45.34 用户生命周期导出交付重试/死信实现记录

本轮把导出外部交付从“Webhook 可承接投递”推进到“失败可调度重试并进入死信”：

1. Admin Lifecycle User Exports Module 新增 `RETRY_SCHEDULED` 与 `DEAD_LETTER` 交付状态，记录 last attempt、next retry、max attempts 和 dead letter reason。
2. 交付失败时只有显式启用 `deliveryRetryEnabled` 或生产变量后才会自动排入重试，避免改变既有手工失败处理口径。
3. 新增 `POST /api/v1/jobs/lifecycle-user-exports-delivery-retry`，支持 dry-run 预览、execute 执行、批量上限、最大尝试次数和稳定 `request_id`。
4. 新增 `npm run lifecycle-user-exports-delivery-retry --prefix backend` 命令行 Runner，CloudBase/cron 可复用同一个 Job Interface。
5. CloudBase Job Manifest 与 Production Env Matrix 新增 `ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_BATCH_SIZE`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_MAX_ATTEMPTS`、`ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_DELAY_SECONDS`。
6. Domain/API 测试和最终验收脚本覆盖 Webhook 500 后进入 `RETRY_SCHEDULED`、到期 dry-run、execute 重试成功和 `lifecycle_export_delivery_retry` smoke。
7. 真实邮件/企微 URL、模板内容、负责人名单和真实 CloudBase 执行历史仍需生产环境注入和验收；通道健康页和失败原因聚合已在 0.45.35 接入。

## 0.45.35 用户生命周期导出通道健康聚合实现记录

本轮把导出交付从“记录级重试”推进到“运营可看通道健康”：

1. Admin Lifecycle User Exports Module 新增通道健康聚合 Interface，按交付状态、通道、失败原因、到期重试和最近异常汇总已有导出记录。
2. 新增 `GET /api/v1/admin/lifecycle-user-exports/delivery-health`，返回 `HEALTHY`、`PENDING`、`WARNING`、`BLOCKED`、`IDLE` 健康状态和可操作计数。
3. Element Plus 用户生命周期导出记录抽屉新增健康摘要、通道表和失败原因表，运营可在同一抽屉查看交付、重试、死信和失败原因。
4. 页面补齐 `RETRY_SCHEDULED` 与 `DEAD_LETTER` 交付状态标签，避免新后端状态在后台显示为未请求。
5. Domain/API 测试和最终验收脚本覆盖失败后 `WARNING`、到期重试计数、重试成功后恢复和 `lifecycle_export_delivery_health` smoke。
6. 真实邮件/企微 URL、模板内容、负责人名单、真实 CloudBase 执行历史、真实 COS/S3 SDK Adapter、对象存储原生签名 URL、企业微信 SSO/组织架构仍需生产环境注入或后续批次推进；通道健康订阅通知已在 0.45.36 接入运营预警体系。

## 0.45.36 用户生命周期导出交付健康预警实现记录

本轮把生命周期导出通道健康从“抽屉内查看”推进到“可订阅、可路由、可审计通知”：

1. 新增运营预警目标类型 `LIFECYCLE_EXPORT_DELIVERY_HEALTH`，复用已有规则、Job、通知历史和 Webhook Adapter Interface。
2. 新增默认规则 `op_alert_lifecycle_export_delivery_dead_letter` 和 `op_alert_lifecycle_export_delivery_due_retry`，分别覆盖死信交付和到期重试。
3. 预警 payload 新增 `exportId`、`exportFilename`、`deliveryChannel`、`deliveryStatus`、`dueRetryCount`、`deadLetterCount`、`attemptCount`、`maxAttempts` 和 `deadLetterReason`。
4. Element Plus 运营数据页预警规则表单新增“导出交付健康”目标。
5. Domain/API 测试和最终验收脚本覆盖默认规则、导出死信、导出到期重试、站内通知和 Job 执行结果。
6. 真实邮件/企微 URL、模板内容、负责人名单、真实 CloudBase 执行历史、真实 COS/S3 SDK Adapter、对象存储原生签名 URL、企业微信 SSO/组织架构和外部告警签收策略仍需生产环境注入或后续批次推进。

## 0.45.37 发布记录外部通道与负责人证据实现记录

本轮把生产配置缺口从“文档提醒”推进到“发布记录可审计证据”：

1. `releaseRecord` 新增 `externalChannelReadiness`，聚合 Operational Alerts 负责人路由、外部预警 Webhook 环境变量、生命周期导出 Webhook 交付变量和导出交付健康摘要。
2. 发布记录顶层新增 `mustFixBeforeRelease`、`mustConfirmForGray` 和 `finalChecks`，Element Plus 开发发布页可直接展示发布阻塞。
3. `release-calibration` 命令行报告新增“外部通道与负责人”章节。
4. Domain/API 测试和最终验收脚本覆盖发布记录外部通道证据、导出交付健康预警负责人路由和顶层阻塞字段。
5. 真实 URL、模板、负责人姓名/联系方式、签收策略和执行历史仍需生产环境注入；发布记录会把缺口列为阻塞或灰度确认项。

## 0.45.38 发布证据包实现记录

本轮把上线证据从多条命令推进到一个可脱敏汇总包：

1. 新增 `releaseEvidencePack` Module，聚合发布记录、Production Env Matrix、CloudBase Job Manifest、Adapter 校准和外部通道负责人证据。
2. 新增 `npm run release:evidence --prefix backend`，支持生产/灰度目标、后台口令、JSON 输出、严格模式和允许阻塞退出。
3. 证据包清洗 base_url 中的账号、密码和 query，并校验不输出真实 token、secret、openid、unionid 或手机号原文。
4. 新增专用测试和最终验收 `release_evidence_pack` smoke。
5. 真实生产证据仍需在 CloudBase、微信开放平台、有赞、企微和外部通道配置完成后重新生成；本地证据包不能替代真实环境验收。

## 0.45.39 发布证据包后台入口实现记录

本轮把命令行证据包接入后台发布页：

1. 新增 `GET /api/v1/admin/release-evidence-pack`，返回 `pack` 与 `validation`，支持 `target`、`baseUrl` 和 `strict`。
2. Domain Interface 复用现有发布记录、Production Env Matrix、CloudBase Job Manifest、Adapter 校准和外部通道负责人证据，页面不重复实现发布判断。
3. Element Plus「开发发布」页新增发布证据包区块，展示状态、阻塞/提醒、Job 数、缺失变量和留证命令。
4. 发布页支持下载脱敏 JSON 证据包，供正式验收附件留存。
5. API 测试和最终验收 HTTP smoke 覆盖 `release-evidence-pack` 路径；真实生产证据仍需在生产环境重新生成。

## 0.45.40 发布证据包留档实现记录

本轮把证据包从“可下载”推进到“可追溯留档”：

1. 新增 `releaseEvidenceArchive` Module，保存脱敏证据包摘要、validation、操作人、request_id、备注和时间。
2. Store 快照新增 `releaseEvidenceArchives`，快照校验覆盖重复 `archive_id` 与 `request_id`；数据库 Schema 新增 `release_evidence_archive` 表结构。
3. 新增 `POST /api/v1/admin/release-evidence-pack/archive`，要求 `CONFIG_WRITE` capability 和稳定 `request_id`，并写入 `RELEASE_EVIDENCE_ARCHIVE_CREATE` 审计。
4. Element Plus「开发发布」页新增留档备注、留档按钮和最近留档列表。
5. Domain/API 测试和最终验收覆盖留档、幂等、审计和脱敏检查；真实生产留档仍需在生产环境重新生成。

## 0.45.41 发布证据包留档取回实现记录

本轮把留档从“只看摘要”推进到“可按历史记录下载当时证据”：

1. Domain 新增 `getReleaseEvidenceArchive`，从 `releaseEvidenceArchives` 按 `archiveId` 返回摘要、脱敏证据包和 validation。
2. HTTP 层新增 `GET /api/v1/admin/release-evidence-pack/archive?archiveId=...`，不存在的留档返回 404，当前证据包刷新不会影响历史留档内容。
3. Element Plus「开发发布」页最近留档表新增行级下载，下载对应历史留档 JSON。
4. Domain/API 测试、Admin 自检和最终验收覆盖留档详情取回、下载数据脱敏和 validation 状态。

## 0.45.42 发布签字记录实现记录

本轮把发布记录模板里的人工签字位推进到后台可审计记录：

1. 新增 `releaseSignoff` Module，产品、运营、研发三类角色可对目标环境记录 `APPROVED/REJECTED` 签字。
2. 签字必须绑定发布证据包留档 `archiveId`，避免脱离当时证据单独签字。
3. 发布记录 `signoffs` 会读取最新签字记录，未签字角色仍保持 `PENDING`。
4. 新增 `POST /api/v1/admin/release-signoffs`，要求 `CONFIG_WRITE` capability、稳定 `request_id`，并写入 `RELEASE_SIGNOFF_RECORD` 审计。
5. Element Plus「开发发布」页新增发布签字卡片，支持选择留档、角色、状态和备注并查看签字状态。
6. Domain/API 测试和最终验收覆盖签字记录、幂等、审计和发布记录汇总；真实生产签字仍需等生产证据包留档后执行。

## 0.45.43 发布签字 Gate 实现记录

本轮把签字记录推进到可参与发布判断的 Gate：

1. `releaseSignoff` Module 新增 `buildReleaseSignoffGate`，集中计算产品、运营、研发签字状态。
2. 发布记录新增 `signoffGate`，生产缺签进入阻塞，灰度缺签进入待确认，任一拒绝直接阻塞。
3. 发布证据包新增 `summary.signoffGateStatus` 和 `evidence.signoffGate`，JSON/Markdown 留档均能看到签字 Gate。
4. Element Plus「开发发布」页新增 Gate 摘要卡片，展示 Gate、已通过、待签和已拒绝数量。
5. Domain/API 测试和最终验收覆盖初始待签、产品签字后计数变化和三方签字后的 Gate READY；真实生产仍需留档后由三类负责人完成签字。

## 0.45.44 Admin 迁移 Gate 实现记录

本轮把旧静态后台下线决策推进到发布记录可判断的 Gate：

1. 新增 `adminTransitionReadiness` Module，检查 Element Plus Admin 模块覆盖、source dist、backend-only dist、`/admin-legacy` 回退和下线批准环境变量。
2. 发布记录新增 `evidence.adminTransitionReadiness`，Admin 迁移阻塞/提醒会进入发布 checklist。
3. 发布证据包新增 `summary.adminTransitionStatus` 和 `evidence.adminTransitionReadiness`，JSON/Markdown 留档可看到 Admin 迁移 Gate。
4. Element Plus「开发发布」页新增 Admin 迁移 Gate 卡片，展示模块覆盖、部署包、旧后台回退和下线批准状态。
5. API/Domain 测试和最终验收覆盖 Admin 迁移 Gate；本段不删除旧静态后台，正式移除仍需生产稳定期和 `ROOT_LEGACY_ADMIN_DEPRECATION_APPROVED=true`。

## 0.45.45 生产切换 Gate 实现记录

本轮把真实生产切换前的外部证明项结构化：

1. 新增 `productionCutoverReadiness` Module，检查微信开放平台、CloudBase unionid、Root 会员中心 appId、有赞、企微、CloudBase Job、外部通道、导出存储和回滚演练证明。
2. 发布记录新增 `evidence.productionCutoverReadiness`，生产目标缺证明进入阻塞，灰度目标缺证明进入待确认。
3. 发布证据包新增 `summary.productionCutoverStatus` 和 `evidence.productionCutoverReadiness`，JSON/Markdown 留档可看到生产切换 Gate。
4. `npm run calibrate --prefix backend` 新增“生产切换 Gate”章节。
5. Element Plus「开发发布」页新增生产切换 Gate 卡片；API/Domain/证据包测试和最终验收覆盖该 Gate。

## 0.45.46 生产切换证明记录实现记录

本轮把生产切换证明从只能依赖环境变量，推进到可由后台记录并进入发布判断：

1. 新增 `productionCutoverProof` Module，负责证明项校验、`VERIFIED` / `REJECTED` 状态记录、证据引用脱敏、备注脱敏、幂等和审计。
2. Store 与 SQL schema 新增生产切换证明记录集合，快照校验覆盖 `proof_id` 和 `request_id` 重复。
3. 新增 `GET /api/v1/admin/production-cutover-proofs` 和 `POST /api/v1/admin/production-cutover-proofs`，Element Plus「开发发布」页可直接记录证明。
4. `productionCutoverReadiness` Gate 会读取最新后台记录；环境变量和 `VERIFIED` 记录都可使证明项通过，最新 `REJECTED` 会阻塞该项。
5. API/Domain/证据包测试和最终验收覆盖证明记录、重复请求、敏感信息不泄露和发布记录联动。

## 0.45.47 旧静态后台下线决策记录实现记录

本轮把旧静态后台下线批准从环境变量推进到可审计记录：

1. 新增 `adminLegacyDeprecationDecision` Module，负责 `APPROVED` / `REJECTED` 下线决策、证据引用、回滚引用、备注脱敏、幂等和审计。
2. Store 与 SQL schema 新增旧后台下线决策记录集合，快照校验覆盖 `decision_id` 和 `request_id` 重复。
3. 新增 `GET /api/v1/admin/admin-legacy-deprecation-decisions` 和 `POST /api/v1/admin/admin-legacy-deprecation-decisions`，Element Plus「开发发布」页可直接记录下线决策。
4. `adminTransitionReadiness` Gate 会优先读取最新后台决策记录，环境变量只作为兼容兜底；最新 `REJECTED` 会提示继续保留 `/admin-legacy`。
5. 发布记录、发布证据包、API/Domain/证据包测试、Admin 自检和最终验收覆盖下线决策记录、重复请求、敏感信息不泄露和发布记录联动。

## 0.45.48 生产证据收口实现记录

本轮把分散在文档台账里的上线外部证据推进到发布记录可见：

1. 新增 `productionEvidenceIntake` Module，把 T-001 到 T-010 映射为账号身份、有赞商城、运营触达、数据与 Store、发布回滚五组证据项。
2. 生产证据收口项复用既有 Gate 和记录 Module，不重复判断底层 Interface。
3. 发布记录新增 `evidence.productionEvidenceIntake`，发布证据包新增 `summary.productionEvidenceIntakeStatus` 和 `evidence.productionEvidenceIntake`。
4. Element Plus「开发发布」页新增生产证据收口卡片，展示编号、范围、状态、负责人、来源和下一步动作。
5. Domain/API/证据包/Admin 自检和最终验收覆盖 10 条证据项、Markdown 报告章节和旧后台下线决策联动。

## 0.45.49 新版问卷答卷实现记录

本轮把 B3/B4 留下的完整 `questionnaire_answer` 能力从任务 payload 推进到独立答卷记录：

1. `questionnaire` Module 新增新版答卷 Interface，支持 `root_user_id + campaign_id + questionnaire_id + version` 留存、幂等提交、必填校验、分值范围校验和跟进判断。
2. 新增 `POST /api/v1/questionnaire/answers` 与 `GET /api/v1/questionnaire/answers/status`，不依赖旧 `checkin_session`，无订单用户也能提交活动问卷。
3. 小程序阶段问卷页改为提交新版答卷，由后端桥接 `QUESTIONNAIRE` 任务事实，避免页面绕过问卷定义校验。
4. Element Plus 用户生命周期详情新增新版问卷答卷摘要和最近答卷表，便于运营追溯。
5. Domain/API 测试、Admin 自检、小程序自检和最终验收新增 `questionnaire_answer` 覆盖。

## 0.45.50 myRoot 活动首页改版实现记录

本轮把 DEV-4001 从旧 7 日试饮首页主体推进到 myRoot 互动首页：

1. `pages/home/index` 的 `activity` 状态读取 `/api/v1/campaigns/active`、`/api/v1/tasks/progress` 和 `/api/v1/products`，展示活动、任务进度和商品镜像。
2. 首页“今日建议”使用 Task Progress 展示模型，按 `taskType` 分发到打卡、问卷、咨询、分享或商品页。
3. 首页商品区只展示 myRoot 商品快照，购买仍由商品详情/商品页跳 Root 会员中心处理。
4. 首页保留订单、咨询、奖励快捷入口，但订单不再是活动参与前置。
5. 小程序自检新增首页契约，避免首页回退到旧订单启动主体。

## 0.45.51 Settlement AND/OR 条件树实现记录

本轮把 DEV-5002 从“平铺条件全部满足”推进到可配置条件树：

1. Settlement Module 支持旧平铺数组和显式条件树两种条件配置；旧数组继续作为隐式 AND，不破坏既有规则版本。
2. 显式规则树支持 `{ logic: "AND" | "OR", conditions: [...] }`，可表达“完成任一互动即可奖励”等运营任务机制。
3. 结算结果新增 `conditionTree`，同时保留旧展示使用的 `conditions` / `missingConditions`，让调用方不需要理解树结构也能继续展示缺失条件。
4. Admin Config Presenter 的条件数量按叶子条件统计，后台规则列表能正确展示 OR/AND 组合规则的配置规模。
5. Domain/API 测试覆盖规则发布、任务事实命中、OR 达标、缺失条件展示和配置工作台条件数量。

## 0.45.52 后台 AND/OR 规则生成器实现记录

本轮把 B7.91 的条件树能力接到运营配置页：

1. Element Plus Admin「结算规则」页新增规则生成器，支持全部满足/任一满足两种关系，并可勾选打卡、问卷、分享、咨询和购买条件。
2. 生成器可配置打卡天数、问卷类型、分享次数、指定商品 ID，并可生成有赞券、免单机会、积分和标签奖励。
3. 生成结果仍写入规则 JSON，发布继续复用 `publishRuleVersion` 和后端规则发布 Interface，保持规则能力集中在 Settlement Module。
4. 默认规则模板字段改为 `conditionType`、`minCount`、`questionnaireType` 等后端可直接评估的结构，版本号默认值改为 `1`。
5. Admin 自检和构建已覆盖规则生成器存在性，避免结算配置页退回纯手写 JSON。

## 0.45.53 奖励上限保护实现记录

本轮把奖励库存风险先收口到 Reward Grant Module：

1. 奖励配置支持 `stockLimit`、`maxCount`、`quota`、`quotaLimit` 与 `quotaKey` / `inventoryKey` / `budgetKey`，用于限制同活动同奖励池的有效 `reward_grant` 数量。
2. 超过上限时用户仍保持结算达标，结算记录照常生成，但该奖励返回 `SKIPPED`、`skipped=true` 和 `skippedReason`，不会生成新的奖励记录或发放任务。
3. 同一用户重复结算仍按幂等键返回已有奖励，不会被已满库存误伤。
4. `reward_grant` 新增 `quota_key` 和 `quota_limit` 字段，Schema 与用户端/后台可见 payload 已同步。
5. Element Plus Admin 规则生成器新增“奖励上限”，可直接生成带 `stockLimit/quotaKey` 的奖励 JSON。
6. Domain/API/Admin 自检和最终验收已覆盖奖励上限配置、HTTP 发布、跳过结果和规则生成器字段。

## 0.45.54 奖励库存预占/释放实现记录

本轮把奖励上限从“数已有奖励”推进到独立库存预占：

1. 新增 `rewardInventory` Module，提供库存池、预占、释放和使用量统计 Interface。
2. Store 和 Schema 新增 `rewardInventoryPools` / `rewardInventoryReservations`，`reward_grant` 记录关联 `inventory_reservation_id`。
3. Reward Grant Module 生成限量奖励前先创建 reservation；库存已满时只返回 `SKIPPED`，不生成奖励或发放任务。
4. 人工复核拒绝限量奖励时会释放 reservation，让后续达标用户可以获得释放出的名额。
5. Domain/API 测试覆盖预占、超限跳过、幂等重算不重复占用、复核拒绝释放和释放后重新发放。

## 0.45.55 免单抽取与黑名单实现记录

本轮把 D-006 从“待运营规则”推进到可配置奖励资格判断：

1. Reward Grant Module 支持 `chanceRate` / `selectionRate` / `lotteryRate` / `winRate` / `probability`，使用确定性分数决定是否生成奖励。
2. 同一用户、活动、规则版本和奖励 Key 的抽取结果稳定，重复结算不会因为随机数漂移。
3. 支持 `blockedRootUserIds`、`blacklistRootUserIds`、`excludedRootUserIds` 黑名单字段；命中时跳过奖励但保留达标结算事实。
4. Element Plus Admin 规则生成器新增“免单抽取”比例，低于 100% 时生成 `chanceRate`。
5. Domain/API/Admin 自检覆盖 0% 抽取、黑名单跳过和 HTTP 发布配置。

## 0.45.56 奖励售后追回/库存回补实现记录

本轮把 D-011 的本地风控闭环推进到可追溯追回：

1. 新增 `rewardRecovery` Module，提供奖励追回、撤销、库存回补、复核关闭和台账查询 Interface。
2. Store 和 Schema 新增 `rewardRecoveryRecords` / `reward_recovery_record`，`reward_grant` 追加 recovery 状态、原因、关联台账和时间字段。
3. 本地退款审批通过后会调用 Reward Recovery Module，追回该用户关联奖励并释放库存 reservation。
4. 未发放奖励直接 `REVOKED`，已发放或已有外部凭证的奖励进入 `RECOVERY_PENDING`，为后续真实外部追回动作保留 seam。
5. Domain/API 测试覆盖退款通过后的奖励追回、库存释放和释放后重新发放。

## 0.45.57 企微自动触达队列实现记录

本轮把 D-010 从“待确认企微能力”推进到本地可配置运营任务机制：

1. 新增 `weworkTouch` Module，统一处理触达候选选择、默认任务类型、模板渲染、24 小时同类冷却、幂等队列、执行和审计。
2. Store 和 Schema 新增 `weworkTouchJobs` / `wework_touch_job`，记录外部联系人 ID、模板 Key、消息、状态、Adapter 类型、执行次数、外部回执和错误。
3. 新增 `WEWORK_TOUCH` Adapter；真实 `WEWORK_TOUCH_SEND_URL` 与 token 未配置时，可用 `MANUAL`、`LOCAL` 或 `SIMULATED` 模式本地确认。
4. 新增 `GET /api/v1/admin/wework-touch-jobs`、`POST /api/v1/admin/wework-touch-jobs/plan`、`POST /api/v1/admin/wework-touch-jobs/run` 和 `POST /api/v1/jobs/wework-touch-due`，执行模式要求稳定 `request_id`。
5. 新增 `npm run wework-touch --prefix backend`，CloudBase Job Manifest 增加 `wework_touch_due`，Production Env Matrix 增加触达口径与真实 Adapter 可选变量。
6. Domain/API 测试和最终验收 smoke 覆盖 BLOCKED 补链激活、runner 执行、待办完成和 Manifest 校验；真实企微 URL/token/模板/回执字段仍需生产配置。

## 0.45.58 订单售后状态镜像与追回联动实现记录

本轮把 D-012 从“待 live 字段校准”推进到本地可追溯售后同步：

1. 新增 `orderAfterSales` Module，提供售后记录 upsert、批量同步、状态映射、订单摘要更新、退款工作项同步、奖励追回和列表查询 Interface。
2. Store 和 Schema 新增 `orderAfterSalesRecords` / `order_after_sales_record`，`youzan_order` 新增售后状态、售后单号、退款状态、退款金额和售后更新时间字段。
3. 新增 `GET /api/v1/admin/order-after-sales`、`POST /api/v1/admin/order-after-sales/upsert` 和 `POST /api/v1/admin/order-after-sales/sync`，写入要求稳定 `request_id`。
4. `ROOT_AFTER_SALES_STATUS_MAP` 控制原始状态映射，`ROOT_AFTER_SALES_RECOVERY_STATUSES` 控制奖励追回触发，`ROOT_AFTER_SALES_FOLLOW_STATUSES` 控制人工跟进待办。
5. 命中退款成功类状态时，已存在的本地退款工作项会同步为 `PAID`，Reward Recovery Module 会按 `order_id` / `youzanOrderNo` / `sessionId` / `rewardGrantIds` 等证据追回或撤销关联奖励，避免同一用户跨订单误追回。
6. `reward_grant` 已补可选 `order_id`，旧数据缺少关联字段时仅在单一候选奖励场景保留兼容兜底。
7. Domain/API 测试和最终验收 smoke 覆盖售后申请、退款成功、批量同步、用户订单售后摘要、奖励追回和 Production Env Matrix。

## 0.45.59 问卷分支题实现记录

本轮把“问卷分支题”从待开发项推进到本地可用：

1. `questionnaire` Module 新增 `visibleIf` 分支规则求值，支持简单字段比较、集合包含、存在性、布尔真值、数值大小和 `AND / OR` 条件组。
2. 必填校验改为基于当前答案的可见题集合；隐藏题不阻塞提交，可见的 `required: true` 分支题由后端统一校验。
3. 默认中期问卷和收尾问卷新增 `needsContact === true` 时显示的 `contactReason` 分支题，用于结构化沉淀运营跟进重点。
4. 小程序新版活动问卷页与旧 7 日打卡问卷页共用 `utils/questionnaire-branching.js`，前端动态展示可见题并只提示当前可见必填项。
5. Domain/API 测试覆盖分支题缺失失败、正常提交、幂等提交和任务事实桥接；小程序校验和最终验收 smoke 已同步覆盖。

## 0.45.60 规则拖拽编辑器实现记录

本轮把后台规则配置从轻量生成器推进到拖拽式条件树编辑：

1. Element Plus Admin「结算规则」页新增 `ruleTree` 编辑器，可新增条件、新增分组、启停节点、上移/下移，并通过 HTML5 `draggable` 在同层重排。
2. 条件节点支持打卡天数、连续打卡、阶段问卷、分享次数、完成咨询和购买商品，分组节点支持 `AND / OR`。
3. 编辑器编译结果仍写入规则 JSON，发布继续复用 `campaign-rules/publish` 和 Settlement Module 的同一 Interface。
4. 根节点 `AND` 继续输出旧兼容数组，根节点 `OR` 输出显式条件树；分组节点输出 `{ logic, label, conditions }`，旧规则版本无需迁移。
5. Admin 自检新增拖拽规则树契约，Admin build 和最终验收已覆盖不退回纯手写 JSON。

## 0.46 用户端状态复核页实现记录

本轮把 DEV-4011 从设计占位推进到小程序可运行页面：

1. 新增 `subpkg/profile/pages/review/index`，复用结算状态 Interface 展示待复核、历史复核、最近结算和关联奖励。
2. 奖励页人工复核卡片和个人中心菜单均新增状态复核入口，路由守卫允许已注册及活动相关用户查看。
3. 小程序静态校验和 release smoke 已覆盖页面存在、路由白名单和入口契约。
4. 复核 SLA 和运营备注展示已在 0.50 接入；企微联系回写已在 0.51 接入；复核解释模板已在 0.56 接入，模板校验与后台预览已在 0.57 接入。

## 0.47 用户端咨询页实现记录

本轮把 DEV-4010 从静态客服入口推进到可记录任务事实的咨询页：

1. `subpkg/profile/pages/support/index` 支持选择订单物流、打卡问卷、奖励复核和身体反馈四类咨询主题。
2. 已登录用户联系顾问时会写入 `CONSULTATION` 任务事件，复用 Task Progress Module 的幂等、活动归属和进度快照 Interface。
3. 未登录用户仍可使用微信客服入口，不把咨询能力绑定到订单或活动参与状态。
4. 小程序静态校验和 release smoke 已覆盖客服入口、咨询任务记录和可选任务进度更新。
5. 跟进状态展示已在 0.49 接入；企微联系回写已在 0.51 接入，咨询顾问分配已在 0.52 接入，真实企微外部联系人 ID、真实组织架构和自动回写策略仍保留在后续真实企微字段校准批次。

## 0.48 用户端订单同步页实现记录

本轮把 DEV-4009 从基础列表推进到用户可理解的订单同步页：

1. `subpkg/profile/pages/orders/index` 继续消费 `GET /api/v1/user/orders`，在页面层增加订单同步展示 Presenter。
2. 页面区分订单待同步、同步中、已送达、异常和取消状态，提供对应说明和样式。
3. 页面明确 Root 会员中心购买、myRoot 展示订单和活动相关状态，并说明不强制订单绑定才能参与任务。
4. 已同步订单展示商品、金额、匹配方式、收货信息和物流节点；无订单提供商品入口，异常提供人工协助入口。
5. 小程序静态校验和 release smoke 已覆盖同步说明、商品入口、人工协助和订单 Interface 契约。
6. 真实售后状态、多包裹、拆单和游标策略仍保留在 Root 会员中心 live 字段校准批次。

## 0.49 用户端咨询跟进状态实现记录

本轮把 DEV-4010 从“记录咨询事实”推进到“用户可见跟进状态 + 运营待办”：

1. 新增 Consultation Follow-up Module，复用 `task_event` 作为咨询事实源、`operation_task` 作为顾问跟进源。
2. `CONSULTATION` 任务事件会自动生成 `CONSULTATION_FOLLOW` 待办，按 `task_event_id` 幂等去重。
3. 新增 `GET /api/v1/user/consultations`，小程序咨询页展示最近咨询、待跟进/已跟进/已关闭状态和处理备注。
4. Element Plus 用户生命周期页展示待跟进咨询指标、表格标签和详情说明。
5. 小程序校验、Admin 校验、HTTP 测试和 release smoke 已覆盖咨询跟进状态。
6. 企微联系回写已在 0.51 接入，咨询顾问分配已在 0.52 接入；真实企微外部联系人 ID、真实组织架构和聊天结果自动拉取仍保留在真实企微字段校准批次。

## 0.50 状态复核 SLA 与运营备注实现记录

本轮把 DEV-4011 从“复核状态可查看”推进到“用户知道预计处理时间和处理结果”：

1. Manual Review Module 统一输出 `slaHours`、`expectedResolutionAt`、`overdue`、`statusCopy` 和 `publicNote`。
2. 复核项按优先级默认生成 SLA：高优先级 12 小时、正常 24 小时、低优先级 48 小时，后续可从 `metadata` 覆盖。
3. Element Plus 奖励复核页支持填写用户可见备注，单条和批量复核都会回写到 Manual Review Module。
4. 小程序状态复核页展示预计处理时间、SLA 文案、超时提示和历史复核备注。
5. 小程序校验、Admin 校验、后端测试和 release smoke 已覆盖复核 SLA 与运营备注字段。
6. 企微联系回写已在 0.51 接入；复核解释模板已在 0.56 接入，模板校验与后台预览已在 0.57 接入，真实顾问身份仍放在后续真实字段校准批次。

## 0.51 企微联系回写实现记录

本轮把 DEV-4010 的运营待办处理推进到可记录企微联系证据：

1. 新增 Consultation WeWork Writeback Module，围绕 `CONSULTATION_FOLLOW` 待办提供人工记录和自动 Adapter 两种写回路径。
2. 新增 `WEWORK_CONTACT_WRITEBACK` Adapter，支持生产 URL、token、method、额外参数、回执字段路径和成功状态配置。
3. 新增 `GET/POST /api/v1/admin/consultation-wework-writebacks`，写入要求 `REVIEW_RESOLVE` 能力、稳定 `request_id`、幂等和审计。
4. Element Plus 用户生命周期详情抽屉新增“企微联系回写”，运营可填写外部联系人 ID、状态和备注，并关闭对应咨询跟进待办。
5. Production Env Matrix、发布记录和生产切换 Gate 已纳入 `WEWORK_CONTACT_WRITEBACK_URL`，方便上线前识别真实配置缺口。
6. 真实企微 URL、token、模板、外部联系人字段、回执字段和小流量执行历史仍需生产校准；咨询顾问分配已在 0.52 接入，会话内容自动拉取仍按后续真实企微字段校准批次推进。

## 0.52 咨询顾问分配实现记录

本轮把 DEV-4010 从“咨询待办可见”推进到“咨询待办有负责人”：

1. 新增 Consultation Advisor Assignment Module，支持人工指定顾问和自动候选池分配，并要求稳定 `request_id`。
2. 新增 `GET/POST /api/v1/admin/consultation-advisor-assignments`，写入要求 `REVIEW_RESOLVE` 能力、幂等和审计。
3. 顾问分配结果写入 `CONSULTATION_FOLLOW` 待办 metadata，并通过 Consultation Follow-up Presenter 返回给生命周期页。
4. Element Plus 用户生命周期详情抽屉新增“顾问分配”，支持人工指定顾问 ID/姓名，也支持自动候选池字符串。
5. Production Env Matrix 和发布记录已纳入 `ROOT_CONSULTATION_ADVISORS`，用于生产自动分配候选池配置。
6. 咨询 SLA 超时提醒、咨询顾问工作台和超时升级链路已在 0.53、0.54、0.55 接入；真实企业微信组织架构、SSO、顾问在线状态和企微会话内容自动拉取仍留给生产字段校准批次。

## 0.53 咨询 SLA 超时提醒实现记录

本轮把 DEV-4010 从“咨询待办有负责人”推进到“咨询待办可按 SLA 被提醒”：

1. 新增 Consultation SLA Module，按 `CONSULTATION_FOLLOW` 待办创建时间、SLA 分钟数和顾问分配 metadata 计算 `OPEN / DUE_SOON / OVERDUE`。
2. 新增 `GET /api/v1/admin/consultation-sla`，支持 root 用户、顾问、活动、状态和 SLA 参数查询。
3. Element Plus 用户生命周期详情抽屉新增“咨询 SLA”面板，展示到期时间、超时分钟、顾问和当前用户的 SLA 列表。
4. Operational Alerts 新增 `CONSULTATION_SLA_OVERDUE` 目标和默认规则，并进入运营数据页目标类型、通知 Job、发布记录负责人路由和发布证据包。
5. Production Env Matrix 已纳入 `ROOT_CONSULTATION_SLA_MINUTES` 和 `ROOT_CONSULTATION_SLA_DUE_SOON_MINUTES`。
6. 顾问工作台已在 0.54 接入，超时升级链路已在 0.55 接入；真实企微会话自动拉取和顾问在线状态仍留给后续生产字段校准批次。

## 0.54 咨询顾问工作台实现记录

本轮把 DEV-4010 从“咨询 SLA 可提醒”推进到“顾问负载可查看”：

1. 新增 Consultation Advisor Workbench Module，按顾问、未分配咨询和 SLA 状态聚合待跟进咨询。
2. 新增 `GET /api/v1/admin/consultation-advisor-workbench`，支持顾问、分配状态、SLA 状态、SLA 参数和 limit 查询。
3. Element Plus 用户生命周期页新增“顾问工作台”抽屉，展示顾问负载、未分配咨询、超时数量、即将超时数量和待办明细。
4. 工作台复用 Consultation SLA Module 的 Interface，不在页面或工作台里重复拼 SLA 规则。
5. Admin 校验、Domain/API 测试和最终验收 smoke 已覆盖顾问分组、未分配分组、配置候选池和页面入口。
6. 真实企微在线状态、排班、组织架构、SSO 和会话内容自动拉取仍留给生产字段校准批次；超时升级链路已在 0.55 接入。

## 0.55 咨询 SLA 超时升级链路实现记录

本轮把 DEV-4010 从“顾问负载可查看”推进到“超时后可按运营链路升级”：

1. 新增 Consultation SLA Escalation Module，按超时分钟计算升级阶段、等级、负责人角色、处理动作和下次升级时间。
2. 新增 `GET /api/v1/admin/consultation-sla-escalations`，支持 root 用户、顾问、分配状态、活动、SLA 参数和升级阶段查询。
3. 升级规则可通过 `ROOT_CONSULTATION_SLA_ESCALATION_RULES` 配置；默认 0/60/120 分钟对应顾问提醒、运营升级和负责人升级。
4. Operational Alerts 新增 `CONSULTATION_SLA_ESCALATION` 目标和默认规则，并进入运营数据页目标类型、通知 Job、发布记录负责人路由和发布证据包。
5. Element Plus 用户生命周期页顾问工作台新增“超时升级”区块，展示升级统计、负责人角色和处理动作。
6. Domain/API/Admin 自检和最终验收 smoke 已覆盖升级列表、默认规则、运营预警、发布证据和页面入口；真实企微在线状态、排班、组织架构、SSO 和会话内容自动拉取仍留给生产字段校准批次。

## 0.56 状态复核解释模板实现记录

本轮把 DEV-4011 从“看到复核状态”推进到“用户知道为什么复核、运营知道按什么证据处理”：

1. 新增 Manual Review Explanation Module，把复核标题、原因、所需证据、用户下一步和运营指引收口为同一 Interface。
2. 支持 `ROOT_MANUAL_REVIEW_EXPLANATION_TEMPLATES` 按复核类型覆盖模板；不配置时使用免单机会、奖励发放和通用人工复核默认模板。
3. Manual Review Module 输出 `explanation`、`explanationTitle`、`pendingReason`、`evidenceRequired` 和 `nextAction`；用户端不会输出 `operatorGuidance`。
4. 小程序状态复核页展示解释卡片、证据标签和下一步动作，后台奖励复核表展示解释模板与运营指引。
5. Production Env Matrix、发布记录、Admin 自检、小程序自检、Domain/API 测试和最终验收 smoke 已覆盖复核解释模板。
6. 真实运营模板口径可在生产前通过环境变量校准；微信开放平台认证、真实有赞字段、真实企微字段和生产切换证明仍按生产校准批次推进。

## 0.57 状态复核解释模板校准实现记录

本轮把 DEV-4011 从“模板可配置”推进到“模板上线前可校验和预览”：

1. 扩展 Manual Review Explanation Module，新增模板校验和模板列表预览 Interface。
2. 模板校验覆盖 JSON 解析、模板字段类型、未知字段、未知占位符、用户可见字段内部占位符和 token/secret/openid/unionid/手机号等敏感词。
3. 配置工作台新增 `manualReviewExplanationTemplates`，输出 `READY/NEEDS_REVIEW/BLOCKED`、错误/提醒列表和三类复核模板预览。
4. Element Plus Admin“奖励复核”页新增模板校准面板，运营可查看模板来源、用户解释、所需证据和运营指引。
5. Domain/API/Admin 自检和最终验收 smoke 已覆盖模板校验状态、HTTP 工作台返回和错误模板拦截。
6. 真实运营口径仍需运营确认后注入生产环境；上线前以后台模板校准状态和发布记录为准。

## 0.58 旧 7 日历史数据迁移评估实现记录

本轮把旧 `checkinSessions` 历史处置从“待决定”推进到“发布前可评估、可留证、默认只读”：

1. 新增 Legacy Data Migration Module，统计旧周期、旧打卡、旧问卷、旧优惠券、旧退款工作项和新任务/奖励/复核记录之间的桥接情况。
2. 发布记录和发布证据包新增旧数据迁移评估，输出 `READY/NEEDS_REVIEW/BLOCKED`、推荐策略、阻塞项、提醒项、下一步动作和 `writeMode=false`。
3. Element Plus Admin「开发发布」页新增旧数据迁移评估卡片，展示旧周期列表、迁移决策和阻塞/动作。
4. Domain/API/证据包测试、Admin 自检和最终验收 smoke 已覆盖无旧数据、可桥接旧数据、缺失用户阻塞和证据包 validation。
5. 本轮没有执行真实补迁；生产前仍需基于生产快照决定只读归档、选择性补迁或人工处理。

## 0.59 CloudBase Store 决策 Gate 实现记录

本轮把 CloudBase 生产 Store 从“待确认方案”推进到“发布前可检查、可留证、可阻塞”：

1. 新增 CloudBase Store Readiness Module，统一检查 Store 决策、CloudBase 环境 ID、地域、当前 Store Adapter、MySQL 配置、备份计划、回滚计划和生产证明。
2. Production Env Matrix 新增 `cloudbase_store` 组，发布记录和发布证据包新增 CloudBase Store 证据与状态摘要。
3. Element Plus Admin「开发发布」页新增 CloudBase Store 决策卡片，展示决策、Adapter 匹配、环境、备份回滚、阻塞项和建议动作。
4. Domain/API/证据包测试、Admin 自检和最终验收 smoke 已覆盖未决策、云托管 MySQL 已满足、CloudBase Database 缺 Adapter 阻塞等场景。
5. 本轮没有切换真实生产 Store；生产前仍需在 CloudBase 控制台和环境变量中补齐真实环境 ID、地域、备份计划、回滚计划和证明引用。

## 0.60 Root 会员中心购买跳转 Gate 实现记录

本轮把 myRoot 商品页跳 Root 会员中心购买从隐含配置推进到发布前可检查、可留证的 Gate：

1. 新增 `rootMemberCenterReadiness` Module，统一检查活跃商品、Root 会员中心 appId、商品购买路径和 appId 一致性。
2. Product Mirror 跳转目标优先读取 `ROOT_MEMBER_CENTER_*` 变量，并保留旧 `ROOT_YOUZAN_*` 兼容；小程序移除占位 appid/path fallback。
3. 发布记录和发布证据包新增 Root 会员中心购买跳转证据与 `summary.rootMemberCenterStatus`。
4. Element Plus Admin「开发发布」页新增购买跳转卡片，展示商品级 appId/path 配置状态和下一步动作。
5. Domain/API/证据包/Admin/小程序自检和最终验收 smoke 已覆盖缺 appId、缺路径、appId 冲突和新变量优先级；真实 appId/path 与体验版跳转证明仍需生产配置。

## 0.61 Root 会员中心跳转证明记录实现记录

本轮把体验版跳转结果从文档待办推进到可录入、可审计、可进 Gate 的证明记录：

1. 新增 `rootMemberCenterJumpProof` Module，负责商品级跳转证明、`VERIFIED` / `REJECTED` 状态、appId/path 快照、证据引用脱敏、备注脱敏、幂等和审计。
2. 新增 `GET/POST /api/v1/admin/root-member-center-jump-proofs`，Element Plus Admin「开发发布」页可在 Root 会员中心购买跳转卡片中直接记录证明。
3. `rootMemberCenterReadiness` Gate 已联动最新证明：生产目标在 appId/path 已配置后必须有匹配的 `VERIFIED` 证明，灰度目标缺证明为 `NEEDS_REVIEW`，`REJECTED` 会阻塞。
4. 发布记录、发布证据包、Schema、Domain/HTTP Interface 测试、Admin 自检和最终验收 smoke 已覆盖跳转证明录入、脱敏、幂等和 Gate 联动。
5. 本轮没有补真实 Root 会员中心生产 appId/path 或真实截图/链接；微信开放平台认证、真实体验版跳转和生产证明内容仍需上线前录入。

## 0.62 旧数据生产处置决策记录实现记录

本轮把旧 7 日历史数据“只读归档、选择性补迁或人工处理”的生产决策从文档待办推进到可录入、可审计、可进 Gate 的决策记录：

1. 新增 `legacyDataMigrationDecision` Module，负责旧数据处置 policy、`APPROVED` / `REJECTED` 状态、生产快照引用、dry-run 引用、证据引用、备注脱敏、幂等和审计。
2. 新增 `GET/POST /api/v1/admin/legacy-data-migration-decisions`，Element Plus Admin「开发发布」页可在旧数据迁移评估卡片中直接记录决策。
3. `legacyDataMigration` Gate 已联动最新决策：生产目标存在旧数据但缺 `APPROVED` 决策会阻塞，灰度目标缺决策会提醒，`REJECTED` 或错误的 `NO_LEGACY_DATA` 决策会阻塞。
4. 发布记录、发布证据包、Schema、Domain/HTTP Interface 测试、Admin 自检和最终验收 smoke 已覆盖旧数据决策录入、脱敏、幂等和 Gate 联动。
5. 本轮不执行写入型补迁；真实执行历史、生产快照文件和 dry-run 输出仍需上线前按最终策略补录。

## 0.63 旧数据生产处置执行历史记录实现记录

本轮把旧 7 日历史数据“按决策执行完成”的证据从文档待办推进到可录入、可审计、可进 Gate 的执行历史记录：

1. 新增 `legacyDataMigrationExecution` Module，负责执行动作、`VERIFIED` / `FAILED` 状态、执行引用、证据引用、影响数量、备注脱敏、幂等和审计。
2. 新增 `GET/POST /api/v1/admin/legacy-data-migration-executions`，Element Plus Admin「开发发布」页可在旧数据迁移评估卡片中直接记录执行历史。
3. `legacyDataMigration` Gate 已联动最新执行历史：生产目标存在旧数据时，必须同时具备最新 `APPROVED` 决策和匹配动作的 `VERIFIED` 执行历史。
4. 发布记录、发布证据包、Schema、Domain/HTTP Interface 测试、Admin 自检和最终验收 smoke 已覆盖旧数据执行历史录入、脱敏、幂等和 Gate 联动。
5. 本轮不直接写入生产旧数据；真实执行截图、链接或 CloudBase/对象存储留档仍需上线环境录入。

## 0.64 动作 Adapter 校准 Gate 实现记录

本轮把有赞发券、券状态查询、企业微信标签写入和企业微信联系回写从“文档待校准”推进到可查询、可进发布记录、可进证据包的动作 Adapter 校准 Gate：

1. 新增 `actionAdapterCalibration` Module，统一检查动作 Adapter 的 URL/token 配置和真实执行证据。
2. 新增 `GET /api/v1/admin/action-adapter-calibration`，按生产/灰度目标返回四个动作的 `READY/NEEDS_REVIEW/BLOCKED` 状态、检查结果和回滚口径。
3. 发布记录、发布证据包、发布校准报告和 Element Plus「开发发布」页均新增动作 Adapter 校准证据。
4. Domain/HTTP Interface 测试、发布证据包测试、Admin 自检和最终验收 smoke 已覆盖该 Gate。
5. 本轮不伪造真实平台成功；生产仍需注入真实 URL/token/字段映射，并执行小批量有赞发券、券状态查询、企微打标签和联系回写。

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
