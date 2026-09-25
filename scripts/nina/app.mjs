/**
 * A Nina andando pelo app da Fantastic.
 *
 * Tudo que sabe NAVEGAR fica aqui; o que sabe ler pixel fica no `tela.mjs`.
 * A separação é para o dia em que a API deles aparecer: aí este arquivo e o
 * `tela.mjs` saem, e o resto da Nina continua igual.
 *
 * O que o app tem de peculiar e mora aqui:
 *
 *   • a checklist diária BLOQUEIA o dia, e enquanto ela não sai o app abre
 *     nela e não deixa chegar nos jobs;
 *   • o horário na tela está no fuso do APARELHO (São Paulo), não no do job:
 *     a hora real é a mostrada + 4h;
 *   • o endereço completo só aparece depois de apertar "Confirm to see full
 *     address", que é também o gesto que confirma a reserva;
 *   • `Status: Booked` na tela de detalhe NÃO muda quando o job fecha. O sinal
 *     de concluído é a tela do job dizer "The job is done".
 */
import { arvore, achar, esperar, tocar, dorme, sh, descer, subirAoTopo } from "./tela.mjs";

export const PACOTE = "com.fos.bfantastic";

/** Traz o app para a frente e espera ele desenhar algo. */
export function abrirApp() {
  sh(`shell monkey -p ${PACOTE} -c android.intent.category.LAUNCHER 1`);
  dorme(6000);
  for (let i = 0; i < 10; i++) {
    if (arvore().some((n) => n.txt)) return true;
    dorme(3000);
  }
  return false;
}

/** O aparelho está de pé e o app logado? Sem isto, o resto não faz sentido. */
export function saude() {
  const dispositivos = sh("devices").split("\n").filter((l) => /\tdevice$/.test(l));
  if (dispositivos.length === 0) return { ok: false, motivo: "nenhum emulador em adb devices" };
  if (!sh(`shell pm list packages ${PACOTE}`).includes(PACOTE)) {
    return { ok: false, motivo: "o app não está instalado neste aparelho" };
  }
  if (!abrirApp()) return { ok: false, motivo: "o app abriu e não desenhou nada" };
  const nos = arvore();
  // Tela de login: aqui nenhum script resolve, precisa de gente.
  if (nos.some((n) => /sign in|log in|password/i.test(n.txt))) {
    return { ok: false, motivo: "o app está DESLOGADO — precisa de alguém entrar à mão" };
  }
  const checklist = nos.some((n) => /selfie wearing your uniform/i.test(n.txt));
  return { ok: true, checklistPendente: checklist };
}

/**
 * Espera o app parar de dizer "Loading…".
 *
 * A Nina desistia de navegar com a tela em carregamento: o canto não tinha
 * botão nenhum e ela concluía "não cheguei". O app busca a agenda do servidor
 * deles, e isso leva o tempo que leva.
 */
export function esperarCarregar(segundos = 60) {
  for (let i = 0; i < segundos / 3; i++) {
    const nos = arvore();
    if (!nos.some((n) => /^Loading/i.test(n.txt))) return true;
    dorme(3000);
  }
  return false;
}

