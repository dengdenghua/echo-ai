"""App Server request shaping and response checks for ``CodexExecutionSession``."""

from __future__ import annotations

from collections.abc import Mapping

from .types import JsonValue, Notification, ProtocolError, RemoteError

_METHOD_NOT_FOUND = -32601
_INVALID_REQUEST = -32600


def _thread_extra_params(
    overrides: Mapping[str, object],
    *,
    resume: bool,
) -> dict[str, object]:
    """Remove fields owned by the client's typed thread convenience API."""

    reserved = {
        "cwd",
        "model",
        "approvalPolicy",
        "approvalsReviewer",
        "sandbox",
        "permissions",
        "ephemeral",
    }
    # Resume must reassert every mutable capability selector.  Otherwise the
    # App Server may retain the previous turn's dynamic tool allowlist.
    supported_extras = {
        "runtimeWorkspaceRoots",
        "dynamicTools",
        "selectedCapabilityRoots",
        "developerInstructions",
    }
    return {
        key: value
        for key, value in overrides.items()
        if key not in reserved and key in supported_extras
    }


def _turn_extra_params(overrides: Mapping[str, object]) -> dict[str, object]:
    """Allow only local named-profile fields on ``turn/start``.

    In particular, never forward ``environments``. App Server treats an empty
    list as disabling the local execution environment and a non-empty list as
    an explicit environment selection; neither is caller-controlled here.
    """

    supported = {
        "cwd",
        "runtimeWorkspaceRoots",
        "approvalPolicy",
        "approvalsReviewer",
        "permissions",
    }
    return {key: value for key, value in overrides.items() if key in supported}


def _permission_profile(overrides: Mapping[str, object]) -> str:
    value = overrides.get("permissions")
    if not isinstance(value, str) or not value.strip():
        raise ProtocolError("security context did not provide a named permissions profile")
    return value


def _entity_id(
    payload: Mapping[str, JsonValue],
    *,
    entity: str,
    operation: str,
) -> str:
    nested = payload.get(entity)
    value = nested.get("id") if isinstance(nested, Mapping) else None
    if not isinstance(value, str) or not value.strip():
        raise ProtocolError(f"{operation} response {entity} is missing a non-empty id")
    return value


def _unsupported_api(error: RemoteError) -> bool:
    return error.code == _METHOD_NOT_FOUND


def _thread_not_found(error: RemoteError, thread_id: str) -> bool:
    return error.code == _INVALID_REQUEST and error.message == f"thread not found: {thread_id}"


def _environment_sandbox_refused(error: RemoteError) -> bool:
    """Resume failed only because the default local environment's sandbox could not start."""
    return "failed to prepare fs sandbox" in error.message


def _notification_matches(
    notification: Notification,
    *,
    thread_id: str,
    turn_id: str,
) -> bool:
    params = notification.params
    event_thread_id = params.get("threadId")
    if notification.method == "thread/tokenUsage/updated":
        return event_thread_id == thread_id
    event_turn_id = params.get("turnId")
    if event_turn_id is None:
        raw_turn = params.get("turn")
        if isinstance(raw_turn, Mapping):
            event_turn_id = raw_turn.get("id")
    return event_thread_id == thread_id and event_turn_id == turn_id
