import React from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import { LoginServiceStatus } from "@/app/login/login-service-status";
import "@/styles/globals.css";

document.cookie = "locale=zh-CN; path=/";
document.documentElement.classList.add("dark");
let processState = "starting";
window.setBackendState = (state) => {
  processState = state;
};
window.echo = {
  isElectron: true,
  backend: {
    getStatus: async () => ({ state: processState }),
    restart: async () => {
      processState = "running";
      return { ok: true };
    },
  },
};
createRoot(document.getElementById("root")).render(
  <I18nProvider initialLocale="zh-CN" initialTranslations={zhCN}>
    <main className="flex min-h-screen items-center justify-center bg-background p-5 text-foreground">
      <div className="w-full max-w-sm">
        <LoginServiceStatus unavailable onRetry={() => {}} />
      </div>
    </main>
  </I18nProvider>,
);
