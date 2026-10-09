/**
 * Typed request layer for the Echo backend.
 *
 * Paths, path parameters, query parameters, JSON request bodies and JSON
 * responses are all derived from the generated OpenAPI ``paths`` type
 * (``./openapi-types``), so a call like
 *
 *   apiGet("/api/cowork/{thread_id}", { path: { thread_id }, query: { until_seq } })
 *
 * only compiles when that operation exists and the arguments match it.
 *
 * Every call:
 *  - resolves against ``getBackendBaseURL()`` at call time (or ``baseUrl``);
 *  - sends the auth + CSRF headers built by ``EchoClient``'s shared helpers,
 *    plus ``Content-Type: application/json`` when a JSON body is sent;
 *  - throws ``EchoAPIError`` (status + parsed ``detail``) on any non-2xx
 *    response — pass ``errorMessage`` to keep a module's existing wording;
 *  - parses the JSON body (204 → ``undefined``) and reports stub payloads.
 *
 * Use ``apiFetch`` when the caller needs the raw ``Response`` (streams,
 * blobs, text, or an intentionally ignored body). When an endpoint is missing
 * from the OpenAPI snapshot (or its declared shape is wrong), fall back to
 * ``untypedApi`` — it requires a ``reason`` so the gap stays visible.
 */

import { authHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";

import {
  EchoAPIError,
  apiErrorFromFailure,
  echoRequestHeaders,
  readApiFailure,
  warnOnStubResponse,
  type ApiFailure,
} from "./client";
import type { paths } from "./openapi-types";

export type { ApiFailure } from "./client";
export { EchoAPIError } from "./client";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

type Operation<P extends keyof paths, M extends HttpMethod> = NonNullable<
  paths[P][M]
>;

/** Every OpenAPI path that declares an operation for ``M``. */
export type ApiPath<M extends HttpMethod> = {
  [P in keyof paths]: [Operation<P, M>] extends [never] ? never : P;
}[keyof paths];

type ParametersOf<Op> = Op extends { parameters: infer X } ? X : never;

// ``[X] extends [never]`` guards below matter: matching ``never`` against an
// ``infer`` pattern would otherwise infer ``unknown`` and accept anything.

type PathParamsOf<Op> = [ParametersOf<Op>] extends [never]
  ? never
  : ParametersOf<Op> extends { path: infer X }
    ? [X] extends [never]
      ? never
      : X
    : never;

type QueryParamsOf<Op> = [ParametersOf<Op>] extends [never]
  ? never
  : ParametersOf<Op> extends { query?: infer X }
    ? [Exclude<X, undefined>] extends [never]
      ? never
      : Exclude<X, undefined>
    : never;

/**
 * openapi-typescript runs with ``defaultNonNullable`` on, so any request
 * field that has a server-side default is emitted as *required*. Clients may
 * legitimately omit those, so request bodies are matched against a deep
 * partial of the schema: field names and value types are still checked.
 *
 * Free-form ``Dict[str, Any]`` fields (``{ [key: string]: unknown }``) accept
 * any object: TS interfaces carry no index signature, so the literal schema
 * type would reject perfectly valid domain objects.
 */
type IsLooseRecord<T> = string extends keyof T
  ? unknown extends T[keyof T]
    ? true
    : false
  : false;

type RequestShape<T> = T extends readonly (infer U)[]
  ? RequestShape<U>[]
  : T extends Blob | FormData
    ? T
    : T extends object
      ? IsLooseRecord<T> extends true
        ? object
        : { [K in keyof T]?: RequestShape<T[K]> }
      : T;

type RequestBodyContent<Op> = Op extends { requestBody?: infer RB }
  ? [Exclude<RB, undefined>] extends [never]
    ? never
    : Exclude<RB, undefined> extends { content: infer C }
      ? C
      : never
  : never;

type RequestBodyOf<Op> = [RequestBodyContent<Op>] extends [never]
  ? never
  : RequestBodyContent<Op> extends { "application/json": infer B }
    ? RequestShape<B>
    : RequestBodyContent<Op> extends { "multipart/form-data": unknown }
      ? FormData
      : RequestBodyContent<Op> extends {
            "application/x-www-form-urlencoded": unknown;
          }
        ? URLSearchParams
        : never;

type BodyIsRequired<Op> = Op extends { requestBody: object } ? true : false;

type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 206;

type JsonContentOf<R> = R extends { content: { "application/json": infer C } }
  ? C
  : undefined;

/**
 * Loosely-declared responses (``unknown`` or ``{ [key: string]: unknown }``,
 * i.e. FastAPI handlers returning a plain ``dict``) collapse to ``unknown`` so
 * call sites narrow them explicitly instead of double-casting.
 */
type Tighten<T> = unknown extends T
  ? unknown
  : T extends { [key: string]: infer V }
    ? string extends keyof T
      ? unknown extends V
        ? unknown
        : T
      : T
    : T;

type ResponseOf<Op> = Op extends { responses: infer Rs }
  ? [Extract<keyof Rs, SuccessStatus>] extends [never]
    ? unknown
    : Tighten<JsonContentOf<Rs[Extract<keyof Rs, SuccessStatus>]>>
  : unknown;

/** Response body type of ``M path`` per the OpenAPI snapshot. */
export type ApiData<P extends ApiPath<M>, M extends HttpMethod> = ResponseOf<
  Operation<P, M>
>;

/** Options shared by typed and untyped calls. */
export interface ApiCallOptions {
  /** Extra headers; they win over the defaults on conflict. */
  headers?: Record<string, string>;
  signal?: AbortSignal | null;
  /** Let the browser finish the request across a page unload. */
  keepalive?: boolean;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  /** Origin/prefix override; defaults to ``getBackendBaseURL()``. */
  baseUrl?: string;
  /** Message for the thrown ``EchoAPIError`` (keeps legacy wording). */
  errorMessage?: (failure: ApiFailure) => string;
}

type PathOption<Op> = [PathParamsOf<Op>] extends [never]
  ? { path?: never }
  : { path: PathParamsOf<Op> };

type QueryOption<Op> = [QueryParamsOf<Op>] extends [never]
  ? { query?: never }
  : object extends QueryParamsOf<Op>
    ? { query?: QueryParamsOf<Op> }
    : { query: QueryParamsOf<Op> };

type BodyOption<Op> = [RequestBodyOf<Op>] extends [never]
  ? { body?: never }
  : BodyIsRequired<Op> extends true
    ? { body: RequestBodyOf<Op> }
    : { body?: RequestBodyOf<Op> };

export type ApiOptions<
  P extends ApiPath<M>,
  M extends HttpMethod,
> = ApiCallOptions &
  PathOption<Operation<P, M>> &
  QueryOption<Operation<P, M>> &
  BodyOption<Operation<P, M>>;

/** Options are optional only when nothing in them is required. */
type OptionsArgs<O> = object extends O ? [options?: O] : [options: O];

type QueryValue = string | number | boolean | null | undefined;

/** Query input for ``untypedApi``; arrays repeat the key. */
export type QueryInit =
  | URLSearchParams
  | Record<string, QueryValue | readonly QueryValue[]>;

export interface UntypedApiOptions extends ApiCallOptions {
  /**
   * Why the typed helpers cannot be used here (e.g. the route is missing
   * from the OpenAPI snapshot). Required so every fallback is explained.
   */
  reason: string;
  query?: QueryInit;
  body?: unknown;
}

interface InternalOptions extends ApiCallOptions {
  path?: object;
  query?: unknown;
  body?: unknown;
  /** Untyped calls pass a finished path; skip ``{param}`` substitution. */
  verbatim?: boolean;
}

function fillPath(template: string, params: object | undefined): string {
  const values = (params ?? {}) as Record<string, unknown>;
  return template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined || value === null) {
      throw new Error(`Missing path parameter "${name}" for ${template}`);
    }
    return encodeURIComponent(String(value));
  });
}

