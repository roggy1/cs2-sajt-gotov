import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeId = "go" | "ct" | "t";

const CLASSES: Record<ThemeId, string> = {
  go: "theme-go",
  ct: "theme-ct",
  t: "theme-t",
};

const ThemeCtx = createContext<{ theme: ThemeId; setTheme: (t: ThemeId) => void }>({
  theme: "go",
  setTheme: () => {},
});

function apply(theme: ThemeId) {
  const el = document.documentElement;
  Object.values(CLASSES).forEach((c) => el.classList.remove(c));
  el.classList.add(CLASSES[theme]);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>("go");

  useEffect(() => {
    const saved = localStorage.getItem("cs2-theme") as ThemeId | null;
    const initial = saved && saved in CLASSES ? saved : "go";
    setThemeState(initial);
    apply(initial);
  }, []);

  const setTheme = useCallback((t: ThemeId) => {
    setThemeState(t);
    localStorage.setItem("cs2-theme", t);
    apply(t);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
