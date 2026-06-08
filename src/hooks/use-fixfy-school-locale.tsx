"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_SCHOOL_LOCALE,
  readSchoolLocale,
  writeSchoolLocale,
  type SchoolLocale,
} from "@/lib/fixfy-school-locale";

type SchoolLocaleContextValue = {
  locale: SchoolLocale;
  setLocale: (locale: SchoolLocale) => void;
};

const SchoolLocaleContext = createContext<SchoolLocaleContextValue | null>(null);

export function FixfySchoolLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<SchoolLocale>(DEFAULT_SCHOOL_LOCALE);

  useEffect(() => {
    setLocaleState(readSchoolLocale());
  }, []);

  const setLocale = useCallback((next: SchoolLocale) => {
    writeSchoolLocale(next);
    setLocaleState(next);
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return <SchoolLocaleContext.Provider value={value}>{children}</SchoolLocaleContext.Provider>;
}

export function useFixfySchoolLocale(): SchoolLocaleContextValue {
  const ctx = useContext(SchoolLocaleContext);
  if (!ctx) {
    return {
      locale: DEFAULT_SCHOOL_LOCALE,
      setLocale: writeSchoolLocale,
    };
  }
  return ctx;
}
