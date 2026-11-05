import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, snapshotTasks } from '../server/lib/snapshot.js';
import { dayPoints, adherence, bonusTier } from '../server/lib/points.js';
import { defaultSectionsFor } from '../server/lib/defaults.js';

const ANA = 1;
const BRUNO = 2;

// Ids na ordem do checklist padrão: 1 entrada, 2 abrir, 3 caixa, 4 geladeira, 5 foco, 6 gôndolas, 7 repor,
// 8 validade, 9 pedidos, 10 postagens, 11 WhatsApp, 12 limpeza final, 13 fechamento de caixa, 14 saída, 15 fechar o dia.
function defaultTemplate() {
  let id = 0;
  return {
    version_id: 1,
    weekday: 1,
    cleaning_focus: 'balcão e vitrine',
    sections: defaultSectionsFor([ANA, BRUNO]).map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t, id: ++id })) })),
  };
}

test('o checklist padrão tem 15 tarefas e dá 100 pontos para cada funcionário', async () => {
  const all = buildSnapshot(defaultTemplate());
  assert.equal(snapshotTasks(all).length, 15);
  for (const uid of [ANA, BRUNO]) {
    const snap = buildSnapshot(defaultTemplate(), [], uid);
    const ids = snapshotTasks(snap).map((t) => t.id);
    assert.equal(ids.length, 9);
    assert.deepEqual(dayPoints(snap, ids), { earned: 100, max: 100, done: 9, total: 9 });
  }
});

test('cada um só recebe as próprias tarefas e as em comum', async () => {
  const ana = buildSnapshot(defaultTemplate(), [], ANA);
  const bruno = buildSnapshot(defaultTemplate(), [], BRUNO);
  assert.deepEqual(snapshotTasks(ana).map((t) => t.id), [1, 2, 3, 6, 10, 11, 13, 14, 15]);
  assert.deepEqual(snapshotTasks(bruno).map((t) => t.id), [1, 4, 5, 7, 8, 9, 12, 14, 15]);
  // O bloco "Estoque e validade" é todo do Bruno: some do dia da Ana.
  assert.ok(!ana.sections.some((s) => s.title === 'Estoque e validade'));
  assert.equal(ana.user_id, ANA);
});

test('dia parcial soma só o que foi marcado', async () => {
  const snap = buildSnapshot(defaultTemplate(), [], ANA);
  // 1: ponto de entrada (10), 3: caixa (10), 6: gôndolas (10)
  assert.deepEqual(dayPoints(snap, [1, 3, 6]), { earned: 30, max: 100, done: 3, total: 9 });
  // A limpeza do foco (5) é do Bruno: marcada no dia da Ana, não conta.
  assert.equal(dayPoints(snap, [1, 3, 5]).earned, 20);
  assert.equal(dayPoints(snap, []).earned, 0);
});

test('postagens rendem pontos proporcionais até a tarefa ficar completa', async () => {
  const posts = [{ id: 101, time: '09:30' }, { id: 102, time: '13:30' }, { id: 103, time: '16:30' }];
  const snap = buildSnapshot(defaultTemplate(), posts, ANA);
  const task = snapshotTasks(snap).find((t) => t.posts);
  assert.equal(task.posts.length, 3);
  assert.equal(task.points, 20);
  assert.equal(dayPoints(snap, [], [101]).earned, 6);
  assert.equal(dayPoints(snap, [], [101, 102]).earned, 13);
  // Com todas feitas, a tarefa é marcada e vale os 20 inteiros, sem contar as postagens de novo.
  assert.equal(dayPoints(snap, [task.id], [101, 102, 103]).earned, 20);
  assert.equal(dayPoints(snap, [task.id], [101, 102, 103]).done, 1);
});

test('tarefa removida do template não afeta dia antigo', async () => {
  const template = defaultTemplate();
  const oldDay = buildSnapshot(template, [], BRUNO);
  const allIds = snapshotTasks(oldDay).map((t) => t.id);

  template.sections[1].tasks.shift(); // remove a limpeza do foco
  const newDay = buildSnapshot(template, [], BRUNO);

  assert.equal(dayPoints(oldDay, allIds).earned, 100);
  assert.equal(dayPoints(newDay, allIds).max, 85);
});

test('foco do dia entra no texto da tarefa', async () => {
  const snap = buildSnapshot(defaultTemplate(), [], BRUNO);
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
