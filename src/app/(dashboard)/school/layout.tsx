"use client";

import { usePathname } from "next/navigation";
import { FixfySchoolLocaleProvider } from "@/hooks/use-fixfy-school-locale";
import { FixfySchoolFrame } from "@/components/school/fixfy-school-frame";
import { SchoolEscapeBar } from "@/components/school/school-escape-bar";

function isQuizRoute(pathname: string): boolean {
  return /\/school\/[^/]+\/quiz$/.test(pathname);
}

export default function SchoolLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const quiz = isQuizRoute(pathname);

  return (
    <FixfySchoolLocaleProvider>
      {quiz ? (
        <div className="mx-auto w-full max-w-lg sm:max-w-xl space-y-4">
          <SchoolEscapeBar />
          {children}
        </div>
      ) : (
        <FixfySchoolFrame className="min-h-[calc(100dvh-7rem)]" />
      )}
    </FixfySchoolLocaleProvider>
  );
}
