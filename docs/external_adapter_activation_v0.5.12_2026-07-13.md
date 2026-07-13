# myRoot 外部 Adapter 正式接入执行包

日期：2026-07-13

状态：`E-01_SUBMITTED / YOUZAN_REVIEWING / NO_CREDENTIALS_STORED / NO_LIVE_ADAPTER_ACTION_EXECUTED`

适用候选：本地 `v0.5.12`；生产仍为 `myroot-api-026 / v0.5.11 / 0%`

## 1. 实际读取来源

1. `productionEnvMatrix`、`adapterCalibration`、`actionAdapterCalibration`、`externalAdapterSamples` 和四类真实 Adapter Implementation。
2. Admin 的样本预览、真实 Adapter 运行、回滚和发布 Gate Interface。
3. 生产发布记录对缺失变量、样本校准和真实动作证据的只读回读。
4. 企业微信导出 `/Users/rijay/Desktop/整理归档_2026-05-30/10_项目文件夹/Root项目/客户列表.xlsx` 的结构只读检查；不读取或留存客户明细。

## 2. 共同停止规则

1. 凭据只进入密码管理器、受控轮换终端和候选运行变量，不进入仓库、文档、命令参数、截图或聊天。
2. 每个来源先完成至少 3 条真实样本评审，再运行真实 Adapter。
3. 顺序固定为 `样本预览 -> PREVIEW -> 单页 IMPORT -> 游标/数据/审计回读`；任一阶段出现未知枚举、重复、字段错配或身份冲突即停止。
4. IMPORT、发券、打标签、联系回写分别使用新 request ID；真实写动作不得共享一次授权。
5. 灰度首日保留 `MANUAL_SAMPLE`、后台手工修正和运营人工处理路径。
6. 真实写动作失败时不自动改写为成功；发券结果不明确时禁止再次发券。

## 3. 有赞 ROOT 店铺

### 3.1 前置材料

1. 有赞云自用型无容器应用“myRoot会员数据对接”已于 2026-07-13 提交，应用中心回读为 `审核中`；审核通过后必须再次确认 ROOT 店铺授权。
2. 获取 `client_id`、店铺 `grant_id`、集中管理的 access token、到期时间和轮换负责人。
3. `client_secret` 只在受控授权/轮换端使用，不注入 CloudRun。
4. 确认订单列表、客户列表、用户查询、发券和券状态 Interface 的正式 URL 与权限。

### 3.2 正式变量

订单拉取必需：

- `YOUZAN_CLIENT_ID`
- `YOUZAN_GRANT_ID`
- `YOUZAN_ACCESS_TOKEN`
- `YOUZAN_ACCESS_TOKEN_EXPIRES_AT`，至少剩余 24 小时
- `YOUZAN_TOKEN_MANAGEMENT_MODE=static_rotation`
- `YOUZAN_TOKEN_ROTATION_OWNER`
- `YOUZAN_ORDER_LIST_URL`

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

1. 有赞云应用中心仅显示 1 个应用：`myRoot会员数据对接`。
2. 页面回读类型为 `无容器 / 自用型`，状态为 `审核中`，创建时间为 `2026-07-13 22:01:07`。
3. 点击应用后平台提示审核需要 1–3 个工作日，审核通过前不能进入应用控制台。
4. 审核中页面没有展示应用 ID、ROOT 店铺授权详情或凭据，因此这些字段仍为待验，不以“已提交”替代“已授权”。
5. 本次未打开或复制 `client_secret`，未保存 E-02 变量，未运行 PREVIEW/IMPORT、发券或券状态查询。

### 3.4 样本准入

订单至少 3 条，覆盖实际状态：

```text
有赞订单号,有赞客户ID,unionid,收货人,收货手机号,商品名称,商品ID,实付金额,订单状态,物流状态,支付时间,收货地址
```

客户至少 3 条，覆盖 unionid 已授权、仅手机号、未匹配：

```text
有赞客户ID,unionid,手机号,昵称
```

原始样本只进入受控 Admin 预览，不写入仓库。评审结果必须达到 READY，未知订单/物流状态先补映射。

### 3.5 执行批次

1. `YOUZAN_ORDER / YOUZAN_OPEN / PREVIEW / limit=3`，核对订单号、手机号、金额、订单状态和物流状态。
2. `YOUZAN_CUSTOMER / YOUZAN_CUSTOMER / PREVIEW / limit=3`，核对 yzUid、unionid、手机号和昵称。
3. 分别单页 IMPORT；核对导入数量、错误数、身份补链、游标和审计记录。
4. 先 dry-run 身份对账，再用最小批次执行；冲突进入人工复核。
5. 发券使用一个已明确同意的测试用户和一张测试券，确认唯一 `yz_open_id`、`activity_id`、外部券 ID 与幂等引用。
6. 使用同一张测试券查询状态，确认 `ISSUED/USED/EXPIRED/CANCELLED` 映射；发券和状态查询必须分别取得确认。

### 3.6 回滚

1. 暂停有赞真实 Adapter，恢复 `MANUAL_SAMPLE` 和后台手工同步。
2. 对可回滚的单页 IMPORT 使用 runId 回滚，并核对订单、客户镜像、游标和审计。
3. 已在有赞成功发出的券不得通过重复请求“回滚”；改由运营核对、作废或补偿，并保留外部券 ID。

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
| E-01 | 创建有赞云应用并提交审核 | 创建第三方应用 | 是 |
| E-02 | 保存有赞只读变量并 PREVIEW | 读取真实订单/客户 | 是 |
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
