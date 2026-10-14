import { act, render } from "@testing-library/react";
import { toast } from "sonner";
import { expect, it } from "vitest";

import { Toaster } from "./sonner";

it("mounts toasts on <body>, outside the #root stacking context", async () => {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  const { unmount } = render(<Toaster />, { container: root });

  act(() => {
    toast("saved");
  });

  const toaster = await new Promise<Element | null>((resolve) =>
    setTimeout(
      () => resolve(document.querySelector("[data-sonner-toaster]")),
      0,
    ),
  );
  expect(toaster).not.toBeNull();
  expect(root.contains(toaster)).toBe(false);

  unmount();
  root.remove();
});
