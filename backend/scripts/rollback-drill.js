#!/usr/bin/env node

const { runProductionRollbackDrill } = require("../src/productionRollbackDrill");

runProductionRollbackDrill()
  .then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "PASS") process.exitCode = 1;
  })
  .catch((error) => {
    console.error(JSON.stringify({ status: "ERROR", message: error.message }, null, 2));
    process.exitCode = 1;
  });
