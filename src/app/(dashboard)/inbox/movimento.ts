/**
 * Os tokens do VOS Movimento que a /inbox usa, para o composer e o áudio andarem
 * no mesmo tempo e na mesma curva do Atendimento do VOS. Os números são os do
 * pacote do VOS (tokens.ts); o CSS (inbox.css) usa os mesmos.
 */

import type { Transition } from "framer-motion";

export const CURVA_ENTRADA = [0.22, 1, 0.36, 1] as const;
export const CURVA_SAIDA = [0.4, 0, 0.6, 1] as const;
export const DUR = { xs: 0.1, sm: 0.15, md: 0.2, lg: 0.28 } as const;

export const tempo = (d: keyof typeof DUR, sentido: "entrada" | "saida" = "entrada"): Transition => ({
  duration: DUR[d],
  ease: sentido === "entrada" ? [...CURVA_ENTRADA] : [...CURVA_SAIDA],
});

/** Peça pequena que troca no lugar (a onda ao vivo ↔ a prévia). */
export const CHIP = {
  initial: { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1, transition: tempo("sm") },
  exit: { opacity: 0, scale: 0.9, transition: tempo("sm", "saida") },
};

/** Flutuante que nasce da borda do gatilho (menu, popover). */
export const flutuante = (lado: "top" | "bottom" = "top") => ({
  initial: { opacity: 0, scale: 0.98, y: lado === "top" ? 4 : -4 },
  animate: { opacity: 1, scale: 1, y: 0, transition: tempo("md") },
  exit: { opacity: 0, scale: 0.98, y: lado === "top" ? 4 : -4, transition: tempo("sm", "saida") },
});
