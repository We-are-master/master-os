"use client";

import { useEffect } from "react";
import { getCompanySettings } from "@/services/company";

const EVENT = "master-os-company-settings";
const LINK_ID = "master-os-dynamic-favicon";

function guessIconType(href: string): string {
  const h = href.split("?")[0].toLowerCase();
  if (h.endsWith(".svg")) return "image/svg+xml";
  if (h.endsWith(".png")) return "image/png";
  if (h.endsWith(".ico")) return "image/x-icon";
  if (h.endsWith(".webp")) return "image/webp";
  return "image/png";
}

/**
 * Applies company favicon from `company_settings.favicon_url`, or falls back to `/favicon.ico`.
 * Listens for `master-os-company-settings` after Settings save.
 */
export function DynamicFavicon() {
  useEffect(() => {
    const apply = async () => {
      try {
        const s = await getCompanySettings();
        const raw = s?.favicon_url?.trim();
        const href = raw && raw.length > 0 ? raw : "/favicon.ico";

        if (typeof document === "undefined") return;

        let link = document.querySelector<HTMLLinkElement>(`link#${LINK_ID}`);
        if (!link) {
          link = document.createElement("link");
          link.id = LINK_ID;
          link.rel = "icon";
          document.head.appendChild(link);
        }
        link.href = href;
        link.type = guessIconType(href);

        let apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"][data-master-os="1"]');
        if (raw) {
          if (!apple) {
            apple = document.createElement("link");
            apple.rel = "apple-touch-icon";
            apple.setAttribute("data-master-os", "1");
            document.head.appendChild(apple);
          }
          apple.href = href;
        } else {
          apple?.remove();
        }
      } catch {
        /* keep default favicon */
      }
    };

    void apply();
    window.addEventListener(EVENT, apply);
    return () => window.removeEventListener(EVENT, apply);
  }, []);

  return null;
}
