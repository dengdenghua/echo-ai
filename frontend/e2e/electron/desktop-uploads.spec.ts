import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

test("desktop forwards multipart spreadsheets with Unicode filenames intact", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "echo-upload-"));
  const bodies: Buffer[] = [];
  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url?.endsWith("/uploads")) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      bodies.push(Buffer.concat(chunks));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ files: [] }));
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const app = await electron.launch({
    args: [
      path.resolve("electron/main.cjs"),
      "--smoke-test",
      `--user-data-dir=${profile}`,
    ],
    cwd: path.resolve(".."),
    env: {
      ...process.env,
      ECHO_PET_DISABLED: "1",
      ECHO_BACKEND_URL: `http://127.0.0.1:${address.port}`,
    },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const result = await page.evaluate(
      () =>
        new Promise<{ status: number; text: string }>((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/threads/upload-test/uploads");
          xhr.onload = () =>
            resolve({ status: xhr.status, text: xhr.responseText });
          xhr.onerror = () => resolve({ status: 0, text: "network error" });
          const form = new FormData();
          form.append(
            "files",
            new File(
              [new Uint8Array([80, 75, 3, 4, 0, 255, 128])],
              "2LAW\u00a0设计规格书_20240709(2)(1).xlsx",
              {
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              },
            ),
          );
          xhr.send(form);
        }),
    );
    expect(result.status, result.text).toBe(200);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.toString("utf8")).toContain(
      "2LAW\u00a0设计规格书_20240709(2)(1).xlsx",
    );
    expect(bodies[0]!.includes(Buffer.from([80, 75, 3, 4, 0, 255, 128]))).toBe(
      true,
    );
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(profile, { recursive: true, force: true });
  }
});
