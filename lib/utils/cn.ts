import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge does not know the custom font-size tokens defined in
 * app/globals.css. Without this, `cn("text-primary-foreground", "text-small")`
 * treats both as text-color utilities and drops the foreground color — which
 * made primary buttons render dark-on-green.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "h1", "h2", "h3", "body", "small", "caption"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
