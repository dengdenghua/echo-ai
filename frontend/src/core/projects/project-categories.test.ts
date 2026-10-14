import { describe, expect, it } from "vitest";

import {
  PROJECT_CATEGORY_PRESETS,
  projectCategoryLabel,
} from "./project-categories";
import { projectIconId } from "./project-icons";

const copy = {
  categoryInvest: "投资",
  categoryHomework: "作业",
  categoryWriting: "写作",
  categoryTravel: "旅行",
};

describe("project categories", () => {
  it("translates preset ids and shows other stored labels as is", () => {
    expect(projectCategoryLabel("travel", copy)).toBe("旅行");
    expect(projectCategoryLabel(" investment ", copy)).toBe("投资");
    expect(projectCategoryLabel("side project", copy)).toBe("side project");
  });

  it("has no label without a category", () => {
    expect(projectCategoryLabel(null, copy)).toBeNull();
    expect(projectCategoryLabel(undefined, copy)).toBeNull();
    expect(projectCategoryLabel("  ", copy)).toBeNull();
  });

  it("pairs every preset with a known line icon", () => {
    for (const preset of PROJECT_CATEGORY_PRESETS) {
      expect(projectIconId(preset.icon)).toBe(preset.icon);
    }
  });
});
