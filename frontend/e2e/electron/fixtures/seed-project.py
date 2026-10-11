"""Seed a fixed plan in the Electron test's isolated data directory."""

import json
import shutil
import sys
from pathlib import Path

from runtime.platform.plugins.workbench_package import (
    WorkbenchPackageStore,
    verify_workbench_package_trust,
)
from runtime.projectos.model import PROJECT_ORIGIN_APP, Milestone, Project
from runtime.projectos.store import ProjectStore

data_dir, actor_id, tenant_id = sys.argv[1:]
store = ProjectStore(Path(data_dir) / "projectos")
# Install the locally built UI fixture with its ordinary integrity record.
# This is an unsigned local candidate, not a trusted marketplace release.
packages = Path(data_dir) / "plugins" / "workbench"
package = packages / "projects"
shutil.copytree(Path(__file__).resolve().parents[4] / "extensions/workbench-apps/projects", package)
manifest = WorkbenchPackageStore(packages).load_manifest("projects")
trust = verify_workbench_package_trust(package, manifest, require_trusted=False)
record = packages / ".lifecycle" / "trust" / "projects.json"
record.parent.mkdir(parents=True, exist_ok=True)
record.write_text(json.dumps(trust), encoding="utf-8")
store.save_project(
    Project(
        id="P-desktop-closure",
        name="Desktop approval verification",
        goal="Verify the owner decision without executing any tasks",
        origin=PROJECT_ORIGIN_APP,
        owner_id=actor_id,
        tenant_id=tenant_id,
        milestone_ids=["M-desktop-closure"],
        current_ms="M-desktop-closure",
    )
)
store.save_milestone(
    "P-desktop-closure",
    Milestone(
        id="M-desktop-closure",
        name="Review phase",
        goal="Verify persisted approval",
        spec={
            "requires_owner_acceptance": True,
            "phase_agents": ["eve"],
            "ai_budget_usd": None,
        },
    ),
)
