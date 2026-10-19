import { PlusIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import {
  creationCopy,
  creationRoute,
  type CreationKind,
} from "@/core/i18n/locales/asset-creation";

export function CreateAssetButton({ kind }: { kind: CreationKind }) {
  const navigate = useNavigate();
  const { locale } = useI18n();
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => void navigate(creationRoute(kind, locale))}
    >
      <PlusIcon className="size-4" />
      {creationCopy(locale)[kind]}
    </Button>
  );
}
