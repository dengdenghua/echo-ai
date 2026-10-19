import { useState } from "react";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";

const ACCOUNT_URL = "https://www.codebuddy.cn/profile/plans-usage";

export function CodeBuddyCredits() {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const { resolvedTheme } = useTheme();
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  return (
    <section className="space-y-3 border-t border-border-subtle pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">
          {zh ? "剩余积分与套餐" : "Remaining credits and plan"}
        </h4>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setLoaded(false);
              setRevision((value) => value + 1);
            }}
          >
            <RefreshCwIcon className="size-3.5" />
            {zh ? "刷新积分" : "Refresh credits"}
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a href={ACCOUNT_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon className="size-3.5" />
              {zh ? "在浏览器打开" : "Open in browser"}
            </a>
          </Button>
        </div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {zh
          ? "下方直接显示 CodeBuddy 官方用量页面。若出现二维码，请在这里登录官网账号；此登录与 CLI 授权独立，建议使用同一个账号。"
          : "The official CodeBuddy usage page is shown below. If a QR code appears, sign in here with the same account as the CLI; the website and CLI have separate logins."}
      </p>
      {!loaded && (
        <p role="status" className="text-xs text-muted-foreground">
          {zh ? "正在加载官方用量页面…" : "Loading the official usage page…"}
        </p>
      )}
      <iframe
        key={`${theme}-${revision}`}
        title={
          zh
            ? "CodeBuddy 官方积分与套餐"
            : "CodeBuddy official credits and plan"
        }
        src={`${ACCOUNT_URL}?embed=1&theme=${theme}`}
        className="h-[620px] w-full rounded-lg border border-border-subtle bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
      />
      <p className="text-xs leading-5 text-muted-foreground">
        {zh
          ? "积分与登录信息由 CodeBuddy 官方页面管理。若浏览器阻止内嵌登录，可使用“在浏览器打开”。"
          : "CodeBuddy manages the balance and website sign-in. If your browser blocks embedded sign-in, use “Open in browser”."}
      </p>
    </section>
  );
}
