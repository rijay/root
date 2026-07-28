# MySQL 001-065 本机单次授权包（R9）

- 状态：`PREPARED_NOT_AUTHORIZED_NOT_EXECUTED`
- JSON SHA-256：`2dc3d74eb33af4e641eb09e935cddf9c6e2035ac1c7b7d84c23c1007c8e797db`
- 单次 nonce：`7f2aca54-87ea-4c48-bf8c-096dcbbcdd4a`
- 固定镜像：MySQL 8.0.43 digest
- 作用域：仅本机 `127.0.0.1` 随机临时端口；禁止 Candidate/生产、部署、提交与推送

R9 冻结 Attempt 8 的唯一新更正：运行主体真实引擎夹具不再写死过期的 authority version，而是从运行时 Module 导入 `RECEIVER_BINDING_AUTHORITY_VERSION`，从同一 Interface 向 migration 063 的约束写入 `runtime-alert-receiver-authority:v1`。migration 001～065 未改动。

精确执行入口：

```text
npm run v1:mysql-local-authorized:run -- --packet docs/evidence/v1.0.0/mysql_001_065_local_authorization_packet_2026-07-20_r9.json
```

成功条件仍为 13/13 PASS、0 FAIL、0 SKIP，随后依次生成并独立校验 schema snapshot，最终 repository verify 必须 18/18。任何失败都必须停止并删除受管一次性容器。

本包不构成授权。只有用户另行明确给出上述 JSON SHA 与 nonce，并继续限定本机 loopback、失败即停和清理，执行器才可消费一次。即使通过，也不关闭 Candidate/生产、容量、真实送达或正式上线 Gate。
