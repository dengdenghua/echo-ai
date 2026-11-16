const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron, chromium } = require("@playwright/test");

// Requires a backend with local dev login enabled (default :8310):
//   ECHO_ENV=development ECHO_DEPLOYMENT_MODE=local python -m runtime serve --port 8310
// Usage: pnpm --dir frontend audit:a11y
// CI/web: ECHO_A11Y_TARGET=web ECHO_A11Y_BASE_URL=http://127.0.0.1:4173 \
//   pnpm --dir frontend audit:a11y
const frontend = path.resolve(__dirname, "..");
const backendUrl = process.env.ECHO_A11Y_BACKEND_URL ?? "http://127.0.0.1:8310";
const target = process.env.ECHO_A11Y_TARGET ?? "electron";
const baseUrl = (
  process.env.ECHO_A11Y_BASE_URL ?? "http://127.0.0.1:4173"
).replace(/\/$/, "");
const axeSource = fs.readFileSync(
  require.resolve("axe-core/axe.min.js"),
  "utf8",
);
const theme = process.env.ECHO_A11Y_THEME ?? "light";
const locale = process.env.ECHO_A11Y_LOCALE ?? "zh-CN";
const uiLabels = {
  "zh-CN": {
    addConnection: "添加连接",
    share: "分享",
    qr: /二维码|QR/,
    copyLink: "复制链接",
    browser: /浏览器/,
  },
  "en-US": {
    addConnection: "Add connection",
    share: "Share",
    qr: /QR code|QR/i,
    copyLink: "Copy link",
    browser: /Browser/i,
  },
  "ja-JP": {
    addConnection: "接続を追加",
    share: "共有",
    qr: /QRコード|QR/i,
    copyLink: "リンクをコピー",
    browser: /ブラウザ/,
  },
  "ko-KR": {
    addConnection: "연결 추가",
    share: "공유",
    qr: /QR 코드|QR/i,
    copyLink: "링크 복사",
    browser: /브라우저/,
  },
};
const ui = uiLabels[locale] ?? uiLabels["zh-CN"];

function decodeActor(token) {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

async function audit(target, label) {
  await target.evaluate(axeSource);
  return target.evaluate(async (name) => {
    const results = await axe.run(document, {
      resultTypes: ["violations"],
      rules: { "color-contrast": { enabled: true } },
    });
    return {
      page: name,
      url: window.location.href,
      themeClass: document.documentElement.className,
      lang: document.documentElement.lang,
      violations: results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.length,
        targets: violation.nodes.slice(0, 4).map((node) => node.target),
        html: violation.nodes.slice(0, 4).map((node) => node.html),
        summaries: violation.nodes
          .slice(0, 2)
          .map((node) => node.failureSummary),
        texts: violation.nodes.slice(0, 4).map((node) => {
          const element = document.querySelector(node.target[0]);
          return element ? element.innerText : null;
        }),
      })),
    };
  }, label);
}

const LAYOUT_ONLY_VIOLATIONS = new Set([
  "landmark-one-main",
  "page-has-heading-one",
]);

async function auditWithRetry(win, label) {
  let report = await audit(win, label);
  for (
    let attempt = 0;
    attempt < 2 &&
    report.violations.length > 0 &&
    report.violations.every((violation) =>
      LAYOUT_ONLY_VIOLATIONS.has(violation.id),
    );
    attempt += 1
  ) {
    await win.waitForTimeout(3000);
    report = await audit(win, label);
  }
  return report;
}

function record(keyboardChecks, name, pass, detail = "") {
  keyboardChecks.push({ name, pass, detail });
}

async function focusInside(target, selector) {
  return target.evaluate((sel) => {
    const root = document.querySelector(sel);
    return Boolean(root && root.contains(document.activeElement));
  }, selector);
}

