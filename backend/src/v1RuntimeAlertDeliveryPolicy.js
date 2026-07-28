const RUNTIME_ALERT_DELIVERY_SLO_BY_SEVERITY = Object.freeze({
  BLOCKER: Object.freeze({
    sloClass: "BLOCKER_IMMEDIATE",
    sloTargetSeconds: 300,
  }),
  WARNING: Object.freeze({
    sloClass: "WARNING_STANDARD",
    sloTargetSeconds: 1800,
  }),
});

function runtimeAlertDeliverySloForSeverity(severity) {
  return RUNTIME_ALERT_DELIVERY_SLO_BY_SEVERITY[severity] || null;
}

module.exports = {
  RUNTIME_ALERT_DELIVERY_SLO_BY_SEVERITY,
  runtimeAlertDeliverySloForSeverity,
};
