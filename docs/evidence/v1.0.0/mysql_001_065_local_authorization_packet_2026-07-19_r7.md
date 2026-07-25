# MySQL 001-065 本机单次授权包（R7）

- 状态：`PREPARED_NOT_AUTHORIZED_NOT_EXECUTED`
- JSON SHA-256：`168bb5bd43be21513b8367f60c44296f3b7eeb64628e8255107985a45ffeb062`
- 单次 nonce：`f3203727-8afa-40b1-a8ed-b40e6fc919d2`
- 固定镜像：MySQL 8.0.43 digest
- 作用域：仅本机 `127.0.0.1` 随机临时端口；禁止 Candidate/生产、部署、提交与推送

R7 冻结 Attempt 6 后的四类更正：移除 MySQL 保留字 `GRANT` 与 `CURRENT_USER` 的未引用别名、从 `SHOW CREATE PROCEDURE` DDL 校验 definer、令 direct-Adapter 真实引擎注册 harness 使用与生产编排一致的 UTC 会话。migration 001～065 未改动。

精确执行入口：

```text
npm run v1:mysql-local-authorized:run -- --packet docs/evidence/v1.0.0/mysql_001_065_local_authorization_packet_2026-07-19_r7.json
```

成功条件固定为 13/13 PASS、0 FAIL、0 SKIP，随后依次生成并独立校验 schema snapshot，最终 repository verify 必须 18/18。任何失败都必须停止并删除受管一次性容器。

本包不构成授权。只有用户另行明确给出上述 JSON SHA 与 nonce，并继续限定本机 loopback、失败即停和清理，执行器才可消费一次。即使通过，也不关闭 Candidate/生产、容量、真实送达或正式上线 Gate。
