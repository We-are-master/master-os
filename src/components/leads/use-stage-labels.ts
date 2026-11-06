"use client";

/**
 * Nomes das colunas do board, iguais para a equipe toda (admin_config
 * crm_stage_labels). Um store só no navegador: a primeira tela que pede
 * carrega, as outras reaproveitam, e quem renomeia avisa todo mundo na hora.
 */
import { useEffect, useSyncExternalStore } from "react";
import { STAGE_LABEL, cleanStageLabels, mergeStageLabels, type StageLabels } from "@/lib/crm/etapas";
import { getSupabase } from "@/services/base";
import type { LeadStage } from "@/types/database";

const KEY = "crm_stage_labels";

let labels: StageLabels = STAGE_LABEL;
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: StageLabels) {
  labels = next;
  listeners.forEach((l) => l());
}

function load(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      const { data } = await getSupabase().from("admin_config").select("value").eq("key", KEY).maybeSingle();
      emit(mergeStageLabels((data?.value ?? null) as Partial<StageLabels> | null));
    })().catch(() => {
      loaded = null;
    });
  }
  return loaded;
}

/** Renomeia uma coluna (vazio = nome padrão). Só admin grava (RLS do admin_config). */
export async function renameStage(stage: LeadStage, name: string): Promise<StageLabels> {
  const custom = cleanStageLabels({ ...labels, [stage]: name.trim() || STAGE_LABEL[stage] });
  const { error } = await getSupabase()
    .from("admin_config")
    .upsert({ key: KEY, value: custom, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  const next = mergeStageLabels(custom);
  emit(next);
  return next;
}

export function useStageLabels(): StageLabels {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => labels,
    () => STAGE_LABEL,
  );
  useEffect(() => {
    void load();
  }, []);
  return value;
}
