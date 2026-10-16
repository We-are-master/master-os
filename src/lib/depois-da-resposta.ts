/**
 * Trabalho que roda DEPOIS da resposta, sem morrer na Vercel.
 *
 * `void promessa` depois da resposta morre na Vercel: a função congela quando a
 * resposta sai e o envio fica no meio (ticket do JOB-9675 ficou New, 23/09/2026).
 * No :3000 do Mac, processo longo, o mesmo código terminava, então o bug só
 * aparecia em produção. A confirmação ao cliente era disparada assim nos três
 * caminhos que colocam parceiro num job: 0 de 47 jobs confirmados (14/10/2026).
 *
 * `after()` do Next só existe dentro de uma requisição. Fora dela (script,
 * launchd, teste) ele lança erro, e aí o trabalho roda na hora, com await: quem
 * chama de um script espera mesmo.
 *
 * Erro do trabalho nunca sobe: vira log com o rótulo de quem chamou.
 */
import { after } from "next/server";

export async function depoisDaResposta(rotulo: string, trabalho: () => Promise<unknown>): Promise<void> {
  const seguro = async () => {
    try {
      await trabalho();
    } catch (e) {
      console.error(`[${rotulo}] falhou:`, e);
    }
  };
  try {
    after(seguro);
  } catch {
    // Fora de requisição: roda agora.
    await seguro();
  }
}
