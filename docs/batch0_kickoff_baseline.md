# ROOT 7 日试饮打卡 Batch 0 开工基线

版本：V0.1
日期：2026-05-16
状态：建议默认值，作为 Batch 1 开发前拍板稿
依据：[flow_update_prd.md](./flow_update_prd.md)、[development_breakdown.md](./development_breakdown.md)

## 1. 目标

在进入 Batch 1 代码开发前，先锁定品牌口径、打卡规则、外部字段、隐私约束、数据仓库 Implementation 和小程序页面 Canonical 路径，避免后续在核心流程里返工。

## 2. 决策摘要

| 项目 | 建议默认值 | 影响 |
| --- | --- | --- |
| 主品牌 | 用户可见主品牌使用 ROOT | 后续页面文案、后台标题和活动说明统一 |
| 活动名 | ROOT 7 日身体重启计划 | 延续当前小程序导航和 README 口径 |
| 权益口径 | 用户端可说“免单权益”，后台和流程内使用“人工退款” | 避免让系统表现成自动退款承诺 |
| 打卡失败规则 | 达到 3 次失败后进入失败或人工处理 | 测试可以用确定阈值编写 |
| 补卡窗口 | 次日 23:59 前 | 保留当前轻量补卡体验 |
| 未服用记录 | 允许保存真实记录，但不计入成功打卡 | 鼓励真实反馈，不制造虚假完成 |
| Day8 触发 | Day7 完成后的次自然日开放 | 和“Day7+1”一致，避免 Day7 当天直接退款 |
| 数据仓库 | 第一阶段继续内存 Implementation，明确只用于演示和试跑 | Batch 1 不引入数据库迁移，降低开工复杂度 |
| 打卡页 Canonical | `subpkg/checkin/pages/*` | 主包旧打卡页不再承接新能力 |

## 3. DEV-0001 品牌与权益口径

建议拍板：

1. 用户可见主品牌统一为 ROOT。
2. 活动名称统一为“ROOT 7 日身体重启计划”。
3. LinkVital 如需出现，只作为产品名或物料名，不作为小程序主品牌。
4. 用户端可保留“免单权益”方便理解，但关键流程文案使用“人工退款处理”。
5. 后台、数据对象和开发任务统一使用 `refundWorkItem`、`人工退款`、`待人工退款`。

用户端建议文案：

1. “完成 7 天打卡并提交收尾问卷后，工作人员会进行人工退款处理。”
2. “退款资格以订单匹配、物流送达、打卡完成和收尾问卷为准。”
3. “如订单或物流信息异常，工作人员会通过企业微信与你确认。”

## 4. DEV-0002 打卡、补卡和 Day8 规则

建议拍板：

1. 断卡规则：达到 3 次失败记录后，本轮试饮进入失败或人工处理。
2. 失败记录包括：
   - 当日未打卡且超过补卡窗口。
   - 用户明确记录“今日未服用”。
   - 后台人工判定为无效记录。
3. 补卡窗口：次日 23:59 前。
4. 用户未服用时允许提交真实记录，系统保存反馈，但不计入成功打卡。
5. Day8 在 Day7 完成后的次自然日开放。
6. 演示环境可通过测试日期推进 Day8，但用户端不展示“当天直接退款”的路径。

验收口径：

1. Day7 完成不等于退款资格完成。
2. Day8 未提交时，旧免单路径也不能创建退款工作项。
3. 达到 3 次失败后，Flow View Presenter Module 不再返回正常退款动作。

## 5. DEV-0003 外部字段最小集

有赞订单人工导入 Adapter 最小字段：

1. `order_no`
2. `product_name`
3. `paid_amount`
4. `paid_at`
5. `receiver_name`
6. `receiver_phone`
7. `order_status`
8. `raw_address_text`

处理规则：

1. `receiver_phone` 是订单匹配主键候选。
2. `receiver_name` 只用于人工辅助确认。
3. `raw_address_text` 默认不进入业务对象，不在后台列表展示。
4. 若后续必须保存地址，需要单独确认展示范围和保留期限。

物流人工导入 Adapter 最小字段：

1. `carrier`
2. `tracking_no`
3. `delivery_status`
4. `shipped_at`
5. `delivered_at`
6. `last_event_text`

企业微信人工记录最小字段：

1. `external_contact_id`
2. `wechat_remark_name`
3. `source_channel`
4. `corp_wechat_status`
5. `operator_note`

## 6. DEV-0004 隐私授权与数据最小化

建议拍板：

1. 收货手机号用途：订单匹配、物流识别、打卡权益判断。
2. 身体记录、便型、反馈和图片用途：试饮记录、运营跟进、退款资格判断。
3. 地址默认不进入业务对象，不在后台列表展示。
4. 后台列表手机号默认脱敏，例如 `138****0001`。
5. 图片只在反馈处理和用户详情里可见，不进入 Summary 汇总。
6. 文案不得暗示诊断、治疗或确定功效。
7. 试饮结束后默认保留 90 天个人明细，用于退款、客服和复盘；超过后只保留脱敏汇总。上线前需要最终确认。

用户端授权文案草案：

“为完成试饮打卡、订单匹配、物流识别、人工退款处理和运营跟进，我们需要收集你的收货手机号、打卡记录、问卷反馈和可选图片。相关记录仅用于本次试饮活动和后续支持，不用于诊断或治疗建议。”

## 7. DEV-0005 数据仓库 Implementation

建议拍板：

1. 第一阶段继续使用当前内存 Implementation。
2. 所有新增 Module 仍按仓储 Interface 组织，避免页面和后台依赖内存数组。
3. README、后台和演示说明中明确：当前数据重启后会丢失，不作为正式上线存储。
4. 进入真实运营前，再选择 SQLite、MySQL 或 PostgreSQL 作为数据仓库 Implementation。

对开发的约束：

1. Batch 1 不做数据库迁移。
2. 测试穿过 Module 的 Interface，不直接读写内部数组。
3. `schema.sql` 随数据对象更新，但不声称已经接入真实数据库。

## 8. DEV-0006 Canonical 路径

建议拍板：

1. 本轮打卡 Canonical 页面为：
   - `subpkg/checkin/pages/today/index`
   - `subpkg/checkin/pages/history/index`
   - `subpkg/checkin/pages/result/index`
2. 新增问卷页放在 `subpkg/checkin/pages/questionnaire/index`。
3. 主包旧路径 `pages/checkin/*` 不再新增新流程能力。
4. 若旧路径仍被引用，先通过 `router.js` 重定向到 Canonical 页面。
5. 若确认无引用，再删除旧页面。

## 9. Batch 1 开工顺序

第一段建议只做：

1. `DEV-1001` 扩展数据模型和种子数据。
2. `DEV-1002` 新建 Identity Module。
3. `DEV-1003` 修改订单匹配，不再自动启动打卡。

第一段完成标准：

1. 订单匹配成功只进入 `ORDER_MATCHED` 或 `WAITING_DELIVERY`。
2. 不创建新的 7 天打卡周期。
3. 手机号冲突进入 warning 或人工异常。
4. 后端测试通过。
5. 小程序静态检查通过。

建议验证命令：

1. `npm test --prefix root_seven_day_checkin/backend`
2. `npm run check --prefix root_seven_day_checkin/miniprogram`

## 10. 开发前仍需注意

1. 当前项目路径下未发现 `.git`，进入代码开发前需要确认版本管理位置。
2. README 旧路径已在上线前验收阶段改为当前 Root 路径。
3. 本基线默认“先演示试跑，后真实上线”；如果要直接上线，`DEV-0005` 必须改为真实数据仓库 Implementation。
