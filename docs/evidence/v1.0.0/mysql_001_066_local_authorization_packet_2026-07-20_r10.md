# MySQL 001-066 本机单次授权包（R10）

- 状态：`PREPARED_NOT_AUTHORIZED_NOT_EXECUTED`
- JSON SHA-256：`406d69b069eded1af6f96968ded41679c4d53d2f0baed1d60259f4d1b84f96c4`
- 单次 nonce：`66d0134b-d70e-497b-a9a3-9bf78530ae0f`
- 固定镜像：`mysql:8.0.43@sha256:3e646bcda0d9448ffa3d2024eef04e1bca95528ec19b9e8b76749da9d97d4a10`

## 更正范围

R10 冻结 Attempt 9 的源头修正与数据库防御：

- 真实引擎夹具不再把严重级别 `BLOCKER` 与临时值 `60` 当作数据库 SLO 参数，而是从共享 Policy Module 得到 `BLOCKER_IMMEDIATE / 300`。
- 运行 Delivery Adapter 与 Payload Module 通过同一个 Policy Interface 解释严重级别。
- 新增 immutable migration 066；两个注册过程都根据持久化 `runtime_alert.severity` 强制 SLO 对应关系，拒绝 `BLOCKER + WARNING_STANDARD/1800` 等合法 pair 的跨事实降级。
- migration 001～065 未修改；当前完整集合为 001～066。

非 Docker 定向回归已证明相关 Module、SQL 静态合同、迁移解析与 Structure Guard 共 64/64 PASS。该结果不等于真实 MySQL 证明；migration 066 与新的负向数据库断言尚未获得一次性执行授权。

## 如需执行

本包不构成授权。只有用户另行明确授权本 JSON SHA 与 nonce 后，执行器才允许运行：

```bash
npm run v1:mysql-local-authorized:run -- --packet docs/evidence/v1.0.0/mysql_001_066_local_authorization_packet_2026-07-20_r10.json
```

执行器仅允许固定 MySQL 8.0.43、`127.0.0.1` 随机临时端口与一次性随机数据库；失败立即停止并清理。成功后才依次写入 schema snapshot、独立验证并运行最终 repository verify。

即使 R10 将来完全通过，也不会关闭 Candidate/生产 MySQL、容量、远端 CI、真实告警接收端或正式发布 Gate。
