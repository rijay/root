# myRoot v1.0.0 正式上线 Gate 就绪矩阵

截至 2026-07-20 04:50 +08:00，正式上线仍为 `NOT_READY_FORMAL_LAUNCH_GATES_OPEN`。本矩阵区分“本地 Implementation 已具备”“外部只读证据缺失”“外部写动作待授权”，不把结构测试、合成签名或历史证据当作正式验收。

固定 Readiness Validator 已对 JSON 矩阵派生：14 OPEN、3 HARD BLOCKER、0 CLOSED、`formalLaunchAuthorized=false`，matrix digest=`7788123ec1b59b4e46192b46beb8a6695a6e486c31c07adc4c6a024959838293`。即使未来 14 项均具有受控外部 readback，也只允许进入独立正式发布决策，不能由本矩阵自行授权。详见 `formal_launch_readiness_validation_2026-07-19.json`。

| Gate | 当前状态 | 本地基础 | 正式关闭仍缺 |
| --- | --- | --- | --- |
| PRD 具名签署 | OPEN | source binding 与结构 Contract ready；仍为 non-authorizing | 受信审批/验签 Adapter、执行控制面、34 个真实签署、受控审批实例与 Acceptance Envelope |
| 远端 CI required check | OPEN | 三 check + 13/13 real-engine zero-skip 的静态声明 ready | Remote CI Evidence Registry、commit/PR/首次 run、actual contexts、artifact、active protection readback |
| Candidate/生产 MySQL | OPEN / P0 | Attempt 9 真实引擎 12 PASS / 1 FAIL 后停止并清理；R10 未执行且已被取代；R11 绑定完整执行闭包并冻结但未授权 | 仍缺 13/13 成功引擎证明、schema provenance 及 Candidate/生产分别实证 |
| MySQL/CloudRun 容量 | OPEN / P0 | 六池策略/Collector ready | live 配置、负载、突发、锁、故障数据 |
| Artifact provenance | OPEN | commit-tree source结构与 deployment binding contracts ready | 完整 build inputs、trusted remote readback、HEAD source artifact、attestation、deployed-byte binding |
| timer-only IAM | OPEN | fail-closed route token/evidence contract ready | live IAM、正负向调用与签署 |
| 告警接收端 | OPEN | controlled DB write/delivery foundation ready | receiver/on-call、ACK、合成发送、重试/DLQ 演练 |
| 密钥轮换与保留 | OPEN | 四域 inventory/retention invariants ready | live inventory、rekey/rollback/retire/destroy proof |
| 微信身份与订阅送达 | OPEN / P0 | trusted identity/binding/provider fence + endpoint exfiltration guard；本地 103/103 | Candidate artifact/env/egress、真实 login、模板/额度/凭据、真机送达与审计 |
| 健康内容 | OPEN | gated shell/structure validator ready | 授权量表、SOP 与真人签署 |
| 隐私履约 | OPEN | consent/retention partial | H-04P 审批与同 D0 Candidate H-04R 演练 |
| 活动运营 | OPEN | vertical flow ready, publication off | 首发内容/SOP、真实 Adapter、Candidate UAT |
| UED handoff | OPEN | structure index available | 受控 node ref、逐屏 parity/无障碍/签署 |
| 摄影授权 | OPEN | selection/digest inventory ready | clean master、完整权利链与签署 |

## 当前最短关键路径

1. R9 nonce 已消费且不得复用；R10 未执行但已由 R11 取代。R11 如需执行，必须按 SHA `d0369e06f7fb57a2085cd5a567bf775370fe0ae2a43178179465a435e7aa3016` 与 nonce `dd1a2ef2-8687-4509-a799-0960748cb6fd` 另行取得单次明确授权。
2. 先关闭 `TRUST-P0-001～006`：实现 Formal Evidence Resolver、Baseline trusted evidence verifier/execution control 与 Remote CI Evidence Registry；结构通过不得解释为真实签署或 Gate closure。
3. 指定 PRD 审批系统和六角色真实 owner，收集 34 个签署。
4. 在同一冻结基线上分别授权 commit、push、PR 与首次远端 CI，再回读 actual contexts/artifact/protection。
5. 并行收集健康、隐私、活动、UED、摄影五类真人/权利验收材料。
6. 之后才进入 Candidate 的 MySQL、容量、IAM、告警、密钥、微信身份与真实送达实证；Production 保持单独 Gate。

本矩阵不授权 Candidate/生产连接、远端写、部署、真实发送或正式上线。
