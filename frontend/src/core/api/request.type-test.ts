/**
 * Compile-time contract for ``./request`` — checked by ``tsc --noEmit`` and
 * never imported at runtime. Each ``@ts-expect-error`` must stay an error;
 * if one starts compiling, the typed layer lost a guarantee.
 */
import type { components } from "./openapi-types";
import {
  apiGet,
  apiPost,
  apiPut,
  untypedApi,
  type ApiData,
  type ApiPath,
} from "./request";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
function assertType<T extends true>(_value?: T): void {}

export function requestTypeContract(threadId: string): void {
  // Path params are required, named and typed.
  void apiGet("/api/cowork/{thread_id}", { path: { thread_id: threadId } });
  // @ts-expect-error -- missing the required path params
  void apiGet("/api/cowork/{thread_id}");
  // @ts-expect-error -- wrong path param name
  void apiGet("/api/cowork/{thread_id}", { path: { id: threadId } });

  // Unknown paths and wrong verbs do not compile.
  // @ts-expect-error -- not in the OpenAPI snapshot
  void apiGet("/api/definitely-not-a-route");
  // @ts-expect-error -- /api/teams/{team_id}/join-policy has no POST
  void apiPost("/api/teams/{team_id}/join-policy", {
    path: { team_id: "t" },
  });

  // Query params follow the spec.
  void apiGet("/api/cowork/{thread_id}/search", {
    path: { thread_id: threadId },
    query: { q: "x", limit: 3 },
  });
  void apiGet("/api/cowork/{thread_id}/search", {
    path: { thread_id: threadId },
    // @ts-expect-error -- limit is a number
    query: { limit: "3" },
  });
  // @ts-expect-error -- this operation declares no query params
  void apiGet("/api/teams", { query: { a: 1 } });
  // @ts-expect-error -- a GET without a request body
  void apiGet("/api/teams", { body: 1 });

  // JSON bodies follow the request schema (defaulted fields optional).
  void apiPut("/api/cowork/{thread_id}/roster", {
    path: { thread_id: threadId },
    body: { mode: "chat" },
  });
  void apiPut("/api/cowork/{thread_id}/roster", {
    path: { thread_id: threadId },
    // @ts-expect-error -- agent_ids is string[]
    body: { mode: "chat", agent_ids: [1] },
  });
  // @ts-expect-error -- the operation declares a required body
  void apiPut("/api/cowork/{thread_id}/roster", {
    path: { thread_id: threadId },
  });
  void apiPost("/api/collab/{thread_id}/deliveries/{delivery_id}/retry", {
    path: { thread_id: threadId, delivery_id: "d" },
    // @ts-expect-error -- the operation declares no body
    body: {},
  });

  // Free-form ``Dict[str, Any]`` fields accept interface-typed objects.
  interface ReplyRef {
    message_id: string;
  }
  const replyTo: ReplyRef = { message_id: "m1" };
  void apiPost("/api/collab/{thread_id}/room-message", {
    path: { thread_id: threadId },
    body: { text: "hi", reply_to: replyTo },
  });
  void apiPost("/api/collab/{thread_id}/room-message", {
    path: { thread_id: threadId },
    // @ts-expect-error -- still not a free-for-all: text must be a string
    body: { text: 1 },
  });

  // Untyped fallbacks must say why.
  // @ts-expect-error -- reason is required
  void untypedApi.get("/api/x", {});
  void untypedApi.get("/api/x", { reason: "route missing from snapshot" });

  // Loose ``dict`` responses collapse to ``unknown``; precise ones survive.
  assertType<Equals<ApiData<"/api/teams", "get">, unknown>>();
  assertType<
    Equals<
      ApiData<"/api/coder/codex/model-profile", "get">,
      components["schemas"]["CodexModelProfileResponse"]
    >
  >();
  assertType<"/api/cowork/{thread_id}" extends ApiPath<"get"> ? true : false>();
}
