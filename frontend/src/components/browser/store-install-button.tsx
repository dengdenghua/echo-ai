import { Loader2Icon, PuzzleIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EXTENSION_STORE_NAME, storeExtensionPage } from "./extension-links";

/**
 * "Install to Echo" in the address bar while a Chrome Web Store / Edge
 * Add-ons extension page is open (desktop app only).
 */
export function StoreInstallButton({ url }: { url: string | undefined }) {
  const [installing, setInstalling] = useState(false);
  const page = storeExtensionPage(url);
  const api =
    typeof window === "undefined" ? undefined : window.echo?.extensions;
  if (!page || !url || !api?.installFromStore) return null;

  const install = async () => {
    setInstalling(true);
    try {
      const result = await api.installFromStore(url);
      if (result.ok)
        toast.success(`已安装「${result.extension?.name ?? "扩展"}」`);
      else toast.error(result.error || "安装失败");
    } finally {
      setInstalling(false);
    }
  };

  return (
    <button
      type="button"
      disabled={installing}
      onClick={() => void install()}
      title={`从${EXTENSION_STORE_NAME[page.store]}安装这个扩展`}
      className="flex h-6 shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-60"
    >
      {installing ? (
        <Loader2Icon className="size-3 animate-spin" />
      ) : (
        <PuzzleIcon className="size-3" />
      )}
      安装到 Echo
    </button>
  );
}
