import { EchoAgeMark } from "./echo-age";

type EchoBrandMarkProps = {
  className?: string;
  size?: "md" | "lg";
};

/**
 * Legacy entry point for the brand mark. It now renders the ECHO AGE
 * sphere "E" (see ./echo-age.tsx); `md` ≈ the old 36px tile, `lg` ≈ 44px.
 */
export function EchoBrandMark({ className, size = "md" }: EchoBrandMarkProps) {
  return (
    <EchoAgeMark className={className} size={size === "lg" ? "md" : "sm"} />
  );
}
