# R9 本机 MySQL 准备验证

- 状态：`R9_PREPARED_NOT_AUTHORIZED_LOCAL_CONTRACTS_PASS_FORMAL_GATES_OPEN`
- R9 包 SHA-256：`2dc3d74eb33af4e641eb09e935cddf9c6e2035ac1c7b7d84c23c1007c8e797db`
- 单次 nonce：`7f2aca54-87ea-4c48-bf8c-096dcbbcdd4a`（未消费）

Attempt 8 的直接执行证据为 12 PASS / 1 FAIL / 0 SKIP，失败后容器已清理。唯一失败由真实引擎结构化诊断定位为测试夹具 authority version 漂移；R9 已令夹具从运行时 Module 导入唯一常量，未修改 migration 001～065。

本地非真实引擎验证：定向 88 项中 87 PASS、1 个真实 MySQL 分支按预期 SKIP；Backend 1291 项中 1282 PASS、9 个真实 MySQL 分支 SKIP、0 FAIL；Foundation PASS；授权执行器与 R9 包合同 28/28 PASS。未授权 guard 在 Docker 前拒绝，受管容器残留为 0，R9 nonce 未消费。

本文件与 R9 包都不构成授权，不关闭本地真实引擎、schema snapshot、Candidate/生产、容量或正式上线 Gate。
