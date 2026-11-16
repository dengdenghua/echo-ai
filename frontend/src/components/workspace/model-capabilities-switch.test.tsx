import { expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/harness";
import { ModelContextSetting } from "./model-picker";

it("replaces context on model switch and distinguishes unknown and API-only capacity", () => {
  const onChange=vi.fn();
  const view=renderWithProviders(<ModelContextSetting models={[]} selected={{name:"one",context_window:128000}} onChange={onChange}/>,{locale:"zh-CN"});
  expect(screen.getByText("128K")).toBeInTheDocument();
  view.rerender(<ModelContextSetting models={[]} selected={{name:"two",context_window:1000000}} onChange={onChange}/>);
  expect(screen.getByText("1M")).toBeInTheDocument();
  expect(screen.queryByText("128K")).toBeNull();
  view.rerender(<ModelContextSetting models={[]} selected={{name:"subscription",context_window:1050000,context_source:"official_api"}} onChange={onChange}/>);
  expect(screen.getByText("1.05M（官方 API 上限）")).toBeInTheDocument();
  view.rerender(<ModelContextSetting models={[]} selected={{name:"unknown"}} onChange={onChange}/>);
  expect(screen.getByText("由引擎管理（未上报上限）")).toBeInTheDocument();
  expect(screen.queryByText("256K")).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});
