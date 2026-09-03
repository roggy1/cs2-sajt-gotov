import { useEffect, useRef, useState, useCallback } from "react";
import { useCurrency } from "@/lib/currency";
import type { Wear } from "@/lib/wear";

// Defined in wear.ts, which carries the exterior rules and no React
// dependency; re-exported here so every existing import keeps working.
export { WEARS, type Wear } from "@/lib/wear";

// Same arrangement for the portfolio arithmetic: it lives in a React-free
// module so it can be unit-tested, and every existing
// `from "@/lib/skins"` import keeps resolving.
export * from "@/lib/portfolioMath";

export const WEAR_STYLES: Record<Wear, string> = {
  "Factory New": "bg-profit/15 text-profit border-profit/40",
  "Minimal Wear": "bg-primary/15 text-primary border-primary/40",
  "Field-Tested": "bg-foreground/10 text-foreground border-border",
  "Well-Worn": "bg-loss/10 text-loss/90 border-loss/30",
  "Battle-Scarred": "bg-loss/20 text-loss border-loss/50",
};

// All prices are stored internally as EUR. This hook returns a formatter that
// converts to the user's selected display currency (using live FX rates from
// CurrencyProvider) and formats it with the correct locale/symbol.
export function useMoney() {
  const { currency, rates } = useCurrency();

  return useCallback(
    (n: number) => {
      const amount = Number.isFinite(n) ? n : 0;
      switch (currency) {
        case "usd":
          return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
            amount * rates.usd,
          );
        case "gbp":
          return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
            amount * rates.gbp,
          );
        case "rub":
          return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(
            amount * rates.rub,
          );
        case "eur":
        default:
          return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
            amount,
          );
      }
    },
    [currency, rates],
  );
}

export function useLocalStorage<T>(key: string, initial: T, migrate?: (raw: unknown) => T) {
  const [value, setValue] = useState<T>(initial);
  /**
   * WHICH key the value in state came from — not merely "has loaded".
   *
   * This is the fix for a real data-loss bug. When `key` changes (switching
   * portfolio swaps `cs2-inventory:a` for `cs2-inventory:b`) both effects
   * below run in the same commit. The read effect calls `setValue`, but
   * that only schedules a render — the write effect in this same pass still
   * closes over the PREVIOUS portfolio's items and, with a plain
   * `loaded` boolean, happily wrote them under the NEW key. Switching
   * portfolios therefore overwrote the destination with the source.
   *
   * Comparing the loaded key against the current one makes that pass a
   * no-op: the write only happens once state and key belong together.
   */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // `initial` and `migrate` are usually inline literals, so depending on
  // them directly would re-read storage on every render.
  const initialRef = useRef(initial);
  const migrateRef = useRef(migrate);
  migrateRef.current = migrate;

  useEffect(() => {
    let next = initialRef.current;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        next = migrateRef.current ? migrateRef.current(parsed) : (parsed as T);
      }
    } catch {
      /* ignore */
    }
    // Always set, including the empty case: moving to a portfolio with no
    // stored data must clear the previous one's items out of state rather
    // than leave them on screen (and then persist them under the new key).
    setValue(next);
    setLoadedKey(key);
  }, [key]);

  useEffect(() => {
    if (loadedKey === key) localStorage.setItem(key, JSON.stringify(value));
  }, [key, value, loadedKey]);

  return [value, setValue] as const;
}
