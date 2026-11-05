// Valores padrão da drogaria. Usados pelo seed e, depois, por "restaurar padrão".

export const DEFAULT_SETTINGS = {
  // Meta de cada funcionário por dia. O checklist padrão dá 100 pontos para cada um.
  meta_pontos: '100',
  turno_inicio: '08:00',
  turno_fim: '18:00',
  bonus_base: '0',
  nome_loja: 'Drogaria Bem Popular',
  // Dias da semana com expediente (0 = domingo). A drogaria abre de segunda a sábado.
  dias_expediente: '1,2,3,4,5,6',
  // Ponto por etiqueta NFC. Desligado até a gestão gravar a etiqueta.
  ponto_exige_nfc: '0',
  // Entra no fim de todo prompt de imagem do roteiro, para as artes saírem com a mesma cara.
  estilo_marca:
    'Estilo Drogaria Bem Popular: foto limpa e bem iluminada, fundo branco com detalhes em vermelho, amarelo e verde, ' +
    'produto em destaque, sem pessoas, sem texto escrito na imagem, formato vertical 4:5.',
};

// Índice = dia da semana (0 = domingo).
export const DEFAULT_CLEANING_FOCUS = [
  'loja fechada',
  'balcão e vitrine',
  'prateleiras de medicamentos',
  'perfumaria e higiene',
  'banheiro e copa',
  'entrada e fachada',
  'gôndolas e piso',
];

// Quantas pessoas o checklist padrão divide. `who` = posição do funcionário (0 = primeiro, 1 = segundo);
// sem `who`, a tarefa é das duas pessoas e cada uma marca no próprio dia.
export const DEFAULT_TEAM_SIZE = 2;

// A tarefa com {foco} recebe o foco de limpeza do dia na hora de montar o snapshot.
// Cada funcionário soma 100 pontos: 30 das tarefas em comum + 70 das próprias.
export const DEFAULT_SECTIONS = [
  {
    title: 'Abertura',
    subtitle: null,
    tasks: [
      { text: 'Bater ponto de entrada', points: 10, auto: 'check_in', due_time: '08:00' },
      { text: 'Abrir a loja: portas, luzes, computador e sistema', points: 5, due_time: '08:05', who: 0 },
      { text: 'Conferir caixa e troco inicial', points: 10, due_time: '08:15', who: 0 },
      { text: 'Conferir a geladeira de medicamentos e anotar a temperatura', points: 10, requires_photo: true, due_time: '08:15', who: 1 },
    ],
  },
  {
    title: 'Loja',
    subtitle: null,
    tasks: [
      { text: 'Limpeza do foco do dia: {foco}', points: 15, requires_photo: true, due_time: '09:00', who: 1 },
      { text: 'Organizar gôndolas de higiene, beleza e perfumaria', points: 10, requires_photo: true, due_time: '10:00', who: 0 },
      { text: 'Repor medicamentos e produtos do balcão', points: 10, due_time: '11:00', who: 1 },
    ],
  },
  {
    title: 'Estoque e validade',
    subtitle: null,
    tasks: [
      { text: 'Conferir a validade de uma prateleira e separar vencidos e a vencer', points: 15, requires_photo: true, due_time: '14:00', who: 1 },
      { text: 'Conferir pedidos e receber mercadorias', points: 10, due_time: '15:00', who: 1 },
    ],
  },
  {
    title: 'Atendimento e divulgação',
    subtitle: null,
    tasks: [
      // Cada postagem do roteiro do dia tem o próprio horário; os pontos se dividem entre elas.
      { text: 'Postagens do dia', points: 20, posts: true, who: 0 },
      { text: 'Responder os clientes do WhatsApp e separar encomendas', points: 10, due_time: '16:00', who: 0 },
    ],
  },
  {
    title: 'Fechamento',
    subtitle: null,
    tasks: [
      { text: 'Limpeza final: balcão e entrada', points: 10, requires_photo: true, due_time: '17:30', who: 1 },
      { text: 'Fechamento de caixa e relatório do dia', points: 15, due_time: '17:40', who: 0 },
      { text: 'Bater ponto de saída', points: 10, auto: 'check_out', due_time: '18:00' },
      { text: 'Fechar o dia no app e enviar o resumo', points: 10, auto: 'close', due_time: '18:05' },
    ],
  },
];

