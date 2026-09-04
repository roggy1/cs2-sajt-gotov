import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** Curated Lucide icon keys — see PORTFOLIO_ICONS in PortfolioIcon.tsx. */
export type PortfolioIconId =
  | "briefcase"
  | "gem"
  | "crosshair"
  | "swords"
  | "trending"
  | "wallet"
  | "package"
  | "star"
  | "shield"
  | "flame"
  | "target"
  | "coins";

export const PORTFOLIO_ACCENTS = [
  "#f2954a",
  "#4c8bf5",
  "#1dd3b0",
  "#c084fc",
  "#f472b6",
  "#facc15",
] as const;

export interface Portfolio {
  id: string;
  name: string;
  icon: PortfolioIconId;
  accent: string;
  createdAt: number;
  /** Set on the portfolio that mirrors the user's Steam inventory. */
  steamSync?: boolean;
}

const PORTFOLIOS_KEY = "cs2-portfolios";
const ACTIVE_KEY = "cs2-active-portfolio";

/** Storage key for one portfolio's holdings / wishlist. */
export function inventoryKey(portfolioId: string): string {
  return `cs2-inventory:${portfolioId}`;
}
export function wishlistKey(portfolioId: string): string {
  return `cs2-wishlist:${portfolioId}`;
}

/**
 * The Main portfolio is permanently bound to the Steam inventory: imports
 * always land here, and the /profile stats are computed from it alone. It
 * therefore cannot be deleted — every other portfolio is free-form and
 * purely for the user's own tracking.
 */
export const DEFAULT_PORTFOLIO_ID = "default";

