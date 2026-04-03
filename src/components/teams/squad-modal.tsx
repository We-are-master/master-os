"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Squad } from "@/types/database";

export function SquadModal({
  open,
  onClose,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  initial: Squad | null;
  onSave: (name: string) => void | Promise<void>;
  saving: boolean;
}) {
  const [name, setName] = useState("");

  useEffect(() => {
    queueMicrotask(() => setName(initial?.name ?? ""));
  }, [open, initial]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    await Promise.resolve(onSave(name.trim()));
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit squad" : "Add squad"} size="sm">
      <form onSubmit={submit} className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Squad name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Squad London" required />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving} icon={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}>
            {saving ? "Saving..." : initial ? "Update" : "Create"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
