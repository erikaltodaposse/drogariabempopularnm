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
// O primeiro funcionário cuida do caixa e do atendimento; o segundo é o farmacêutico.
export const DEFAULT_TEAM_SIZE = 2;
export const DEFAULT_ROLES = ['Caixa e atendimento', 'Farmacêutico'];

// A tarefa com {foco} recebe o foco de limpeza do dia na hora de montar o snapshot.
// Cada funcionário soma 100 pontos: 10 de fechar o dia (de todos) + 90 das próprias.
export const DEFAULT_SECTIONS = [
  {
    title: 'Abertura',
    subtitle: null,
    tasks: [
      { text: 'Abrir a loja: portas, luzes, computador e sistema', points: 10, due_time: '08:05', who: 0 },
      { text: 'Conferir caixa e troco inicial', points: 10, due_time: '08:15', who: 0 },
      { text: 'Conferir a geladeira de medicamentos e anotar a temperatura', points: 15, requires_photo: true, due_time: '08:15', who: 1 },
    ],
  },
  {
    title: 'Caixa e atendimento',
    subtitle: null,
    tasks: [
      { text: 'Limpeza do foco do dia: {foco}', points: 20, requires_photo: true, due_time: '09:00', who: 0 },
      { text: 'Organizar gôndolas e vitrine de higiene, beleza e perfumaria', points: 15, requires_photo: true, due_time: '10:00', who: 0 },
      { text: 'Conferir preços e etiquetas de uma gôndola', points: 10, due_time: '11:00', who: 0 },
      { text: 'Responder os clientes do WhatsApp e separar encomendas', points: 15, due_time: '16:00', who: 0 },
    ],
  },
  {
    title: 'Farmácia',
    subtitle: null,
    tasks: [
      { text: 'Conferir as receitas retidas e lançar os controlados no SNGPC', points: 20, due_time: '09:00', who: 1 },
      { text: 'Conferir a validade de uma prateleira e separar vencidos e a vencer', points: 20, requires_photo: true, due_time: '10:00', who: 1 },
      { text: 'Receber mercadorias e conferir com a nota fiscal', points: 10, due_time: '14:00', who: 1 },
      { text: 'Repor medicamentos e organizar o estoque', points: 15, due_time: '15:00', who: 1 },
      { text: 'Conferir o armário de controlados', points: 10, due_time: '17:30', who: 1 },
    ],
  },
  {
    title: 'Fechamento',
    subtitle: null,
    tasks: [
      { text: 'Fechamento de caixa e relatório do dia', points: 10, due_time: '17:40', who: 0 },
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
