import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ACCOUNT_FREE_TOKEN,
  getAuthStatus,
  getMe,
  getToken,
  getUser as getStoredUser,
  login as loginApi,
  logout as logoutApi,
  refreshToken,
  register as registerApi,
  _writeToken,
  _clearTokens,
} from "@/core/auth/api";
import { octAuthApi } from "@/core/oct/api";
import { AUTH_EXPIRED_EVENT } from "@/core/auth/fetch-interceptor";

import { swallow } from "@/core/utils/log";
import type {
  AuthStatus,
  LoginRequest,
  RegisterRequest,
  User,
} from "@/core/auth/types";
import { useI18n } from "@/core/i18n/hooks";
import { looseBody } from "@/core/api/response";
import { isUser } from "@/core/auth/guards";
import { isRecord, isString } from "@/core/utils/guards";

const GUEST_USER_ID = "__guest__";
const ANONYMOUS_USER_ID = "__anonymous__";
const ACCOUNT_FREE_USER_ID = "__account_free__";

function isPlaceholderUsername(username?: string | null): boolean {
  const value = username?.trim().toLowerCase();
  return !value || value === "anonymous" || value === ANONYMOUS_USER_ID;
}

function isPlaceholderUserId(userId?: string | null): boolean {
  const value = userId?.trim().toLowerCase();
  return !value || value === "anonymous" || value === ANONYMOUS_USER_ID;
}

function userFromJwt(token: string | null): Partial<User> | null {
  if (!token || token === GUEST_USER_ID || token.split(".").length !== 3) {
    return null;
  }
  try {
    const tokenPayload = token.split(".")[1];
    if (!tokenPayload) return null;
    const rawPayload = tokenPayload.replace(/-/g, "+").replace(/_/g, "/");
    const payload = rawPayload.padEnd(
      Math.ceil(rawPayload.length / 4) * 4,
      "=",
    );
    const json = looseBody(JSON.parse(window.atob(payload)), isJwtIdentity);
    const actorId = json.sub;
    const mobile = json.mobile;
    if (!actorId && !mobile) return null;
    return {
      user_id: actorId || mobile,
      actor_id: actorId,
      username: mobile || actorId || "Echo",
      mobile,
      provider: json.provider,
    };
  } catch (e) {
    swallow(e);
    return null;
  }
}

function isJwtIdentity(
  value: unknown,
): value is { sub?: string; mobile?: string; provider?: string } {
  return (
    isRecord(value) &&
    (value.sub === undefined || isString(value.sub)) &&
    (value.mobile === undefined || isString(value.mobile))
  );
}

function normalizeUserIdentity(
  incoming: Partial<User>,
  fallback?: Partial<User> | null,
  fallbackMobile?: string,
): User {
  const mobile = incoming.mobile || fallback?.mobile || fallbackMobile;
  const actorId = incoming.actor_id || fallback?.actor_id;
  const incomingUserId = !isPlaceholderUserId(incoming.user_id)
    ? incoming.user_id
    : undefined;
  const fallbackUserId = !isPlaceholderUserId(fallback?.user_id)
    ? fallback?.user_id
    : undefined;
  const userId =
    incomingUserId || actorId || fallbackUserId || mobile || ANONYMOUS_USER_ID;
  const fallbackUsername =
    fallback?.username && !isPlaceholderUsername(fallback.username)
      ? fallback.username
      : undefined;
  const username =
    incoming.username && !isPlaceholderUsername(incoming.username)
      ? incoming.username
      : mobile ||
        incoming.email ||
        fallbackUsername ||
        incoming.username ||
        userId;

  return {
    ...fallback,
    ...incoming,
    user_id: userId,
    username,
    ...(actorId ? { actor_id: actorId } : {}),
    ...(mobile ? { mobile } : {}),
  };
}

