# myRoot 用户标签：服务端联调第一轮

核查日期：2026-09-04。最新状态：**用户授权已生效，本地服务端读取逻辑连接真实飞书的只读联调通过；云端部署和真实记录写入尚未在本任务执行**。原应用身份的文档授权仍未通过。

目标环境：`myroot-prod-d5gl3gzg7115f149a`；服务：`myroot-api`。目标飞书数据表：`tbl9PI8eKv6aQE3S`，沿用已确认的「用户标签表」。

## 实际核查结果

| 检查 | 结果 | 影响 |
|---|---|---|
| 现行服务健康 | `/health` 为 HTTP 200、业务码 0 | 基础服务可用 |
| 数据库就绪 | `/ready` 为 HTTP 200，MySQL 已连接 | 数据库连接正常 |
| 标签配置接口 | 用现有服务管理凭据读取 `/api/v1/admin/user-labels/config`，HTTP 404 | 线上尚无标签接口 |
| 数据库迁移 | 就绪接口报告 `074_assessment_source_survey.sql`；只读查询仅找到 `schema_migrations`，没有 `user_label_mapping` / `user_label_sync_state` | 迁移 075 尚未应用 |
| 发布配置 | 发布单为 FLOW、100%、success、无进行中的发布；列出版本 074 和 075，公网健康返回现行 v0.8.0 发布标识 | 本轮未创建候选、发布或切换流量 |
| 服务端飞书配置 | 上述两个版本均未配置 `ROOT_LABEL_FEISHU_APP_TOKEN`、`ROOT_LABEL_FEISHU_TABLE_ID`、`ROOT_LABEL_FEISHU_ACCESS_TOKEN`、`ROOT_LABEL_FEISHU_WRITE_ENABLED` | 服务端 Adapter 尚不能访问目标表 |
| 本机飞书应用只读探测 | 新增三项应用权限后，Base v3 和服务端采用的 `bitable/v1` 字段读取均返回 `91403` | API scope 已开通，目标文档访问仍未通过 |
| 目标文档应用授权 | 页面提交后刷新，协作者名单仍为原三项；按确认的 App ID、`view`、关闭通知调用官方协作者接口，返回 `1063002 / permission_denied` | 当前用户身份无权执行该资源授权，需要具备授权权限的文档管理员处理 |

最初 Base v3 探测的 `99991672 / app_scope_not_applied` 属于开通权限之前的历史结果。授权后，使用本机已确认应用的安全凭据，经 CLI 调用两种字段读取路径，均被文档权限拒绝。尚未将有效凭据配置到云端，也尚未完成真实 Adapter 的完整字段/记录读取。

HTTP 初次使用 Python 运行时发生连接错误；之后用项目实际 Node.js 运行时、保留 TLS 校验重新读取，得到上述 HTTP 结果。

## 已准备的联调入口

新增 `backend/scripts/verify-user-labels-feishu-readonly.js`，直接复用服务端 `feishuUserLabels` Adapter：

- 仅接受运行时注入的目标配置与访问凭据；不读取或复制本机个人飞书令牌。
- 强制关闭写开关，仅允许字段列表 GET、记录查询 POST `/records/search` 和回读 POST `/records/batch_get`。两项 POST 均是飞书官方只读接口；创建、更新、删除请求会被拒绝。
- 读取全部字段与记录分页，仅输出数量与字段兼容性结果，不输出用户明细、访问令牌或服务商原始错误内容。
- 使用本地虚构用户校验字段和默认选项，明确标注未测试真实用户同步。
- 缺少配置或调用未通过时以退出码 2 停止。

在候选或本地联调进程的安全配置中注入下列变量后运行，不把密钥填写进仓库或对话：

```text
ROOT_LABEL_FEISHU_APP_TOKEN
ROOT_LABEL_FEISHU_TABLE_ID
ROOT_LABEL_FEISHU_ACCESS_TOKEN
```

```sh
node backend/scripts/verify-user-labels-feishu-readonly.js
```

初版脚本已检查缺少凭据时没有网络请求。更新为新版读取接口后，本地模拟即便传入写开关 true，也只发起字段 GET 和记录搜索 POST，并返回写开关 false。使用已回读的真实字段结构作模拟输入，兼容性检查通过。更新后的标签与 HTTP 权限测试 20/20 通过，覆盖完整分页、缺失 UID 列、错误回读 ID、禁止访问和记录不存在等情况。这些是本地验证，不代表真实 Adapter 联调通过。

## 继续所需的输入与顺序

