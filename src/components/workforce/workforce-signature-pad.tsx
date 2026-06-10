"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import SignatureCanvas from "react-signature-canvas";

export type WorkforceSignaturePadHandle = {
  clear: () => void;
  isEmpty: () => boolean;
  toDataURL: () => string | null;
};

type WorkforceSignaturePadProps = {
  disabled?: boolean;
  onDrawStart?: () => void;
  /** Fired when the pad becomes empty or has strokes. */
  onChange?: (hasSignature: boolean) => void;
  className?: string;
};

export const WorkforceSignaturePad = forwardRef<WorkforceSignaturePadHandle, WorkforceSignaturePadProps>(
  function WorkforceSignaturePad({ disabled = false, onDrawStart, onChange, className }, ref) {
    const padRef = useRef<SignatureCanvas | null>(null);

    const notifyChange = () => {
      onChange?.(!(padRef.current?.isEmpty() ?? true));
    };

    useImperativeHandle(ref, () => ({
      clear: () => {
        padRef.current?.clear();
        onChange?.(false);
      },
      isEmpty: () => padRef.current?.isEmpty() ?? true,
      toDataURL: () => {
        if (!padRef.current || padRef.current.isEmpty()) return null;
        return padRef.current.toDataURL("image/png");
      },
    }));

    return (
      <SignatureCanvas
        ref={padRef}
        penColor="#020040"
        minWidth={1.5}
        maxWidth={2.5}
        canvasProps={{
          className: className ?? "ob-sign__pad w-full touch-none cursor-crosshair",
          width: 480,
          height: 96,
          style: { height: 96, pointerEvents: disabled ? "none" : "auto", opacity: disabled ? 0.5 : 1 },
        }}
        onBegin={() => onDrawStart?.()}
        onEnd={notifyChange}
      />
    );
  },
);
