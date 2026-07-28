# myRoot v1.0.0 外部 Gate 证据收件协议

状态：`DRAFT_FOR_CONTROLLED_EXECUTION / NO_EXTERNAL_ACTION_AUTHORIZED`

## 通用收件规则

每份外部证据必须同时具备：release/environment/subject 绑定、原始导出字节摘要、受控 readback receipt、观察时间与有效期、撤销源及当前序列、Adapter Implementation/Policy digest。公开仓只保存去标识引用和摘要，不保存姓名、邮箱、手机号、openid、unionid、数据库名、连接串、审批链接或密钥。

截图、聊天转述、手填 `PASS/CLOSED`、opaque ref、结构测试或本地 seed fixture 均不能单独关闭 Gate。

| Gate | 受控来源 | 必收原始事实 | 失效条件 | 外部动作授权 |
| --- | --- | --- | --- | --- |
| PRD 具名签署 | 受控审批系统/签名验证系统 | workflow、owner/custodian authority、34 条 approval event、payload/signature、条件、当前撤销 | workflow 取消/过期、签名或角色不符、撤销源过期 | 创建 workflow、发起签署分别授权 |
| Remote CI | GitHub 只读 readback | repo/ref、workflow blob、run/attempt/event、四类 SHA、job/check/App、artifact、active ruleset/protection | 同名错误 App、旧 run、混 attempt、非 success、保护弱化 | commit/push/PR/CI/protection 分别授权 |
| Candidate/生产 MySQL | 各环境数据库只读/受控迁移执行 | engine/version、schema/principal/parity、DDL result、rollback/drain、脱敏事实 | 环境或 artifact 不同、结果不完整、失败/SKIP、snapshot 漂移 | Candidate 与生产连接/DDL分别授权 |
| 容量 | 数据库与 CloudRun 指标 | 六池配置、其他消费者、30 分钟目标负载、5 分钟 2x burst、锁/错误/超时 | 单点截图、无完整时间窗、配置漂移 | 只读收集、压测、参数修改分别授权 |
| Artifact provenance | GitHub artifact/attestation 与部署平台 | commit tree、完整 build inputs、artifact bytes、attestation、revision/上传包绑定 | source-only、错误 run、subject/issuer/workflow 不符 | artifact、attestation、部署分别授权 |
| timer-only IAM | CloudBase/云平台 IAM readback | principal/policy/resource、timer success、non-timer deny、revision/trigger | broad invoke、无 deny、release 不一致 | IAM、trigger、正负向调用分别授权 |
| 告警接收端 | 接收平台与值班系统 | owner、receiver、warning/critical ACK、retry、dead-letter 演练 | 无 owner/ACK、仅本地 fake、endpoint 漂移 | 建通道、注入 secret、合成发送分别授权 |
| 密钥轮换与保留 | 密钥平台/数据库/备份系统 | 四域 inventory、TTL/备份/法定值、old-record read、rekey、rollback、引用归零、销毁 | 未覆盖备份、旧 key 仍被引用、不可回滚 | create/inject/rotate/rekey/retire/delete 六步分别授权 |
| 微信身份与送达 | 微信/CloudBase/Candidate | trusted login、AppID mapping、template/quota、timer IAM、`errcode=0`、真机可见、审计回读 | client header、test loopback、无真机/审计、identity drift | 体验版、凭据、订阅、真实发送分别授权 |
| 健康内容 | 授权源文件与受控审批 | 逐量表许可、中文版本、人群、计分解释、红旗/SOP、人工路径、四角色签署 | 许可过期、版本不符、缺红旗处理 | 收件和审批分别授权；健康写入保持关闭 |
| 隐私履约 | DPIA/数据治理系统与 Candidate drill | H-04P、数据流/受托方、留存/删除/备份、访问/密钥、事件处置、同 release H-04R | H-04P/H-04R 不同 release、演练不完整 | 审批与 Candidate 演练分别授权 |
| 活动运营 | 运营后台与受控审批 | activity/version、发布 decision/principal/receipt、规则/SOP、当前 runtime 状态、取消演练 | UED 占位、活动已撤回、版本漂移 | 内容录入、发布、UAT分别授权 |
| UED handoff | 受控 Ardot 节点/交付系统 | 逐屏 node/route/AC/states/accessibility/assets/parity、四角色签署 | Archive 混入、节点不可读、实现版本漂移 | 只读验收与签署分别授权 |
| 摄影/品牌权利 | 权利管理系统/原始文件库 | clean master bytes、摄影师/人物/场地/第三方权利、渠道/地域/期限、编辑/叠字、撤销 | 截图/PDF 合成页、N/A 无依据、权利或 master 漂移 | 资产收件、发布分别授权 |

## 受控执行顺序

1. 先完成 `TRUST-SEAM-1`，确保收件结果能被验真。
2. 只读收件优先；任何创建、审批、发送、配置、迁移或部署分别申请授权。
3. 每个 Gate 形成 Candidate 与 Production 或 RELEASE 的独立证据，不复制环境结论。
4. 证据解析通过后更新 readiness matrix；矩阵仍不授权正式上线。
5. 全部 Gate 验证后另做正式发布决策。

本协议不授权访问任何外部系统，也不构成具名签署、Candidate/生产操作或正式上线批准。
