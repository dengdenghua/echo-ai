const { ipcRenderer } = require("electron");
window.addEventListener("DOMContentLoaded", () => {
  let lastPulse = "";
  ipcRenderer.on("automation:feedback", (_event, event) => {
    const labels = { click: "点击", move: "移动", type: "输入", key: "按键" };
    const phase = event.phase === "active" ? "正在" : event.phase === "error" ? "未完成" : "已";
    document.getElementById("label").textContent =
      event.phase === "error" ? "AI · 操作未完成" : "AI · " + phase + (labels[event.kind] || "操作");
    document.body.dataset.phase = event.phase;
    document.body.dataset.side = event.side;
    const pulse = event.id + event.phase;
    if (event.kind === "click" && event.phase === "done" && lastPulse !== pulse) {
      const ring = document.getElementById("ripple");
      ring.classList.remove("pulse");
      void ring.offsetWidth;
      ring.classList.add("pulse");
    }
    lastPulse = pulse;
  });
});

