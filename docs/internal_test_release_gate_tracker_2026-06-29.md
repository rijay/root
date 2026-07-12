# myRoot 内测期间正式发布 Gate 与反馈台账

日期：2026-06-29
状态：内测使用中，正式发布 Gate 逐项准备
适用环境：`develop/trial -> myroot-test-d4gclpzxx286deda6 + myroot-api`

## 1. 当前原则

1. 内测继续使用 `myroot-test-d4gclpzxx286deda6` 和云托管 `myroot-api`。
2. 不把 `release` 切到生产，不修改 `myroot-prod-d5gl3gzg7115f149a` 的正式发布开关。
3. 正式发布 Gate 可以先准备变量、样本、证明入口和 dry-run，但不伪造真实外部证明。
4. 团队试用反馈先进入本台账或缺陷表，再按 P0/P1/P2/P3 排期。
5. 所有 token、secret、openid、unionid、手机号原文只放控制台、密钥管理或脱敏证据，不写入仓库。

## 2. 已完成内测基线

| 项目 | 当前状态 | 证据 |
| --- | --- | --- |
| 内测后端版本 | `myroot-api / 004` 正常 | CloudBase 部署详情，2026-06-28 22:09:31 |
| 小程序云调用 | 通过 | `MYROOT_CALLCONTAINER_004_HARDEN_OK` |
| 登录与账号打通 | 通过 | `unionidStatus=LINKED` |
| Root 会员中心商品展示 | 通过 | `ROOT_MEMBER_CENTER_DEFAULT`，`productCount=1` |
| Root 会员中心跳转 Interface | 通过 | `appId=wxfb75c0b432670215`，短链 `#小程序://ROOT会员中心/lnQOjYsk8gZoABH` |
| 打卡提醒模板配置 | 通过 | 模板 ID `SOABCc3dk6tItVnjglFc94X6FVQo4LuZvnoZlHJTaBc` 可从后端读到 |
| 后台写入保护 | 通过 | 未携带后台 token 的写入返回 `401/40101` |
| 后端测试 | 通过 | `npm test --prefix backend`，157/157 |

## 3. 正式发布 Gate 处理顺序

| 顺序 | Gate | 内测期动作 | 正式发布前完成标准 | 当前状态 |
| --- | --- | --- | --- | --- |
| G-001 | 生产环境链路与 unionid 证明 | 保持内测调用；准备生产探针步骤和脱敏证据字段 | `release` 运行态从 `myroot-prod + myroot-api` 访问身份探针，openid/unionid 均存在并留存脱敏证明 | 等生产演练 |
| G-002 | 微信发布配置 | 确认体验版入口、体验成员、隐私协议、服务类目和合法域名清单 | 体验版真机全链路通过，审核材料齐备，可提交审核 | 内测中 |
| G-003 | Root 会员中心真机跳转证明 | 用内测体验版真机点击短链跳转，不付款；记录截图或录屏 | 后台录入与当前 appId/path 匹配的 `VERIFIED` 跳转证明 | Interface 通过，真机证明待录入 |
| G-004 | 打卡提醒订阅消息 | 内测环境验证授权弹层、接受/拒绝记录、Job dry-run | 正式环境 `miniprogram_state` 改为 `formal`，Job execute 小批量成功 | 配置与 dry-run 通过，授权真机待测 |
| G-005 | 有赞商品/订单/客户字段校准 | 使用有赞导出或有赞云小批量样本做 preview，不影响用户任务 | 商品、订单、客户样本字段映射和状态枚举通过，必要时执行小批量 import | 校准查询完成，有赞样本待补 |
| G-006 | 有赞券与售后动作校准 | 先 dry-run 或小批量测试券，不对真实用户大范围发放 | 发券、券状态查询、售后状态、奖励追回均有小批量成功回执 | 动作校准待真实券回执 |
| G-007 | 企业微信动作校准 | 确认外部联系人 ID、标签 ID、咨询入口、触达模板和回执字段 | 标签写入、联系回写、自动触达小批量成功，失败可审计重试 | 动作校准待企微回执 |
| G-008 | 运营规则终版 | 内测收集团队对 7/14/21 天规则、返券、免单机会的反馈 | 运营确认规则 JSON、奖励库存、黑名单、人工复核口径并发布版本 | 规则 Interface 已具备，运营终版待确认 |
| G-009 | 后台权限与发布安全 | 内测已配置后台 token；准备角色拆分策略 | viewer/finance/operator/admin 权限与菜单、按钮、后端能力一致 | 基础保护已完成，正式角色拆分待定 |
| G-010 | 旧数据处置 | 先评估是否需要迁移旧 7 日试饮历史 | 录入只读归档、选择性补迁或人工处理决策；如补迁需 dry-run 和执行证据 | 内测 gray 已完成无旧数据决策与 no-op 执行 |
| G-011 | 发布证据包与签字 | 内测结束后汇总 Gate 状态、缺陷和新需求 | release evidence pack 无 secret 泄漏，产品/运营/研发签字齐备 | 内测 gray 证据包已归档，正式签字待内测后 |

说明：CloudBase Store / MySQL 决策已在 `docs/cloudbase_mysql_store_decision.md` 单独跟踪，本表不重复展开。

## 4. G-003 至 G-011 推进记录 - 2026-06-28

本轮只处理内测灰度目标 `gray`，不代表正式生产批准。`GET /api/v1/admin/release-evidence-pack?target=gray&strict=true` 当前可生成脱敏证据包，`validation.status=PASS`；`pack.status=BLOCKED` 是预期结果，因为有赞、企业微信、生产变量和三方签字仍需要真实外部证明。