/** Abre o menu lateral e vai para uma entrada dele (History, Jobs, Dashboard). */
export function irPara(entrada) {
  /**
   * Confirmar a CHEGADA, não só o toque.
   *
   * A gaveta do menu anima, e tocar no item antes de ela assentar leva a
   * lugar nenhum sem erro: a Nina dizia "dia 16 não apareceu no calendário"
   * com a tela ainda na anterior. Duas tentativas, e cada uma só termina
   * quando o título da tela de destino aparece.
   */
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    // A terceira tentativa reabre o app: de qualquer tela perdida, o launcher
    // devolve a Nina para casa, e casa tem gaveta.
    if (tentativa === 3) { abrirApp(); dorme(3000) }
    esperarCarregar();
    limparAvisos();                                                        // modal na frente tranca tudo
    if (esperar((n) => n.txt === entrada && n.y1 < 300, 6)) return true;   // já estamos lá
    /**
     * A gaveta e a flecha de voltar dividem o canto superior esquerdo.
     *
     * Em tela de detalhe o que está ali é "Navigate up", e tocá-la volta uma
     * tela em vez de abrir o menu — a Nina saía procurando "History" numa tela
     * que não tem menu. A flecha se identifica pelo content-desc; a gaveta não
     * tem nenhum. Quando é a flecha, volta até chegar numa tela com gaveta.
     */
    let menu = null;
    for (let saida = 0; saida < 4; saida++) {
      const canto = arvore().filter((n) => n.clic && n.x2 < 200 && n.y1 < 300);
      menu = canto.find((n) => !/navigate up/i.test(n.desc));
      if (menu) break;
      const voltar = canto.find((n) => /navigate up/i.test(n.desc));
      if (!voltar) break;
      sh("shell input keyevent 4"); dorme(2500);
    }
    if (!menu) { dorme(2000); continue }
    tocar(menu.x, menu.y, 3000);
    const item = esperar((n) => n.txt === entrada && n.y1 > 400, 8);
    if (!item) { sh("shell input keyevent 4"); dorme(1500); continue }
    tocar(item.x + 200, item.y, 3000);
    if (esperar((n) => n.txt === entrada && n.y1 < 300, 20)) return true;
  }
  return false;
}

/**
 * Os jobs de um dia, lidos do History.
 *
 * `dia` é o número no calendário do mês corrente (o app abre no mês de hoje).
 * Devolve `{ hora, titulo, resumo, y }`, onde `y` serve para abrir o job.
 */
export function jobsDoDia(dia) {
  /**
   * ESPERAR a célula, não ler uma vez.
   *
   * A navegação do menu leva um tempo que varia, e a primeira leitura pegava a
   * tela anterior: a Nina dizia "dia 16 não está no calendário" com o
   * calendário desenhado na tela um segundo depois.
   */
  const celula = esperar((n) => n.txt === String(dia) && n.y1 > 450 && n.y2 < 600, 30);
  if (!celula) return { ok: false, motivo: `dia ${dia} não apareceu no calendário` };
  tocar(celula.x, celula.y, 5000);

  /**
   * Só as linhas DESTE dia.
   *
   * O History é uma lista contínua: abaixo dos jobs do dia escolhido vêm os
   * cabeçalhos dos outros dias ("Tue, Sep 15, 2026") e os jobs deles. Rolando
   * e juntando tudo, a Nina lia 9:00 de hoje e 8:00 de amanhã como se fossem
   * de ontem. O corte é o cabeçalho: vale o que está entre o do dia pedido e
   * o próximo.
   */
  const cabecalho = (n) => /^\w{3}, \w{3} \d{1,2}, \d{4}$/.test(n.txt);
  const linhas = [];
  let igual = 0, antes = "", dentro = false, acabou = false;
  for (let v = 0; v < 12 && igual < 2 && !acabou; v++) {
    const nos = arvore().sort((a, b) => a.y - b.y);
    for (const n of nos) {
      if (cabecalho(n)) {
        const desteDia = new RegExp(`\\b${dia}, `).test(n.txt);
        if (desteDia) dentro = true;
        else if (dentro) { acabou = true; break }
        continue;
      }
      if (!dentro) continue;
      if (!/^\d{1,2}:\d{2}\s?(AM|PM)$/.test(n.txt)) continue;
      const titulo = nos.find((t) => Math.abs(t.y - n.y) < 60 && t.x1 > 280 && t.txt.length > 4);
      if (!titulo) continue;
      const chave = `${n.txt}|${titulo.txt}`;
      if (linhas.some((l) => l.chave === chave)) continue;
      const resumo = nos.find((r) => r.y > n.y && r.y < n.y + 320 && /Client:/.test(r.txt));
      linhas.push({ chave, hora: n.txt, titulo: titulo.txt, resumo: resumo?.txt ?? "", y: n.y });
    }
    const estado = nos.map((n) => `${n.y}:${n.txt}`).join("|");
    if (estado === antes) igual++; else igual = 0;
    antes = estado;
    if (!acabou) descer();
  }
  return { ok: true, jobs: linhas };
}

