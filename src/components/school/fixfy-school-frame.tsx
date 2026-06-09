"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

function schoolFrameSrc(pathname: string): string {
  const base = "/school/fixfy-school/index.html?embed=1";
  const lessonMatch = pathname.match(/^\/school\/lesson\/([^/]+)$/);
  if (lessonMatch) return `${base}&lesson=${encodeURIComponent(lessonMatch[1]!)}`;
  const phaseQuizMatch = pathname.match(/^\/school\/([^/]+)\/quiz$/);
  if (phaseQuizMatch && phaseQuizMatch[1] !== "lesson") {
    return `${base}&phase=${encodeURIComponent(phaseQuizMatch[1]!)}`;
  }
  const phaseMatch = pathname.match(/^\/school\/([^/]+)$/);
  if (phaseMatch && phaseMatch[1] !== "lesson") {
    return `${base}&phase=${encodeURIComponent(phaseMatch[1]!)}`;
  }
  return base;
}

export function FixfySchoolFrame({ className }: { className?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const src = useMemo(() => schoolFrameSrc(pathname), [pathname]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (!e.data || e.data.type !== "fixfy-school-navigate") return;
      const path = typeof e.data.path === "string" ? e.data.path : "/school";
      router.push(path);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router]);

  return (
    <iframe
      ref={iframeRef}
      key={src}
      src={src}
      title="Fixfy School"
      className={cn(
        "w-full border-0 bg-[#F7F7FB] dark:bg-[#0f1115]",
        className,
      )}
      style={{ minHeight: "calc(100dvh - 7rem)" }}
      allow="fullscreen"
    />
  );
}