/**
 * Checklist padrão com o responsável de cada tarefa trocado pelo id do funcionário.
 * `employeeIds` = ids dos funcionários ativos em ordem de cadastro. Sem o funcionário da posição, a tarefa fica para todos.
 */
export function defaultSectionsFor(employeeIds) {
  return DEFAULT_SECTIONS.map((section) => ({
    ...section,
    tasks: section.tasks.map(({ who, ...task }) => ({ ...task, assignee: who == null ? null : employeeIds[who] ?? null })),
  }));
}

export const POST_KINDS = {
  grupo_vip: 'Grupo de clientes',
  stories: 'Stories/Status',
  feed: 'Feed',
  tiktok: 'TikTok/Reels',
  mensagem: 'Mensagem para clientes',
};

export const MAX_POSTS_PER_DAY = 10;

// Tema de cada dia útil do roteiro padrão (índice = dia da semana).
const DAY_THEMES = {
  1: { theme: 'proteção solar e cuidados com a pele', product: 'protetores solares, hidratantes e sabonetes faciais' },
  2: { theme: 'vitaminas e suplementos', product: 'frascos de vitaminas e suplementos de venda livre' },
  3: { theme: 'cuidados com o bebê', product: 'fraldas, lenços umedecidos e pomadas para assaduras' },
  4: { theme: 'higiene e saúde bucal', product: 'escovas, cremes dentais e fio dental' },
  5: { theme: 'ofertas do fim de semana', product: 'uma seleção dos produtos de higiene e beleza mais vendidos' },
  6: { theme: 'beleza e perfumaria', product: 'desodorantes, perfumes e cremes corporais' },
};

// Regra que vai em todo prompt de texto: propaganda de farmácia tem limites (Anvisa).
const PHARMA_RULE =
  ' Não cite medicamentos com tarja, não prometa cura nem resultado de saúde e termine com ' +
  '"Em caso de dúvida, fale com o nosso farmacêutico".';

/** Roteiro inicial: três postagens por dia útil, com prompts prontos para o ChatGPT. */
export function defaultPosts() {
  const posts = [];
  for (const [weekday, { theme, product }] of Object.entries(DAY_THEMES)) {
    posts.push(
      {
        weekday: Number(weekday),
        time: '09:30',
        kind: 'grupo_vip',
        goal: `Boa tarde com a novidade do dia: ${theme}`,
        image_prompt: `Crie uma imagem de ${product} arrumados sobre o balcão de uma drogaria de bairro.`,
        text_prompt:
          `Escreva uma mensagem curta de WhatsApp para os clientes da Drogaria Bem Popular ` +
          `sobre ${theme}. Tom acolhedor e próximo, no máximo 4 linhas, até 2 emojis, com um convite ` +
          `para passar na drogaria ou pedir pelo WhatsApp.${PHARMA_RULE}`,
      },
      {
        weekday: Number(weekday),
        time: '13:30',
        kind: 'stories',
        goal: `Dica rápida de ${theme}`,
        image_prompt: `Crie uma imagem em close de ${product}, em uma prateleira organizada e bem iluminada.`,
        text_prompt:
          `Escreva o texto de um story de Instagram da Drogaria Bem Popular com uma dica rápida de ${theme}. ` +
          `Uma frase de gancho, uma dica prática e a chamada "Responda este story que a gente separa para você".${PHARMA_RULE}`,
      },
      {
        weekday: Number(weekday),
        time: '16:30',
        kind: 'feed',
        goal: `Post do feed: ${theme}`,
        image_prompt: `Crie uma imagem de vitrine de drogaria com ${product}, composição organizada e limpa.`,
        text_prompt:
          `Escreva uma legenda de Instagram para a Drogaria Bem Popular sobre ${theme}. Comece com uma pergunta ` +
          `que prenda a atenção, explique o benefício em 2 frases, convide para visitar a drogaria e sugira 5 hashtags.${PHARMA_RULE}`,
      },
    );
  }
  return posts;
}
