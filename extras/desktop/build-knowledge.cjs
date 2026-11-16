// Build the separately versioned knowledge runtime; never use OS's legacy
// echo-storage file-browser command or install packages in the host runtime.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const repo = path.resolve(__dirname, "../..");
const source = path.resolve(repo, "../echo-storage");
const python = path.join(source, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!fs.existsSync(python)) throw new Error("Prepare the echo-storage locked build environment before packaging.");
const output = path.join(__dirname, "build", "knowledge-runtime");
const result = spawnSync(python, ["-m", "PyInstaller", "--noconfirm", "--distpath", output, "--workpath", path.join(__dirname, "build", "knowledge-work"), path.join(source, "packaging", "echo-storage.spec")], { cwd: source, stdio: "inherit", windowsHide: true });
if (result.status !== 0) process.exit(result.status || 1);
const binary = path.join(output, "echo-storage", process.platform === "win32" ? "echo-storage.exe" : "echo-storage");
if (!fs.existsSync(binary)) throw new Error("Knowledge runtime build did not produce an executable");
