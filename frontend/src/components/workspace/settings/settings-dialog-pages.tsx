import { lazy } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { swallow } from "@/core/utils/log";

// Lazy load settings pages. Each ``import()`` is kept as a reusable factory
// so we can preload *all* chunks the moment the dialog opens — see
// ``preloadSettingsPages`` below. Without preloading, switching to a tab
// that hasn't been visited in this session triggered a fresh chunk
// download + Suspense fallback, which users correctly perceived as "every
// tab reloads".
const importAbout = () =>
  import("@/components/workspace/settings/about-settings-page");
const importAccount = () =>
  import("@/components/workspace/settings/account-settings-page");
const importMemory = () =>
  import("@/components/workspace/settings/memory-settings-page");
const importNotification = () =>
  import("@/components/workspace/settings/notification-settings-page");
const importModel = () =>
  import("@/components/workspace/settings/model-settings-page");
const importSubscription = () =>
  import("@/components/workspace/settings/subscription-settings-page");
const importPrivacy = () =>
  import("@/components/workspace/settings/privacy-settings-page");
const importAutomation = () =>
  import("@/components/workspace/settings/automation-settings-page");
const importAutomationSecurity = () =>
  import("@/components/workspace/settings/automation-security-settings-page");
const importBrowserAutomation = () =>
  import("@/components/workspace/settings/browser-automation-settings-page");
const importDesktopAutomation = () =>
  import("@/components/workspace/settings/desktop-automation-settings-page");
const importConversation = () =>
  import("@/components/workspace/settings/conversation-settings-page");
const importMcp = () =>
  import("@/components/workspace/settings/mcp-settings-page").then((mod) => ({
    default: mod.McpSettingsPage,
  }));

export const AboutSettingsPage = lazy(importAbout);
export const AccountSettingsPage = lazy(importAccount);
export const MemorySettingsPage = lazy(importMemory);
export const NotificationSettingsPage = lazy(importNotification);
export const ModelSettingsPage = lazy(importModel);
export const SubscriptionSettingsPage = lazy(importSubscription);
export const PrivacySettingsPage = lazy(importPrivacy);
export const AutomationSecuritySettingsPage = lazy(importAutomationSecurity);
export const BrowserAutomationSettingsPage = lazy(importBrowserAutomation);
export const DesktopAutomationSettingsPage = lazy(importDesktopAutomation);
export const ConversationSettingsPage = lazy(importConversation);
export const McpSettingsPage = lazy(importMcp);

// Run every chunk import in parallel the first time the dialog opens.
// Browsers dedupe the ``import()`` calls against cache, so repeated opens
// are no-ops. We deliberately swallow errors — a failed preload doesn't
// break anything; the per-tab Suspense fallback will still catch it on
// actual navigation.
let preloadStarted = false;
export function preloadSettingsPages(): void {
  if (preloadStarted) return;
  preloadStarted = true;
  [
    importAbout,
    importAccount,
    importMemory,
    importNotification,
    importModel,
    importSubscription,
    importPrivacy,
    importAutomation,
    importAutomationSecurity,
    importBrowserAutomation,
    importDesktopAutomation,
    importConversation,
    importMcp,
  ].forEach((fn) => {
    fn().catch((e) => {
      swallow(e);
    });
  });
}

// Skeleton loader for settings pages
export function SettingsPageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-96" />
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}
