import { useQuery } from "@tanstack/react-query";

/**
 * Skinport sales history — what copies actually SOLD for.
 *
 * Kept apart from the price adapters on purpose. Every market in the
 * registry answers "what is it listed at right now"; this answers "what
 * did it change hands for, and how often", which is a different question
 * and comes from a different, per-item endpoint with a tight budget
 * (8 requests / 5 minutes — see the server route). It is therefore an
 * Inspect-page feature and never something the portfolio pulls in bulk.
 *
 * All figures are EUR, the app's internal currency.
 */

export interface SalesWindow {
  min: number | null;
  max: number | null;
  avg: number | null;
  median: number | null;
  /** Copies sold in the period. 0 means "no sales", not "unknown". */
  volume: number;
}

export interface SalesHistory {
  marketHashName: string;
  last24h: SalesWindow;
  last7d: SalesWindow;
  last30d: SalesWindow;
  last90d: SalesWindow;
}

/** Why there is no history, when there isn't one. */
export type SalesHistoryStatus = "ok" | "rate_limited" | "error";

export interface SalesHistoryResult {
  history: SalesHistory | null;
  status: SalesHistoryStatus;
  /** True when served from the proxy's cache rather than a fresh call. */
  cached: boolean;
}

interface SalesHistoryResponse {
  history?: SalesHistory | null;
  status?: SalesHistoryStatus;
  cached?: boolean;
  error?: string;
}

/**
 * Fetches the sales history for one exact market_hash_name.
 *
 * `staleTime` is deliberately long: the upstream feed only refreshes every
 * few minutes and the budget is shared by every visitor of the deployment,
 * so re-asking on every focus change would spend it on nothing.
 */
export function useSalesHistory(marketHashName: string) {
  return useQuery<SalesHistoryResult>({
    queryKey: ["skinport-sales-history", marketHashName],
    enabled: marketHashName.length > 0,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const params = new URLSearchParams({ name: marketHashName });
      const res = await fetch(`/api/skinport-history?${params.toString()}`);
      const body = (await res.json()) as SalesHistoryResponse;
      if (!res.ok || body.error) throw new Error(body.error ?? `Request failed (${res.status})`);
      return {
        history: body.history ?? null,
        status: body.status ?? "ok",
        cached: !!body.cached,
      };
    },
  });
}

/** True when a window has nothing worth rendering. */
export function isEmptyWindow(w: SalesWindow): boolean {
  return w.volume === 0 && w.median === null;
}
