import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, MANAGER, employeeAgent, BRUNO, MONDAY } from './helpers.js';
import { at } from './scenario.js';

async function managerAgent(app) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login/password').send(MANAGER).expect(200);
  return agent;
}

test('contagem atravessa dias: cada um continua de onde o outro parou', async () => {
  const { app, clock, db } = await makeApp();
  const m = await managerAgent(app);
  const created = await m.post('/api/counts')
    .send({ title: 'Inventário de novembro', parts: 'Infantil\n\nHigiene\nPrateleira A1\n' })
    .expect(201);
  const count = created.body.count;
  assert.deepEqual(count.parts.map((p) => p.name), ['Infantil', 'Higiene', 'Prateleira A1']);
  assert.equal(count.next_part_id, count.parts[0].id);
  const [infantil, higiene, a1] = count.parts;
  const url = (p) => `/api/counts/${count.id}/parts/${p.id}`;

  // Segunda: Ana conta o Infantil e para no meio da Higiene.
  clock.now = at('2026-10-26', '16:00');
  const ana = await employeeAgent(app, request);
  await ana.put(url(infantil)).expect(200);
  let res = await ana.put(`${url(higiene)}/note`).send({ note: ' parei nos sabonetes ' }).expect(200);
  assert.equal(res.body.count.done, 1);
  assert.equal(res.body.count.next_part_id, higiene.id);
  const h = res.body.count.parts[1];
  assert.equal(h.note, 'parei nos sabonetes');
  assert.equal(h.note_by, 'Ana');

  // Terça: Bruno abre e vê onde parou.
  clock.now = at('2026-10-27', '09:00');
  const bruno = await employeeAgent(app, request, BRUNO);
  const list = (await bruno.get('/api/counts').expect(200)).body.open;
  assert.equal(list.length, 1);
  assert.equal(list[0].parts.find((p) => p.id === list[0].next_part_id).note, 'parei nos sabonetes');
  assert.equal(list[0].parts[0].done_by, 'Ana');

  // Contar a parte apaga o "parei aqui"; a última fecha a contagem.
  res = await bruno.put(url(higiene)).expect(200);
  assert.equal(res.body.count.parts[1].note, null);
  await bruno.put(`${url(higiene)}/note`).send({ note: 'x' }).expect(409);
  clock.now = at('2026-10-28', '10:00');
  res = await bruno.put(url(a1)).expect(200);
  assert.ok(res.body.count.closed_at);
  assert.equal(res.body.count.next_part_id, null);
  assert.equal(res.body.count.started_at, at('2026-10-26', '16:00').toISOString());
  assert.equal(res.body.count.finished_at, at('2026-10-28', '10:00').toISOString());
  assert.equal((await bruno.get('/api/counts').expect(200)).body.open.length, 0);

  // Desmarcar reabre.
  res = await bruno.delete(url(a1)).expect(200);
  assert.equal(res.body.count.closed_at, null);
  await bruno.put(url(a1)).expect(200);

  const all = (await m.get('/api/counts?all=1').expect(200)).body;
  assert.equal(all.closed.length, 1);
  assert.equal((await db.all("SELECT * FROM audit_log WHERE action LIKE 'count.%'")).length, 1);
});

test('gerência edita a contagem sem perder o andamento', async () => {
  const { app } = await makeApp();
  const m = await managerAgent(app);
  const { count } = (await m.post('/api/counts').send({ title: 'Geral', parts: ['A', 'B', 'C'] }).expect(201)).body;
  const ana = await employeeAgent(app, request);
  await ana.put(`/api/counts/${count.id}/parts/${count.parts[0].id}`).expect(200);

  const [a, b] = count.parts;
  const res = await m.put(`/api/counts/${count.id}`)
    .send({ title: 'Geral de novembro', parts: [{ id: a.id, name: 'A' }, { name: 'D' }, { id: b.id, name: 'B2' }] })
    .expect(200);
  assert.equal(res.body.count.title, 'Geral de novembro');
  assert.deepEqual(res.body.count.parts.map((p) => [p.name, Boolean(p.done_at)]), [['A', true], ['D', false], ['B2', false]]);

  // Parte já contada não sai da lista.
  const refused = await m.put(`/api/counts/${count.id}`).send({ title: 'Geral', parts: ['Z'] });
  assert.equal(refused.status, 409);

  await m.post('/api/counts').send({ title: '', parts: ['A'] }).expect(400);
  await m.post('/api/counts').send({ title: 'Vazia', parts: '\n \n' }).expect(400);
  await ana.post('/api/counts').send({ title: 'X', parts: ['A'] }).expect(403);
  await m.put(`/api/counts/${count.id}/parts/${a.id}`).expect(403);

  await m.delete(`/api/counts/${count.id}`).expect(200);
  assert.equal((await ana.get('/api/counts').expect(200)).body.open.length, 0);
  await ana.put(`/api/counts/${count.id}/parts/${b.id}`).expect(404);
  await request(app).get('/api/counts').expect(401);
});

test('tarefa de contagem do checklist se marca ao contar uma parte no dia', async () => {
  const { app } = await makeApp();
  const m = await managerAgent(app);
  const { checklist } = (await m.get('/api/manager/checklist/1').expect(200)).body;
  // Foto pedida numa tarefa de contagem é ignorada: ela se marca sozinha.
  checklist.sections[0].tasks.push({ text: 'Contagem de estoque', points: 20, requires_photo: true, auto: 'count' });
  const saved = await m.put('/api/manager/checklist/1').send(checklist).expect(200);
  const savedTask = saved.body.checklist.sections[0].tasks.at(-1);
  assert.equal(savedTask.auto, 'count');
  assert.equal(savedTask.requires_photo, false);

  const ana = await employeeAgent(app, request);
  const dayUrl = `/api/day/${MONDAY}`;
  const countTask = (body) => body.day.sections.flatMap((s) => s.tasks).find((t) => t.auto === 'count');

  // Sem contagem em andamento: é uma tarefa comum, marcada à mão.
  let day = (await ana.get(dayUrl).expect(200)).body;
  assert.equal(day.stock_count_open, false);
  await ana.put(`${dayUrl}/tasks/${countTask(day).id}`).expect(200);
  await ana.delete(`${dayUrl}/tasks/${countTask(day).id}`).expect(200);

  // Com contagem: só se marca pelas partes.
  const { count } = (await m.post('/api/counts').send({ title: 'Geral', parts: ['A', 'B'] }).expect(201)).body;
  day = (await ana.get(dayUrl).expect(200)).body;
  assert.equal(day.stock_count_open, true);
  await ana.put(`${dayUrl}/tasks/${countTask(day).id}`).expect(409);

  const part = `/api/counts/${count.id}/parts/${count.parts[0].id}`;
  await ana.put(part).expect(200);
  day = (await ana.get(dayUrl).expect(200)).body;
  assert.equal(countTask(day).done, true);
  const pointsWith = day.day.points.earned;

  // Desmarcar a única parte contada hoje desmarca a tarefa.
  await ana.delete(part).expect(200);
  day = (await ana.get(dayUrl).expect(200)).body;
  assert.equal(countTask(day).done, false);
  assert.equal(day.day.points.earned, pointsWith - 20);
});
