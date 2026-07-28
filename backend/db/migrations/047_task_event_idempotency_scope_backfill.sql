-- Historical task facts all came from the single record-task-event operation.
-- Do not invent keyed request digests: runtime reconstructs the persisted
-- semantic request and upgrades only after a verified equal replay.

UPDATE task_event
SET idempotency_operation = 'RECORD_TASK_EVENT:v1'
WHERE idempotency_operation IS NULL;
