import type { components } from "@/core/api/openapi-types";

import type { AiModeDevice } from "../settings-resilience";

// ─── Local API types · narrow to what the UI actually uses ──────
//
// These mirror the backend wire shape (see ``runtime/web/ai_mode_router.py``
// and ``runtime/web/path_denylist_router.py``). They're intentionally
// hand-rolled rather than codegen — the endpoints are recent and
// the openapi-ts pipeline hasn't picked them up yet.
export type AiModeId = "efficiency" | "privacy";

export interface AiModeOption {
  id: AiModeId;
  label: string;
  description: string;
  recommended_default?: boolean;
}

export interface AiModeStatus {
  mode: AiModeId;
  recommended: AiModeId;
  device?: AiModeDevice;
  modes: AiModeOption[];
}

export interface PathDenylistStatus {
  paths: string[];
}

export interface FactoryResetResult {
  ok: boolean;
}

// Pulled from the auto-generated OpenAPI types so backend changes
// to the ``IdentityLockResponse`` pydantic model propagate here
// without a hand-edit. See docs/adr/004-openapi-ts-codegen.md.
// The ``source`` field is typed as ``string`` in the generated
// file (FastAPI can't express the ``"runtime" | "env" | "default"``
// union through pydantic without a Literal); we re-narrow it for
// UI-side compile-time safety where we branch on it.
export type LockStatus = components["schemas"]["IdentityLockResponse"] & {
  source: "runtime" | "env" | "default";
};

export type ConstitutionProfile = "strict" | "normal" | "lax";

export type ConstitutionProfileStatus = {
  profile: ConstitutionProfile;
  available: ConstitutionProfile[];
};

// LLM 语义安全 judge:enabled=当前是否接了真 judge;available=有无模型路由可接。
export type JudgeStatus = {
  enabled: boolean;
  available: boolean;
};

export type LoadState = "loading" | "ready" | "error";
