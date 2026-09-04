import type { MarketplaceId } from "@/lib/marketplace";

export interface ValuePoint {
  /** "YYYY-MM-DD" */
  date: string;
  /** Total inventory value in EUR (the app's internal base currency). */
  value: number;
}

const HISTORY_KEY_PREFIX = "cs2-value-history-";
const MAX_POINTS = 3650; // ~10 years of daily points, generous safety cap

function historyKey(marketplace: MarketplaceId, portfolioId: string): string {
  return `${HISTORY_KEY_PREFIX}${marketplace}:${portfolioId}`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Reads the recorded value history for one specific marketplace. Each
 * marketplace has its own independent series — switching the active
 * marketplace is a change of perspective, not a real portfolio-value event,
 * so histories must never be mixed together. */
export function readHistory(marketplace: MarketplaceId, portfolioId: string): ValuePoint[] {
  try {
    const raw = localStorage.getItem(historyKey(marketplace, portfolioId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ValuePoint[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Records (or updates) today's total-inventory-value snapshot for one
 * marketplace. Safe to call often — repeated calls on the same day just
 * overwrite today's point instead of creating duplicates, so real history
 * accumulates one point per day for as long as the site is used.
 */
export function recordSnapshot(
  marketplace: MarketplaceId,
  portfolioId: string,
  value: number,
): void {
  try {
    const history = readHistory(marketplace, portfolioId);
    const today = todayStr();
    const last = history[history.length - 1];
    if (last && last.date === today) {
      last.value = value;
    } else {
      history.push({ date: today, value });
    }
    localStorage.setItem(
      historyKey(marketplace, portfolioId),
      JSON.stringify(history.slice(-MAX_POINTS)),
    );
  } catch {
    /* ignore — non-fatal */
  }
}

/**
 * Generates `count` plausible-looking daily points ending just before
 * `anchorDate`, trending toward `anchorValue`. Used ONLY to fill in a chart
 * visually when real recorded history is too short for the selected
 * timeframe — never written to storage, purely a display-time illustration.
 * Uses randomized day-to-day swings (3%-10%) so the sample trend reads as a
 * real, dynamic price chart rather than a flat line, while still gently
 * converging toward the real anchor value by the end.
 */
export function synthesizeBackfill(
  count: number,
  anchorDate: Date,
  anchorValue: number,
): ValuePoint[] {
  if (count <= 0) return [];
  // A brand-new marketplace (e.g. just started tracking CSFloat prices) can
  // have a real anchor value of 0 or near-0 if most skins don't have a price
  // entered for it yet. Bailing out here used to leave the chart with a
  // single point, which renders as a flat/degenerate line — use a safe
  // minimum baseline instead so there's always a real, varied trend to show.
  const safeAnchor = Math.max(anchorValue, 1);
  const startFactor = 0.75 + Math.random() * 0.4; // start ~75%-115% of the anchor value
  const startValue = safeAnchor * startFactor;
  const floor = safeAnchor * 0.05;

  const points: ValuePoint[] = [];
  let value = startValue;
  for (let i = count; i >= 1; i--) {
    const d = new Date(anchorDate);
    d.setDate(d.getDate() - i);
    const progress = 1 - i / count;
    const trendTarget = startValue + (safeAnchor - startValue) * progress;

    // Gentle pull back toward the trend line, plus a randomized daily
    // swing of 3%-10% (up or down) for a dynamic, "real chart" look.
    const pull = (trendTarget - value) * 0.18;
    const swingPct = (0.03 + Math.random() * 0.07) * (Math.random() < 0.5 ? -1 : 1);
    value = Math.max(floor, value + pull + value * swingPct);

    points.push({ date: d.toISOString().slice(0, 10), value });
  }
  return points;
}
