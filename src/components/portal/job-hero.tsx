"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";

interface JobHeroProps {
  reference: string;
  title: string;
  statusLabel: string;
  statusClassName: string;
  /** Before/after (or any) photos — if empty, falls back to map/gradient. */
  images: string[];
  address: string | null;
}

/**
 * Full-bleed hero for the portal job detail page.
 *
 * Prioritises a photo carousel (most emotive). If no photos exist, renders
 * a branded gradient with the address inline — still looks intentional
 * rather than empty. Uses Next/Image for responsive delivery + lazy
 * decode, and <button> controls rather than auto-advance so the user
 * can read.
 */
export function JobHero({ reference, title, statusLabel, statusClassName, images, address }: JobHeroProps) {
  const hasImages = images.length > 0;
  const [idx, setIdx] = useState(0);
  const go = (delta: number) => {
    setIdx((cur) => {
      const n = images.length;
      if (n === 0) return 0;
      return (cur + delta + n) % n;
    });
  };

  return (
    <div className="relative rounded-2xl overflow-hidden border border-border bg-card">
      <div className="relative aspect-[16/7] w-full overflow-hidden">
        {hasImages ? (
          <>
            {/* Signed URLs from Supabase Storage change per-request, so
                next/image's cache fingerprinting isn't useful — plain
                <img> keeps the network simple and the hero loads fast. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={images[idx] as string}
              alt={title}
              loading="eager"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
            />
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => go(-1)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/40 backdrop-blur-sm text-white hover:bg-black/60 transition-colors flex items-center justify-center"
                  aria-label="Previous photo"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/40 backdrop-blur-sm text-white hover:bg-black/60 transition-colors flex items-center justify-center"
                  aria-label="Next photo"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1">
                  {images.map((_, i) => (
                    <span
                      key={i}
                      className={`h-1.5 rounded-full transition-all ${
                        i === idx ? "w-5 bg-white" : "w-1.5 bg-white/50"
                      }`}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-primary-600 via-primary to-amber-500" />
        )}

        {/* Gradient overlay + caption */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-[11px] font-mono text-white/80 tracking-wider">{reference}</span>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusClassName}`}>
              {statusLabel}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white drop-shadow-sm">{title}</h1>
          {address && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-white/90">
              <MapPin className="w-3.5 h-3.5" />
              {address}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
