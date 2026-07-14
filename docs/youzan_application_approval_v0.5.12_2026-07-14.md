# 有赞应用 E-01 审核通过证据

复核时间：2026-07-14 10:08-10:43 +08:00

行动时状态：`E-01_APPROVED / APPLICATION_CONSOLE_ACCESSIBLE / CREDENTIALS_GENERATED_NOT_STORED / CLIENT_SECRET_ROTATION_REQUIRED / ROOT_SHOP_AUTH_PENDING / API_PACKAGE_STATUS_PENDING / CALLBACK_DEFERRED_NO_RECEIVER / PRIVACY_DATA_ENCRYPTION_STATUS_PENDING`

后续回读状态：`ROOT_SHOP_AUTHORIZED / A_PLAN_ACTIVE / READ_INTERFACES_GRANTED / COUPON_CAPABILITY_REVIEWING / PRIVACY_PAYLOAD_PROBE_PENDING`。本文第 3 至第 8 节保留 10:08-10:43 的行动时快照，当前状态以第 9 节为准。

## 1. 实际读取来源

1. 已登录的有赞云应用中心，刷新后的应用卡片与应用概览页。
2. 应用“myRoot会员数据对接”的应用信息、测试店铺、授权信息和有赞授权登录页签存在性。
3. 当前 [外部 Adapter 正式接入执行包](./external_adapter_activation_v0.5.12_2026-07-13.md) 与 [正式上线 Gate](./formal_launch_gate_v0.5.12_2026-07-13.md)。

没有读取、复制、保存或写入任何凭据值；本证据只记录字段存在性和配置状态。

## 2. 审核结果

1. 刷新应用中心后，应用卡不再显示“审核中”。
2. 应用卡可以进入正式应用概览，不再被审核等待页阻断。
3. 概览页显示正式 App Id 字段、`client_id` 与 `client_secret` 字段均已生成。
4. 应用继续显示为 `无容器 / 自用型`，名称为“myRoot会员数据对接”。

据此，E-01“创建有赞应用并提交审核”已完成，状态从 `SUBMITTED` 更新为 `APPROVED`。

## 3. 行动时缺失材料

1. ROOT 店铺授权尚未回读，`grant_id` 未确认。
2. 商品、订单、客户、User Query、优惠券及券状态能力范围尚未逐项回读。
3. 当前有赞接入仅包含主动拉取与动作调用，没有接收有赞通知、验签和幂等消费的回调 Interface；回调地址必须保持空白，不能用 CloudRun 根地址或 `/health` 充当占位。
4. 质量负责人尚未配置。
5. access token 获取方式、到期时间和轮换负责人尚未确认。
6. 测试店铺与正式 ROOT 店铺的关系尚未核对。
7. ROOT 店铺的有赞云 `API 套餐包`订购与可用额度尚未回读；有赞现行说明称，自研应用授权店铺未订购套餐包时会限制 Interface 调用。
8. 有赞“消费者隐私数据/数据加密”状态尚未回读；当前代码没有有赞隐私字段解密 Implementation，不能假定订单手机号、地址或客户字段会以明文返回。

以上是 E-01 关闭时的行动时缺口。回调不是当前主动拉取链路的 E-02 前置条件；后续已关闭或仍阻塞的项目见第 9 节。

## 4. 凭据安全处理

1. 有赞概览页默认明文展示了 `client_id` 和 `client_secret`，本轮临时截图曾捕获该页面。
2. 所有包含凭据页的临时截图已从 `/private/tmp` 删除，浏览器已离开凭据页并返回应用中心。
3. 凭据值没有进入仓库、文档、命令参数、剪贴板或候选运行变量。
4. 基于最小暴露原则，当前 `client_secret` 视为不可用于生产；E-02 前必须先轮换，再在受控密钥存储中保存新值。
5. 轮换、保存凭据和设置质量负责人均属于后续写动作，需要行动时单独确认；回调地址保持空白，不执行写入。

## 5. E-02 前置顺序

1. 单独确认轮换 `client_secret`，只在受控终端读取一次并立即保存到密钥存储。
2. 配置质量负责人并回读结果；回调地址保持空白。若控制台强制要求回调，停止操作并先实现通知接收、验签、幂等和重放防护 Module。
3. 只读核对 ROOT 店铺授权、`grant_id`、商品/订单/客户/User Query/优惠券能力范围、`API 套餐包`与可用额度，以及“消费者隐私数据/数据加密”状态；若授权为待确认，由 ROOT 店铺管理员在店铺后台确认。
4. 按自用型无容器应用流程，以 `client_id + client_secret + grant_id` 获取最小权限 access token，记录到期时间和轮换负责人。
5. 补齐有赞读取变量后，先运行 3 条脱敏样本 PREVIEW；不得直接 IMPORT。若响应包含密文或加密标记，立即停止，先补齐并验证解密 Implementation。

