import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("application copy writes the real system clipboard without granting website reads", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "echo-clipboard-"));
  const executablePath = process.env.ECHO_TEST_EXECUTABLE;
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      ...(executablePath ? [] : [path.resolve("electron/main.cjs")]),
      "--smoke-test",
      "--hidden",
      `--user-data-dir=${root}`,
    ],
    env: { ...process.env, ECHO_PET_DISABLED: "1" },
    cwd: path.resolve(".."),
  });
  let previous: Array<{ format: string; data: number[] }> | null = null;
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    // Preserve every existing clipboard format; never print the user's contents.
    previous = await app.evaluate(({ clipboard }) =>
      clipboard
        .availableFormats()
        .map((format) => ({ format, data: [...clipboard.readBuffer(format)] })),
    );
    const text = "Echo 复制验收\n\n**完整消息**\n```ts\nconst value = 42;\n```";
    expect(
      await win.evaluate(
        async (value) => window.echo?.clipboard?.writeText(value),
        text,
      ),
    ).toEqual({ ok: true });
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      text,
    );
    expect(
      await win.evaluate(() => Object.keys(window.echo?.clipboard ?? {})),
    ).toEqual(["writeText"]);
    const rejected = await win.evaluate(async () =>
      window.echo?.clipboard?.writeText({ text: "wrong type" } as never),
    );
    expect(rejected?.ok).toBe(false);
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      text,
    );
    // Navigating the host away from Echo must revoke the privileged write path.
    await win.goto("data:text/html,<title>Untrusted page</title>");
    expect(
      (
        await win.evaluate(async () =>
          window.echo?.clipboard?.writeText("must not copy"),
        )
      )?.ok,
    ).toBe(false);
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      text,
    );
  } finally {
    if (previous)
      await app.evaluate(({ clipboard }, entries) => {
        clipboard.clear();
        for (const entry of entries)
          clipboard.writeBuffer(entry.format, Buffer.from(entry.data));
      }, previous);
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
