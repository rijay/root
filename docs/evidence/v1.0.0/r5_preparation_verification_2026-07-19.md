# R5 本地准备验证

截至 2026-07-19 20:49 +08:00，R5 冻结包已准备但未授权、未执行。

- R5 JSON SHA-256：`fbebc88c7cae403f7a8a37ecb13ae1961217c527a459b3aad5edeb97140baf9a`
- 单次 nonce：`b6424a60-aea0-401d-9688-f1aa21eec614`
- Runner/packet contracts：26/26 PASS，0 FAIL，0 SKIP
- Backend：1280 tests，1271 PASS，0 FAIL，9 个默认关闭的真实 MySQL SKIP
- Foundation：PASS
- Final verification：17/18；唯一失败为 `Generated MySQL schema snapshot provenance`
- 未授权 guard：返回 `MYSQL_LOCAL_RUNNER_NOT_AUTHORIZED`，未启动 Docker，残留 owned container 为 0

R5 把 Attempt 4 丢失的 child 失败诊断改为有界、脱敏、分通道的稳定 Interface：完整输出先脱敏再做 UTF-8 尾部保留，每通道最多 4096 bytes；区分退出、信号、启动错误和缓冲超限；测试子进程只继承环境白名单；原始无界输出不再回传；诊断在容器清理之后输出。

这份证据不证明 R5 的真实引擎结果，也不关闭本地 schema、远端 CI、Candidate/生产 MySQL 或正式上线 Gate。R5 只有获得新的单次明确授权后才能执行。
