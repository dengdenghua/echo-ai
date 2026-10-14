import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Custom font-size and letter-spacing names must be registered; otherwise
// tailwind-merge treats text-micro as a colour and drops it when a component
// also supplies text-foreground (and tracking-caps would never override a
// tracking-wide default). Keep in sync with the @theme block in globals.css.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "ui",
        "ui-caption",
        "ui-body",
        "ui-title",
        "micro",
        "mini",
        "caption",
        "2xs",
        "3xs",
      ],
      tracking: ["caps", "eyebrow"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Shared class for external links (underline by default). */
export const externalLinkClass =
  "text-primary underline underline-offset-2 hover:no-underline";
/** Link style without underline by default (e.g. for streaming/loading). */
export const externalLinkClassNoUnderline = "text-primary hover:underline";
