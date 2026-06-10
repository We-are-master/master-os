"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Highlights the section id most visible inside a scroll container (New Job modal pattern).
 */
export function useModalScrollSpy(
  sectionIds: string[],
  scrollRef: RefObject<HTMLElement | null>,
  enabled = true,
): string {
  const [active, setActive] = useState(sectionIds[0] ?? "");

  useEffect(() => {
    if (!enabled || sectionIds.length === 0) return;
    const root = scrollRef.current;
    if (!root) return;

    const elements = sectionIds
      .map((id) => root.querySelector<HTMLElement>(`[data-modal-section="${id}"]`))
      .filter((el): el is HTMLElement => !!el);

    if (elements.length === 0) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0]?.target as HTMLElement | undefined;
        const id = top?.dataset.modalSection;
        if (id) setActive(id);
      },
      { root, rootMargin: "-10% 0px -70% 0px", threshold: [0, 0.25, 0.5] },
    );

    for (const el of elements) obs.observe(el);
    return () => obs.disconnect();
  }, [sectionIds, scrollRef, enabled]);

  return active;
}
