import { expect, it } from "vitest";
import { conversationImageURL } from "./conversation-file";

it.each([
  "D:/工程/previews/渲染 #1.png",
  "file:///D:/%E5%B7%A5%E7%A8%8B/previews/%E6%B8%B2%E6%9F%93%20%231.png",
])(
  "routes local image paths through the scoped preview endpoint: %s",
  (path) => {
    const result = new URL(
      conversationImageURL(path, "t", "D:/工程"),
      "http://localhost",
    );
    expect(result.pathname).toBe("/api/fs/preview");
    expect(result.searchParams.get("path")).toBe(
      "D:/工程/previews/渲染 #1.png",
    );
    expect(result.searchParams.get("thread_id")).toBe("t");
  },
);

it("preserves a relative path for unique scoped resolution", () => {
  const result = new URL(
    conversationImageURL("previews/render.png", "t", "D:/project"),
    "http://localhost",
  );
  expect(result.searchParams.get("path")).toBe(
    "D:/project/previews/render.png",
  );
  expect(result.searchParams.get("reference")).toBe("previews/render.png");
});

it("resolves nested output paths without dropping their directory", () => {
  expect(conversationImageURL("./output/charts/render.png", "t")).toContain(
    "/api/threads/t/outputs/charts/render.png?area=output",
  );
});

it.each([
  "https://cdn.example/render.png",
  "data:image/png;base64,AA==",
  "blob:render",
  "/api/fs/preview?path=a.png",
])("leaves web and already resolved sources alone: %s", (src) => {
  expect(conversationImageURL(src, "t")).toBe(src);
});
