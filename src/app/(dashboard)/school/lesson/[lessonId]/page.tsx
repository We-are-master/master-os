"use client";

import { useParams } from "next/navigation";
import { PageTransition } from "@/components/layout/page-transition";
import { LessonViewer } from "@/components/school/lesson-viewer";

export default function SchoolLessonPage() {
  const params = useParams();
  const lessonId = typeof params.lessonId === "string" ? params.lessonId : "";

  return (
    <PageTransition className="flex min-h-0 flex-1 flex-col">
      <LessonViewer lessonId={lessonId} />
    </PageTransition>
  );
}
