# R16 本机 MySQL 8.0.43 一次性授权包

- 状态：`PREPARED_NOT_AUTHORIZED_NOT_EXECUTED`
- packet SHA-256：`0616627c22584cbecc035eca01ead5322c8a63e9f14216d9bf0a0e03ee743105`
- single-use nonce：`1220ef8a-5887-44d1-96d1-5efe6fe64ec7`
- 仅允许本机 `127.0.0.1` 随机临时端口及一次性 MySQL 8.0.43 容器。
- 不连接 Candidate/生产，不授权提交、推送、部署、真实发送或正式 Gate 关闭。
- 本包不构成授权；必须由用户再次精确确认 packet SHA 与 nonce 后才能执行。
- 失败立即停止、恢复可变输出，并删除本任务拥有的一次性容器。
