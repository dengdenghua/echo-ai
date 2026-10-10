import { useState, useEffect, useCallback, useRef } from "react";

import { useLocalSettings } from "../settings";

import {
  desktopNotificationBridge,
  showSystemNotification,
  webNotificationsSupported,
} from "./system-notify";

interface NotificationOptions {
  test?: boolean;
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: unknown;
  requireInteraction?: boolean;
  silent?: boolean;
}

interface UseNotificationReturn {
  permission: NotificationPermission;
  isSupported: boolean;
  isReady: boolean;
  requestPermission: () => Promise<NotificationPermission>;
  showNotification: (title: string, options?: NotificationOptions) => boolean;
}

export function useNotification(): UseNotificationReturn {
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [isSupported, setIsSupported] = useState(false);
  const [isReady, setIsReady] = useState(false);

  // Implementation note.
  const lastNotificationTime = useRef<number>(0);

  useEffect(() => {
    // Desktop shell: the main process shows notifications itself, so there
    // is no renderer permission to ask for — only OS support to check.
    const bridge = desktopNotificationBridge();
    if (bridge) {
      let cancelled = false;
      bridge
        .isSupported()
        .catch(() => false)
        .then((supported) => {
          if (cancelled) return;
          setIsSupported(supported);
          setPermission(supported ? "granted" : "denied");
          setIsReady(true);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }
    // Check if browser supports Notification API
    if (webNotificationsSupported()) {
      setIsSupported(true);
      setPermission(Notification.permission);
    }
    setIsReady(true);
    return undefined;
  }, []);

  const requestPermission =
    useCallback(async (): Promise<NotificationPermission> => {
      if (!isSupported) {
        console.warn("Notification API is not supported in this browser");
        return "denied";
      }
      if (desktopNotificationBridge()) return permission;

      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    }, [isSupported, permission]);

  const [settings] = useLocalSettings();

  const showNotification = useCallback(
    (title: string, options?: NotificationOptions) => {
      if (!isSupported) {
        console.warn("Notification API is not supported");
        return false;
      }

      if (!settings.notification.enabled) {
        console.warn("Notification is disabled");
        return false;
      }

      if (
        !options?.test &&
        settings.notification.only_when_unfocused &&
        document.hasFocus() &&
        document.visibilityState === "visible"
      )
        return false;

      if (Date.now() - lastNotificationTime.current < 1000) {
        console.warn("Notification sent too soon");
        return false;
      }
      lastNotificationTime.current = Date.now();

      if (permission !== "granted") {
        console.warn("Notification permission not granted");
        return false;
      }

      return showSystemNotification({
        title,
        body: options?.body,
        tag: options?.tag,
        silent: options?.silent,
      });
    },
    [
      isSupported,
      settings.notification.enabled,
      settings.notification.only_when_unfocused,
      permission,
    ],
  );

  return {
    permission,
    isSupported,
    isReady,
    requestPermission,
    showNotification,
  };
}