interface AuthContextType {
  isLoading: boolean;
  authError: Error | null;
  authStatus: AuthStatus | null;
  user: User | null;
  isAuthenticated: boolean;
  login: (request: LoginRequest) => Promise<void>;
  emailLogin: (email: string, code: string) => Promise<void>;
  /** Deprecated: guest mode is disabled when auth is enabled. */
  guestLogin: () => Promise<void>;
  register: (request: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  startAccountFreeMode: () => void;
  refresh: () => Promise<void>;
  /**
   * Re-run the auth bootstrap. `quiet` retries (e.g. the login page's
   * automatic backend-availability polling) skip the global loading
   * flip and keep the current error visible until the retry settles,
   * so the UI does not flicker between spinner and error card.
   */
  retryAuth: (options?: { quiet?: boolean }) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<Error | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const initializedRef = useRef(false);

  const isAuthenticated =
    !!user && !isPlaceholderUserId(user.user_id) && !user.is_guest;

  const initAuth = useCallback(async (options?: { quiet?: boolean }) => {
    const quiet = options?.quiet === true;
    if (!quiet) {
      setIsLoading(true);
      setAuthError(null);
    }
    const token = getToken();
    const storedUser = getStoredUser();
    const tokenUser = userFromJwt(token);
    const localUser = storedUser || tokenUser;
    try {
      if (
        token === ACCOUNT_FREE_TOKEN &&
        storedUser &&
        !storedUser.is_guest &&
        storedUser.is_account_free
      ) {
        setUser(normalizeUserIdentity(storedUser));
        setAuthStatus({
          enabled: false,
          jwt_available: false,
          allow_registration: false,
          exempt_paths: [],
        });
        setAuthError(null);
        return;
      }
      if (token === GUEST_USER_ID || storedUser?.is_guest) {
        _clearTokens();
        setUser(null);
      } else if (token && localUser && !localUser.is_guest) {
        setUser(normalizeUserIdentity(localUser, tokenUser));
      } else {
        setUser(null);
      }
      let status: AuthStatus;
      try {
        status = await getAuthStatus();
        setAuthStatus(status);
        // Clear a stale unavailability error after a successful quiet
        // retry (the non-quiet path already reset it on entry).
        setAuthError(null);
      } catch (error) {
        const unavailable =
          error instanceof Error
            ? error
            : new Error("Authentication service is unavailable");
        swallow(unavailable);
        setAuthStatus(null);
        setAuthError(unavailable);
        return;
      }
      // A browser restart intentionally has no sessionStorage JWT.  The
      // HttpOnly cookie is the durable credential, so always ask the backend
      // for the current actor when authentication is enabled.
      const current = status.enabled
        ? await getMe()
            .then((currentUser) => ({ currentUser, error: null }))
            .catch((error: unknown) => ({ currentUser: null, error }))
        : { currentUser: null, error: null };
      if (current.currentUser) {
        setUser(
          normalizeUserIdentity(current.currentUser, storedUser || tokenUser),
        );
      } else if (current.error) {
        swallow(current.error);
        const msg = current.error instanceof Error ? current.error.message : "";
        if (/401|Unauthorized/i.test(msg)) {
          _clearTokens();
          setUser(null);
        }
      }
    } catch (e) {
      swallow(e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void initAuth();
  }, [initAuth]);

  useEffect(() => {
    const expire = () => {
      if (getToken() === ACCOUNT_FREE_TOKEN) return;
      _clearTokens();
      setUser(null);
      // HttpOnly cookies cannot be cleared from JavaScript.  The logout route
      // is deliberately callable even when the old JWT has expired.
      void fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      }).catch(() => undefined);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, expire);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expire);
  }, []);

  const login = useCallback(async (request: LoginRequest) => {
    const response = await loginApi(request);
    if (response.user) {
      const normalized = normalizeUserIdentity(response.user);
      if (response.access_token) _writeToken(response.access_token, normalized);
      setUser(normalized);
    }
  }, []);

  const emailLogin = useCallback(async (email: string, code: string) => {
    // oct 账号网关:邮箱验证码登录 → agent 自有会话 JWT
    const response = await octAuthApi.emailLogin(email, code);
    if (response.user) {
      const normalized = normalizeUserIdentity(
        looseBody(response.user, isUser),
        null,
        email,
      );
      if (response.access_token) _writeToken(response.access_token, normalized);
      setUser(normalized);
    }
  }, []);

  const guestLogin = useCallback(async () => {
    _clearTokens();
    setUser(null);
    throw new Error(t.auth.notLoggedIn);
  }, [t.auth.notLoggedIn]);

  const startAccountFreeMode = useCallback(() => {
    const accountFreeUser: User = {
      user_id: ACCOUNT_FREE_USER_ID,
      username: "免账号",
      provider: "account_free",
      is_account_free: true,
      is_active: true,
    };
    _writeToken(ACCOUNT_FREE_TOKEN, accountFreeUser);
    setAuthStatus({
      enabled: false,
      jwt_available: false,
      allow_registration: false,
      exempt_paths: [],
    });
    setAuthError(null);
    setUser(accountFreeUser);
  }, []);

  const register = useCallback(async (request: RegisterRequest) => {
    const newUser = await registerApi(request);
    setUser(newUser);
  }, []);

  const logout = useCallback(async () => {
    await logoutApi();
    _clearTokens();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    const response = await refreshToken();
    if (response.user) {
      setUser((previous) => {
        const normalized = normalizeUserIdentity(response.user!, previous);
        if (response.access_token)
          _writeToken(response.access_token, normalized);
        return normalized;
      });
    }
  }, []);

  const value = useMemo(
    () => ({
      isLoading,
      authError,
      authStatus,
      user,
      isAuthenticated,
      login,
      emailLogin,
      guestLogin,
      register,
      logout,
      startAccountFreeMode,
      refresh,
      retryAuth: initAuth,
    }),
    [
      isLoading,
      authError,
      authStatus,
      user,
      isAuthenticated,
      login,
      emailLogin,
      guestLogin,
      register,
      logout,
      startAccountFreeMode,
      refresh,
      initAuth,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

/**
 * Read authentication when a reusable leaf component may render outside the
 * application shell (tests, stories, previews). Missing context means no
 * control-plane privileges; it must never grant guest access implicitly.
 */
export function useOptionalAuth() {
  return useContext(AuthContext);
}
