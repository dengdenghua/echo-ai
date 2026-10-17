import { FolderIcon, FolderOpenIcon, Loader2Icon } from "lucide-react";

import { useI18n } from "@/core/i18n/hooks";
import { basename } from "@/lib/path-utils";

import {
  LocationAction,
  LocationItem,
  LocationLabel,
  LocationNote,
  LocationSeparator,
  shortenPath,
} from "./work-location-picker";
import { normalizePathKey } from "./workdir-selector-utils";

/**
 * The "this computer" submenu of the work-location menu: the personal space,
 * the recent folders (the current one first) and the system folder picker.
 */
export function WorkdirLocationItems({
  isWorkDirLocked,
  lockedHint,
  lockedOpenFolderLabel,
  personalSpaceLabel,
  runsLocally,
  workDir,
  folderName,
  folders,
  isPicking,
  onSelectPersonalSpace,
  onChooseFolder,
  onPickFolder,
}: {
  isWorkDirLocked: boolean;
  lockedHint: string;
  lockedOpenFolderLabel: string;
  personalSpaceLabel: string;
  runsLocally: boolean;
  workDir: string;
  folderName: string;
  folders: string[];
  isPicking: boolean;
  onSelectPersonalSpace: () => void;
  onChooseFolder: (dir: string) => void;
  onPickFolder: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {isWorkDirLocked ? <LocationNote>{lockedHint}</LocationNote> : null}
      {isWorkDirLocked ? null : (
        <LocationItem
          icon={<FolderIcon className="size-3.5" />}
          title={personalSpaceLabel}
          selected={runsLocally && !workDir}
          onSelect={onSelectPersonalSpace}
        />
      )}
      {folders.length > 0 ? (
        <>
          <LocationLabel>{t.codeMode.recentWorkspaces}</LocationLabel>
          {folders.map((dir) => (
            <LocationItem
              key={dir}
              icon={<FolderIcon className="size-3.5" />}
              title={dir === workDir ? folderName : basename(dir) || dir}
              subtitle={shortenPath(dir)}
              hint={dir}
              selected={
                runsLocally &&
                normalizePathKey(dir) === normalizePathKey(workDir)
              }
              onSelect={() => onChooseFolder(dir)}
            />
          ))}
        </>
      ) : null}
      <LocationSeparator />
      <LocationAction
        icon={
          isPicking ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <FolderOpenIcon className="size-3.5" />
          )
        }
        onSelect={onPickFolder}
      >
        {isWorkDirLocked ? lockedOpenFolderLabel : t.workLocation.openFolder}
      </LocationAction>
    </>
  );
}
