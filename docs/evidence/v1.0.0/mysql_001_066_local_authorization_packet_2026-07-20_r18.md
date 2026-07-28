# R18 本机 MySQL 8.0.43 一次性授权包

- 状态：`PREPARED_NOT_AUTHORIZED_NOT_EXECUTED`
- packet SHA-256：`c8a0e0bb3ceb5ac31a9a79709aab9a87d0e38f08dbdf7945dd0cc273571c63ad`
- single-use nonce：`a5e97063-bbe1-4bd3-af1a-fa3cb7bc7f1e`
- 仅允许本机 `127.0.0.1` 随机临时端口及一次性 MySQL 8.0.43 容器。
- 不连接 Candidate/生产，不授权提交、推送、部署、真实发送或正式 Gate 关闭。
- 本包不构成授权；必须由用户再次精确确认 packet SHA 与 nonce 后才能执行。
- 失败立即停止、恢复可变输出，并删除本任务拥有的一次性容器。
