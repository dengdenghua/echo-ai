import type { Dispatch, SetStateAction } from "react";

import type { useBoundProjectState } from "@/components/workspace/agent-workbench-panel/project-os-tab";
import type { useCollabSession, useCoworkGroup } from "@/core/cowork";
import type { useI18n } from "@/core/i18n/hooks";
import type { useThreadSettings } from "@/core/settings";
import type { useThreadStream } from "@/core/threads/hooks";

/** Shared shapes for the realtime conversation page and its extracted hooks. */
export type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type RealtimeTranslations = ReturnType<typeof useI18n>["t"];

export type RealtimeSettings = ReturnType<typeof useThreadSettings>[0];
export type RealtimeSettingsSetter = ReturnType<typeof useThreadSettings>[1];

export type RealtimeThreadStream = ReturnType<typeof useThreadStream>;
export type RealtimeThread = RealtimeThreadStream[0];
export type RealtimeSendMessage = RealtimeThreadStream[1];
export type RealtimeToolEvents = RealtimeThreadStream[3];
export type RealtimeApprovalControls = RealtimeThreadStream[5];

export type CollabSessionQuery = ReturnType<typeof useCollabSession>;
export type CoworkGroupQuery = ReturnType<typeof useCoworkGroup>;
export type BoundProjectQuery = ReturnType<typeof useBoundProjectState>;
