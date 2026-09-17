import { MessageSquareTextIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

const QUESTIONNAIRE_TYPE = "clarification_questionnaire";

export interface ClarificationQuestionnaireOption {
  description?: string;
  label: string;
  value: string;
}

export interface ClarificationQuestionnaireQuestion {
  id: string;
  multiple?: boolean;
  options: ClarificationQuestionnaireOption[];
  title: string;
}

export interface ClarificationQuestionnairePayload {
  directSubmitLabel?: string;
  prompt?: string;
  questions: ClarificationQuestionnaireQuestion[];
  submitLabel?: string;
  title?: string;
}

interface ExtractedClarificationQuestionnaire {
  payload: ClarificationQuestionnairePayload;
  visibleContent: string;
}

interface QuestionnaireCandidate {
  block: string;
  json: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionFromUnknown(
  value: unknown,
  index: number,
): ClarificationQuestionnaireOption | null {
  if (typeof value === "string" && value.trim()) {
    return {
      value: `option_${index + 1}`,
      label: value.trim(),
    };
  }
  if (!isRecord(value)) return null;
  const label =
    stringValue(value.label) ??
    stringValue(value.title) ??
    stringValue(value.text) ??
    stringValue(value.value);
  if (!label) return null;
  return {
    value: stringValue(value.value) ?? `option_${index + 1}`,
    label,
    description: stringValue(value.description) ?? stringValue(value.detail),
  };
}

function questionFromUnknown(
  value: unknown,
  index: number,
): ClarificationQuestionnaireQuestion | null {
  if (!isRecord(value)) return null;
  const title =
    stringValue(value.title) ??
    stringValue(value.question) ??
    stringValue(value.label);
  if (!title || !Array.isArray(value.options)) return null;

  const options = value.options
    .map(optionFromUnknown)
    .filter((option): option is ClarificationQuestionnaireOption =>
      Boolean(option),
    )
    .slice(0, 8);
  if (options.length === 1) return null;

  return {
    id: stringValue(value.id) ?? `question_${index + 1}`,
    title,
    multiple: value.multiple === true,
    options,
  };
}

function normalizePayload(
  value: unknown,
): ClarificationQuestionnairePayload | null {
  if (!isRecord(value)) return null;
  const source = isRecord(value.questionnaire) ? value.questionnaire : value;
  const type = stringValue(source.type) ?? stringValue(value.type);
  const isAskUserQuestionResult =
    !type &&
    stringValue(source.question) &&
    Array.isArray(source.options) &&
    ("allow_other" in source ||
      "allowOther" in source ||
      "yield_turn" in source ||
      "posted" in source ||
      "ok" in source);
  if (type !== QUESTIONNAIRE_TYPE && !isAskUserQuestionResult) return null;

  const rawQuestions = Array.isArray(source.questions)
    ? source.questions
    : isAskUserQuestionResult
      ? [
          {
            id: "answer",
            title: source.question,
            options: source.options,
          },
        ]
      : null;
  if (!rawQuestions) return null;

  const questions = rawQuestions
    .map(questionFromUnknown)
    .filter((question): question is ClarificationQuestionnaireQuestion =>
      Boolean(question),
    )
    .slice(0, 10);
  if (questions.length === 0) return null;

  return {
    title: stringValue(source.title),
    prompt: stringValue(source.prompt) ?? stringValue(source.context),
    questions,
    submitLabel:
      stringValue(source.submitLabel) ?? stringValue(source.submit_label),
    directSubmitLabel:
      stringValue(source.directSubmitLabel) ??
      stringValue(source.direct_submit_label),
  };
}

function parsePayload(json: string): ClarificationQuestionnairePayload | null {
  try {
    return normalizePayload(JSON.parse(json));
  } catch {
    return null;
  }
}

function collectCandidates(content: string): QuestionnaireCandidate[] {
  const candidates: QuestionnaireCandidate[] = [];
  const tagPattern =
    /<clarification_questionnaire\b[^>]*>\s*([\s\S]*?)\s*<\/clarification_questionnaire>/gi;
  for (const match of content.matchAll(tagPattern)) {
    const block = match[0];
    const json = match[1];
    if (block && json) candidates.push({ block, json });
  }

  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of content.matchAll(fencePattern)) {
    const block = match[0];
    const json = match[1];
    if (
      block &&
      json &&
      json.includes(QUESTIONNAIRE_TYPE) &&
      !candidates.some((candidate) => candidate.block === block)
    ) {
      candidates.push({ block, json });
    }
  }

  const trimmed = content.trim();
  if (
    trimmed.startsWith("{") &&
    trimmed.endsWith("}") &&
    (trimmed.includes(QUESTIONNAIRE_TYPE) ||
      (trimmed.includes('"question"') && trimmed.includes('"options"')))
  ) {
    candidates.push({ block: content, json: trimmed });
  }

  return candidates;
}

function historicalOptions(title: string): ClarificationQuestionnaireOption[] {
  // Only promote alternatives already written in the reply; never infer new ones.
  const examples = title.match(/(?:比如|例如)[:：]\s*(.+)/)?.[1];
  const tail = examples ?? title.split(/[?？]/).slice(1).join("？");
  if (!tail || !/[、，,]|还是/.test(tail)) return [];
  const parts: string[] = [];
  let depth = 0,
    part = "";
  for (const char of tail.replace(/[?？。]+$/, "")) {
    if ("（(".includes(char)) depth++;
    if ("）)".includes(char)) depth = Math.max(0, depth - 1);
    if (depth === 0 && "、，,".includes(char)) {
      parts.push(part);
      part = "";
    } else part += char;
  }
  parts.push(part);
  const labels = parts
    .flatMap((p) => p.split("还是"))
    .map((p) => p.trim())
    .filter(Boolean);
  if (labels.length < 2 || labels.length > 6) return [];
  return labels.map((label, index) => ({
    value: `historical_${index}`,
    label,
  }));
}

export function extractClarificationQuestionnaire(
  content: string,
): ExtractedClarificationQuestionnaire | null {
  for (const candidate of collectCandidates(content)) {
    const payload = parsePayload(candidate.json.trim());
    if (!payload) continue;
    return {
      payload,
      visibleContent: content.replace(candidate.block, "").trim(),
    };
  }
  // Historical replies can expose a form without inventing choices or submitting anything.
  if (/需要.*(?:了解|确认)|关键(?:问题|点)|请.*(?:回答|补充)/.test(content)) {
    const lines = [...content.matchAll(/^\s*\d+[.)、]\s+(.+[?？].*)$/gm)];
    if (lines.length >= 2 && lines.length <= 6) {
      return {
        visibleContent: content,
        payload: {
          title: "完善需求",
          questions: lines.map((line, index) => ({
            id: `question_${index + 1}`,
            title: line[1]!.replace(/\*\*/g, ""),
            options: historicalOptions(line[1]!.replace(/\*\*/g, "")),
            multiple: !/还是|单选|选一个|二选一/.test(line[1]!) && /多选|哪些|功能.*(?:比如|例如)/.test(line[1]!),
          })),
        },
      };
    }
  }
  return null;
}

