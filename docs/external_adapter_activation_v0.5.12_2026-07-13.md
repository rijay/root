# myRoot 外部 Adapter 正式接入执行包

日期：2026-07-13
最近复核：2026-07-14

状态：`E-01_COMPLETE / ROOT_SHOP_AUTHORIZED / A_PLAN_ACTIVE / READ_INTERFACES_GRANTED / CLIENT_SECRET_ROTATION_REQUIRED / PRIVACY_PAYLOAD_PROBE_PENDING / COUPON_CAPABILITY_REVIEWING / NO_LIVE_ADAPTER_ACTION_EXECUTED`

历史生产候选：`myroot-api-027 / v0.5.12 / URL_PARAMS / 0%`。当前本地执行目标已转为 `v0.5.13 / planned 028 / NOT_DEPLOYED`。

## 1. 实际读取来源

1. `productionEnvMatrix`、`adapterCalibration`、`actionAdapterCalibration`、`externalAdapterSamples` 和四类真实 Adapter Implementation。
2. Admin 的样本预览、真实 Adapter 运行、回滚和发布 Gate Interface。
3. 生产发布记录对缺失变量、样本校准和真实动作证据的只读回读。
4. 企业微信导出 `/Users/rijay/Desktop/整理归档_2026-05-30/10_项目文件夹/Root项目/客户列表.xlsx` 的结构只读检查；不读取或留存客户明细。
5. 2026-07-14 10:08 刷新有赞云应用中心后，应用卡不再显示“审核中”；进入正式应用概览后确认 App Id、`client_id` 和 `client_secret` 字段已经生成。凭据值未读取或保存。
6. 凭据页曾被本轮临时截图捕获；截图已删除并离开凭据页。当前 `client_secret` 按已暴露处理，E-02 前必须轮换。
7. 有赞官方的商家自研无容器接入、token 获取、开发规范与套餐限制说明；链接集中记录在 E-01 审核证据中。
8. 2026-07-14 已登录的有赞控制台：ROOT 店铺授权、A 套餐购买记录与 API 账单、565 个 Interface、能力包、回调地址和 IP 白名单页面；全程未读取或保存凭据值，未调用真实 Interface。

## 2. 共同停止规则

1. 凭据只进入密码管理器、受控轮换终端和候选运行变量，不进入仓库、文档、命令参数、截图或聊天。
2. 每个来源先完成至少 3 条真实样本评审，再运行真实 Adapter。
3. 顺序固定为 `样本预览 -> PREVIEW -> 单页 IMPORT -> 游标/数据/审计回读`；任一阶段出现未知枚举、重复、字段错配或身份冲突即停止。
4. IMPORT、发券、打标签、联系回写分别使用新 request ID；真实写动作不得共享一次授权。
5. 灰度首日保留 `MANUAL_SAMPLE`、后台手工修正和运营人工处理路径。
6. 真实写动作失败时不自动改写为成功；发券结果不明确时禁止再次发券。

## 3. 有赞 ROOT 店铺

### 3.1 前置材料

1. 有赞云自用型无容器应用“myRoot会员数据对接”已审核通过；ROOT 店铺已授权，授权有效期已回读。
2. 轮换当前 `client_secret` 后，再受控保存 `client_id`、店铺 `grant_id`、集中管理的 access token、到期时间和轮换负责人。
3. `client_secret` 只在受控授权/轮换端使用，不注入 CloudRun。
4. 商品、订单、客户和用户查询目标 Interface 已获授权；优惠券发送和状态查询 Interface 仍未获授权。
5. A 套餐当前月额度与 QPS 已回读可用；精确套餐到期日未在本轮页面显示，后续不得以店铺授权到期日替代。
6. 控制台菜单不能证明消费者隐私字段实际返回明文或密文。当前没有有赞隐私字段解密 Implementation；订单手机号、地址或客户字段出现密文时，停止 PREVIEW 后续流程，不能 IMPORT。
7. 回调地址保持空白。当前 Implementation 不接收有赞通知；未来只有在通知接收、验签、幂等和重放防护 Module 完成后，才单独配置回调。

### 3.2 正式变量

订单拉取必需：

