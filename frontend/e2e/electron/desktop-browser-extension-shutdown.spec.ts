import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("desktop exits with a pending extension toolbar refresh", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "echo-extension-shutdown-"));
  const folder = path.join(root, "extension");
  await mkdir(folder);
  await writeFile(
    path.join(folder, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Shutdown probe",
      version: "1.0.0",
      action: { default_title: "Shutdown probe" },
    }),
  );
  const app = await electron.launch({
    args: [
      path.resolve("electron/main.cjs"),
      "--hidden",
      `--user-data-dir=${root}/profile`,
    ],
    env: {
      ...process.env,
      ELECTRON_START_URL: "about:blank",
      ECHO_DATA_DIR: root,
      ECHO_PET_DISABLED: "1",
    },
  });
  const child = app.process();
  try {
    const win = await app.firstWindow();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, folder);
    const installed = await win.evaluate(() =>
      window.echo!.extensions.installFromFolder(),
    );
    expect(installed.ok).toBe(true);
    await win.evaluate(
      (id) => window.echo!.extensions.setPinned(id, false),
      installed.extension!.id,
    );
    await app.close();
    expect(child.exitCode).toBe(0);
  } finally {
    if (child.exitCode === null) await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