## 6. 对抗式审查

1. **能进入概览不等于 ROOT 店铺已授权**：E-01 关闭，店铺授权继续阻塞。
2. **字段已生成不等于凭据可用**：当前 secret 必须轮换后才能进入生产流程。
3. **App Id 存在不等于能力齐全**：订单、客户、用户查询和券能力仍需逐项回读。
4. **截图删除不等于暴露从未发生**：按已暴露处理并要求轮换，不复用当前 secret。
5. **审核通过不等于可执行真实同步**：E-02 至 E-05 继续分别授权。
6. **HTTP 200 不等于隐私字段可用**：手机号、地址或客户字段若为密文，必须在受控样本中验证解密和脱敏后才可 IMPORT。

## 7. 官方依据复核

2026-07-14 仅查阅有赞官方资料，不调用有赞业务 Interface：

1. [商家自研无容器接入流程](https://doc.youzanyun.com/resource/develop-guide/41355/41703)说明，自用型应用只能选择同一有赞云账号下的店铺；若状态为待授权，需由店铺管理人员在商城后台确认。
2. [自用型无容器获取和刷新 access_token](https://doc.youzanyun.com/resource/doc/3031)说明，应用通过 `POST https://open.youzanyun.com/auth/token` 和 JSON 请求体换取 token；`authorize_type` 固定为 `silent`，请求包含 `client_id + client_secret + grant_id + refresh`，其中 `grant_id` 为店铺 ID。成功响应包含约 7 天有效的 token 与毫秒级过期时间；主动刷新后旧 token 仅保留 1 小时过渡期。
3. [欠费后如何处理，是否会影响服务](https://doc.youzanyun.com/resource/doc/3862/3862)说明，自研应用授权店铺未订购 `API 套餐包`时会限制 Interface 调用，并给出额度不足与欠费后的分级限制规则。
4. [有赞云开发规范](https://doc.youzanyun.com/resource/operate-spec/27033/27637)要求开放数据使用必须事先取得商家授权，并限制授权数据的使用范围。
5. [消费者隐私数据加密说明](https://doc.youzanyun.com/resource/develop-guide/27027/42743)说明消费者隐私数据存在加密与解密接入要求，真实字段使用前必须按店铺状态完成适配。

以上资料只确定 E-02 的前置条件，不证明 ROOT 店铺当前已授权、已订购套餐或具备目标能力。

## 8. 行动时结论

E-01 已通过并关闭。有赞应用已经可进入正式控制台，但 ROOT 店铺授权、能力范围、`API 套餐包`与额度、质量负责人、隐私数据加密状态、token 管理和凭据轮换均未完成；当前不得启用有赞真实读取、IMPORT 或券动作。回调地址按当前主动拉取架构明确留空，不作为虚假完成项。

2026-07-14 后续只读复核补齐了官方 token 请求与轮换契约，但没有读取凭据、调用 token Interface 或改变 E-02 状态。正式换取仍须等待 ROOT 店铺授权、`grant_id`、能力范围、套餐状态与新 secret 安全保存全部完成。

## 9. 后续控制台回读

1. ROOT 店铺已授权，店铺号 `543131955`，授权有效期至 `2027-05-31`；质量负责人已配置。
2. A 套餐已开通，当前月 500,000 次、20 QPS、已用 0、剩余 500,000、费用 0；套餐精确到期日未在本轮页面显示。
3. 商品、订单、客户与用户查询目标 Interface 已授权；优惠券发送与查询 Interface 未授权，能力包仍审核中。
4. 有赞 CRM 能力包被驳回，但当前所需客户列表与用户查询 Interface 已单独授权；高级 CRM 范围与当前读取准入分开判定。
5. 回调保持空白，IP 白名单为 0 条。控制台菜单不能证明隐私字段返回形态，仍须脱敏只读探针。
6. 当前 secret 仍必须轮换；没有换取 token、读取真实订单/客户、运行 PREVIEW/IMPORT 或执行券动作。
7. 完整脱敏证据与当前 E-02 停止规则见 [有赞 ROOT 店铺脱敏回读证据](./youzan_live_readback_v0.5.13_2026-07-14.md)。