/**
 * Abre um job da lista do History e lê o detalhe inteiro.
 *
 * Aperta "Confirm to see full address" quando o endereço ainda está escondido
 * (regra do dono, 30/08/2026): sem a rua o job nasce no OS com só o postcode e
 * o parceiro chega no CEP, não na porta.
 */
/**
 * Abre um job da lista do History pela IDENTIDADE dele, não pela coordenada.
 *
 * `jobsDoDia` rola enquanto coleta, então o `y` que ela anotou pertence a um
 * estado de rolagem anterior: tocar nele abria outra linha, ou nada, e a Nina
 * respondia "não consegui ler o estado desta tela" para todo job. Aqui ela
 * rola até a hora aparecer e toca no que está ao lado dela.
 */
export function abrirJob(dia, { hora }) {
  /**
   * Reselecionar o DIA e descer, nunca subir.
   *
   * `subirAoTopo` rola o History inteiro de volta e desfaz a seleção: a Nina
   * passava a procurar a hora na lista de outro dia e não achava nada. Tocar
   * na célula do calendário recoloca a lista do dia certo no lugar.
   */
  const celula = esperar((n) => n.txt === String(dia) && n.y1 > 450 && n.y2 < 600, 20);
  if (!celula) return false;
  tocar(celula.x, celula.y, 4000);
  for (let v = 0; v < 12; v++) {
    const alvo = arvore().find((n) => n.txt === hora && n.y1 > 600 && n.y2 < 2100);
    if (alvo) { tocar(624, alvo.y, 6000); return true }
    descer();
  }
  return false;
}

export function lerJob(y) {
  if (y != null) tocar(624, y, 6000);
  let nos = arvore();

  const esconde = nos.find((n) => /Confirm to see/i.test(n.txt));
  if (esconde) {
    tocar(esconde.x, esconde.y, 3000);
    const confirmar = achar((n) => n.txt === "CONFIRM");
    if (confirmar) { tocar(confirmar.x, confirmar.y, 7000); nos = arvore() }
  }

  const campo = (rotulo) => {
    const n = nos.find((x) => x.txt.startsWith(rotulo + "\n"));
    return n ? n.txt.slice(rotulo.length + 1).trim() : null;
  };
  const postcode = nos.find((n) => /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/.test(n.txt))?.txt ?? null;
  const titulo = nos.find((n) => /cleaning|clean/i.test(n.txt) && n.y1 > 400 && n.y2 < 620)?.txt ?? null;
  const comeca = nos.find((n) => /^Starts /.test(n.txt))?.txt ?? null;
  const cliente = nos.find((n) => /\((Member|Corporate|Member, Corporate)\)/.test(n.txt))?.txt ?? null;

  // Condições, layout e comentário do cliente vivem mais abaixo, e o layout é
  // o que decide o custo do parceiro.
  for (let i = 0; i < 3; i++) descer();
  const fundo = arvore();
  const juntar = (re) => fundo.filter((n) => re.test(n.txt)).map((n) => n.txt).join("\n\n") || null;

  return {
    postcode,
    titulo,
    comeca,
    cliente: cliente ? cliente.replace(/\s*\((Member|Corporate|Member, Corporate)\)\s*$/, "").trim() : null,
    endereco: campo("Address"),
    precoApp: (() => { const p = campo("Price"); return p ? Number(String(p).replace(/[^\d.]/g, "")) : null })(),
    pagamento: campo("Payment method"),
    statusPagamento: campo("Payment Status"),
    condicoes: juntar(/Important conditions|Property Layout|Move in\/Out/),
    comentario: juntar(/Key pick up|bedroom property|parking/i),
  };
}

