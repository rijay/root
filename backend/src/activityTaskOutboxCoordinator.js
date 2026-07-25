const { atomicWriteFailure } = require("./atomicWriteError");
const { buildActivityTaskOutboxEnvelope } = require("./activityTaskEventOutbox");
const { stageOutboxEnvelope } = require("./eventTransport");

function text(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function taskTransition(event) {
  if (!event || typeof event !== "object") return false;
  if (event.to_status === "CONFIRMED"
    && ["ENROLL", "REVIEW"].includes(event.operation)
    && [null, "PENDING"].includes(event.from_status)
    && event.reason_code === null) return true;
  return event.to_status === "CANCELED"
    && ["CANCEL", "SESSION_CANCEL"].includes(event.operation)
    && event.from_status === "CONFIRMED"
    && ["USER_CANCELED", "SESSION_CANCELED"].includes(event.reason_code);
}

function bindingError(message) {
  const error = new Error(message);
  error.code = "ACTIVITY_TASK_BINDING_INCOMPLETE";
  error.status = 409;
  return error;
}

function resolveFrozenBinding(data, event) {
  const session = (data.activitySessions || []).find((item) => (
    item.activity_session_id === event.activity_session_id
  ));
  if (!session) throw bindingError("activity task binding session is missing");
  const definition = (data.activityDefinitionVersions || []).find((item) => (
    item.activity_version_id === session.activity_version_id
  ));
  if (!definition) throw bindingError("activity task binding version is missing");
  const taskDefinitionId = text(definition.prebound_task_definition_id);
  const taskDefinitionVersion = text(definition.prebound_task_definition_version);
  if (!taskDefinitionId && !taskDefinitionVersion) return null;
  if (!taskDefinitionId || !taskDefinitionVersion) {
    throw bindingError("activity task binding id and version must be frozen together");
  }
  return Object.freeze({ taskDefinitionId, taskDefinitionVersion });
}

function eventTransport(context = {}) {
  if (typeof context.getEventTransport === "function") return context.getEventTransport();
  return context.eventTransport || null;
}

function stageEnvelope(data, envelope, context) {
  const transport = eventTransport(context);
  if (transport && typeof transport.stageOutbox === "function") {
    return transport.stageOutbox(envelope);
  }
  return stageOutboxEnvelope(data, envelope);
}

/**
 * Runs one Activity enrollment mutation and stages all task-source facts emitted
 * by that mutation. The caller must execute this Interface inside the request
 * transaction seam. Staging failures are marked atomic so the HTTP layer cannot
 * convert them into a committed handled error.
 */
function executeActivityTaskWrite(data, context = {}, mutate) {
  if (!data || typeof data !== "object" || typeof mutate !== "function") {
    throw bindingError("activity task write input is invalid");
  }
  const beforeIds = new Set((data.activityEnrollmentEvents || []).map((event) => (
    event.activity_enrollment_event_id
  )));
  const result = mutate();
  const emitted = (data.activityEnrollmentEvents || []).filter((event) => (
    !beforeIds.has(event.activity_enrollment_event_id) && taskTransition(event)
  ));
  try {
    emitted.forEach((enrollmentEvent) => {
      const binding = resolveFrozenBinding(data, enrollmentEvent);
      if (!binding) return;
      const envelope = buildActivityTaskOutboxEnvelope({ enrollmentEvent, binding }, {
        producerVersion: context.producerVersion,
        correlationId: context.correlationId,
        releaseId: context.releaseId,
      });
      if (envelope) stageEnvelope(data, envelope, context);
    });
  } catch (error) {
    throw atomicWriteFailure(error);
  }
  return result;
}

module.exports = Object.freeze({
  executeActivityTaskWrite,
  resolveFrozenBinding,
});
