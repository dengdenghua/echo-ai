import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { apiGet } from "@/core/api/request";
import { useI18n } from "@/core/i18n/hooks";
import { attentionPrefsFromSettings } from "@/core/notification/attention";
import { showSystemNotification } from "@/core/notification/system-notify";
import { useLocalSettings } from "@/core/settings";
import { swallow } from "@/core/utils/log";
import { useOptionalAuth } from "@/providers/AuthProvider";

export const PROJECT_PATROL_POLL_MS = 60_000;
const SEEN_KEY = "echo.project-patrol.seen";

function seenDigestIds(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === "string").slice(-60)
      : [];
  } catch {
    return [];
  }
}

export function ProjectPatrolNotifier() {
  const { t } = useI18n();
  const [settings] = useLocalSettings();
  const auth = useOptionalAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const prefs = attentionPrefsFromSettings(settings.notification);
  const enabled = prefs.enabled && prefs.categories.paused;
  const latest = useRef({
    copy: t.attentionNotifications,
    prefs,
    pathname,
    search,
  });
  latest.current = { copy: t.attentionNotifications, prefs, pathname, search };
  const delivered = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;
    let closed = false;
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const digest = await apiGet("/api/project-attention");
        if (closed || !digest.notices.length) return;
        const {
          copy,
          prefs: currentPrefs,
          pathname: currentPath,
          search: currentSearch,
        } = latest.current;
        const focused =
          document.visibilityState === "visible" && document.hasFocus();
        if (currentPrefs.onlyWhenUnfocused && focused) return;
        const seen = seenDigestIds();
        if (
          seen.includes(digest.digest_id) ||
          delivered.current.has(digest.digest_id)
        )
          return;
        const firstNotice = digest.notices[0];
        const href =
          digest.notices.length === 1 && firstNotice
            ? `/workspace/projects?project=${encodeURIComponent(firstNotice.project_id)}`
            : "/workspace/projects";
        const viewingProjects =
          focused &&
          currentPath === "/workspace/projects" &&
          digest.notices.length === 1 &&
          new URLSearchParams(currentSearch).get("project") ===
            firstNotice?.project_id;
        const shown =
          viewingProjects ||
          showSystemNotification(
            {
              title: copy.projectDigestTitle(digest.notices.length),
              body: copy.projectDigestBody,
              tag: "echo-project-patrol",
              href,
            },
            { onClick: () => void navigate(href) },
          );
        if (!shown) return;
        delivered.current.add(digest.digest_id);
        try {
          localStorage.setItem(
            SEEN_KEY,
            JSON.stringify([...seen, digest.digest_id].slice(-60)),
          );
        } catch (error) {
          swallow(error, "project-patrol-seen");
        }
      } catch (error) {
        if (!closed) swallow(error, "project-patrol-poll");
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), PROJECT_PATROL_POLL_MS);
    return () => {
      closed = true;
      window.clearInterval(timer);
    };
  }, [auth?.user, enabled, navigate]);

  return null;
}
