/**
 * Emojis do composer. Extraído do inbox pra que a faixa lateral use a MESMA
 * lista: dois teclados diferentes pro mesmo campo seria um design paralelo.
 *
 * Eram 30 numa grade só (founder 08/08: "quero como se fosse realmente o
 * iPhone, com todos"). Agora vem por CATEGORIA, na ordem do teclado do iOS,
 * com palavras-chave em pt-BR pra busca — sem busca a pessoa rola 300 símbolos
 * pra achar o joinha, que é o que ela usa 90% das vezes.
 */
export interface EmojiCat {
  key: string;
  /** Nome da categoria, mostrado acima da grade. */
  label: string;
  /** Emoji que representa a categoria na fila de abas. */
  aba: string;
  itens: readonly (readonly [string, string])[];
}

/** [emoji, palavras-chave em pt-BR sem acento]. A busca casa por prefixo. */
export const EMOJI_CATS: readonly EmojiCat[] = [
  {
    key: "usados",
    label: "Most used",
    aba: "🕘",
    itens: [
      ["👍", "joinha positivo ok legal curtir"],
      ["🙏", "obrigado favor prece agradecer"],
      ["❤️", "coracao amor vermelho"],
      ["😂", "rindo chorando risada engracado"],
      ["🔥", "fogo top demais quente"],
      ["✅", "check certo feito confirmado ok"],
      ["🎉", "festa comemorar parabens"],
      ["😊", "feliz sorriso simpatico"],
    ],
  },
  {
    key: "rostos",
    label: "Faces and emotions",
    aba: "😀",
    itens: [
      ["😀", "sorriso feliz"], ["😃", "sorriso alegre"], ["😄", "sorriso rindo"],
      ["😁", "sorriso dentes"], ["😆", "rindo muito"], ["😅", "rindo suor alivio"],
      ["😂", "rindo chorando risada"], ["🤣", "rolando de rir"], ["🙂", "sorriso leve"],
      ["🙃", "cabeca para baixo ironia"], ["😉", "piscada"], ["😊", "feliz simpatico"],
      ["😇", "anjo inocente"], ["🥰", "apaixonado coracoes"], ["😍", "olhos de coracao amor"],
      ["🤩", "estrelas uau"], ["😘", "beijo"], ["😗", "beijinho"],
      ["😚", "beijo fechado"], ["🥲", "sorriso lagrima"], ["😋", "delicia lingua gostoso"],
      ["😛", "lingua"], ["😜", "lingua piscada"], ["🤪", "maluco doido"],
      ["🤑", "cifrao dinheiro"], ["🤗", "abraco"], ["🤭", "ops risadinha"],
      ["🤫", "silencio segredo"], ["🤔", "pensando duvida"], ["🤨", "sobrancelha desconfiado"],
      ["😐", "neutro"], ["😑", "sem expressao"], ["😶", "sem boca"],
      ["😏", "malicioso"], ["😒", "de lado chateado"], ["🙄", "revirando olhos"],
      ["😬", "constrangido careta"], ["🤥", "mentira"], ["😌", "aliviado calmo"],
      ["😔", "triste pensativo"], ["😪", "sono"], ["🤤", "babando"],
      ["😴", "dormindo"], ["😷", "mascara doente"], ["🤒", "febre termometro"],
      ["🤕", "machucado curativo"], ["🤢", "enjoado nojo"], ["🤧", "espirro"],
      ["🥵", "calor quente"], ["🥶", "frio congelando"], ["😵", "tonto"],
      ["🤯", "explodindo mente chocado"], ["🤠", "cowboy"], ["😎", "oculos escuros estiloso"],
      ["🤓", "nerd"], ["🧐", "monoculo analisando"], ["😕", "confuso"],
      ["😟", "preocupado"], ["🙁", "triste leve"], ["😮", "surpreso boca aberta"],
      ["😯", "espantado"], ["😲", "chocado"], ["😳", "envergonhado corado"],
      ["🥺", "suplicante favor"], ["😨", "medo"], ["😰", "ansioso suor"],
      ["😢", "chorando triste"], ["😭", "chorando muito"], ["😱", "grito pavor"],
      ["😖", "sofrendo"], ["😞", "desapontado"], ["😓", "suor frio"],
      ["😩", "cansado exausto"], ["😫", "exausto"], ["🥱", "bocejo entediado"],
      ["😤", "bufando irritado"], ["😡", "bravo raiva vermelho"], ["😠", "bravo"],
      ["🤬", "xingando palavrao"], ["😈", "diabinho travesso"], ["💀", "caveira morto"],
      ["💩", "coco"], ["🤡", "palhaco"], ["👻", "fantasma"],
      ["👽", "et alien"], ["🤖", "robo bot ia agente"],
      ["🥹", "emocionado segurando choro"],
      ["🫠", "derretendo constrangido"],
      ["🤗", "abraco acolher"],
      ["🤔", "pensando duvida"],
      ["😴", "dormindo sono cansado"],
      ["🤒", "doente febre"],
      ["🥳", "festa aniversario comemorar"],
      ["😇", "anjo inocente"],
      ["🤩", "estrelas impressionado uau"],
      ["😭", "chorando muito triste"],
      ["😮", "surpreso boca aberta"],
      ["🫶", "coracao com as maos amor"],
    ],
  },
  {
    key: "gestos",
    label: "Gestures and people",
    aba: "👍",
    itens: [
      ["👍", "joinha positivo ok legal curtir"], ["👎", "negativo ruim"],
      ["👌", "ok perfeito"], ["🤏", "pouquinho pequeno"], ["✌️", "paz vitoria"],
      ["🤞", "dedos cruzados sorte"], ["🤟", "amor rock"], ["🤘", "rock"],
      ["🤙", "me liga"], ["👈", "aponta esquerda"], ["👉", "aponta direita"],
      ["👆", "aponta cima"], ["👇", "aponta baixo"], ["☝️", "indicador cima"],
      ["✋", "mao parada"], ["🖐️", "mao dedos"], ["👋", "tchau ola aceno"],
      ["🤝", "aperto de mao acordo negocio fechado"], ["🙏", "obrigado favor prece"],
      ["✍️", "escrevendo assinar"], ["🤳", "selfie"], ["💪", "forte musculo biceps"],
      ["👏", "palmas aplauso parabens"], ["🙌", "maos para o alto comemorar"],
      ["👐", "maos abertas"], ["🤲", "maos juntas pedindo"], ["🫶", "coracao com as maos"],
      ["👀", "olhos olhando"], ["👁️", "olho"], ["🧠", "cerebro"],
      ["👤", "pessoa contato"], ["👥", "pessoas grupo equipe"],
      ["🧑‍💻", "trabalhando computador"], ["👨‍🔧", "tecnico mecanico"],
      ["👩‍⚕️", "medica saude"], ["🕺", "dancando"], ["💃", "dancando"],
      ["🤦", "facepalm"], ["🤷", "sei la ombros"], ["🙋", "levantando a mao"],
      ["🙅", "nao"],
      ["🤝", "aperto de mao acordo fechado"],
      ["👌", "ok perfeito otimo"],
      ["🫡", "continencia entendido pode deixar"],
      ["👋", "tchau oi aceno"],
      ["🙌", "maos para cima comemorar"],
      ["💪", "forca musculo bora"],
      ["🤞", "dedos cruzados torcendo"],
      ["👏", "palmas parabens"],
    ],
  },
  {
    key: "trabalho",
    label: "Work and objects",
    aba: "💼",
    itens: [
      ["💼", "maleta trabalho negocio"], ["📅", "calendario agenda data"],
      ["🗓️", "calendario agenda"], ["⏰", "despertador hora alarme"],
      ["⏳", "ampulheta esperando"], ["📞", "telefone ligar chamada"], ["📱", "celular"],
      ["💻", "notebook computador"], ["🖥️", "monitor"], ["⌨️", "teclado"],
      ["🖨️", "impressora"], ["📷", "camera foto"], ["🎥", "video filmadora"],
      ["🎤", "microfone audio"], ["🔊", "som alto"], ["🔔", "sino notificacao"],
      ["📎", "clipe anexo"], ["📌", "alfinete fixar"], ["📍", "local endereco pin"],
      ["✂️", "tesoura cortar"], ["📝", "anotacao escrever nota"], ["📄", "documento folha"],
      ["📑", "documentos abas"], ["📊", "grafico barras relatorio"],
      ["📈", "grafico subindo crescimento"], ["📉", "grafico caindo queda"],
      ["📋", "prancheta lista"], ["🗂️", "pastas arquivo"], ["📁", "pasta"],
      ["🗑️", "lixeira excluir"], ["🔒", "cadeado fechado"], ["🔓", "cadeado aberto"],
      ["🔑", "chave"], ["🔧", "chave inglesa ferramenta os"], ["🔨", "martelo"],
      ["🛠️", "ferramentas manutencao"], ["⚙️", "engrenagem config"],
      ["🧰", "caixa de ferramentas"], ["🔍", "lupa buscar"], ["💡", "ideia lampada"],
      ["🔋", "bateria"], ["🔌", "tomada energia"], ["📦", "caixa pacote pedido entrega"],
      ["🚚", "caminhao entrega frete"], ["🛒", "carrinho compra pedido"],
      ["🏷️", "etiqueta preco tag"], ["🧾", "recibo nota fiscal"],
      ["💳", "cartao pagamento"], ["💰", "dinheiro saco grana"], ["💵", "dinheiro nota"],
      ["🪙", "moeda"], ["🏦", "banco"], ["🏠", "casa"],
      ["🏢", "predio empresa escritorio"], ["🏪", "loja"], ["🚗", "carro"],
      ["🏍️", "moto"], ["✈️", "aviao viagem"],
      ["📎", "clipe anexo"],
      ["🧾", "recibo nota cupom"],
      ["💳", "cartao pagamento credito"],
      ["🏦", "banco agencia"],
      ["📦", "caixa pacote entrega"],
      ["🚚", "caminhao entrega frete"],
      ["🧰", "caixa de ferramentas manutencao"],
      ["🗓️", "agenda calendario data"],
      ["📍", "local endereco pin"],
      ["🔗", "link url"],
    ],
  },
  {
    key: "simbolos",
    label: "Symbols",
    aba: "✅",
    itens: [
      ["✅", "check certo feito confirmado ok"], ["☑️", "check caixa"],
      ["✔️", "check"], ["❌", "erro nao cancelar x"], ["⚠️", "atencao aviso alerta cuidado"],
      ["🚨", "urgente sirene alerta"], ["❗", "exclamacao importante"],
      ["❓", "duvida pergunta"], ["‼️", "muito importante"], ["🔴", "vermelho bolinha"],
      ["🟠", "laranja bolinha"], ["🟡", "amarelo bolinha"], ["🟢", "verde bolinha online"],
      ["🔵", "azul bolinha"], ["⚫", "preto bolinha"], ["⭐", "estrela favorito"],
      ["🌟", "estrela brilho"], ["✨", "brilho magico ia"], ["💥", "explosao impacto"],
      ["🔥", "fogo top demais quente"], ["⚡", "raio rapido energia"],
      ["🎯", "alvo meta objetivo"], ["🏆", "trofeu ganhou premio"],
      ["🥇", "primeiro medalha ouro"], ["🎁", "presente brinde"],
      ["🎉", "festa comemorar parabens"], ["🎊", "confete festa"],
      ["🚀", "foguete lancamento crescer"], ["💯", "cem nota maxima"],
      ["❤️", "coracao amor vermelho"], ["🧡", "coracao laranja"], ["💛", "coracao amarelo"],
      ["💚", "coracao verde"], ["💙", "coracao azul"], ["💜", "coracao roxo"],
      ["🖤", "coracao preto"], ["🤍", "coracao branco"], ["💔", "coracao partido"],
      ["♻️", "reciclar"], ["🔗", "link"],
      ["⚠️", "atencao aviso cuidado"],
      ["❗", "exclamacao importante"],
      ["💯", "cem nota maxima top"],
      ["♻️", "reciclar renovar"],
      ["🔒", "cadeado seguro privado"],
      ["⏰", "despertador prazo hora"],
      ["💸", "dinheiro voando gasto"],
      ["📈", "grafico subindo crescimento"],
      ["📉", "grafico caindo queda"],
    ],
  },
  {
    key: "comida",
    label: "Food and nature",
    aba: "☕",
    itens: [
      ["☕", "cafe"], ["🍵", "cha"], ["🥤", "refrigerante copo"],
      ["🍺", "cerveja"], ["🍻", "brinde cervejas"], ["🥂", "brinde taca comemorar"],
      ["🍷", "vinho"], ["🍕", "pizza"], ["🍔", "hamburguer lanche"],
      ["🍟", "batata frita"], ["🌭", "cachorro quente"], ["🌮", "taco"],
      ["🍝", "macarrao"], ["🍣", "sushi"], ["🍜", "lamen sopa"],
      ["🥗", "salada"], ["🍞", "pao"], ["🧀", "queijo"],
      ["🍎", "maca"], ["🍌", "banana"], ["🍓", "morango"],
      ["🍇", "uva"], ["🍉", "melancia"], ["🎂", "bolo aniversario"],
      ["🍰", "fatia bolo"], ["🍫", "chocolate"], ["🍪", "biscoito"],
      ["🍦", "sorvete"], ["🌱", "broto crescendo"], ["🌿", "folha planta"],
      ["🌷", "tulipa flor"], ["🌹", "rosa flor"], ["🌻", "girassol"],
      ["🌳", "arvore"], ["☀️", "sol"], ["🌙", "lua noite"],
      ["☁️", "nuvem"], ["🌧️", "chuva"], ["🌈", "arco iris"],
      ["❄️", "neve frio"], ["🐶", "cachorro"], ["🐱", "gato"],
      ["🐾", "patinhas pet"], ["🦷", "dente odonto"], ["💊", "remedio"],
      ["🍕", "pizza"],
      ["🍔", "hamburguer lanche"],
      ["🥗", "salada saudavel"],
      ["🍺", "cerveja chopp"],
      ["🥤", "refrigerante bebida copo"],
      ["🍫", "chocolate doce"],
    ],
  },
] as const;

/** Lista achatada — quem só quer "os emojis" (faixa lateral, atalhos). */
export const WA_EMOJIS: readonly string[] = Array.from(
  new Set(EMOJI_CATS.flatMap((c) => c.itens.map(([e]) => e))),
);

/** Busca por palavra-chave, sem acento e por prefixo. Vazio = sem filtro. */
export function buscarEmojis(termo: string): string[] {
  const q = termo.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (!q) return [];
  const achados: string[] = [];
  for (const cat of EMOJI_CATS) {
    if (cat.key === "usados") continue;
    for (const [emoji, chaves] of cat.itens) {
      if (chaves.split(" ").some((k) => k.startsWith(q)) && !achados.includes(emoji)) {
        achados.push(emoji);
      }
    }
  }
  return achados;
}