1. 用户已确认沿用应用 `cli_aa904d2635b8dbd7`，后续选择通过本人用户身份继续联调。用户授权已兑换，凭据由 CLI 安全管理，未导出到仓库、对话或云端。
2. 为选定应用核对实际服务端接口权限和目标表访问权限，通过安全运行时配置提供有效凭据。先执行上述只读检查，确认字段、记录分页和错误处理。
3. 按已审阅变更准备迁移 075 及后台/服务端候选部署，保留写开关关闭。部署影响和恢复方案随具体候选一并审阅；本轮尚未执行这些云端变更。
4. 候选环境通过后，核定来源映射和明确 UID，生成首批真实差异预览；记录写入另按批准批次执行并回读。

本轮云端写操作、飞书记录写入、真实用户明细读取均为 **0**。

证据：`docs/evidence/user-labels-20260904/server-integration/cloud-readonly.json`、`feishu-app-probe.json`、`local-credential-check.json`、`probe-script-check.json`。

后续接口核对入口：[字段读取](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/list)、[记录读取](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/list)、[自建应用访问凭据](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal)。

## 应用确认后的权限准备

用户已确认复用上述应用。官方 Markdown 文档将旧记录列表和单条获取接口标记为历史接口；代码现已替换为 `records/search` 与 `records/batch_get`。字段列表仍使用原有接口。记录搜索明确请求系统字段白名单，不请求测评列和自动人员字段。

本次只读联调申请的应用身份权限为：

| 权限 | 用途 | 当前状态 |
|---|---|---|
| `base:field:read` | 读取字段名、类型、选项 | 已开通，应用身份 |
| `base:record:retrieve` | 按字段白名单完整分页查询记录 | 已开通，应用身份 |
| `base:record:read` | 按指定记录 ID 回读核对 | 已开通，应用身份 |

用户确认提交后，已点击「确认开通权限」。回读三项均显示「应用身份 / 已开通」，页面显示「当前修改均已发布」。应用字段创建/更新/删除、记录创建/更新/删除权限均不在本次申请范围。权限仅赋予 API 能力；目标表还须向该应用授予相应文档访问权限。若需撤销，可关闭本次新增三项权限；既有权限保持原状。