- `YOUZAN_CLIENT_ID`
- `YOUZAN_GRANT_ID`
- `YOUZAN_ACCESS_TOKEN`
- `YOUZAN_ACCESS_TOKEN_EXPIRES_AT`，至少剩余 24 小时
- `YOUZAN_TOKEN_MANAGEMENT_MODE=static_rotation`
- `YOUZAN_TOKEN_ROTATION_OWNER`
- `YOUZAN_ORDER_LIST_URL`

后续商品同步候选使用，027 不注入：

- `YOUZAN_PRODUCT_LIST_URL`
- `YOUZAN_PRODUCT_ACCESS_TOKEN`，或复用 `YOUZAN_ACCESS_TOKEN`
- `YOUZAN_PRODUCT_ACCESS_TOKEN_EXPIRES_AT`，仅使用独立商品 token 时必需

客户与身份对账必需：

- `YOUZAN_CUSTOMER_LIST_URL`
- `YOUZAN_USER_QUERY_URL`
- `ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED=true`
- `YOUZAN_CUSTOMER_ACCESS_TOKEN` 或复用 `YOUZAN_ACCESS_TOKEN`

优惠券动作必需：

- `YOUZAN_COUPON_SEND_URL`
- `YOUZAN_COUPON_STATUS_URL`
- `YOUZAN_COUPON_ACCESS_TOKEN` 或复用 `YOUZAN_ACCESS_TOKEN`

字段路径、游标、has-more、请求方法和字段映射先保持可选，必须根据真实 PREVIEW 回执再确定，不能提前猜测。

### 3.3 E-01 执行证据

1. 有赞云应用中心仅显示 1 个应用：`myRoot会员数据对接`，类型为 `无容器 / 自用型`，创建时间为 `2026-07-13 22:01:07`。
2. 2026-07-14 刷新后“审核中”标签消失，应用可以进入正式概览，E-01 状态更新为 `APPROVED`。
3. 正式 App Id、`client_id` 和 `client_secret` 字段已生成；本证据不记录其值。
4. 质量负责人已配置；ROOT 店铺授权、A 套餐当前月额度及读取 Interface 已回读。消费者隐私字段返回形态、token 管理和真实样本仍待验证。回调地址因当前无接收 Interface 而明确保持空白。
5. 当前 `client_secret` 因页面默认明文及临时截图暴露而必须轮换；相关临时截图已删除，未保存 E-02 变量，未运行 PREVIEW/IMPORT、发券或券状态查询。
6. 完整脱敏证据见 [有赞应用 E-01 审核通过证据](./youzan_application_approval_v0.5.12_2026-07-14.md)。

### 3.4 当前授权、套餐与 Interface 回读

1. 应用 App Id 为 `10007712`；ROOT 店铺号为 `543131955`，授权有效期至 `2027-05-31`；Root 会员中心小程序 AppID 为 `wxfb75c0b432670215`。
2. A 套餐于 2026-07-14 12:03:10 开通；当前月为 500,000 次、20 QPS、已用 0、剩余 500,000、费用 0。套餐精确到期日未在本轮页面显示。
3. 已授权：`youzan.items.onsale.get`、`youzan.item.get`、`youzan.trades.sold.get`、`youzan.scrm.customer.list`、`youzan.users.info.query`。
4. 未授权：`youzan.ump.voucheractivity.send`、`youzan.ump.voucher.query.detail`；优惠券能力包仍为审核中。
5. 有赞 CRM 能力包被驳回，理由为“仅限订购有赞CRM申请”；但当前所需客户列表与用户查询 Interface 已独立授权，因此读取链路以后续脱敏回执为准，高级 CRM 范围不作为当前读取链路的错误阻塞项。
6. IP 白名单为 0 条；固定出口方案未确定，不写入临时或随机 CloudBase 出口 IP。
7. 数据加密入口未在当前菜单出现，这不是明文证明。必须对已知测试订单和客户执行脱敏只读探针，只记录字段存在性、是否密文、业务码与分页形状。
8. 完整回读与停止规则见 [有赞 ROOT 店铺脱敏回读证据](./youzan_live_readback_v0.5.13_2026-07-14.md)。

### 3.5 样本准入

订单至少 3 条，覆盖实际状态：

```text
有赞订单号,有赞客户ID,unionid,收货人,收货手机号,商品名称,商品ID,实付金额,订单状态,物流状态,支付时间,收货地址
```

