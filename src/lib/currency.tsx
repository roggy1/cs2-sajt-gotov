import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Currency = "usd" | "eur" | "gbp" | "rub";

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  usd: "$",
  eur: "€",
  gbp: "£",
  rub: "₽",
};

export const CURRENCY_CODE: Record<Currency, string> = {
  usd: "USD",
  eur: "EUR",
  gbp: "GBP",
  rub: "RUB",
};

// Fallback rates used only if the live API call fails (offline, etc).
// Base currency is EUR. Update these occasionally if they drift far from reality.
// RUB in particular is volatile — this fallback is approximate.
const FALLBACK_EUR_TO_USD = 1.08;
const FALLBACK_EUR_TO_GBP = 0.86;
const FALLBACK_EUR_TO_RUB = 95;

type Rates = { usd: number; gbp: number; rub: number };

const RATE_CACHE_KEY = "cs2-fx-rate-v2";
const RATE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

type RateCache = { rates: Rates; fetchedAt: number };

function readCache(): RateCache | null {
  try {
    const raw = localStorage.getItem(RATE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RateCache;
    if (
      typeof parsed?.fetchedAt !== "number" ||
      !parsed?.rates ||
      typeof parsed.rates.rub !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(rates: Rates) {
  try {
    const entry: RateCache = { rates, fetchedAt: Date.now() };
    localStorage.setItem(RATE_CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* ignore */
  }
}

// Single free, no-key currency API (community-hosted, no attribution required)
// covering USD/EUR/GBP/RUB and 150+ others in one request, base currency EUR.
const RATES_URL =
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json";

async function fetchRates(): Promise<Rates> {
  const res = await fetch(RATES_URL);
  if (!res.ok) throw new Error("FX fetch failed");
  const data = (await res.json()) as { eur?: Record<string, number> };
  const usd = data.eur?.usd;
  const gbp = data.eur?.gbp;
  const rub = data.eur?.rub;
  if (typeof usd !== "number" || typeof gbp !== "number" || typeof rub !== "number") {
    throw new Error("FX response malformed");
  }
  return { usd, gbp, rub };
}

const CurrencyCtx = createContext<{
  currency: Currency;
  setCurrency: (c: Currency) => void;
  rates: Rates;
}>({
  currency: "usd",
  setCurrency: () => {},
  rates: { usd: FALLBACK_EUR_TO_USD, gbp: FALLBACK_EUR_TO_GBP, rub: FALLBACK_EUR_TO_RUB },
});

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>("usd");
  const [rates, setRates] = useState<Rates>({
    usd: FALLBACK_EUR_TO_USD,
    gbp: FALLBACK_EUR_TO_GBP,
    rub: FALLBACK_EUR_TO_RUB,
  });

  useEffect(() => {
    const saved = localStorage.getItem("cs2-currency") as Currency | null;
    if (saved === "usd" || saved === "eur" || saved === "gbp" || saved === "rub")
      setCurrencyState(saved);

    const cached = readCache();
    if (cached && Date.now() - cached.fetchedAt < RATE_MAX_AGE_MS) {
      setRates(cached.rates);
      return;
    }

    fetchRates()
      .then((r) => {
        setRates(r);
        writeCache(r);
      })
      .catch(() => {
        // keep fallback rates already in state; nothing else to do
      });
  }, []);

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c);
    localStorage.setItem("cs2-currency", c);
  }, []);

  const value = useMemo(() => ({ currency, setCurrency, rates }), [currency, setCurrency, rates]);
  return <CurrencyCtx.Provider value={value}>{children}</CurrencyCtx.Provider>;
}

export const useCurrency = () => useContext(CurrencyCtx);