/** Já fechado? O único sinal confiável. */
export function jobFechado() {
  // `lerJob` desce a lista para pegar layout e comentário, e o GO TO JOB sai
  // da tela. Sem voltar ao topo, a Nina respondia "não sei" para todo job.
  subirAoTopo();
  const ir = achar("GO TO JOB");
  if (!ir) return null;                       // não é a tela de detalhe
  tocar(ir.x, ir.y, 4000);
  /**
   * Esperar a tela do job desenhar antes de decidir.
   *
   * Lendo uma vez, a Nina dizia "aberto" para job fechado e proporia fechar de
   * novo o que já estava pronto. Entre as duas respostas possíveis, a de
   * "fechado" é a que aparece mais devagar, porque vem do servidor.
   */
  const pronto = esperar((n) => /The job\s*is done/i.test(n.txt), 25);
  if (pronto) return true;
  return Boolean(achar((n) => /^Check (in|out)$/.test(n.txt))) ? false : null;
}

/** A hora real: o app pinta no fuso do aparelho, e a diferença é 4h. */
export function horaReal(textoDoApp) {
  const m = /(\d{1,2}):(\d{2})\s?(AM|PM)?/i.exec(String(textoDoApp ?? ""));
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2];
  if (/PM/i.test(m[3] ?? "") && h < 12) h += 12;
  if (/AM/i.test(m[3] ?? "") && h === 12) h = 0;
  return `${String((h + 4) % 24).padStart(2, "0")}:${min}`;
}

/**
 * A tela de "New job received", que era a lacuna do bot desde o desenho dele.
 *
 * Ela NÃO é tela de aceitar: só informa, com "Go to jobs" e "OK". E é a fonte
 * mais confiável de horário que o app tem, porque vem escrita em data e hora
 * REAIS, sem a conversão de fuso que a tela de detalhe exige:
 *
 *   "New job received - EOT - Move out cleaning at EC2A 2FJ starting
 *    17.09.2026 12:00."
 *
 * Quando ela está na frente, nada mais navega — por isso a Nina lê, anota e
 * dispensa antes de qualquer outra coisa.
 */
