/** Inert, bounded native UI protocol. Keep bounds in sync with platform/native_ui.py. */
export type UIField = {
  id: string;
  label: string;
  type: "text" | "textarea" | "select";
  required?: boolean;
  options?: string[];
};
export type UIForm = {
  type: "form";
  id: string;
  title: string;
  fields: UIField[];
};
export type UIComparison = {
  type: "comparison";
  id: string;
  title: string;
  columns: string[];
  rows: string[][];
};
export type UIBlock =
  | UIForm
  | UIComparison
  | { type: "text"; id: string; text: string }
  | { type: "tasks"; id: string; title: string };
export type UIDocument = { version: 1; title: string; blocks: UIBlock[] };
export type UIReceipt = {
  ok: true;
  kind: "echo.ui.v1";
  thread_id: string;
  document: UIDocument;
};

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number, min = 1): v is string =>
  typeof v === "string" && v.length >= min && v.length <= max;
const id = (v: unknown) =>
  typeof v === "string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(v);
const keys = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).every((key) => allowed.includes(key));
const list = (v: unknown, min: number, max: number): v is unknown[] =>
  Array.isArray(v) && v.length >= min && v.length <= max;

function isField(v: unknown): v is UIField {
  if (
    !object(v) ||
    !keys(v, ["id", "label", "type", "required", "options"]) ||
    !id(v.id) ||
    !text(v.label, 160)
  )
    return false;
  if (
    !["text", "textarea", "select"].includes(String(v.type)) ||
    (v.required !== undefined && typeof v.required !== "boolean")
  )
    return false;
  const options = v.options === undefined ? [] : v.options;
  return (
    list(options, v.type === "select" ? 1 : 0, v.type === "select" ? 12 : 0) &&
    options.every((entry) => text(entry, 160)) &&
    new Set(options).size === options.length
  );
}

export function isUIBlock(v: unknown): v is UIBlock {
  if (!object(v) || !id(v.id)) return false;
  if (v.type === "text")
    return keys(v, ["id", "type", "text"]) && text(v.text, 8000);
  if (!text(v.title, 160)) return false;
  if (v.type === "tasks") return keys(v, ["id", "type", "title"]);
  if (v.type === "form")
    return (
      keys(v, ["id", "type", "title", "fields"]) &&
      list(v.fields, 1, 8) &&
      v.fields.every(isField) &&
      new Set(v.fields.map((field) => field.id)).size === v.fields.length
    );
  if (v.type === "comparison") {
    const columns = v.columns;
    return (
      keys(v, ["id", "type", "title", "columns", "rows"]) &&
      list(columns, 2, 6) &&
      columns.every((entry) => text(entry, 80)) &&
      list(v.rows, 1, 12) &&
      v.rows.every(
        (row) =>
          list(row, columns.length, columns.length) &&
          row.every((entry) => text(entry, 500, 0)),
      )
    );
  }
  return false;
}

export function parseUIDocument(v: unknown): UIDocument | null {
  if (
    !object(v) ||
    !keys(v, ["version", "title", "blocks"]) ||
    v.version !== 1 ||
    !text(v.title, 160) ||
    !list(v.blocks, 1, 12) ||
    !v.blocks.every(isUIBlock)
  )
    return null;
  if (
    new Set(v.blocks.map((block) => block.id)).size !== v.blocks.length ||
    JSON.stringify(v).length > 60000
  )
    return null;
  return v as UIDocument;
}

/** Tool results can include the bridge's human-readable success prefix. */
export function parseUIReceipt(
  value: unknown,
  documentInput?: unknown,
): UIReceipt | null {
  try {
    const data: unknown =
      typeof value === "string"
        ? JSON.parse(value.slice(value.indexOf("{")))
        : value;
    if (
      !object(data) ||
      data.ok !== true ||
      data.kind !== "echo.ui.v1" ||
      !text(data.thread_id, 256)
    )
      return null;
    const document = parseUIDocument(documentInput);
    return document
      ? { ok: true, kind: "echo.ui.v1", thread_id: data.thread_id, document }
      : null;
  } catch {
    return null;
  }
}

/** Only complete, individually valid blocks appear while arguments stream. */
export function previewUIDocument(value: unknown): UIDocument | null {
  if (
    !object(value) ||
    value.version !== 1 ||
    !text(value.title, 160) ||
    !list(value.blocks, 0, 12) ||
    JSON.stringify(value).length > 60000
  )
    return null;
  const blocks = value.blocks.filter(isUIBlock);
  if (new Set(blocks.map((block) => block.id)).size !== blocks.length)
    return null;
  return { version: 1, title: value.title, blocks };
}

export function formReply(
  form: UIForm,
  values: Record<string, string>,
): string {
  // Everything sent is visible in the card; no model-authored hidden action.
  return [
    `表单回复：${form.title}`,
    ...form.fields.map(
      (field) =>
        `${field.label}：${formValue(values, field.id).trim() || "未填写"}`,
    ),
  ].join("\n");
}

export function formValue(
  values: Record<string, string>,
  fieldId: string,
): string {
  return Object.hasOwn(values, fieldId) && typeof values[fieldId] === "string"
    ? values[fieldId]
    : "";
}

export type UIFormState = {
  values: Record<string, string>;
  clientMessageId?: string;
};
export function readUIFormState(
  key: string | null,
  schema: string,
): UIFormState {
  if (!key) return { values: {} };
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > 30000) return { values: {} };
    const saved: unknown = JSON.parse(raw);
    if (
      !object(saved) ||
      saved.schema !== schema ||
      !object(saved.values) ||
      Object.keys(saved.values).length > 8 ||
      !Object.values(saved.values).every((value) => text(value, 2000, 0))
    )
      return { values: {} };
    return {
      values: saved.values as Record<string, string>,
      ...(typeof saved.clientMessageId === "string" &&
      /^ui-[a-zA-Z0-9-]{1,80}$/.test(saved.clientMessageId)
        ? { clientMessageId: saved.clientMessageId }
        : {}),
    };
  } catch {
    return { values: {} };
  }
}

export function saveUIFormState(
  key: string | null,
  schema: string,
  state: UIFormState,
): void {
  if (!key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify({ schema, ...state }));
  } catch {
    /* Storage may be disabled; in-memory drafts still work. */
  }
}
