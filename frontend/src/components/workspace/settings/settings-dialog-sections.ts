import {
  ActivityIcon,
  BellIcon,
  InfoIcon,
  BrainIcon,
  CpuIcon,
  PaletteIcon,
  ShieldIcon,
  ZapIcon,
  CreditCardIcon,
  ServerIcon,
  SettingsIcon,
  Globe2Icon,
  MessageSquareTextIcon,
  MonitorIcon,
  GitBranchIcon,
} from "lucide-react";
import type { ComponentType } from "react";

import type { Translations } from "@/core/i18n/locales/types";

import type { SettingsSection } from "./settings-sections";

export type SettingsSectionGroup =
  | "account"
  | "workspace"
  | "capabilities"
  | "system";

export type SettingsNavSection = {
  id: SettingsSection;
  label: string;
  icon: ComponentType<{ className?: string }>;
  keywords: string[];
  group: SettingsSectionGroup;
  disabled?: boolean;
  disabledReason?: string;
};

/** Resolved nav labels; the dialog picks the locale-specific ones. */
export interface SettingsSectionLabels {
  account: string;
  subscription: string;
  general: string;
  conversation: string;
  models: string;
  memory: string;
  notification: string;
  coding: string;
  tools: string;
  browserAutomation: string;
  desktopAutomation: string;
  automationSecurity: string;
  privacy: string;
  observability: string;
  about: string;
}

type SectionKeywords = Translations["settings"]["dialog"]["sectionKeywords"];

/** The settings dialog's navigation, in display order, grouped. */
export function buildSettingsSections(
  labels: SettingsSectionLabels,
  sectionKeywords: SectionKeywords,
): SettingsNavSection[] {
  const all: SettingsNavSection[] = [
    {
      id: "account",
      group: "account",
      label: labels.account,
      icon: SettingsIcon,
      keywords: [
        "account",
        "user",
        "login",
        "profile",
        ...sectionKeywords.account,
      ],
    },
    {
      id: "subscription",
      group: "account",
      label: labels.subscription,
      icon: CreditCardIcon,
      keywords: [
        "subscription",
        "billing",
        "plan",
        "usage",
        ...sectionKeywords.subscription,
      ],
    },
    {
      id: "appearance",
      group: "workspace",
      label: labels.general,
      icon: PaletteIcon,
      keywords: [
        "appearance",
        "theme",
        "material",
        "glass",
        "density",
        "language",
        ...sectionKeywords.appearance,
      ],
    },
    {
      id: "conversation",
      group: "workspace",
      label: labels.conversation,
      icon: MessageSquareTextIcon,
      keywords: [
        "conversation",
        "chat",
        "detail level",
        "font size",
        "对话",
        "细节",
        "字号",
        ...sectionKeywords.appearance,
      ],
    },
    {
      id: "models",
      group: "workspace",
      label: labels.models,
      icon: CpuIcon,
      keywords: ["model", "llm", "api", "provider", ...sectionKeywords.models],
    },
    {
      id: "memory",
      group: "workspace",
      label: labels.memory,
      icon: BrainIcon,
      keywords: ["memory", "knowledge", ...sectionKeywords.memory],
    },
    {
      id: "notification",
      group: "workspace",
      label: labels.notification,
      icon: BellIcon,
      keywords: ["notification", "alert", ...sectionKeywords.notification],
    },
    {
      id: "coding",
      group: "capabilities",
      label: labels.coding,
      icon: GitBranchIcon,
      keywords: [
        "coding",
        "code",
        "git",
        "hooks",
        "worktrees",
        "编码",
        "代码",
        "提交",
        "工作树",
        "钩子",
      ],
    },
    {
      id: "tools",
      group: "capabilities",
      label: labels.tools,
      icon: ServerIcon,
      keywords: [
        "tools",
        "integrations",
        "mcp",
        "tool",
        "server",
        ...sectionKeywords.mcp,
      ],
    },
    {
      id: "browserAutomation",
      group: "capabilities",
      label: labels.browserAutomation,
      icon: Globe2Icon,
      keywords: [
        "browser",
        "relay",
        "extension",
        "link",
        "浏览器",
        "扩展",
        "链接",
        ...sectionKeywords.automation,
      ],
    },
    {
      id: "desktopAutomation",
      group: "capabilities",
      label: labels.desktopAutomation,
      icon: MonitorIcon,
      keywords: [
        "desktop",
        "computer",
        "screen recording",
        "accessibility",
        "桌面",
        "电脑",
        "屏幕录制",
        "辅助功能",
        ...sectionKeywords.automation,
      ],
    },
    {
      id: "automationSecurity",
      group: "capabilities",
      label: labels.automationSecurity,
      icon: ZapIcon,
      keywords: [
        "automation",
        "security",
        "sandbox",
        "execution",
        "permission",
        "browser",
        "desktop",
        "approval",
        "沙箱",
        "执行",
        "权限",
        "自动化",
        ...sectionKeywords.automation,
        ...sectionKeywords.sandbox,
      ],
    },
    {
      id: "privacy",
      group: "capabilities",
      label: labels.privacy,
      icon: ShieldIcon,
      keywords: [
        "privacy",
        "permission",
        "security",
        ...sectionKeywords.privacy,
      ],
    },
    {
      id: "observability",
      group: "system",
      label: labels.observability,
      icon: ActivityIcon,
      keywords: [
        "observability",
        "diagnostics",
        "logs",
        ...sectionKeywords.observability,
      ],
    },
    {
      id: "about",
      group: "system",
      label: labels.about,
      icon: InfoIcon,
      keywords: ["about", "version", "help", ...sectionKeywords.about],
    },
  ];

  return all;
}
