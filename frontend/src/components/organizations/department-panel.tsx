import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createOrgDepartment,
  deleteOrgDepartment,
  type OrgDepartment,
} from "@/core/organizations/api";
import type { OrgCopy } from "@/core/organizations/copy";
import { selectClass } from "./member-controls";
import type { OrgAction } from "./use-org-action";

// Iterative ancestry prevents a malformed/cyclic response from hanging rendering.
export function departmentPath(
  department: OrgDepartment,
  entries: OrgDepartment[],
): string {
  const names = [department.name];
  const visited = new Set([department.id]);
  let parent = entries.find((entry) => entry.id === department.parent_id);
  while (parent && !visited.has(parent.id)) {
    names.unshift(parent.name);
    visited.add(parent.id);
    const id = parent.parent_id;
    parent = entries.find((entry) => entry.id === id);
  }
  return names.join(" / ");
}
export function DepartmentOptions({
  departments,
  copy,
}: {
  departments: OrgDepartment[];
  copy: OrgCopy;
}) {
  return (
    <>
      <option value="">{copy.root}</option>
      {departments.map((department) => (
        <option key={department.id} value={department.id}>
          {departmentPath(department, departments)}
        </option>
      ))}
    </>
  );
}
export function DepartmentPanel({
  orgId,
  departments,
  manage,
  copy,
  action,
}: {
  orgId: string;
  departments: OrgDepartment[];
  manage: boolean;
  copy: OrgCopy;
  action: OrgAction;
}) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const parentId = departments.some((entry) => entry.id === parent)
    ? parent
    : "";
  return (
    <section className="space-y-3" aria-label={copy.departments}>
      <h2 className="text-lg font-semibold">{copy.departments}</h2>
      {!departments.length && (
        <p className="text-sm text-muted-foreground">{copy.none}</p>
      )}
      <ul className="space-y-2">
        {departments.map((department) => (
          <li
            key={department.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
          >
            <span className="min-w-0 flex-1 break-words text-sm">
              {departmentPath(department, departments)}
            </span>
            {manage && (
              <Button
                variant="outline"
                disabled={action.busy}
                aria-label={`${copy.delete}: ${department.name}`}
                onClick={() =>
                  action.request({
                    title: copy.confirmDept,
                    description: `${department.name}. ${copy.deptCascade}`,
                    run: () => deleteOrgDepartment(orgId, department.id),
                  })
                }
              >
                {copy.delete}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {manage && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim() || action.busy) return;
            void action.run(async () => {
              await createOrgDepartment(orgId, name.trim(), parentId || null);
              setName("");
            });
          }}
        >
          <label className="min-w-0 flex-1 basis-48 text-sm">
            {copy.name}
            <Input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="grid min-w-0 gap-1 text-sm">
            {copy.parent}
            <select
              className={selectClass}
              value={parentId}
              onChange={(event) => setParent(event.target.value)}
            >
              <DepartmentOptions departments={departments} copy={copy} />
            </select>
          </label>
          <Button disabled={action.busy || !name.trim()}>{copy.addDept}</Button>
        </form>
      )}
    </section>
  );
}
