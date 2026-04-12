"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

/** Preview diameter in CSS px (must match export framing). */
export const PARTNER_AVATAR_CROP_PREVIEW_PX = 280;
const OUTPUT_PX = 512;

function coverScale(nw: number, nh: number, size: number): number {
  return Math.max(size / nw, size / nh);
}

function clampPan(pan: number, size: number, display: number): number {
  if (display <= size) return 0;
  const half = (display - size) / 2;
  return Math.max(-half, Math.min(half, pan));
}

function clampPans(
  panX: number,
  panY: number,
  nw: number,
  nh: number,
  size: number,
  zoom: number,
): { x: number; y: number } {
  const base = coverScale(nw, nh, size);
  const dw = nw * base * zoom;
  const dh = nh * base * zoom;
  return {
    x: clampPan(panX, size, dw),
    y: clampPan(panY, size, dh),
  };
}

type PartnerAvatarCropModalProps = {
  open: boolean;
  imageFile: File | null;
  onClose: () => void;
  onConfirm: (blob: Blob) => void;
  title?: string;
};

export function PartnerAvatarCropModal({
  open,
  imageFile,
  onClose,
  onConfirm,
  title = "Adjust profile photo",
}: PartnerAvatarCropModalProps) {
  const s = PARTNER_AVATAR_CROP_PREVIEW_PX;
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [{ zoom, panX, panY }, setCrop] = useState({ zoom: 1, panX: 0, panY: 0 });
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    originPanX: number;
    originPanY: number;
  } | null>(null);

  useEffect(() => {
    if (!open || !imageFile) {
      queueMicrotask(() => {
        setImg(null);
        setCrop({ zoom: 1, panX: 0, panY: 0 });
      });
      return;
    }
    const url = URL.createObjectURL(imageFile);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      setImg(image);
      setCrop({ zoom: 1, panX: 0, panY: 0 });
    };
    image.onerror = () => {
      setImg(null);
    };
    image.src = url;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [open, imageFile]);

  const layout = useMemo(() => {
    if (!img?.naturalWidth) return null;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const base = coverScale(nw, nh, s);
    const displayW = nw * base * zoom;
    const displayH = nh * base * zoom;
    const left = s / 2 - displayW / 2 + panX;
    const top = s / 2 - displayH / 2 + panY;
    return { nw, nh, displayW, displayH, left, top };
  }, [img, zoom, panX, panY, s]);

  const setZoomSafe = useCallback(
    (z: number) => {
      if (!img?.naturalWidth) return;
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      setCrop((prev) => {
        const c = clampPans(prev.panX, prev.panY, nw, nh, s, z);
        return { zoom: z, panX: c.x, panY: c.y };
      });
    },
    [img, s],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !img?.naturalWidth) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      originPanX: panX,
      originPanY: panY,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d?.active || !img?.naturalWidth) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const c = clampPans(d.originPanX + dx, d.originPanY + dy, nw, nh, s, zoom);
    setCrop((prev) => ({ ...prev, panX: c.x, panY: c.y }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = null;
  };

  const handleApply = async () => {
    if (!img || !layout || !imageFile) return;
    const { left, top, displayW, displayH } = layout;

    const canvas = document.createElement("canvas");
    canvas.width = s;
    canvas.height = s;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, left, top, displayW, displayH);

    const out = document.createElement("canvas");
    out.width = OUTPUT_PX;
    out.height = OUTPUT_PX;
    const octx = out.getContext("2d");
    if (!octx) return;
    octx.beginPath();
    octx.arc(OUTPUT_PX / 2, OUTPUT_PX / 2, OUTPUT_PX / 2, 0, Math.PI * 2);
    octx.clip();
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(canvas, 0, 0, s, s, 0, 0, OUTPUT_PX, OUTPUT_PX);

    await new Promise<void>((resolve, reject) => {
      out.toBlob(
        (blob) => {
          if (blob) {
            onConfirm(blob);
            resolve();
          } else reject(new Error("Could not create image"));
        },
        "image/jpeg",
        0.92,
      );
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle="Drag to position, zoom to frame. The circle matches the partner card avatar."
      size="lg"
      className="max-w-lg"
      rootClassName="z-[60]"
    >
      <div className="px-4 pb-4 sm:px-6 sm:pb-6 space-y-4">
        {!img || !layout ? (
          <div className="flex h-[320px] items-center justify-center text-sm text-text-tertiary">Loading…</div>
        ) : (
          <>
            <div className="flex justify-center">
              <div
                className="relative touch-none select-none rounded-full bg-zinc-900/10 ring-2 ring-border-light shadow-inner"
                style={{ width: s, height: s }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                <img
                  src={img.src}
                  alt=""
                  draggable={false}
                  className="absolute max-w-none cursor-move"
                  style={{
                    width: layout.displayW,
                    height: layout.displayH,
                    left: layout.left,
                    top: layout.top,
                  }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-text-tertiary">
                <span>Zoom</span>
                <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
              </div>
              <input
                type="range"
                min={1}
                max={3}
                step={0.02}
                value={zoom}
                onChange={(e) => setZoomSafe(Number(e.target.value))}
                className="w-full h-2 accent-primary cursor-pointer"
                aria-label="Zoom"
              />
            </div>
            <p className="text-[11px] text-text-tertiary">
              Saved as {OUTPUT_PX}×{OUTPUT_PX} JPEG (circular crop) for a centred avatar.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void handleApply()}>
                Save photo
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
