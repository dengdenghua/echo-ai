import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { EchoAPIError } from "../api/client";

const mocks = vi.hoisted(() => ({ remove: vi.fn(), error: vi.fn() }));
vi.mock("../api", () => ({
  getAPIClient: () => ({ threads: { delete: mocks.remove } }),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
import { useDeleteThread } from "./hooks";

describe("thread deletion", () => {
  it("restores the list and reports a project conflict without invoking success navigation", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const queryKey = ["threads", "search", "project"];
    const threads = [
      { thread_id: "bound-thread" },
      { thread_id: "other-thread" },
    ];
    client.setQueryData(queryKey, threads);
    let reject!: (error: unknown) => void;
    mocks.remove.mockImplementationOnce(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDeleteThread(), { wrapper });
    const onSuccess = vi.fn();
    act(() =>
      result.current.mutate({ threadId: "bound-thread" }, { onSuccess }),
    );
    await waitFor(() =>
      expect(client.getQueryData(queryKey)).toEqual([
        { thread_id: "other-thread" },
      ]),
    );
    await act(async () =>
      reject(
        new EchoAPIError("Conflict", 409, { code: "THREAD_PROJECT_BOUND" }),
      ),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(queryKey)).toEqual(threads);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("项目"), {
      duration: 8000,
    });
    client.clear();
  });
});
