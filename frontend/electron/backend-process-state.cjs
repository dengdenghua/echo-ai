/** Process evidence is separate from HTTP readiness: a slow boot is not a failure. */
function manageBackend({ spawnBackend, killBackend }) {
  let state = { state: "starting" };
  let observed = null;
  let generation = 0;
  const failed = (reason, exitCode = null) => {
    state = { state: "failed", reason, exitCode };
  };
  async function start(...args) {
    const current = ++generation;
    observed = null;
    state = { state: "starting" };
    try {
      const child = await spawnBackend(...args);
      if (current !== generation) return child;
      observed = child;
      state = { state: "running" };
      child.once("error", () => {
        if (observed === child) failed("spawn-error");
      });
      child.once("exit", (code) => {
        if (observed === child) failed("process-exit", code);
      });
      if (child.exitCode != null || child.signalCode != null) {
        failed("process-exit", child.exitCode ?? null);
      }
      return child;
    } catch (error) {
      if (current === generation) failed("spawn-error");
      throw error;
    }
  }
  return {
    start,
    restart(...args) {
      observed = null;
      state = { state: "starting" };
      killBackend();
      return start(...args);
    },
    getStatus: () => ({ ...state }),
  };
}

module.exports = { manageBackend };
