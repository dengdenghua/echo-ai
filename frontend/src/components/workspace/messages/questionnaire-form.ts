import type { AIMessage, Message } from "@/core/api/types";
import type { Locale } from "@/core/i18n";
import {
  questionnaireCopy,
  type QuestionnaireCopy,
} from "@/core/i18n/locales/questionnaire";
import {
  parseUIDocument,
  type UIDocument,
  type UIField,
} from "@/core/messages/native-ui";
import { findToolCallResult } from "@/core/messages/utils";
import { extractClarificationQuestionnaire } from "../clarification-questionnaire";

export function toolOutput(
  call: NonNullable<AIMessage["tool_calls"]>[number],
  messages: Message[],
): unknown {
  return (
    (call.id ? findToolCallResult(call.id, messages) : undefined) ??
    call.args?.output
  );
}

/** Adapt successful legacy tool receipts only; never infer fields from prose. */
export function questionnaireForm(
  result: unknown,
  copy: QuestionnaireCopy,
  threadId?: string,
): UIDocument | null {
  let value: unknown = result;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value.slice(value.indexOf("{")));
    } catch {
      return null;
    }
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("ok" in value) ||
    value.ok !== true ||
    !("type" in value) ||
    value.type !== "clarification_questionnaire"
  )
    return null;
  if ("thread_id" in value && value.thread_id !== threadId) return null;
  if (
    !("questions" in value) ||
    !Array.isArray(value.questions) ||
    value.questions.length > 3
  )
    return null;
  const questionnaire = extractClarificationQuestionnaire(
    JSON.stringify(value),
  )?.payload;
  if (
    !questionnaire ||
    questionnaire.questions.length !== value.questions.length ||
    questionnaire.questions.some(
      (question) =>
        question.multiple ||
        question.options.some((option) => option.description),
    )
  )
    return null;
  const fields: UIField[] = questionnaire.questions.flatMap(
    (question, index) => {
      const field: UIField = {
        id: `question_${index + 1}`,
        type: question.options.length ? "select" : "textarea",
        label: question.title,
      };
      if (!question.options.length) return [field];
      field.options = [
        ...new Set([
          ...question.options.map((option) => option.label),
          copy.undecidedOption,
        ]),
      ];
      return [
        field,
        {
          id: `note_${index + 1}`,
          type: "text",
          label: copy.noteFor(question.title),
        },
      ];
    },
  );
  const title = questionnaire.title || copy.defaultTitle;
  return parseUIDocument({
    version: 1,
    title,
    blocks: [{ id: "requirements", type: "form", title, fields }],
  });
}

export function hasNativeQuestionnaire(
  messages: Message[],
  threadId?: string | null,
  locale: Locale = "zh-CN",
): boolean {
  return (
    !!threadId &&
    messages.some(
      (message) =>
        message.type === "ai" &&
        message.tool_calls?.some(
          (call) =>
            call.name === "ask_user_question" &&
            !!questionnaireForm(
              toolOutput(call, messages),
              questionnaireCopy(locale),
              threadId,
            ),
        ),
    )
  );
}
