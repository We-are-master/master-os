"use client";

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";

export type Theme = "light" | "dark" | "system";
export type Style = "default" | "minimal";

interface ThemeContextValue {
  theme: Theme;
  resolved: "light" | "dark";
  style: Style;
  setTheme: (theme: Theme) => void;
  setStyle: (style: Style) => void;
  toggle: () => void;
  toggleStyle: () => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  resolved: "light",
  style: "default",
  setTheme: () => {},
  setStyle: () => {},
  toggle: () => {},
  toggleStyle: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function applyStyle(style: Style) {
  if (style === "minimal") {
    document.documentElement.setAttribute("data-style", "minimal");
  } else {
    document.documentElement.removeAttribute("data-style");
  }
}

/**
 * The OS is light only (owner's call, 24/09/2026). `theme`/`resolved` stay in the
 * context so existing callers keep working, but they are always "light": any saved
 * "dark"/"system" preference is dropped and the `dark` class never goes on <html>.
 */
export function useThemeProvider() {
  const theme: Theme = "light";
  const resolved = "light" as const;
  const [style, setStyleState] = useState<Style>("default");

  useEffect(() => {
    queueMicrotask(() => {
      document.documentElement.classList.remove("dark");
      localStorage.removeItem("master-os-theme");

      const storedStyle = localStorage.getItem("master-os-style") as Style | null;
      const initialStyle: Style = storedStyle === "minimal" ? "minimal" : "default";
      setStyleState(initialStyle);
      applyStyle(initialStyle);
    });
  }, []);

  // Accepts a theme for API compatibility; every value lands on light.
  const setTheme = useCallback(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  const setStyle = useCallback((s: Style) => {
    setStyleState(s);
    localStorage.setItem("master-os-style", s);
    applyStyle(s);
  }, []);

  const toggle = useCallback(() => setTheme(), [setTheme]);

  const toggleStyle = useCallback(() => {
    setStyle(style === "minimal" ? "default" : "minimal");
  }, [style, setStyle]);

  return useMemo(
    () => ({ theme, resolved, style, setTheme, setStyle, toggle, toggleStyle }),
    [theme, resolved, style, setTheme, setStyle, toggle, toggleStyle],
  );
}
