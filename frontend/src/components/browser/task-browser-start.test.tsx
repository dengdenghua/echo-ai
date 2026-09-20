import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskBrowserStart, resolveBrowserInput } from "./task-browser-start";

describe("task browser start", () => {
  it("resolves websites, local services, blank pages and search terms", () => {
    expect(resolveBrowserInput(" example.com/docs ")).toBe("https://example.com/docs");
    expect(resolveBrowserInput("localhost:3310")).toBe("http://localhost:3310");
    expect(resolveBrowserInput("127.0.0.1:8000/test")).toBe("http://127.0.0.1:8000/test");
    expect(resolveBrowserInput("about:blank")).toBe("about:blank");
    expect(resolveBrowserInput("research notes", "https://www.google.com/search?q=")).toBe("https://www.google.com/search?q=research%20notes");
    expect(resolveBrowserInput(" ")).toBe("");
  });

  it("submits the central input and opens a recent page", async () => {
    const onNavigate = vi.fn();
    render(<TaskBrowserStart onNavigate={onNavigate} recentPages={[{url: "https://example.com", title: "Research"}]} />);
    const user = userEvent.setup();
    expect(screen.getByRole("button", {name: "打开"})).toBeDisabled();
    await user.type(screen.getByRole("textbox", {name: "输入网址或搜索"}), "market outlook{Enter}");
    expect(onNavigate).toHaveBeenCalledWith("market outlook");
    await user.click(screen.getByRole("button", {name: "Research"}));
    expect(onNavigate).toHaveBeenCalledWith("https://example.com");
  });
});

it("uses the shared home while retaining service navigation", async () => {
  const onNavigate = vi.fn();
  render(<TaskBrowserStart onNavigate={onNavigate} recentPages={[]}
    renderHome={(navigate, services) => <section aria-label="Shared home"><button onClick={() => navigate("https://example.com")}>Visit</button>{services}</section>}>
    <button>Scan services</button>
  </TaskBrowserStart>);
  expect(screen.queryByText("从这里开始浏览")).not.toBeInTheDocument();
  expect(screen.getByRole("button", {name: "Scan services"})).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", {name: "Visit"}));
  expect(onNavigate).toHaveBeenCalledWith("https://example.com");
});