客户至少 3 条，覆盖 unionid 已授权、仅手机号、未匹配：

```text
有赞客户ID,unionid,手机号,昵称
```

原始样本只进入受控 Admin 预览，不写入仓库。评审结果必须达到 READY，未知订单/物流状态先补映射。若有赞返回任何加密隐私字段，只记录字段存在性和密文状态，不复制原值、不执行 IMPORT；先完成解密与脱敏验证。

### 3.6 执行批次

1. `YOUZAN_ORDER / YOUZAN_OPEN / PREVIEW / limit=3`，核对订单号、手机号、金额、订单状态和物流状态。
2. `YOUZAN_CUSTOMER / YOUZAN_CUSTOMER / PREVIEW / limit=3`，核对 yzUid、unionid、手机号和昵称。
3. 分别单页 IMPORT；核对导入数量、错误数、身份补链、游标和审计记录。
4. 先 dry-run 身份对账，再用最小批次执行；冲突进入人工复核。
5. 发券使用一个已明确同意的测试用户和一张测试券，确认唯一 `yz_open_id`、`activity_id`、外部券 ID 与幂等引用。
6. 使用同一张测试券查询状态，确认 `ISSUED/USED/EXPIRED/CANCELLED` 映射；发券和状态查询必须分别取得确认。

### 3.7 回滚

1. 暂停有赞真实 Adapter，恢复 `MANUAL_SAMPLE` 和后台手工同步。
2. 对可回滚的单页 IMPORT 使用 runId 回滚，并核对订单、客户镜像、游标和审计。
3. 已在有赞成功发出的券不得通过重复请求“回滚”；改由运营核对、作废或补偿，并保留外部券 ID。

### 3.8 商品展示与持续同步决策

1. v0.5.12 首发商品展示使用生产 Store 中已验证的商品镜像、Root 会员中心 AppID 和短链；正式 Gate 还要求同版本真机打开证明。
2. 持续自动商品同步不是本版切流前置。ROOT 商品发生上下架、SKU、价格或购买路径变化时，灰度期由运营通过后台商品镜像流程预览并确认更新。
3. 当前商品 Adapter 尚未复用订单/客户 Adapter 的有赞 HTTP 200 业务错误判断，也未按官方分页结构推导下一页；因此 027 不执行商品 PREVIEW，不能把空列表当作成功。
4. 获得 `youzan.items.onsale.get` 权限后，先在后续候选补齐业务错误和分页处理并增加专向测试；通过后才可执行最多 3 条商品只读 PREVIEW，核对商品 ID、标题、SKU、价格、状态和购买路径。
5. `POST /api/v1/admin/products/sync-execute` 会写生产商品镜像，必须使用独立 request ID、二次确认和前后快照；不能与订单/客户 E-03 共用授权，也不能因 PREVIEW 成功自动执行。

## 4. 企业微信客户联系

### 4.1 当前导出能力

现有 `客户列表.xlsx` 在第 4 行开始字段定义，共 1,053 条数据，包含客户名称、添加人、添加时间、来源、手机、企业、标签等字段；没有 `external_userid/外部联系人ID` 列。

结论：该文件可用于只读字段形状评审，不能用于标签写入、联系回写或可逆真实动作证明。正式样本必须由企业微信客户联系 Interface 返回 `external_userid`。

### 4.2 正式变量

线索拉取必需：

- `WEWORK_CORP_ID`
- `WEWORK_CONTACT_LIST_URL`
- `WEWORK_CONTACT_SECRET`、`WEWORK_CONTACT_ACCESS_TOKEN` 或 `WEWORK_ACCESS_TOKEN` 至少一个

标签写入必需：

- `WEWORK_TAG_APPLY_URL`
- `WEWORK_CORP_ID`
- 标签凭据至少一个
- 官方 `externalcontact/mark_tag` 还必须有 `WEWORK_TAG_USERID` 和真实 tag ID

联系回写必需：

- `WEWORK_CONTACT_WRITEBACK_URL`
- `WEWORK_CORP_ID`
- 回写凭据至少一个
- 正式执行用户、模板和回执字段映射

### 4.3 样本准入

至少 3 条真实客户联系样本：

