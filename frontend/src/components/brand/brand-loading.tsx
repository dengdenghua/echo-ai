import { BrandTopProgress } from "@/components/brand/brand-progress";
import { EchoBrandMark } from "@/components/brand/echo-brand-mark";
import { cn } from "@/lib/utils";

/** Full-screen boot state that matches the index.html splash and route fallback. */
export function BrandLoading({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "flex h-screen w-full flex-col items-center justify-center gap-4",
        className,
      )}
    >
      <BrandTopProgress fixed />
      <EchoBrandMark size="lg" breathe />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}
