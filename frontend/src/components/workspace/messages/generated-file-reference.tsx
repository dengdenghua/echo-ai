import { useContext } from "react";
import { FileReferenceChip } from "@/components/ui/file-reference-chip";
import { artifactDisplayPath } from "@/core/artifacts/utils";
import { dispatchOpenArtifact } from "@/core/artifacts/open-artifact";
import { FileReferenceScope } from "@/core/navigation/file-reference";

/** Shared presentation and thread-scoped handoff for generated file links. */
export function GeneratedFileReference({
  artifactRef,
  href,
  label,
}: {
  artifactRef: string;
  href?: string;
  label?: string;
}) {
  const scope = useContext(FileReferenceScope);
  const path = artifactDisplayPath(artifactRef);
  return (
    <FileReferenceChip
      path={path}
      label={label && label !== href && label !== path ? label : undefined}
      onClick={() =>
        dispatchOpenArtifact(artifactRef, { threadId: scope.threadId })
      }
    />
  );
}