function serializeQuery(query: unknown): string {
  if (!query) return "";
  const params =
    query instanceof URLSearchParams ? query : new URLSearchParams();
  if (!(query instanceof URLSearchParams)) {
    for (const [key, raw] of Object.entries(query as object)) {
      const values: unknown[] = Array.isArray(raw) ? raw : [raw];
      for (const value of values) {
        if (value === undefined || value === null) continue;
        params.append(key, String(value));
      }
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function isRawBody(body: unknown): body is BodyInit {
  return (
    (typeof FormData !== "undefined" && body instanceof FormData) ||
    (typeof Blob !== "undefined" && body instanceof Blob) ||
    (typeof URLSearchParams !== "undefined" &&
      body instanceof URLSearchParams) ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    (typeof ReadableStream !== "undefined" && body instanceof ReadableStream)
  );
}

async function send(
  method: Uppercase<HttpMethod>,
  template: string,
  options: InternalOptions = {},
): Promise<{ path: string; response: Response }> {
  const path = options.verbatim ? template : fillPath(template, options.path);
  const url = `${options.baseUrl ?? getBackendBaseURL()}${path}${serializeQuery(
    options.query,
  )}`;
  const hasBody = options.body !== undefined;
  const rawBody = hasBody && isRawBody(options.body);
  const init: RequestInit = {};
  // GET stays implicit so the init mirrors a plain ``fetch(url, {headers})``.
  if (method !== "GET") init.method = method;
  init.headers = {
    ...echoRequestHeaders(authHeaders(), hasBody && !rawBody),
    ...options.headers,
  };
  if (hasBody) {
    init.body = rawBody
      ? (options.body as BodyInit)
      : JSON.stringify(options.body);
  }
  if (options.signal !== undefined) init.signal = options.signal;
  if (options.keepalive !== undefined) init.keepalive = options.keepalive;
  if (options.cache !== undefined) init.cache = options.cache;
  if (options.credentials !== undefined) {
    init.credentials = options.credentials;
  }

  const response = await fetch(url, init);
  if (!response.ok) {
    const failure = await readApiFailure(method, path, response);
    throw apiErrorFromFailure(failure, options.errorMessage?.(failure));
  }
  return { path, response };
}

async function sendJson<T>(
  method: Uppercase<HttpMethod>,
  template: string,
  options?: InternalOptions,
): Promise<T> {
  const { path, response } = await send(method, template, options);
  if (response.status === 204) return undefined as T;
  const payload = (await response.json()) as T;
  warnOnStubResponse(method, path, payload);
  return payload;
}

function upper(method: HttpMethod): Uppercase<HttpMethod> {
  return method.toUpperCase() as Uppercase<HttpMethod>;
}

export function apiGet<P extends ApiPath<"get">>(
  path: P,
  ...[options]: OptionsArgs<ApiOptions<P, "get">>
): Promise<ApiData<P, "get">> {
  return sendJson("GET", path, options as InternalOptions | undefined);
}

export function apiPost<P extends ApiPath<"post">>(
  path: P,
  ...[options]: OptionsArgs<ApiOptions<P, "post">>
): Promise<ApiData<P, "post">> {
  return sendJson("POST", path, options as InternalOptions | undefined);
}

export function apiPut<P extends ApiPath<"put">>(
  path: P,
  ...[options]: OptionsArgs<ApiOptions<P, "put">>
): Promise<ApiData<P, "put">> {
  return sendJson("PUT", path, options as InternalOptions | undefined);
}

export function apiPatch<P extends ApiPath<"patch">>(
  path: P,
  ...[options]: OptionsArgs<ApiOptions<P, "patch">>
): Promise<ApiData<P, "patch">> {
  return sendJson("PATCH", path, options as InternalOptions | undefined);
}

export function apiDelete<P extends ApiPath<"delete">>(
  path: P,
  ...[options]: OptionsArgs<ApiOptions<P, "delete">>
): Promise<ApiData<P, "delete">> {
  return sendJson("DELETE", path, options as InternalOptions | undefined);
}

/**
 * Typed call that resolves to the raw (already 2xx-checked) ``Response``,
 * for streaming, binary/text bodies, or responses the caller ignores.
 */
export async function apiFetch<M extends HttpMethod, P extends ApiPath<M>>(
  method: M,
  path: P,
  ...[options]: OptionsArgs<ApiOptions<P, M>>
): Promise<Response> {
  const { response } = await send(
    upper(method),
    path,
    options as InternalOptions | undefined,
  );
  return response;
}

/**
 * Escape hatch for routes the OpenAPI snapshot does not describe (or
 * describes wrongly). Same headers/errors/parsing as the typed helpers; the
 * ``path`` is used verbatim, so callers encode their own segments.
 */
export const untypedApi = {
  get<T = unknown>(path: string, options: UntypedApiOptions): Promise<T> {
    return sendJson<T>("GET", path, { ...options, verbatim: true });
  },
  post<T = unknown>(path: string, options: UntypedApiOptions): Promise<T> {
    return sendJson<T>("POST", path, { ...options, verbatim: true });
  },
  put<T = unknown>(path: string, options: UntypedApiOptions): Promise<T> {
    return sendJson<T>("PUT", path, { ...options, verbatim: true });
  },
  patch<T = unknown>(path: string, options: UntypedApiOptions): Promise<T> {
    return sendJson<T>("PATCH", path, { ...options, verbatim: true });
  },
  delete<T = unknown>(path: string, options: UntypedApiOptions): Promise<T> {
    return sendJson<T>("DELETE", path, { ...options, verbatim: true });
  },
  async fetch(
    method: HttpMethod,
    path: string,
    options: UntypedApiOptions,
  ): Promise<Response> {
    const { response } = await send(upper(method), path, {
      ...options,
      verbatim: true,
    });
    return response;
  },
};

/** ``payload.detail`` of a failure when the error body was a JSON object. */
export function failureDetail(failure: ApiFailure): unknown {
  const { payload } = failure;
  return payload && typeof payload === "object" && "detail" in payload
    ? payload.detail
    : undefined;
}

/** ``true`` when ``error`` is an ``EchoAPIError`` with one of ``statuses``. */
export function isApiErrorStatus(
  error: unknown,
  ...statuses: number[]
): error is EchoAPIError {
  return error instanceof EchoAPIError && statuses.includes(error.status);
}
