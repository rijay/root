# MySQL 001-065 本机单次执行授权包（R5）

- 状态：`PREPARED_NOT_AUTHORIZED_NOT_EXECUTED`
- 目标：myRoot v1.0.0；当前运行包版本仍为 0.5.13
- JSON SHA-256：`fbebc88c7cae403f7a8a37ecb13ae1961217c527a459b3aad5edeb97140baf9a`
- 单次 nonce：`b6424a60-aea0-401d-9688-f1aa21eec614`
- MySQL：固定 `mysql:8.0.43` digest
- 网络：仅随机 `127.0.0.1` 临时端口
- 禁止：Candidate/生产连接、部署、提交、推送

## R5 修正范围

Attempt 4 已证明认证型 readiness SQL 能在固定 MySQL 8.0.43 上成功执行，但冻结的 13-test 命令退出 1。旧 runner 在失败分支丢弃了 `spawnSync` 缓存的 stdout/stderr，因此无法定位失败测试组。

R5 冻结以下改动：

- child stdout/stderr 分通道保留；
- 完整输出先做 secret 变体、DSN、敏感键值、ANSI/control 和临时端口脱敏；
- 脱敏后每通道最多保留 4096 UTF-8 bytes 尾部，并记录脱敏全文摘要；
- 区分 `EXIT`、`SIGNAL`、`SPAWN_ERROR`、`BUFFER_LIMIT`；
- 诊断只在容器清理完成后输出；
- npm child 只继承固定环境白名单和显式沙箱变量；
- Node 测试 reporter 固定为 TAP；
- 成功与失败均不再回传无界原始 child 输出。

纯本地 runner 测试已覆盖通道隔离、无输出、UTF-8 截断、secret 编码变体、临时端口、终止类型与父环境凭据隔离。真实引擎仍必须满足 13/13 PASS、0 FAIL、0 SKIP，随后才允许执行 schema snapshot write/verify 和最终 18/18 repository verify。

## 执行与授权关系

冻结执行器命令：

```text
npm run v1:mysql-local-authorized:run -- --packet docs/evidence/v1.0.0/mysql_001_065_local_authorization_packet_2026-07-19_r5.json
```

本包不构成授权。只有用户对上述 JSON SHA 与 nonce 做新的单次明确授权后才能执行；R4 nonce 已消费且不得复用。任何失败都必须立即停止并清理。

即使 R5 完全通过，也只推进本地 MySQL engine/schema proof，不关闭 Candidate/生产 MySQL、容量、真实微信送达或其他正式上线 Gate。