```text
外部联系人ID,企业微信备注名,收货手机号,来源活动,线下活动,当前添加状态,运营备注
```

必须保留外部联系人 ID。缺手机号可进入人工匹配，但不能把备注名当作正式写动作主键。

### 4.4 执行批次

1. `WECHAT_LEAD / WEWORK_CONTACT / PREVIEW / limit=3`，核对外部联系人 ID、备注、手机号、来源和添加状态。
2. 单页 IMPORT，确认缺手机号或未匹配用户只生成 `LEAD_NEEDS_MATCHING`，不会错误绑定。
3. 用一个测试外部联系人和一个测试标签执行一次标签写入，回读 tag、externalContactId 和外部回执。
4. 用一条真实咨询待办执行一次联系回写，回读跟进结果、模板字段和外部回执。
5. 标签写入和联系回写分别授权；成功证据分别进入动作 Adapter Gate。

### 4.5 回滚

1. 暂停 `WEWORK_CONTACT`、`WEWORK_TAG` 和 `WEWORK_CONTACT_WRITEBACK`，保留运营人工线索、打标签与联系记录。
2. 对可回滚的 IMPORT 使用 runId 回滚；真实企微标签或备注变更由运营在企微后台核对并人工恢复。

## 5. 物流状态

### 5.1 前置决策

先确认唯一正式来源：有赞物流、承运商 Interface 或内部履约系统。没有来源所有者、访问协议和增量语义时，不配置占位 URL。

### 5.2 正式变量

- `ROOT_FULFILLMENT_LIST_URL`
- `ROOT_FULFILLMENT_SECRET`
- 按真实回执确定 data path、cursor path、has-more path 和 field map

### 5.3 样本准入

至少 3 条，覆盖运输中、已签收和异常件：

```text
快递公司,获取时间,电子面单号,订单号,运输状态,收件人姓名,收件人联系方式
```

订单号必须能与有赞订单匹配。已签收但没有签收时间时必须由运营确认接受系统导入时间。

### 5.4 执行与回滚

1. `FULFILLMENT / FULFILLMENT_PUSH / PREVIEW / limit=3`，核对订单号、运单号、状态和签收时间。
2. 单页 IMPORT，确认 `DELIVERED` 只把用户推进到“已送达待开始/可启动 Day1”，不会自动替用户参加活动。
3. 核对游标、异常件待办和审计。
4. 发生错配时暂停真实 Adapter，使用 runId 回滚，并恢复后台手工更新物流状态。

## 6. 分批授权表

| 批次 | 动作 | 外部影响 | 必须单独确认 |
| --- | --- | --- | --- |
| E-01 | 创建有赞云应用并提交审核 | 已完成；应用审核通过 | 已确认并完成 |
| E-02 | 轮换凭据、完成 ROOT 授权、保存只读变量并 PREVIEW | 修改第三方凭据，回读商品权限并读取真实订单/客户；商品 PREVIEW 暂缓 | 是 |
| E-03 | 有赞订单/客户单页 IMPORT | 写入生产 Store 与游标 | 是 |
| E-04 | 有赞测试券发放 | 消耗真实券额度 | 是 |
| E-05 | 有赞券状态查询 | 读取并更新奖励状态 | 是 |
| E-06 | 保存企微只读变量并 PREVIEW | 读取真实客户联系 | 是 |
| E-07 | 企微线索单页 IMPORT | 写入生产 Store 与游标 | 是 |
| E-08 | 企微测试标签写入 | 修改真实外部联系人标签 | 是 |
| E-09 | 企微测试联系回写 | 修改真实客户联系记录 | 是 |
| E-10 | 保存物流变量并 PREVIEW | 读取真实物流 | 是 |
| E-11 | 物流单页 IMPORT | 修改订单履约状态 | 是 |

所有批次失败即停止，不自动进入下一批。

## 7. 正式验收证据

每个读取 Adapter 必须同时具备：3 条样本 READY、配置 PASS、Implementation READY、最近成功 PREVIEW/IMPORT、游标或“不支持增量”的正式说明。

每个动作 Adapter 必须同时具备：配置 PASS、恰好一次真实成功记录、脱敏外部引用和人工回滚路径。完成后再分别录入带 `evidenceRef` 的生产切换证明。
