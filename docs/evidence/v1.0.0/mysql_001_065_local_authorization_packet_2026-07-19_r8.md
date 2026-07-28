# MySQL 001-065 本机单次授权包（R8）

- 状态：`PREPARED_NOT_AUTHORIZED_NOT_EXECUTED`
- JSON SHA-256：`07cf65ac3a869ff555af5b840b5cdd5ea241b68ae1203946ae41e15334560d23`
- 单次 nonce：`c1d43f6b-0a42-415c-9f21-cd4dfa67794f`
- 固定镜像：MySQL 8.0.43 digest
- 作用域：仅本机 `127.0.0.1` 随机临时端口；禁止 Candidate/生产、部署、提交与推送

R8 冻结 Attempt 7 后的三类更正：以 `information_schema.ROUTINES` 的精确 definer 与 `SECURITY_TYPE=DEFINER` 验证运行主体；对跨实例 provider UNKNOWN recovery 使用确定性 fence；从完整脱敏 stdout 提取有界 TAP 失败标签、错误码、失败类型与诊断摘要，避免首个失败再次被 tail 截断。migration 001～065 未改动。

精确执行入口：

```text
npm run v1:mysql-local-authorized:run -- --packet docs/evidence/v1.0.0/mysql_001_065_local_authorization_packet_2026-07-19_r8.json
```

成功条件固定为 13/13 PASS、0 FAIL、0 SKIP，随后依次生成并独立校验 schema snapshot，最终 repository verify 必须 18/18。任何失败都必须停止并删除受管一次性容器。

本包不构成授权。只有用户另行明确给出上述 JSON SHA 与 nonce，并继续限定本机 loopback、失败即停和清理，执行器才可消费一次。即使通过，也不关闭 Candidate/生产、容量、真实送达或正式上线 Gate。
