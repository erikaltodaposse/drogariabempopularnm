import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, snapshotTasks } from '../server/lib/snapshot.js';
import { dayPoints, adherence, bonusTier } from '../server/lib/points.js';
import { defaultSectionsFor } from '../server/lib/defaults.js';

const ANA = 1;
const BRUNO = 2;

// Ids na ordem do checklist padrão: 1 abrir, 2 caixa, 3 geladeira, 4 foco, 5 gôndolas, 6 preços, 7 WhatsApp,
// 8 receitas, 9 validade, 10 recebimento, 11 reposição, 12 controlados, 13 fechamento de caixa, 14 fechar o dia. Ana é do caixa e atendimento; Bruno, farmacêutico.
function defaultTemplate() {
  let id = 0;
  return {
    version_id: 1,
    weekday: 1,
    cleaning_focus: 'balcão e vitrine',
    sections: defaultSectionsFor([ANA, BRUNO]).map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t, id: ++id })) })),
  };
}

test('o checklist padrão tem 14 tarefas e dá 100 pontos para cada funcionário', async () => {
  const all = buildSnapshot(defaultTemplate());
  assert.equal(snapshotTasks(all).length, 14);
  for (const [uid, n] of [[ANA, 8], [BRUNO, 7]]) {
    const snap = buildSnapshot(defaultTemplate(), uid);
    const ids = snapshotTasks(snap).map((t) => t.id);
    assert.equal(ids.length, n);
    assert.deepEqual(dayPoints(snap, ids), { earned: 100, max: 100, done: n, total: n });
  }
});

test('cada um só recebe as próprias tarefas e as em comum', async () => {
  const ana = buildSnapshot(defaultTemplate(), ANA);
  const bruno = buildSnapshot(defaultTemplate(), BRUNO);
  assert.deepEqual(snapshotTasks(ana).map((t) => t.id), [1, 2, 4, 5, 6, 7, 13, 14]);
  assert.deepEqual(snapshotTasks(bruno).map((t) => t.id), [3, 8, 9, 10, 11, 12, 14]);
  // O bloco "Farmácia" é todo do Bruno e o "Caixa e atendimento" todo da Ana: cada um some do dia do outro.
  assert.ok(!ana.sections.some((s) => s.title === 'Farmácia'));
  assert.ok(!bruno.sections.some((s) => s.title === 'Caixa e atendimento'));
  assert.equal(ana.user_id, ANA);
});

test('dia parcial soma só o que foi marcado', async () => {
  const snap = buildSnapshot(defaultTemplate(), ANA);
  // 1: abrir a loja (10), 2: caixa (10), 5: gôndolas (15)
  assert.deepEqual(dayPoints(snap, [1, 2, 5]), { earned: 35, max: 100, done: 3, total: 8 });
  // A geladeira (3) é do Bruno: marcada no dia da Ana, não conta.
  assert.equal(dayPoints(snap, [1, 2, 3]).earned, 20);
  assert.equal(dayPoints(snap, []).earned, 0);
});

test('tarefa removida do template não afeta dia antigo', async () => {
  const template = defaultTemplate();
  const oldDay = buildSnapshot(template, BRUNO);
  const allIds = snapshotTasks(oldDay).map((t) => t.id);

  template.sections[2].tasks.shift(); // remove a conferência das receitas (20 pontos)
  const newDay = buildSnapshot(template, BRUNO);

  assert.equal(dayPoints(oldDay, allIds).earned, 100);
  assert.equal(dayPoints(newDay, allIds).max, 80);
});

test('foco do dia entra no texto da tarefa', async () => {
  const snap = buildSnapshot(defaultTemplate(), ANA);
  assert.equal(snap.sections[1].tasks[0].text, 'Limpeza do foco do dia: balcão e vitrine');
});

test('adesão ignora dias sem check e aplica as faixas', async () => {
  const a = adherence(
    [
      { points: 150, checks: 14 },
      { points: 135, checks: 12 },
      { points: 0, checks: 0 },
    ],
    150,
  );
  assert.equal(a.workedDays, 2);
  assert.equal(a.ratio, 285 / 300);
  assert.equal(bonusTier(a.ratio).id, 'ouro');
  assert.equal(bonusTier(0.94).id, 'prata');
  assert.equal(bonusTier(0.88).id, 'prata');
  assert.equal(bonusTier(0.879).id, 'bronze');
  assert.equal(bonusTier(0.8).id, 'bronze');
  assert.equal(bonusTier(0.79).id, 'abaixo');
  assert.equal(adherence([], 150).ratio, null);
  assert.equal(bonusTier(null), null);
});