官方依据：[字段列表](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/list.md)、[查询记录](https://open.feishu.cn/document/docs/bitable-v1/app-table-record/search.md)、[批量获取记录](https://open.feishu.cn/document/docs/bitable-v1/app-table-record/batch_get.md)。验证证据：`modern-read-api-tests.tap`、`modern-read-probe-check.json`。

## 确认提交后的执行结果

目标文档授权未完成。在「管理协作者 → 添加协作者」中选中「rijay的飞书 CLI」、设置「可阅读」并关闭「发送通知」后提交，弹窗关闭但协作者没有保留；刷新后的名单仍只有原三项。随后通过官方 CLI 对已确认 App ID 提交相同的只读授权，收到明确拒绝：`1063002 / permission_denied / user lacks permission for the requested resource`。未扩大授权角色、改变文档公开范围或替换调用身份来重试被拒绝的读取。

当前阻塞属于目标资源授权。页面所见当前用户为「可编辑」，没有「添加文档应用」入口；错误没有进一步说明租户策略或所有者规则，不能断言跨租户是具体原因。应用与目标文档所属组织不同，仅作为需管理员核查的上下文。

管理员处理的准确目标：在 [ROOT陪伴计划_用户标签库](https://acnfm9dbh9x3.feishu.cn/base/XO5sbmYGRa0bALsPKH8ck4ZUnJJ?table=tbl9PI8eKv6aQE3S&view=vewMdQCWiL) 中，为「rijay的飞书 CLI」（`cli_aa904d2635b8dbd7`）授予「可阅读」，关闭通知，并回读确认该应用出现在协作者列表。官方应用授权入口说明见 [飞书文档权限说明](https://www.feishu.cn/content/383321056779)。本轮没有发送权限申请消息。

文档授权成功后，继续用同一个应用身份执行只读 Adapter 验证；迁移、候选部署及真实记录写入仍按前述顺序分别准备和验收。本次云端部署、数据库迁移、飞书记录写入均为 0。

`application-permission-request.json` 保留为提交前计划。执行结果见 `application-permission-execution.json`，真实失败响应摘要见 `app-field-read-after-grant.json`、`bitable-v1-field-probe.json`。失败探测的字段数量为未知（`null`），不能当作 0 个字段。

## 22:38 后的只读复核

用户要求核查添加结果。本机配置确认仍使用 `cli_aa904d2635b8dbd7`；应用身份实际读取 `bitable/v1` 字段接口仍返回 `91403 / Forbidden`。文档协作者列表现有四项，新增显示名称为「王晖-rijay's Feishu Assistant」，权限为「可编辑」；当前用户已由「可编辑」变为「可管理」。列表未显示「rijay的飞书 CLI」，但新条目的 App ID 尚未核实，不能只凭显示名称认定它对应哪个应用。

本次结论：文档协作者确有新增，原定服务端应用的访问仍未通过。此前 `1063002` 是权限变化前的授权失败记录，本轮未重新提交授权，不能据此断言当前账号仍无权添加应用。本轮仅复核状态，没有变更权限或写入记录。证据：`application-access-recheck.json`。

## 22:43 后的授权执行

用户要求代为操作后，按相同 App ID、目标文档、`view`、关闭通知重新执行官方授权接口，仍返回 `1063002 / permission_denied`。当前账号已显示「可管理」，因此不能再把阻塞简单归因为账号只有编辑权限。

页面已开放「更多 → 添加文档应用」。在该入口按名称找到「rijay的飞书 CLI」（所属组织「竞化游戏」），选择「可阅读」并点击「添加」。该次提交对应的页面错误在北京时间 22:45:13 显示「无权限」。退出提交后回读「文档应用」列表，只显示既有 CozeClaw，目标应用没有加入。此入口没有通知选项；未主动发送通知或权限申请消息。

两种入口均未完成授权。现需目标文档所有者或所属组织管理员核查拒绝该应用授权的具体限制；现有错误不足以认定跨组织是唯一原因。未改动已添加的 Assistant、既有协作者、表结构或用户记录；未执行迁移或部署。证据：`application-document-grant-retry.json`。

## 用户身份替代路线核查

用户询问其他方式后，复用服务端只读验证脚本，通过 CLI 管理的现有用户授权执行真实请求。未提取个人令牌、未配置到云端；运行方式明确标记为 `READ_ONLY_ADAPTER_WITH_CLI_USER_TRANSPORT`。

- 字段列表 GET 成功，`has_more=false`，说明现有用户身份可访问该目标表。
- 按系统字段白名单执行记录搜索 POST 时返回 `99991679`，完整只读联调仍未通过。
- 只读检查 OAuth scopes：已有 `base:field:read`、`base:record:read`，缺少 `base:record:retrieve`，也未授予两个宽泛的历史 bitable scopes。
- 建议下一步仅补充用户身份的 `base:record:retrieve`，再重跑完整只读检查；本轮没有发起新增授权。

此路线是使用用户本身拥有的资源权限，不代表应用身份授权已成功。正式服务若采用用户身份，需要实现安全的 OAuth 凭据保管、令牌刷新和失效处理，且依赖该用户持续具有文档权限；现有静态访问令牌配置不能直接视为已具备长期运行能力。官方依据：[记录搜索权限](https://open.feishu.cn/document/docs/bitable-v1/app-table-record/search.md)、[用户授权与刷新流程](https://open.feishu.cn/document/sso/web-application-end-user-consent/guide.md)。

另有两条待核实路线：复用已加入的 Assistant（需先确认 App ID、管理权、服务端凭据及 API scopes）；在应用所属组织内建立可控的新表并迁移结构（会改变目标表地址，须先确认）。本轮未切换应用、未新建表、未写入记录。证据：`user-identity-alternative-probe.json`。

用户随后确认采用本人身份继续联调，通过飞书 CLI 发起单项 `base:record:retrieve` 用户授权。用户回复「已授权」后，已完成本次授权兑换并通过实际记录查询验证生效。授权链接、设备码和访问凭据不写入仓库。

## 22:54 用户身份只读联调通过

使用同一个服务端 `feishuUserLabels` Adapter 和只读验证脚本，网络调用由本机 CLI 的用户身份传输执行。目标仍为原「用户标签表」，没有复制表或切换应用。

| 验证项 | 实际结果 |
|---|---|
| 用户授权兑换 | 成功；随后真实记录查询成功 |
| 字段读取 | 22 个字段，`has_more=false` |
| 记录搜索 | 请求 15 个系统字段，0 条记录，`has_more=false` |
| 字段兼容性 | 所需 15 个字段全部匹配，`schemaBlockers=[]` |
| 写入开关 | `false`；记录写入 0 次 |
| 健康信息 | 记录查询字段白名单排除健康信息 |

结论仅覆盖本地服务端读取逻辑与真实飞书之间的用户身份只读联调。当前目标表没有记录，未测试真实记录的按 ID 回读或同步写入；未验证多页真实数据场景，分页逻辑此前已作本地测试。云端服务部署、迁移 075、OAuth 凭据续期和真实用户同步仍为后续工作，不计入本次 PASS。

证据：`user-authorization-completion.json`、`user-identity-readonly-pass.json`。早先 `user-identity-alternative-probe.json` 的缺 scope 结果保留为历史记录。
