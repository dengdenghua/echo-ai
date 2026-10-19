"""Tenant-scope and payload redaction for the JSONL journal.

Extracted from ``journal`` to keep the module under the god-file threshold.
``JSONLJournal`` mixes this in, so every method stays available on the
journal instance and the redaction contract is unchanged.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel

from runtime.memory.journal._journal_models import JournalEvent
from runtime.memory.journal._journal_parse import _parse_event
from runtime.safety.auth.scope import TenantScope


class JournalRedactionMixin:
    """Structured, identity-preserving redaction for file journals."""

    _redactor: Any

    @staticmethod
    def _scope_digest(value: str, *, field: str) -> str:
        """Return a deterministic, redactor-safe storage identifier.

        Ownership fields are authorization data, so replacing an embedded
        email/phone/token with a generic ``[REDACTED:*]`` marker is not safe:
        unrelated principals would collapse onto the same durable scope.  A
        field-separated digest preserves equality without persisting the PII.

        The hexadecimal digest is translated to letters only because the
        built-in phone detector intentionally accepts long digit runs.  Keeping
        the canonical identifier outside every built-in PII shape makes the
        operation idempotent when an event crosses more than one journal
        wrapper.
        """

        digest = hashlib.sha256(f"echo-journal-scope-v1\0{field}\0{value}".encode()).hexdigest()
        letters_only = digest.translate(str.maketrans("0123456789", "ghijklmnop"))
        return f"echo-scope-{field}-vone-{letters_only}"

    def _storage_scope_value(self, value: str | None, *, field: str) -> str | None:
        """Pseudonymize a scope value exactly when redaction would mutate it."""

        if value is None or self._redactor is None:
            return value
        text = str(value)
        if text.startswith(f"echo-scope-{field}-vone-"):
            return text
        try:
            redacted = self._redactor.redact(text)
        except Exception:  # noqa: BLE001 - broken redactors remain best-effort
            return text
        if redacted == text:
            return text
        return self._scope_digest(text, field=field)

    def _storage_scoped_event(self, event: JournalEvent) -> JournalEvent:
        """Map authoritative ownership fields before whole-payload redaction."""

        tenant_id = self._storage_scope_value(event.tenant_id, field="tenant")
        owner_actor_id = self._storage_scope_value(event.owner_actor_id, field="owner")
        if tenant_id == event.tenant_id and owner_actor_id == event.owner_actor_id:
            return event
        return event.model_copy(
            update={
                "tenant_id": tenant_id,
                "owner_actor_id": owner_actor_id,
            }
        )

    @staticmethod
    def _is_redaction_protected_model_field(field_name: str, field_value: Any) -> bool:
        """Return whether one typed model field is structural journal data.

        Loose PII patterns must not rewrite typed identifiers, timestamps, or
        the hashes that bind tool-effect receipts: a phone-shaped digit run
        inside one of those values is still structural data, not user content.
        Ownership fields are deliberately not restored here; they are
        pseudonymized by ``_storage_scoped_event`` and remain covered by the
        fail-closed ownership check below.
        """

        if field_name in {"tenant_id", "owner_actor_id"}:
            return False
        return bool(
            field_name
            in {
                "schema_version",
                "event_type",
                "effect_key",
                "args_fingerprint",
            }
            or field_name.endswith(("_fingerprint", "_hash"))
            or isinstance(field_value, (UUID, date, datetime, Enum))
        )

    @classmethod
    def _restore_redaction_protected_model_fields(
        cls,
        model: Any,
        original: Any,
        redacted: Any,
    ) -> Any:
        """Restore typed structural fields while retaining payload redaction.

        Only Pydantic model fields receive structural protection.  Arbitrary
        dictionaries such as tool ``args`` and ``output`` are still scanned in
        full, even if a user-controlled key happens to end in ``_id``.
        """

        if isinstance(model, BaseModel):
            if not isinstance(original, dict) or not isinstance(redacted, dict):
                return redacted
            restored = dict(redacted)
            for field_name in type(model).model_fields:
                if field_name not in original:
                    continue
                field_value = getattr(model, field_name, None)
                if cls._is_redaction_protected_model_field(field_name, field_value):
                    restored[field_name] = original[field_name]
                    continue
                if field_name in redacted:
                    restored[field_name] = cls._restore_redaction_protected_model_fields(
                        field_value,
                        original[field_name],
                        redacted[field_name],
                    )
            return restored
        if isinstance(model, (list, tuple)):
            if not isinstance(original, list) or not isinstance(redacted, list):
                return redacted
            return [
                cls._restore_redaction_protected_model_fields(item, original_item, redacted_item)
                for item, original_item, redacted_item in zip(
                    model,
                    original,
                    redacted,
                    strict=False,
                )
            ]
        if isinstance(model, dict):
            if not isinstance(original, dict) or not isinstance(redacted, dict):
                return redacted
            restored = dict(redacted)
            for key, item in model.items():
                if key not in original or key not in redacted:
                    continue
                restored[key] = cls._restore_redaction_protected_model_fields(
                    item,
                    original[key],
                    redacted[key],
                )
            return restored
        return redacted

    def _redact_json_string_values(self, value: Any) -> Any:
        """Redact string leaves without exposing JSON syntax to regexes.

        Redacting a serialized JSON document lets a loose pattern consume
        structural data: numeric literals, quoted field names, separators, or
        fragments of typed identifiers.  Walking decoded data keeps the
        redactor's input boundary aligned with one actual application string.
        Dictionary keys are schema, not payload, and are deliberately left
        untouched.
        """

        if self._redactor is None:
            return value
        if isinstance(value, str):
            try:
                redacted = self._redactor.redact(value)
            except Exception:  # noqa: BLE001 - redaction remains best-effort
                return value
            return redacted if isinstance(redacted, str) else value
        if isinstance(value, list):
            return [self._redact_json_string_values(item) for item in value]
        if isinstance(value, dict):
            return {key: self._redact_json_string_values(item) for key, item in value.items()}
        return value

    @classmethod
    def _string_redaction_changes(
        cls,
        original: Any,
        redacted: Any,
        path: tuple[str | int, ...] = (),
    ) -> list[tuple[tuple[str | int, ...], str]]:
        """Return changed string leaves in deterministic document order."""

        if isinstance(original, str) and isinstance(redacted, str):
            return [] if original == redacted else [(path, redacted)]
        if isinstance(original, list) and isinstance(redacted, list):
            changes: list[tuple[tuple[str | int, ...], str]] = []
            for index, (original_item, redacted_item) in enumerate(
                zip(original, redacted, strict=False)
            ):
                changes.extend(
                    cls._string_redaction_changes(
                        original_item,
                        redacted_item,
                        (*path, index),
                    )
                )
            return changes
        if isinstance(original, dict) and isinstance(redacted, dict):
            changes = []
            for key, original_item in original.items():
                if key not in redacted:
                    continue
                changes.extend(
                    cls._string_redaction_changes(
                        original_item,
                        redacted[key],
                        (*path, key),
                    )
                )
            return changes
        return []

    @classmethod
    def _replace_json_path(
        cls,
        value: Any,
        path: tuple[str | int, ...],
        replacement: str,
    ) -> Any:
        """Copy only the containers on ``path`` and replace one leaf."""

        if not path:
            return replacement
        head, *tail = path
        if isinstance(head, int) and isinstance(value, list):
            updated_list = list(value)
            updated_list[head] = cls._replace_json_path(
                updated_list[head],
                tuple(tail),
                replacement,
            )
            return updated_list
        if isinstance(head, str) and isinstance(value, dict):
            updated_dict = dict(value)
            updated_dict[head] = cls._replace_json_path(
                updated_dict[head],
                tuple(tail),
                replacement,
            )
            return updated_dict
        return value

    @staticmethod
    def _dump_json_payload(payload: Any) -> str:
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    @staticmethod
    def _serialized_event_keeps_structure(event: JournalEvent, line: str) -> bool:
        """Validate both the event schema and its durable identity envelope."""

        try:
            durable_event = _parse_event(line)
        except (TypeError, ValueError):
            return False
        return bool(
            durable_event.event_id == event.event_id
            and durable_event.event_type == event.event_type
            and durable_event.task_id == event.task_id
            and durable_event.arm_id == event.arm_id
            and durable_event.tenant_id == event.tenant_id
            and durable_event.owner_actor_id == event.owner_actor_id
            and durable_event.ts == event.ts
            and durable_event.source == event.source
        )

    def _visible(self, event: JournalEvent, scope: TenantScope | None) -> bool:
        """Compare a request scope with the exact durable scope representation."""

        if scope is None or scope.allow_cross_tenant:
            return True
        tenant_ids = {
            scope.tenant_id,
            self._storage_scope_value(scope.tenant_id, field="tenant"),
        }
        owner_actor_ids = {
            scope.actor_id,
            self._storage_scope_value(scope.actor_id, field="owner"),
        }
        return bool(
            event.tenant_id
            and event.owner_actor_id
            and event.tenant_id in tenant_ids
            and event.owner_actor_id in owner_actor_ids
        )
