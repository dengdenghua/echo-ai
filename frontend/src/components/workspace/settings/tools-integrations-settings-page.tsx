import { MessageCircleIcon, ServerIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/core/i18n/hooks";

export type ToolsIntegrationsTab = "external" | "channels";

const McpSettingsPage = lazy(() =>
  import("./mcp-settings-page").then((mod) => ({
    default: mod.McpSettingsPage,
  })),
);
const ChannelsContent = lazy(() =>
  import("@/app/workspace/channels/page").then((mod) => ({
    default: mod.ChannelsContent,
  })),
);

function ContentSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-20 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
    </div>
  );
}

export function ToolsIntegrationsSettingsPage({
  defaultTab = "external",
}: {
  defaultTab?: ToolsIntegrationsTab;
}) {
  const { locale } = useI18n();
  const [activeTab, setActiveTab] = useState<ToolsIntegrationsTab>(defaultTab);
  useEffect(() => setActiveTab(defaultTab), [defaultTab]);
  const copy = locale.startsWith("zh")
    ? { external: "外部工具", channels: "消息渠道" }
    : locale.startsWith("ja")
      ? { external: "外部ツール", channels: "メッセージチャネル" }
      : locale.startsWith("ko")
        ? { external: "외부 도구", channels: "메시지 채널" }
        : { external: "External tools", channels: "Message channels" };

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        if (value === "external" || value === "channels") setActiveTab(value);
      }}
      className="gap-5"
    >
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="external">
          <ServerIcon className="size-4" />
          {copy.external}
        </TabsTrigger>
        <TabsTrigger value="channels">
          <MessageCircleIcon className="size-4" />
          {copy.channels}
        </TabsTrigger>
      </TabsList>
      {activeTab === "external" && (
        <TabsContent value="external">
          <Suspense fallback={<ContentSkeleton />}>
            <McpSettingsPage />
          </Suspense>
        </TabsContent>
      )}
      {activeTab === "channels" && (
        <TabsContent value="channels">
          <Suspense fallback={<ContentSkeleton />}>
            <ChannelsContent embedded />
          </Suspense>
        </TabsContent>
      )}
    </Tabs>
  );
}