export function readPortfolioRaw<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writePortfolioRaw(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

const DEFAULT_PORTFOLIO: Portfolio = {
  id: DEFAULT_PORTFOLIO_ID,
  name: "Main",
  icon: "package",
  accent: PORTFOLIO_ACCENTS[0],
  createdAt: 0,
  steamSync: true,
};

export function isMainPortfolio(id: string): boolean {
  return id === DEFAULT_PORTFOLIO_ID;
}

/**
 * Moves pre-portfolio data (a single global inventory) into the default
 * portfolio, so nobody loses holdings when upgrading. Runs once: after the
 * portfolio list exists, this is a no-op.
 */
function migrateLegacyStorage(): void {
  try {
    if (localStorage.getItem(PORTFOLIOS_KEY)) return;

    const legacyInventory = localStorage.getItem("cs2-inventory");
    const legacyWishlist = localStorage.getItem("cs2-wishlist");
    if (legacyInventory) {
      localStorage.setItem(inventoryKey(DEFAULT_PORTFOLIO.id), legacyInventory);
      localStorage.removeItem("cs2-inventory");
    }
    if (legacyWishlist) {
      localStorage.setItem(wishlistKey(DEFAULT_PORTFOLIO.id), legacyWishlist);
      localStorage.removeItem("cs2-wishlist");
    }
  } catch {
    /* ignore — worst case the user starts with an empty default portfolio */
  }
}

interface PortfolioContextValue {
  portfolios: Portfolio[];
  activeId: string;
  active: Portfolio;
  setActiveId: (id: string) => void;
  createPortfolio: (input: Omit<Portfolio, "id" | "createdAt">) => Portfolio;
  updatePortfolio: (id: string, patch: Partial<Omit<Portfolio, "id">>) => void;
  deletePortfolio: (id: string) => void;
  /** Finds (or creates) the portfolio that mirrors the Steam inventory. */
  ensureSteamPortfolio: () => Portfolio;
}

const PortfolioCtx = createContext<PortfolioContextValue>({
  portfolios: [DEFAULT_PORTFOLIO],
  activeId: DEFAULT_PORTFOLIO.id,
  active: DEFAULT_PORTFOLIO,
  setActiveId: () => {},
  createPortfolio: () => DEFAULT_PORTFOLIO,
  updatePortfolio: () => {},
  deletePortfolio: () => {},
  ensureSteamPortfolio: () => DEFAULT_PORTFOLIO,
});

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([DEFAULT_PORTFOLIO]);
  const [activeId, setActiveIdState] = useState<string>(DEFAULT_PORTFOLIO.id);

  useEffect(() => {
    migrateLegacyStorage();
    try {
      const raw = localStorage.getItem(PORTFOLIOS_KEY);
      const parsed = raw ? (JSON.parse(raw) as Portfolio[]) : null;
      const stored = Array.isArray(parsed) && parsed.length > 0 ? parsed : [DEFAULT_PORTFOLIO];

      // Normalise anything written by an older build: Main gained the
      // steamSync flag after some users had already saved their list, so
      // it has to be re-applied on load rather than assumed present.
      const list = stored.map((p) => (isMainPortfolio(p.id) ? { ...p, steamSync: true } : p));
      // Guarantee Main always exists, even if a stored list somehow lost it.
      if (!list.some((p) => isMainPortfolio(p.id))) list.unshift(DEFAULT_PORTFOLIO);

      setPortfolios(list);

      const savedActive = localStorage.getItem(ACTIVE_KEY);
      setActiveIdState(
        savedActive && list.some((p) => p.id === savedActive) ? savedActive : list[0]!.id,
      );
    } catch {
      setPortfolios([DEFAULT_PORTFOLIO]);
    }
  }, []);

  const persist = useCallback((list: Portfolio[]) => {
    setPortfolios(list);
    try {
      localStorage.setItem(PORTFOLIOS_KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  }, []);

  const setActiveId = useCallback((id: string) => {
    setActiveIdState(id);
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const createPortfolio = useCallback(
    (input: Omit<Portfolio, "id" | "createdAt">) => {
      const created: Portfolio = { ...input, id: crypto.randomUUID(), createdAt: Date.now() };
      persist([...portfolios, created]);
      setActiveId(created.id);
      return created;
    },
    [portfolios, persist, setActiveId],
  );

  const updatePortfolio = useCallback(
    (id: string, patch: Partial<Omit<Portfolio, "id">>) => {
      persist(portfolios.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    },
    [portfolios, persist],
  );

  const deletePortfolio = useCallback(
    (id: string) => {
      // Main is the Steam-synced portfolio and is never deletable; also
      // never leave the app with zero portfolios to fall back to.
      if (isMainPortfolio(id) || portfolios.length <= 1) return;
      const next = portfolios.filter((p) => p.id !== id);
      persist(next);
      try {
        localStorage.removeItem(inventoryKey(id));
        localStorage.removeItem(wishlistKey(id));
      } catch {
        /* ignore */
      }
      if (activeId === id) setActiveId(next[0]!.id);
    },
    [portfolios, persist, activeId, setActiveId],
  );

  /** Steam data always lives in Main — this just focuses it. */
  const ensureSteamPortfolio = useCallback(() => {
    setActiveId(DEFAULT_PORTFOLIO_ID);
    return portfolios.find((p) => p.id === DEFAULT_PORTFOLIO_ID) ?? DEFAULT_PORTFOLIO;
  }, [portfolios, setActiveId]);

  const active = portfolios.find((p) => p.id === activeId) ?? portfolios[0] ?? DEFAULT_PORTFOLIO;

  const value = useMemo(
    () => ({
      portfolios,
      activeId: active.id,
      active,
      setActiveId,
      createPortfolio,
      updatePortfolio,
      deletePortfolio,
      ensureSteamPortfolio,
    }),
    [
      portfolios,
      active,
      setActiveId,
      createPortfolio,
      updatePortfolio,
      deletePortfolio,
      ensureSteamPortfolio,
    ],
  );

  return <PortfolioCtx.Provider value={value}>{children}</PortfolioCtx.Provider>;
}

export const usePortfolio = () => useContext(PortfolioCtx);