function submitQuickReply(text: string, sourceMessageId?: string) {
  window.dispatchEvent(
    new CustomEvent("echo:quick-reply", {
      detail: { text, sourceMessageId },
    }),
  );
}

export function ClarificationQuestionnaire({
  active,
  className,
  onSubmitText,
  payload,
  sourceMessageId,
}: {
  active: boolean;
  className?: string;
  onSubmitText?: (text: string) => void;
  payload: ClarificationQuestionnairePayload;
  sourceMessageId?: string;
}) {
  const { t } = useI18n();
  const formId = useId();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(payload.questions.length <= 3);
  const [modal, setModal] = useState(false);
  const [step, setStep] = useState(0);
  const [review, setReview] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const paged = payload.questions.length > 3;
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    setAnswers({});
    setNotes({});
    setSubmitted(false);
    setStep(0);
    setReview(false);
    setShowAll(false);
  }, [payload, sourceMessageId]);
  if (!active) return null;
  const hasAnswer = payload.questions.some(
    (q) => answers[q.id]?.length || notes[q.id]?.trim(),
  );
  const answerLabel = (q: ClarificationQuestionnaireQuestion) => {
    const labels = q.options
      .filter((o) => answers[q.id]?.includes(o.value))
      .map((o) => o.label);
    if (answers[q.id]?.includes("__undecided"))
      labels.push("还没想好，请给我建议");
    if (notes[q.id]?.trim()) labels.push(notes[q.id]!.trim());
    return labels.join("；") || "暂未回答";
  };
  const submit = () => {
    if (!hasAnswer || submitted) return;
    const text = [
      t.clarificationQuestionnaire.completedHeader,
      ...payload.questions.map((q) => `- ${q.title}: ${answerLabel(q)}`),
    ].join("\n");
    if (onSubmitText) onSubmitText(text);
    else submitQuickReply(text, sourceMessageId);
    setSubmitted(true);
    setModal(false);
  };
  const form = (
    <div className="space-y-5">
      {payload.prompt && (
        <p className="text-sm text-muted-foreground">{payload.prompt}</p>
      )}
      {paged && (
        <div className="flex items-center justify-between gap-2">
          <p role="status" className="text-sm text-muted-foreground">
            {review
              ? "确认回答"
              : showAll
                ? "查看全部问题"
                : `第 ${step + 1} / ${payload.questions.length} 题`}
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setReview(false);
              setShowAll(!showAll);
            }}
          >
            {showAll ? "逐题填写" : "查看全部"}
          </Button>
        </div>
      )}
      {review ? (
        <div className="space-y-3">
          {payload.questions.map((q, index) => (
            <div key={q.id} className="rounded-lg border p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">
                  {index + 1}. {q.title}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`修改第 ${index + 1} 题`}
                  onClick={() => {
                    setStep(index);
                    setReview(false);
                    setShowAll(false);
                  }}
                >
                  修改
                </Button>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                {answerLabel(q)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        payload.questions.map(
          (q, index) =>
            (!paged || showAll || step === index) && (
              <fieldset key={q.id} className="space-y-2">
                <legend className="mb-2 text-sm font-medium leading-6">
                  {index + 1}. {q.title}
                  {q.options.length > 0 ? (q.multiple ? "（可多选）" : "（单选）") : "（填写）"}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {[
                    ...q.options,
                    { value: "__undecided", label: "还没想好，让 AI 建议" },
                  ].map((o) => (
                    <label
                      key={o.value}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                        answers[q.id]?.includes(o.value) && "border-primary bg-primary/5",
                      )}
                    >
                      <input
                        type={q.multiple || q.options.length === 0 ? "checkbox" : "radio"}
                        name={`${formId}-${q.id}`}
                        checked={answers[q.id]?.includes(o.value) ?? false}
                        onChange={() => setAnswers((old) => ({
                          ...old,
                          [q.id]: old[q.id]?.includes(o.value) && (q.multiple || q.options.length === 0)
                            ? old[q.id]!.filter((v) => v !== o.value)
                            : q.multiple && o.value !== "__undecided"
                              ? [...(old[q.id] ?? []).filter((v) => v !== "__undecided"), o.value]
                              : [o.value],
                        }))}
                        className="mt-0.5 size-4 shrink-0 accent-primary"
                      />
                      <span>
                        {o.label}
                        {o.description && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {o.description}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                <textarea
                  aria-label={`补充回答：${q.title}`}
                  placeholder={t.conversation.clarificationOtherPlaceholder}
                  rows={2}
                  value={notes[q.id] ?? ""}
                  onChange={(e) =>
                    setNotes((old) => ({ ...old, [q.id]: e.target.value }))
                  }
                  className="w-full resize-y rounded-md border bg-background p-2 text-sm"
                />
              </fieldset>
            ),
        )
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="text-xs text-muted-foreground">
          可先回答一部分，也可直接在对话中补充。不会自动提交或立项。
        </p>
        <div className="flex flex-wrap gap-2">
          {paged && !showAll && (step > 0 || review) && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (review) setReview(false);
                else setStep(step - 1);
              }}
            >
              上一步
            </Button>
          )}
          {paged && !review ? (
            <>
              {!showAll && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    const q = payload.questions[step]!;
                    setAnswers((old) => ({ ...old, [q.id]: ["__undecided"] }));
                    if (step === payload.questions.length - 1) setReview(true);
                    else setStep(step + 1);
                  }}
                >
                  暂不确定
                </Button>
              )}
              <Button
                type="button"
                onClick={() => {
                  if (showAll || step === payload.questions.length - 1)
                    setReview(true);
                  else setStep(step + 1);
                }}
              >
                {showAll || step === payload.questions.length - 1
                  ? "预览回答"
                  : "下一步"}
              </Button>
            </>
          ) : (
            <Button type="button" disabled={!hasAnswer} onClick={submit}>
              提交回答
            </Button>
          )}
        </div>
      </div>
    </div>
  );
  return (
    <section
      aria-label={t.clarificationQuestionnaire.title}
      className={cn(
        "mt-4 space-y-4 rounded-lg border bg-background p-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <MessageSquareTextIcon className="size-4" />
          {payload.title ?? "完善需求"}
        </h3>
        {!submitted && (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setModal(true)}>
              {paged ? "开始 / 继续填写" : "放大填写"}
            </Button>
            {!paged && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? "收起" : "继续填写"}
              </Button>
            )}
          </div>
        )}
      </div>
      {submitted ? (
        <p role="status" className="text-sm text-muted-foreground">
          回答已提交
        </p>
      ) : paged ? (
        <p className="text-sm text-muted-foreground">
          共 {payload.questions.length} 题 ·
          逐题填写，最后统一确认。关闭后保留草稿。
        </p>
      ) : (
        expanded && !modal && form
      )}
      <Dialog open={modal} onOpenChange={setModal}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{payload.title ?? "完善需求"}</DialogTitle>
          </DialogHeader>
          {form}
        </DialogContent>
      </Dialog>
    </section>
  );
}
