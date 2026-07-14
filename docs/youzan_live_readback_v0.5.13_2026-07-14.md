# 有赞 ROOT 店铺脱敏回读证据

日期：2026-07-14

状态：`READBACK_COMPLETE / E-02_BLOCKED / NO_CREDENTIAL_STORED / NO_TOKEN_EXCHANGED / NO_LIVE_DATA_READ`

## 1. 实际读取来源

1. 已登录的有赞云应用控制台：应用概览、店铺授权、能力与 Interface 列表、套餐购买记录、API 账单、能力包、回调与 IP 白名单页面。
2. 有赞官方数据加密说明与加密 Interface 清单：
   - <https://doc.youzanyun.com/resource/develop-guide/27027/42743>
   - <https://doc.youzanyun.com/resource/doc/3024>
3. 当前仓库的有赞订单、客户、商品和优惠券 Adapter Implementation、生产环境矩阵与 E-02 至 E-05 停止规则。

本轮只做页面回读。没有显示、复制或保存凭据值，没有换取 token，没有调用有赞 Interface，没有读取真实客户、订单或隐私字段，也没有修改有赞后台。

## 2. 缺失与不确定材料

1. A 套餐页面确认按月分配额度，但本轮页面没有显示精确套餐到期日；不能用店铺授权到期日替代套餐到期日。
2. 控制台没有可见的“数据加密”入口，不能据此推断返回明文或密文；必须用已知测试订单或客户做脱敏只读探针。
3. IP 白名单当前为 0 条。固定出口方案尚未确定，不能随意填入 CloudBase 临时出口 IP。
4. 当前 `client_secret` 曾进入临时截图，按已暴露处理；轮换前不得用于正式 token。
5. 优惠券管理能力包已获得，目标发送与查询 Interface 均已在权限清单中；尚未换取 token、读取真实券数据或执行发券。

## 3. 控制台回读结果

| 项目 | 回读结果 | 判定 |
| --- | --- | --- |
| 应用 | `myRoot会员数据对接`，App Id `10007712`，审核通过 | `PASS` |
| ROOT 店铺授权 | 店铺号 `543131955`，授权有效期至 `2027-05-31` | `PASS` |
| Root 会员中心小程序 | AppID `wxfb75c0b432670215` | `PASS` |
| A 套餐 | 2026-07-14 12:03:10 开通；当前月 500,000 次、20 QPS、已用 0、剩余 500,000、费用 0 | `PASS_CURRENT_ALLOCATION` |
| 商品读取 | `youzan.items.onsale.get`、`youzan.item.get` 已授权 | `PASS` |
| 订单读取 | `youzan.trades.sold.get` 已授权 | `PASS` |
| 客户读取 | `youzan.scrm.customer.list` 已授权 | `PASS` |
| 用户查询 | `youzan.users.info.query` 已授权 | `PASS` |
| 优惠券发送 | `youzan.ump.voucheractivity.send` 已授权 | `PASS_CONTROL_PLANE` |
| 优惠券查询 | `youzan.ump.voucher.query.detail` 已授权 | `PASS_CONTROL_PLANE` |
| 有赞 CRM 能力包 | 已驳回，平台理由为“仅限订购有赞CRM申请” | `ADVANCED_SCOPE_BLOCKED` |
| 当前所需 CRM 读取 Interface | 客户列表与用户查询已单独授权 | `READ_SCOPE_AVAILABLE` |
| 数据加密返回形态 | 页面无法证明，尚未执行只读探针 | `NEEDS_PROBE` |
| 回调地址 | 空白；当前主动拉取 Implementation 不接收通知 | `EXPECTED` |
| IP 白名单 | 0 条；固定出口方案未定 | `NEEDS_DECISION` |

CRM 能力包被驳回不等于现有客户读取链路不可用；正式判断以精确 Interface 授权和脱敏只读回执为准。优惠券控制面前置已经关闭，但真实发券和状态查询仍须在轮换 secret、受控 token、活动参数校准和独立行动时确认后验证。

## 4. E-02 准入顺序

1. 单独确认并轮换当前 `client_secret`，随后只在受控凭据存储中保存新值。
2. 明确 token 负责人、`grant_id`、到期与轮换策略；`client_secret` 不进入 CloudRun 运行变量。
3. 决定是否启用 IP 白名单；如启用，先形成稳定固定出口，再写白名单。
4. 在受控终端集中换取只读 token，不把凭据放入命令参数、日志、截图或仓库。
5. 对一个已知测试订单和一个已知测试客户执行只读探针，只记录 HTTP/业务码、目标字段存在性、是否密文和分页形状，不记录姓名、手机号、地址、会员标识或原始响应。
6. 如果出现密文，先增加有赞解密 Adapter 与脱敏测试；在此之前停止 PREVIEW 和 IMPORT。
7. 字段与分页确认后，分别执行最多 3 条订单和客户 PREVIEW；单页 IMPORT 另行确认。
8. 优惠券目标 Interface 已回读通过；配置校准、只读状态查询和真实发券继续使用各自独立确认，不能用权限通过替代真实回执。

## 5. 当前结论

ROOT 授权、A 套餐以及商品、订单、客户、用户查询和优惠券目标 Interface 已具备，E-01 与优惠券控制面前置已关闭。E-02 仍由 `client_secret` 轮换、受控 token、固定出口决策、隐私字段返回形态和真实只读样本阻塞；优惠券真实动作还缺活动参数与独立回执。不得把“控制台有权限”写成“真实 Adapter 已就绪”。
