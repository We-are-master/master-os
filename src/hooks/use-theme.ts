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

function getSystemPreference(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: Theme): "light" | "dark" {
  return theme === "system" ? getSystemPreference() : theme;
}

function applyStyle(style: Style) {
  if (style === "minimal") {
    document.documentElement.setAttribute("data-style", "minimal");
  } else {
    document.documentElement.removeAttribute("data-style");
  }
}

export function useThemeProvider() {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");
  const [style, setStyleState] = useState<Style>("default");

  useEffect(() => {
    queueMicrotask(() => {
      const stored = localStorage.getItem("master-os-theme") as Theme | null;
      const initial = stored ?? "system";
      setThemeState(initial);
      const r = resolveTheme(initial);
      setResolved(r);
      document.documentElement.classList.toggle("dark", r === "dark");

      const storedStyle = localStorage.getItem("master-os-style") as Style | null;
      const initialStyle: Style = storedStyle === "minimal" ? "minimal" : "default";
      setStyleState(initialStyle);
      applyStyle(initialStyle);
    });
  }, []);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const r = getSystemPreference();
      setResolved(r);
      document.documentElement.classList.toggle("dark", r === "dark");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem("master-os-theme", t);
    const r = resolveTheme(t);
    setResolved(r);
    document.documentElement.classList.toggle("dark", r === "dark");
  }, []);

  const setStyle = useCallback((s: Style) => {
    setStyleState(s);
    localStorage.setItem("master-os-style", s);
    applyStyle(s);
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolved === "dark" ? "light" : "dark");
  }, [resolved, setTheme]);

  const toggleStyle = useCallback(() => {
    setStyle(style === "minimal" ? "default" : "minimal");
  }, [style, setStyle]);

  return useMemo(
    () => ({ theme, resolved, style, setTheme, setStyle, toggle, toggleStyle }),
    [theme, resolved, style, setTheme, setStyle, toggle, toggleStyle],
  );
}
