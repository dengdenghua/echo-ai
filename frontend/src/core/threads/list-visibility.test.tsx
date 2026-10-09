import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../api", () => ({
  getAPIClient: () => ({
    threads: {
      setListVisibility: mocks.set,
      delete: mocks.remove,
    },
  }),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
import { useThreadListVisibility } from "./hooks";

beforeEach(() => vi.clearAllMocks());
function setup() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  client.setQueryData(["threads", "search"], [{ thread_id: "shared" }]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    ...renderHook(() => useThreadListVisibility(), { wrapper }),
  };
}

describe("personal list removal", () => {
  it("hides without deleting and offers a persisted undo", async () => {
    mocks.set.mockResolvedValue({ thread_id: "shared", hidden: true });
    const { result, client } = setup();
    const onSuccess = vi.fn();
    act(() => result.current.mutate({ threadId: "shared" }, { onSuccess }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(mocks.set).toHaveBeenCalledWith("shared", true);
    expect(mocks.remove).not.toHaveBeenCalled();
    const options = mocks.success.mock.calls[0]![1];
    options.action.onClick();
    await waitFor(() =>
      expect(mocks.set).toHaveBeenLastCalledWith("shared", false),
    );
    expect(client.getQueryState(["threads", "search"])?.isInvalidated).toBe(
      true,
    );
    client.clear();
  });

  it("keeps rows and the current route when persistence fails", async () => {
    mocks.set.mockRejectedValueOnce(new Error("offline"));
    const { result, client } = setup();
    const onSuccess = vi.fn();
    act(() => result.current.mutate({ threadId: "shared" }, { onSuccess }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(["threads", "search"])).toEqual([
      { thread_id: "shared" },
    ]);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    client.clear();
  });

  it("restores from the removed list without deleting", async () => {
    mocks.set.mockResolvedValueOnce({ thread_id: "shared", hidden: false });
    const { result, client } = setup();
    await act(() =>
      result.current.mutateAsync({ threadId: "shared", hidden: false }),
    );
    expect(mocks.set).toHaveBeenCalledWith("shared", false);
    expect(mocks.remove).not.toHaveBeenCalled();
    client.clear();
  });
});