| Gate | 已完成 | 证据 | 剩余外部证明 |
| --- | --- | --- | --- |
| G-003 | Root 会员中心跳转 Interface 已返回 `appId=wxfb75c0b432670215` 和短链路径 | `ROOT_MEMBER_CENTER_DEFAULT`，短链 `#小程序://ROOT会员中心/lnQOjYsk8gZoABH` | 体验版真机录屏或截图，并通过 `POST /api/v1/admin/root-member-center-jump-proofs` 录入 `VERIFIED` |
| G-004 | 打卡提醒模板配置可读，提醒 Job dry-run 可执行 | 模板 ID `SOABCc3dk6tItVnjglFc94X6FVQo4LuZvnoZlHJTaBc`；dry-run `scannedCount=0`、`resultCount=0` | 真机加入活动时的订阅授权弹层、接受/拒绝记录；正式环境小批量 execute |
| G-005 | 发布证据包已把有赞商品/订单/客户字段校准列为 Gate | `adapterCalibrationStatus=BLOCKED` | 有赞云小批量样本、字段映射、状态枚举、导入 preview 或 import 回执 |
| G-006 | 发布证据包已把有赞发券和券状态查询列为动作校准 Gate | `actionAdapterCalibrationStatus=NEEDS_REVIEW` | 测试券发放、券状态查询、售后/追回小批量回执 |
| G-007 | 发布证据包已把企微标签与联系回写列为动作校准 Gate | `WEWORK_TAG`、`WEWORK_CONTACT_WRITEBACK` 均待真实回执 | 外部联系人 ID、标签 ID、咨询入口 URL、写回/触达结果 |
| G-008 | 运营任务机制已按可配置规则建模，内测反馈不直接打断 Gate | 规则、条件、奖励均走后台配置与发布版本 | 运营确认 7/14/21 天规则 JSON、奖励库存、黑名单和人工复核口径 |
| G-009 | 后台写入已启用口令保护，未授权写入返回 `401/40101` | `adminRole=admin`、`adminTokenConfigured=true` | 正式发布前拆分 viewer/finance/operator/admin 角色和菜单能力 |
| G-010 | 已在内测 gray 记录“无旧数据，无需补迁”决策与 no-op 执行 | 决策 `legacy_mig_3b100125b3d636`；执行 `legacy_exec_b7772687b3d697`；`legacyDataMigrationStatus=READY` | 若正式环境发现旧 7 日历史数据，需重新按生产快照选择归档、补迁或人工处理 |
| G-011 | 已在内测 gray 生成并归档发布证据包 | 归档 `rel_evd_047e13c0b4215b`；`validation.status=PASS`；`pack.status=BLOCKED` | 内测复盘后补齐产品/运营/研发签字，且重新生成正式生产证据包 |

当前证据包摘要：`cloudbaseJobManifestStatus=READY`、`legacyDataMigrationStatus=READY`；`rootMemberCenterStatus=NEEDS_REVIEW`、`cloudbaseStoreStatus=NEEDS_REVIEW`、`signoffGateStatus=NEEDS_REVIEW`、`productionEvidenceIntakeStatus=BLOCKED`。

## 5. 内测反馈处理规则

### 4.1 缺陷

| 优先级 | 判定标准 | 动作 |
| --- | --- | --- |
| P0 | 登录、首页、商品跳转、加入活动、打卡、问卷、奖励状态任一主链路阻断 | 立即修复并重新上传体验版 |
| P1 | 主链路可继续，但影响团队判断或真实路演风险 | 下一轮体验版修复 |
| P2 | 文案、样式、引导、弱网提示、后台效率问题 | 归入后续迭代 |
| P3 | 体验优化或运营想法 | 进入需求池 |

### 4.2 新需求

新需求不直接打断 Gate，先判断归属：

| 归属 | 例子 | 默认处理 |
| --- | --- | --- |
| Product Mirror Module | 商品卡字段、SKU 展示、Root 会员中心跳转文案 | 若影响 P0 购买跳转，升 P1；否则进体验增强 |
| Task Progress Module | 新打卡字段、新任务类型、分享任务规则 | 先确认是否影响当前活动规则 |
| Settlement Module | 7/14/21 天新条件、OR 条件、结算预览 | 规则配置优先，不新增页面私有逻辑 |
| Reward Grant Module | 返券、免单机会、库存、黑名单、售后追回 | 先走规则与奖励配置，再评估外部动作 |
| WeWork Touch Module | 企微提醒、顾问分配、标签写入 | 先补真实企微字段和动作证据 |
| Admin Ops Module | 后台筛选、批量处理、导出、发布证据 | 不影响用户端体验时排到内测后 |

## 6. 本轮下一步

1. 保持内测环境，发团队体验版二维码和缺陷上报格式。
2. 用至少一台真机完成 Root 会员中心短链跳转与返回 myRoot 状态恢复。
3. 用真机完成加入活动后的订阅授权弹层验证，并跑一次提醒 Job dry-run。
4. 收集团队 P0/P1 缺陷，先修复主链路，再处理 P2/P3 体验增强。
5. 内测复盘后，再决定是否进入 `myroot-prod` 生产演练和正式证据包签字。

## 7. 反馈记录模板

| 日期 | 反馈人 | 类型 | 优先级 | 页面或 Module | 摘要 | 证据 | 处理状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-06-28 | 内测反馈 | 缺陷 | P1 | Task Progress Module / 首页完成态 | 每日任务完成后仍可进入继续打卡，不符合当前 PRD；已改为任务完成后拒绝新 CHECKIN 记录，完成态只保留申请免单和查看记录 | 后端 `7003` 拦截测试、HTTP Interface 测试、小程序按钮置灰 | 体验版 `0.4.6` 待真机复测 |
