"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

type DuplicateConfirmContextValue = {
  confirmDespiteDuplicates: (lines: string[]) => Promise<boolean>;
};

const DuplicateConfirmContext = createContext<DuplicateConfirmContextValue | null>(null);

export function DuplicateConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const finish = useCallback((value: boolean) => {
    setOpen(false);
    setLines([]);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(value);
  }, []);

  const confirmDespiteDuplicates = useCallback((dupLines: string[]) => {
    if (dupLines.length === 0) return Promise.resolve(true);
    if (resolveRef.current) {
      resolveRef.current(false);
      resolveRef.current = null;
    }
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setLines(dupLines);
      setOpen(true);
    });
  }, []);

  return (
    <DuplicateConfirmContext.Provider value={{ confirmDespiteDuplicates }}>
      {children}
      <Modal
        open={open}
        onClose={() => finish(false)}
        title="Possible duplicates"
        subtitle="Similar records already exist. Do you still want to continue?"
        size="md"
        scrollBody={lines.length > 6}
        rootClassName="z-[60]"
      >
        <div className="px-4 sm:px-6 py-4 space-y-4">
          <ul className="list-disc pl-5 text-sm text-text-secondary space-y-1.5">
            {lines.map((line, i) => (
              <li key={`${i}-${line.slice(0, 24)}`}>{line}</li>
            ))}
          </ul>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-border-light">
            <Button variant="outline" type="button" onClick={() => finish(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="button" onClick={() => finish(true)}>
              Continue anyway
            </Button>
          </div>
        </div>
      </Modal>
    </DuplicateConfirmContext.Provider>
  );
}

export function useDuplicateConfirm(): DuplicateConfirmContextValue {
  const ctx = useContext(DuplicateConfirmContext);
  if (!ctx) {
    throw new Error("useDuplicateConfirm must be used within DuplicateConfirmProvider");
  }
  return ctx;
}
