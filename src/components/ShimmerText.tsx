import type { CSSProperties, ElementType } from "react";
import { cn } from "@/lib/utils";

/**
 * The app's signature lettering effect.
 *
 * Worth knowing before reusing it: this is NOT a gradient. There is no
 * `bg-clip-text` anywhere in the brand — the effect is a per-LETTER
 * animation (`shimmer-letter` in styles.css) that walks a highlight across
 * the word, each letter delayed by its index, cycling between
 * `--foreground` and `--primary` with a glow at the peak. That is why the
 * text has to be split into one span per character, and why copying a
 * `className` alone could never reproduce it.
 *
 * Lives in its own file so the header title and the footer signature are
 * literally the same component: change the effect once and both follow.
 *
 * Accessibility: the whole string is exposed once via `aria-label` and the
 * individual letters are hidden, otherwise a screen reader spells the word
 * out one character at a time.
 */
export function ShimmerText({
  text,
  as: Tag = "span",
  className,
}: {
  text: string;
  /** Element to render — `h1` for the header title, a span elsewhere. */
  as?: ElementType;
  className?: string;
}) {
  return (
    <Tag className={cn("font-bold uppercase tracking-wide", className)} aria-label={text}>
      {text.split("").map((ch, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="shimmer-letter"
          style={{ "--i": i } as CSSProperties}
        >
          {/* Non-breaking: a plain space collapses between two inline-block
              letters and jams the words together. */}
          {ch === " " ? " " : ch}
        </span>
      ))}
    </Tag>
  );
}