(async () => {
  const login = await (
    await fetch(`${backendUrl}/api/auth/local/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "123", password: "" }),
    })
  ).json();
  const scope = decodeActor(login.access_token);
  if (!scope) throw new Error("local login token has no subject");
  const probe = await fetch(`${backendUrl}/api/threads`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${login.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: "a11y probe" }),
  }).then((response) => (response.ok ? response.json() : null));
  const probeThreadId = probe?.thread_id ?? null;

  let win;
  let close;
  if (target === "web") {
    const browser = await chromium.launch({
      channel: process.env.ECHO_A11Y_BROWSER_CHANNEL || undefined,
    });
    win = await browser.newPage();
    close = () => browser.close();
    await win.goto(`${baseUrl}/#/login`, { waitUntil: "domcontentloaded" });
    if (locale !== "zh-CN") {
      const wanted = locale.split("-")[0];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await win
          .waitForFunction(() => location.hostname === "localhost", {
            timeout: 3000,
          })
          .catch(() => undefined);
        await win.evaluate((value) => {
          document.cookie = `locale=${encodeURIComponent(value)}; max-age=31536000; path=/; SameSite=Lax`;
        }, locale);
        await win.reload({ waitUntil: "domcontentloaded" });
        await win.waitForTimeout(600);
        const lang = await win.evaluate(() => document.documentElement.lang);
        if (lang === wanted) break;
      }
    }
  } else {
    const app = await electron.launch({
      args: [
        path.join(frontend, "electron", "main.cjs"),
        "--smoke-test",
        `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "echo-a11y-"))}`,
      ],
      cwd: frontend,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
        ECHO_PET_DISABLED: "1",
        ECHO_BACKEND_URL: backendUrl,
      },
    });
    win = await app.firstWindow();
    close = () => app.close();
  }
  await win.route(/\/api\/threads\/[^/]+\/shares$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        token: "a11y-probe-token",
        share_id: "a11y-probe-share",
        share_path: "/s/a11y-probe",
        share_url: "https://example.com/s/a11y-probe",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      }),
    });
  });
  if (process.env.ECHO_A11Y_SEED_MODELS === "1") {
    await win.route(/\/api\/llm-models(?:\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [
            {
              id: "a11y-probe-model",
              name: "a11y-probe-model",
              model: "a11y-probe-model",
              display_name: "A11y Probe Model",
              provider: "openai",
              supports_tool_use: true,
              supports_thinking: false,
              supports_vision: false,
              custom: true,
              entry_id: "a11y-probe",
              selection_id: "a11y-probe::a11y-probe-model",
              context_window: 128000,
            },
          ],
        }),
      }),
    );
  }
  const reports = [];
  const keyboardChecks = [];
  try {
    await win.setViewportSize({ width: 1440, height: 1000 });
    await win.waitForSelector("#root");
    await win.waitForTimeout(1200);
    await win.evaluate(() => {
      window.location.hash = "#/login";
    });
    await win.waitForTimeout(1200);
    reports.push(await audit(win, "login"));

    await win.evaluate(() => {
      window.location.hash = "#/register";
    });
    await win.waitForTimeout(1200);
    reports.push(await audit(win, "register"));

    await win.evaluate(
      ({ token, user, scope, theme: nextTheme }) => {
        sessionStorage.setItem("echo_auth_token", token);
        sessionStorage.setItem("echo_user", JSON.stringify(user));
        if (nextTheme === "dark") {
          localStorage.setItem("echo-theme", "dark");
          document.documentElement.classList.add("dark");
          document.documentElement.classList.remove("light");
        }
        localStorage.setItem(
          `echo:browser-state:${encodeURIComponent(scope)}`,
          JSON.stringify({
            tabs: [
              {
                id: "a11y_tab",
                url: "https://example.com/",
                title: "Example",
                isLoading: false,
                device: "desktop",
              },
            ],
            closedTabs: [],
            activeId: "a11y_tab",
            groups: [],
            split: null,
            copilotOpen: false,
            copilotWidth: 420,
            homeSeeded: true,
          }),
        );
      },
      { token: login.access_token, user: login.user, scope, theme },
    );

    const only = process.env.ECHO_A11Y_ROUTES?.split(",").filter(Boolean);
    for (const [label, hash, wait] of [
      ["workspace", "#/workspace/realtime", 6000],
      ["settings", "#/workspace/settings", 2500],
      ["settings-models", "#/workspace/settings?section=models", 3000],
      ["browser", "#/browser", 2500],
      ["design", "#/workspace/design", 6000],
      ["agents", "#/workspace/agents", 3000],
      ["knowledge", "#/workspace/knowledge", 3000],
      ["storage", "#/workspace/storage", 3000],
      ["plugins", "#/workspace/plugins", 3000],
      ["store", "#/workspace/store", 3000],
      ["observability", "#/workspace/observability", 3000],
      ["desktop", "#/desktop", 3000],
      ["apps-photos", "#/apps/photos", 3000],
      ["apps-media", "#/apps/media", 3000],
      ["agents-new", "#/workspace/agents/new", 3000],
      ["skills", "#/workspace/skills", 3000],
      ["community", "#/workspace/community", 3000],
      ["channels", "#/workspace/channels", 3000],
      ["architecture", "#/workspace/architecture", 3000],
      ["intelligence", "#/workspace/intelligence", 3000],
      ["evolution", "#/workspace/evolution", 3000],
      ["projects", "#/workspace/projects", 3000],
      ["mcp", "#/workspace/mcp", 3000],
      ["organizations", "#/workspace/organizations", 3000],
      ["devices", "#/workspace/devices", 3000],
      ["workspace-browser", "#/workspace/browser", 3000],
      ["computer", "#/workspace/computer", 3000],
      ["mobile", "#/workspace/mobile", 3000],
      ["terms", "#/terms", 1500],
      ["privacy", "#/privacy", 1500],
      ["about", "#/about", 1500],
      ...(probeThreadId
        ? [["thread-probe", `#/workspace/realtime/${probeThreadId}`, 4000]]
        : []),
    ]) {
      if (only && !only.includes(label)) continue;
      await win.evaluate((next) => {
        window.location.hash = next;
      }, hash);
      await win.reload();
      await win
        .locator('main, [role="main"]')
        .first()
        .waitFor({ timeout: 15000 })
        .catch(() => undefined);
      await win
        .locator("h1")
        .first()
        .waitFor({ timeout: 8000 })
        .catch(() => undefined);
      await win.waitForTimeout(wait);
      reports.push(await auditWithRetry(win, label));
      if (label === "workspace") {
        await win.evaluate(() => {
          window.dispatchEvent(new Event("echo:command-palette"));
        });
        await win.waitForTimeout(600);
        reports.push(await audit(win, "workspace-command-palette"));
        record(
          keyboardChecks,
          "command-palette:focused-on-open",
          await focusInside(win, '[role="dialog"]'),
        );
        await win.keyboard.press("Tab");
        await win.keyboard.press("Tab");
        await win.keyboard.press("Tab");
        record(
          keyboardChecks,
          "command-palette:focus-trapped",
          await focusInside(win, '[role="dialog"]'),
        );
        await win.keyboard.press("Escape");
        await win.waitForTimeout(300);
        record(
          keyboardChecks,
          "command-palette:escape-closes",
          (await win.locator('[role="dialog"]').count()) === 0,
        );
      }
      if (label === "thread-probe") {
        const composer = win
          .locator('textarea, [contenteditable="true"]')
          .first();
        if ((await composer.count()) > 0) {
          await composer.click();
          await win.waitForTimeout(300);
        }
        const picker = win.locator(
          '[data-testid="unified-model-trigger"], [data-testid="model-picker-trigger"]',
        );
        if ((await picker.count()) > 0) {
          await picker.first().click();
          await win.waitForTimeout(400);
          const menu = win.locator(
            '[data-testid="model-picker-menu"], [role="menu"]',
          );
          const opened = (await menu.count()) > 0;
          record(keyboardChecks, "model-picker:opens", opened);
          if (opened) {
            if (process.env.ECHO_A11Y_SEED_MODELS === "1") {
              record(
                keyboardChecks,
                "model-picker:seeded-model-listed",
                (await menu.getByText("A11y Probe Model").count()) > 0,
              );
            }
            record(
              keyboardChecks,
              "model-picker:focused-on-open",
              await focusInside(win, '[role="menu"]'),
            );
            await win.keyboard.type("gpt");
            record(
              keyboardChecks,
              "model-picker:search-keeps-focus",
              await focusInside(win, '[role="menu"]'),
            );
            await win.keyboard.press("Escape");
            await win.waitForTimeout(350);
            record(
              keyboardChecks,
              "model-picker:escape-closes",
              (await menu.count()) === 0,
            );
            record(
              keyboardChecks,
              "model-picker:focus-returns",
              await win.evaluate(
                () => document.activeElement?.tagName === "BUTTON",
              ),
            );
          }
        }
        const share = win.getByRole("button", { name: ui.share }).first();
        if ((await share.count()) > 0) {
          await share.click();
          await win.waitForTimeout(400);
          const menu = win.locator('[role="menu"]');
          const opened = (await menu.count()) > 0;
          record(keyboardChecks, "share-menu:opens", opened);
          if (opened) {
            record(
              keyboardChecks,
              "share-menu:focused-on-open",
              await focusInside(win, '[role="menu"]'),
            );
            await win.keyboard.press("ArrowDown");
            record(
              keyboardChecks,
              "share-menu:arrow-navigates",
              await focusInside(win, '[role="menu"]'),
            );
            await win.keyboard.press("Escape");
            await win.waitForTimeout(350);
            record(
              keyboardChecks,
              "share-menu:escape-closes",
              (await menu.count()) === 0,
            );
            record(
              keyboardChecks,
              "share-menu:focus-returns",
              await win.evaluate(
                () => document.activeElement?.tagName === "BUTTON",
              ),
            );
            await share.click();
            await win.waitForTimeout(300);
            const qrItem = win.getByRole("menuitem", { name: ui.qr });
            if ((await qrItem.count()) > 0) {
              await qrItem.first().click();
              await win.waitForTimeout(1500);
              const qrDialog = win.locator('[role="dialog"]');
              const qrOpen = (await qrDialog.count()) > 0;
              record(keyboardChecks, "share-qr:opens", qrOpen);
              if (qrOpen) {
                reports.push(await audit(win, "share-qr-dialog"));
                record(
                  keyboardChecks,
                  "share-qr:link-visible",
                  (await win.getByText("https://example.com/s/a11y-probe").count()) >
                    0,
                );
                record(
                  keyboardChecks,
                  "share-qr:copy-enabled",
                  await win
                    .getByRole("button", { name: ui.copyLink })
                    .first()
                    .isEnabled(),
                );
                const openButton = qrDialog.getByRole("button", {
                  name: ui.browser,
                });
                record(
                  keyboardChecks,
                  "share-qr:open-enabled",
                  (await openButton.count()) > 0
                    ? await openButton.first().isEnabled()
                    : false,
                );
                record(
                  keyboardChecks,
                  "share-qr:focused-on-open",
                  await focusInside(win, '[role="dialog"]'),
                );
                await win.keyboard.press("Escape");
                await win.waitForTimeout(400);
                record(
                  keyboardChecks,
                  "share-qr:escape-closes",
                  (await qrDialog.count()) === 0,
                );
              }
            }
          }
        }
      }
      if (label === "settings-models") {
        const addConnection = win.getByRole("button", {
          name: ui.addConnection,
        });
        if ((await addConnection.count()) > 0) {
          await addConnection.first().click();
          await win.waitForTimeout(400);
          const menu = win.locator('[role="menu"]');
          const opened = (await menu.count()) > 0;
          record(keyboardChecks, "settings-add-connection:opens", opened);
          if (opened) {
            record(
              keyboardChecks,
              "settings-add-connection:focused-on-open",
              await focusInside(win, '[role="menu"]'),
            );
            await win.keyboard.press("ArrowDown");
            record(
              keyboardChecks,
              "settings-add-connection:arrow-navigates",
              await focusInside(win, '[role="menu"]'),
            );
            await win.keyboard.press("Escape");
            await win.waitForTimeout(350);
            record(
              keyboardChecks,
              "settings-add-connection:escape-closes",
              (await menu.count()) === 0,
            );
            record(
              keyboardChecks,
              "settings-add-connection:focus-returns",
              await win.evaluate(
                () => document.activeElement?.tagName === "BUTTON",
              ),
            );
          }
        } else {
          record(
            keyboardChecks,
            "settings-add-connection:opens",
            false,
            "no trigger found",
          );
        }
      }
      if (label === "skills") {
        const card = win.locator('[role="listitem"] button.text-left').first();
        if ((await card.count()) > 0) {
          await card.click();
          await win.waitForTimeout(500);
          const dialog = win.locator('[role="dialog"]');
          const opened = (await dialog.count()) > 0;
          record(keyboardChecks, "skill-detail:opens", opened);
          if (opened) {
            reports.push(await audit(win, "skills-detail-dialog"));
            record(
              keyboardChecks,
              "skill-detail:focused-on-open",
              await focusInside(win, '[role="dialog"]'),
            );
            await win.keyboard.press("Tab");
            await win.keyboard.press("Tab");
            record(
              keyboardChecks,
              "skill-detail:focus-trapped",
              await focusInside(win, '[role="dialog"]'),
            );
            await win.keyboard.press("Escape");
            await win.waitForTimeout(400);
            record(
              keyboardChecks,
              "skill-detail:escape-closes",
              (await dialog.count()) === 0,
            );
            record(
              keyboardChecks,
              "skill-detail:focus-returns",
              await win.evaluate(
                () => document.activeElement?.tagName === "BUTTON",
              ),
            );
          }
        } else {
          record(keyboardChecks, "skill-detail:opens", false, "no card found");
        }
      }
      if (label === "design") {
        const frame = win
          .frames()
          .find((candidate) =>
            candidate.url().includes("workbench-packages/design"),
          );
        if (frame) {
          reports.push(await audit(frame, "design-iframe"));
        }
      }
    }
  } finally {
    if (probeThreadId) {
      await fetch(`${backendUrl}/api/threads/${probeThreadId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${login.access_token}` },
      }).catch(() => undefined);
    }
    await close();
  }
  console.log(JSON.stringify({ theme, locale, reports, keyboardChecks }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
