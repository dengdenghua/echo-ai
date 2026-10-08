import { fileURLToPath } from "node:url";
import {
  devSettings,
  inspectDevSetup,
  inspectDevPorts,
  probeOwnedService,
  assertPortFree,
} from "./dev-instance.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const settings = devSettings(root, "ai");
try {
  const probe = process.argv.indexOf("--probe");
  const available = process.argv.indexOf("--port-free");
  if (probe !== -1) {
    const name = process.argv[probe + 1];
    if (!["backend", "frontend"].includes(name))
      throw new Error("Select backend or frontend");
    const status = await probeOwnedService(
      settings.ports[name],
      settings.identity,
      { frontend: name === "frontend" },
    );
    console.info(JSON.stringify(status));
    process.exitCode = status.ready && !status.restartRequired ? 0 : 1;
  } else if (available !== -1) {
    const name = process.argv[available + 1];
    if (!(name in settings.ports))
      throw new Error("Select backend, frontend or tentacle");
    await assertPortFree(settings.ports[name]);
    console.info(JSON.stringify({ free: true }));
  } else {
    const report = inspectDevSetup(settings);
    report.portStatus = await inspectDevPorts(settings);
    for (const name of ["backend", "frontend"]) {
      if (report.portStatus[name].state === "occupied")
        report.errors.push(
          name + " port belongs to an unverified service; choose another port",
        );
    }
    if (
      report.portStatus.tentacle.state === "occupied" &&
      report.portStatus.backend.state !== "owned"
    )
      report.errors.push(
        "Tentacle port is occupied; choose another ECHO_TENTACLE_WS_PORT",
      );
    report.ok = report.errors.length === 0;
    console.info(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  }
} catch (error) {
  console.info(JSON.stringify({ ok: false, errors: [error.message] }));
  process.exitCode = 1;
}
