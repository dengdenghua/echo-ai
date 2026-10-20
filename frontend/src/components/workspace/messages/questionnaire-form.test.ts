import { describe, expect, it } from "vitest";
import { questionnaireCopy } from "@/core/i18n/locales/questionnaire";
import { questionnaireForm } from "./questionnaire-form";

const copy = questionnaireCopy("zh-CN");
const receipt = { ok: true, type: "clarification_questionnaire", questions: [{ title: "用途", options: ["成像", "投影"], multiple: false }] };

describe("legacy questionnaire conversion", () => {
  it("keeps free text and uncertainty without submitting defaults", () => {
    const document = questionnaireForm({ ...receipt, questions: [...receipt.questions, { title: "备注", options: [] }] }, copy);
    const form = document?.blocks[0];
    expect(form?.type).toBe("form");
    if (form?.type !== "form") throw new Error("missing form");
    expect(form.fields[0]?.options).toEqual(["成像", "投影", copy.undecidedOption]);
    expect(form.fields[1]?.type).toBe("text");
    expect(form.fields[2]).toMatchObject({ label: "备注", type: "textarea" });
  });

  it.each([
    "请确认：成像、投影",
    { ...receipt, ok: false },
    { ...receipt, thread_id: "private-member" },
    { ...receipt, questions: [{ ...receipt.questions[0], multiple: true }] },
    { ...receipt, questions: [{ title: "用途", options: [{ label: "成像", description: "保留详细描述" }, "投影"] }] },
  ])("does not replace rejected, foreign, prose or richer questionnaires", (value) => {
    expect(questionnaireForm(value, copy, "current")).toBeNull();
  });
});
