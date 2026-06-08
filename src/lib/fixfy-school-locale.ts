"use client";

export type SchoolLocale = "en" | "pt";

export const DEFAULT_SCHOOL_LOCALE: SchoolLocale = "en";

const STORAGE_KEY = "fixfy_school_locale_v1";

export const SCHOOL_LOCALE_OPTIONS: { id: SchoolLocale; label: string; flag: string }[] = [
  { id: "en", label: "English", flag: "🇬🇧" },
  { id: "pt", label: "Português", flag: "🇧🇷" },
];

export function readSchoolLocale(): SchoolLocale {
  if (typeof window === "undefined") return DEFAULT_SCHOOL_LOCALE;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "en" || v === "pt") return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_SCHOOL_LOCALE;
}

export function writeSchoolLocale(locale: SchoolLocale): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, locale);
}

export function zendeskGuidePath(locale: SchoolLocale): string {
  return locale === "pt" ? "/school/zendesk/guide.pt.html" : "/school/zendesk/guide.en.html";
}

export function localizeZendeskAssetPath(assetPath: string, locale: SchoolLocale): string {
  const hash = assetPath.includes("#") ? assetPath.slice(assetPath.indexOf("#")) : "";
  const base = hash ? assetPath.slice(0, assetPath.indexOf("#")) : assetPath;
  if (!base.includes("/school/zendesk/guide")) return assetPath;
  return `${zendeskGuidePath(locale)}${hash}`;
}
