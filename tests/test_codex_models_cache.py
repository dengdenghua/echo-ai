"""Codex's model list is shared across one principal's conversations."""

from __future__ import annotations

import json
import os
from types import SimpleNamespace

from runtime.execution.codex_backend.models_cache import (
    MODELS_CACHE_NAME,
    seed_models_cache,
    share_models_cache,
    shared_cache_path,
)


def _context(tmp_path, name, *, realm="realm-a", tenant="tenant-a"):
    home = tmp_path / "realms" / name / "codex-home"
    home.mkdir(parents=True)
    return SimpleNamespace(state_root=tmp_path, codex_home=home, realm_key=realm, tenant_key=tenant)


def _cache(models):
    return json.dumps({"client_version": "0.162.0", "models": models}).encode()


def test_a_new_conversation_starts_from_the_list_an_earlier_one_fetched(tmp_path):
    first = _context(tmp_path, "first")
    (first.codex_home / MODELS_CACHE_NAME).write_bytes(_cache(["gpt-a"]))

    assert share_models_cache(first) is True
    assert seed_models_cache(_context(tmp_path, "second")) is True
    second_home = tmp_path / "realms" / "second" / "codex-home"
    assert (second_home / MODELS_CACHE_NAME).read_bytes() == _cache(["gpt-a"])
    # Unchanged lists are not written back.
    assert share_models_cache(first) is False


def test_the_list_never_crosses_principals(tmp_path):
    mine = _context(tmp_path, "mine")
    (mine.codex_home / MODELS_CACHE_NAME).write_bytes(_cache(["gpt-a"]))
    share_models_cache(mine)

    other = _context(tmp_path, "other", tenant="tenant-b")
    assert seed_models_cache(other) is False
    assert not (other.codex_home / MODELS_CACHE_NAME).exists()


def test_a_refreshed_list_replaces_the_shared_copy_but_an_older_one_does_not(tmp_path):
    old = _context(tmp_path, "old")
    new = _context(tmp_path, "new")
    (old.codex_home / MODELS_CACHE_NAME).write_bytes(_cache(["gpt-a"]))
    share_models_cache(old)
    shared = shared_cache_path(old)
    (new.codex_home / MODELS_CACHE_NAME).write_bytes(_cache(["gpt-b"]))
    stamp = shared.stat().st_mtime
    os.utime(new.codex_home / MODELS_CACHE_NAME, (stamp + 60, stamp + 60))

    assert share_models_cache(new) is True
    assert shared.read_bytes() == _cache(["gpt-b"])
    os.utime(old.codex_home / MODELS_CACHE_NAME, (stamp - 60, stamp - 60))
    assert share_models_cache(old) is False
    assert shared.read_bytes() == _cache(["gpt-b"])


def test_the_login_home_seeds_the_first_conversation(tmp_path):
    login_home = tmp_path / "login"
    login_home.mkdir()
    (login_home / MODELS_CACHE_NAME).write_bytes(_cache(["gpt-a"]))
    context = _context(tmp_path, "first")

    assert seed_models_cache(context, fallback_home=login_home) is True
    assert (context.codex_home / MODELS_CACHE_NAME).read_bytes() == _cache(["gpt-a"])


def test_a_home_with_its_own_list_or_a_broken_shared_copy_is_left_alone(tmp_path):
    context = _context(tmp_path, "first")
    shared = shared_cache_path(context)
    shared.parent.mkdir(parents=True)
    shared.write_bytes(b"not json")
    assert seed_models_cache(context) is False
    assert not (context.codex_home / MODELS_CACHE_NAME).exists()

    shared.write_bytes(_cache(["gpt-a"]))
    (context.codex_home / MODELS_CACHE_NAME).write_bytes(_cache(["gpt-own"]))
    assert seed_models_cache(context) is False
    assert (context.codex_home / MODELS_CACHE_NAME).read_bytes() == _cache(["gpt-own"])
