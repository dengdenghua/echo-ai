import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { untypedApi } from "@/core/api/request";
import { useI18n } from "@/core/i18n/hooks";
import { creationCopy } from "@/core/i18n/locales/asset-creation";
import { PersonalAppViewer, type PersonalAppInfo } from "./personal-app-viewer";

export function PersonalAppsPanel({
  searchQuery = "",
}: {
  searchQuery?: string;
}) {
  const { locale } = useI18n();
  const copy = creationCopy(locale);
  const [selected, setSelected] = useState<PersonalAppInfo | null>(null);
  const catalog = useQuery({
    queryKey: ["personal-apps"],
    queryFn: () =>
      untypedApi.get<{ apps: PersonalAppInfo[] }>("/api/personal-apps", {
        reason:
          "Independent personal-app catalog with app-scoped bridge permissions.",
      }),
  });
  const page = useQuery({
    queryKey: ["personal-app-document", selected?.id],
    enabled: selected !== null,
    queryFn: async () => {
      const response = await untypedApi.fetch(
        "get",
        `/api/deployments/${encodeURIComponent(selected!.id)}/index.html`,
        {
          reason:
            "Authenticated personal-app HTML is rendered in an opaque sandbox.",
        },
      );
      return response.text();
    },
  });
  const latest = new Map<string, PersonalAppInfo>();
  for (const item of catalog.data?.apps ?? []) {
    if (item.app?.schema === "echo.app.v1" && !latest.has(item.app.id))
      latest.set(item.app.id, item);
  }
  const apps = [...latest.values()].filter(({ app }) =>
    `${app.name} ${app.description}`
      .toLowerCase()
      .includes(searchQuery.trim().toLowerCase()),
  );

  return (
    <section className="mb-5 space-y-3" aria-label={copy.myApps}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{copy.myApps}</h3>
        <Button
          size="sm"
          variant="ghost"
          disabled={catalog.isFetching}
          onClick={() => void catalog.refetch()}
        >
          {copy.retry}
        </Button>
      </div>
      {catalog.isError ? <p role="alert">{copy.error}</p> : null}
      {!catalog.isPending && !catalog.isError && apps.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.empty}</p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {apps.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-lg border p-3"
          >
            <div className="min-w-0 flex-1">
              <h4 className="font-medium">{item.app.name}</h4>
              <p className="text-sm text-muted-foreground">
                {item.app.description}
              </p>
            </div>
            <Button size="sm" onClick={() => setSelected(item)}>
              {copy.open}
            </Button>
          </div>
        ))}
      </div>
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="flex h-[85vh] max-w-5xl flex-col">
          <DialogHeader>
            <DialogTitle>{selected?.app.name ?? copy.myApps}</DialogTitle>
          </DialogHeader>
          {page.isError ? (
            <div role="alert">
              {copy.error}
              <Button onClick={() => void page.refetch()}>{copy.retry}</Button>
            </div>
          ) : null}
          {page.data !== undefined && selected ? (
            <PersonalAppViewer
              key={selected.id}
              item={selected}
              html={page.data}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