export function lerNotificacaoDeJob() {
  const titulo = achar((n) => /New job received/i.test(n.txt) && n.y1 < 400);
  if (!titulo) return null;
  const desc = arvore().find((n) => n.id === "descriptionTextView" || /New job received -/.test(n.txt));
  const texto = desc?.txt ?? titulo.txt;
  const m = /at\s+([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\s+starting\s+(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}:\d{2})/i.exec(texto);
  return {
    texto,
    servico: (/received\s*-\s*(.+?)\s+at\s+/i.exec(texto) ?? [, null])[1],
    postcode: m ? m[1].toUpperCase() : null,
    // A data vem em DD.MM.AAAA; o OS quer AAAA-MM-DD.
    data: m ? `${m[4]}-${m[3]}-${m[2]}` : null,
    hora: m ? m[5] : null,
  };
}

/** Dispensa a notificação pelo OK, que é o botão que não navega para lugar nenhum. */
export function dispensarNotificacao() {
  const ok = achar((n) => n.id === "okButton" || (n.txt === "OK" && n.clic));
  if (!ok) return false;
  tocar(ok.x, ok.y, 3500);
  return true;
}

/**
 * A tela de OFERTA (`OnDemandActivity`), a que decide se ganhamos o job.
 *
 * Mapeada em 16/09/2026 (ver `telas/LEIA.md`). Tem cronômetro: oferta é
 * corrida. O `heading_txt` diz o desfecho, e na captura que temos ele dizia
 * "Someone else has already taken the job!" — perdida para outro.
 *
 * A Nina NÃO aceita (dono, 16/09/2026). Ela lê, relata, e sai pelo `ok_fbtn`.
 * O botão de aceitar só aparece com oferta viva e ainda não foi visto.
 */
export function lerOferta() {
  // UMA leitura para tudo: três dumps seguidos abriam janela para a tela
  // mudar no meio, e os campos saíam vazios sem ninguém notar.
  const nos = arvore();
  const cab = nos.find((n) => n.id === "heading_txt");
  const nome = nos.find((n) => n.id === "tv_service_name");
  if (!cab && !nome) return null;
  const campo = (rotulo) => {
    const n = nos.find((x) => x.txt.startsWith(rotulo + "\n"));
    return n ? n.txt.slice(rotulo.length + 1).trim() : null;
  };
  const preco = nos.find((n) => n.id === "tv_start_at")?.txt ?? null;
  return {
    desfecho: cab?.txt ?? null,
    perdida: /already taken/i.test(cab?.txt ?? ""),
    servico: nome?.txt ?? null,
    preco: preco ? Number(String(preco).replace(/[^\d.]/g, "")) : null,
    endereco: campo("Address"),
    comeca: campo("Starts"),
    pagamento: campo("Payment method"),
    cronometro: nos.find((n) => n.id === "chronometer")?.txt ?? null,
  };
}

/** Sai da oferta sem aceitar nada. */
export function dispensarOferta() {
  const ok = achar((n) => n.id === "ok_fbtn" || n.id === "button_minimize");
  if (!ok) return false;
  tocar(ok.x, ok.y, 3500);
  return true;
}

/**
 * Limpa QUALQUER aviso que esteja na frente, e conta o que ele dizia.
 *
 * O app conversa por modal, e não é um tipo só: tem o "New job received"
 * (`FOSInfoAnimatedActivity`), a oferta (`OnDemandActivity`), e diálogos
 * simples com um OK — este último trouxe "Hey, EC2A 2FJ at 08:00 has been
 * changed from Cash to Card", que é informação que o escritório quer.
 *
 * Enquanto um deles está na frente NADA navega, e foi por isso que a Nina
 * dizia "não cheguei no History" com o History a um toque de distância. Por
 * isso isto roda antes de cada navegação, e não uma vez no começo.
 *
 * Devolve o que leu, para virar linha no brief: aviso engolido em silêncio é
 * exatamente o que a casa não aceita mais.
 */
export function limparAvisos(limite = 6) {
  const lidos = [];
  for (let i = 0; i < limite; i++) {
    const nos = arvore();

    const oferta = nos.find((n) => n.id === "heading_txt" || n.id === "tv_service_name");
    if (oferta) {
      const of = lerOferta();
      if (of) lidos.push({ tipo: "oferta", ...of });
      if (!dispensarOferta()) break;
      continue;
    }

    const aviso = nos.find((n) => /New job received/i.test(n.txt));
    if (aviso) {
      const a = lerNotificacaoDeJob();
      if (a) lidos.push({ tipo: "job_novo", ...a });
      if (!dispensarNotificacao()) break;
      continue;
    }

    /**
     * Diálogo simples: um OK clicável e um texto acima dele. Só conta como
     * aviso quando há texto de verdade, senão um OK de formulário viraria
     * "aviso" e a Nina apertaria coisa que não devia.
     */
    const ok = nos.find((n) => n.txt === "OK" && n.clic);
    if (ok) {
      const corpo = nos
        .filter((n) => n.txt && !n.clic && n.y < ok.y && n.y > ok.y - 700 && n.txt.length > 12)
        .sort((a, b) => b.y - a.y)[0];
      if (!corpo) break;
      lidos.push({ tipo: "aviso", texto: corpo.txt.replace(/\s+/g, " ").trim() });
      tocar(ok.x, ok.y, 3000);
      continue;
    }

    break;
  }
  return lidos;
}
