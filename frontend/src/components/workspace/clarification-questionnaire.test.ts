import { describe, expect, test } from "vitest";

import { extractClarificationQuestionnaire } from "./clarification-questionnaire";

/**
 * ``extractClarificationQuestionnaire`` grew a second extraction path: tool
 * results can arrive welded to surrounding prose, so the payload has to be
 * fished out of a larger text blob by scanning for a balanced JSON object.
 * These cases pin that scan — especially the places a naive brace counter
 * gets it wrong.
 */
function questionnaireJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "clarification_questionnaire",
    title: "澄清需求",
    questions: [
      {
        id: "q1",
        title: "目标平台？",
        options: [
          { value: "a", label: "A 方案" },
          { value: "b", label: "B 方案" },
        ],
      },
    ],
    ...overrides,
  });
}

function questionWith(label: string, otherLabel: string) {
  return {
    questions: [
      {
        id: "q1",
        title: "写法？",
        options: [
          { value: "a", label },
          { value: "b", label: otherLabel },
        ],
      },
    ],
  };
}

describe("extractClarificationQuestionnaire · embedded payload", () => {
  test("fishes a payload out of surrounding prose", () => {
    const content = `我先确认几个关键点。\n\n工具返回：{"ok":true,"output":${questionnaireJson()}}\n\n以上。`;

    const result = extractClarificationQuestionnaire(content);

    expect(result?.payload.questions[0]?.title).toBe("目标平台？");
    expect(result?.payload.title).toBe("澄清需求");
    expect(result?.visibleContent).toContain("我先确认几个关键点。");
    expect(result?.visibleContent).not.toContain("clarification_questionnaire");
  });

  test("is not fooled by a closing brace inside a string", () => {
    // A naive depth counter ends the object at the "}" inside the title,
    // produces a slice that doesn't parse, and gives up.
    const json = questionnaireJson({ title: "目标}平台{a" });
    const content = `说明文字\n{"wrapper":${json}}\n结尾`;

    const result = extractClarificationQuestionnaire(content);

    expect(result?.payload.title).toBe("目标}平台{a");
  });

  test("is not fooled by an escaped quote inside a string", () => {
    const json = questionnaireJson(
      questionWith('用 "引号" 包起来', "用反斜杠 \\ 收尾"),
    );
    const content = `说明文字\n{"wrapper":${json}}\n结尾`;

    const result = extractClarificationQuestionnaire(content);

    expect(result?.payload.questions[0]?.options[0]?.label).toBe(
      '用 "引号" 包起来',
    );
  });

  test("returns nothing when the marker appears in prose with no payload", () => {
    expect(
      extractClarificationQuestionnaire(
        "这条消息提到 clarification_questionnaire 这个词，但没有卡片。",
      ),
    ).toBeNull();
  });

  test("returns nothing for a balanced object that carries no marker", () => {
    expect(
      extractClarificationQuestionnaire('工具返回：{"ok":true,"output":"done"}'),
    ).toBeNull();
  });

  test("lets an explicit tag win over an embedded copy", () => {
    const tagged = questionnaireJson({ title: "来自标签" });
    const content = `<clarification_questionnaire>${tagged}</clarification_questionnaire>\n\n备注：clarification_questionnaire`;

    expect(extractClarificationQuestionnaire(content)?.payload.title).toBe(
      "来自标签",
    );
  });
});
