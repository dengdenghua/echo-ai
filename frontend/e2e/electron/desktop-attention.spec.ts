import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("native notification crosses preload IPC and routes its click event", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "echo-attention-"));
  const app = await electron.launch({
    args: [
      path.join(repo, "frontend/electron/main.cjs"),
      "--smoke-test",
      `--user-data-dir=${profile}`,
    ],
    cwd: repo,
    env: { ...process.env, ECHO_PET_DISABLED: "1" },
  });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    expect(
      await win.evaluate(() => window.echo!.notifications.isSupported()),
    ).toBe(true);

    // Observe the real native Notification; keep show() and its OS callbacks.
    await app.evaluate(({ Notification }) => {
      const original = Notification.prototype.show;
      const state = {
        note: null as Electron.Notification | null,
        outcome: "pending",
        error: "",
      };
      Object.assign(globalThis, { echoAttentionSmoke: state });
      Notification.prototype.show = function () {
        state.note = this;
        this.once("show", () => {
          state.outcome = "shown";
        });
        this.once("failed", (_event, error) => {
          state.outcome = "failed";
          state.error = error;
        });
        original.call(this);
      };
    });
    await win.evaluate(() => {
      window.echo!.on("notification:clicked", (payload) => {
        Object.assign(window, { echoAttentionClick: payload });
      });
    });
    const receipt = await win.evaluate(() =>
      window.echo!.notifications.show({
        title: "Echo 收尾验收通知",
        body: "验证桌面通知与任务路由",
        tag: "closure-attention-smoke",
        href: "/workspace/realtime/closure-attention",
        threadId: "closure-attention",
        silent: true,
      }),
    );
    expect(receipt).toEqual({ ok: true, id: "closure-attention-smoke" });
    await expect
      .poll(
        () =>
          app.evaluate(() => {
            const state = (
              globalThis as typeof globalThis & {
                echoAttentionSmoke: { outcome: string; error: string };
              }
            ).echoAttentionSmoke;
            return { outcome: state.outcome, error: state.error };
          }),
        { timeout: 15_000 },
      )
      .toEqual({ outcome: "shown", error: "" });

    // Emit on the real instance to verify the main-process click handler.
    // This verifies routing; it does not claim a physical Windows click.
    await app.evaluate(() => {
      const state = (
        globalThis as typeof globalThis & {
          echoAttentionSmoke: { note: Electron.Notification };
        }
      ).echoAttentionSmoke;
      state.note.emit("click", {});
      state.note.close();
    });
    await expect
      .poll(() =>
        win.evaluate(
          () =>
            (window as Window & { echoAttentionClick?: unknown })
              .echoAttentionClick,
        ),
      )
      .toEqual({
        href: "/workspace/realtime/closure-attention",
        threadId: "closure-attention",
        tag: "closure-attention-smoke",
      });
  } finally {
    await app
      .evaluate(() => {
        const state = (
          globalThis as typeof globalThis & {
            echoAttentionSmoke?: { note: Electron.Notification | null };
          }
        ).echoAttentionSmoke;
        state?.note?.close();
      })
      .catch(() => {});
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
