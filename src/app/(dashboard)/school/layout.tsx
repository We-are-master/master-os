"use client";

import { FixfySchoolLocaleProvider } from "@/hooks/use-fixfy-school-locale";
import { SchoolEscapeBar } from "@/components/school/school-escape-bar";

export default function SchoolLayout({ children }: { children: React.ReactNode }) {
  return (
    <FixfySchoolLocaleProvider>
      <div className="space-y-4">
        <SchoolEscapeBar />
        {children}
      </div>
    </FixfySchoolLocaleProvider>
  );
}
