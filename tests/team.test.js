import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, MANAGER, MONDAY, employeeAgent, BRUNO, FAKE_JPEG } from './helpers.js';
import { at } from './scenario.js';

async function managerAgent(app) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login/password').send(MANAGER).expect(200);
  return agent;
}

const tasksOf = (body) => body.day.sections.flatMap((s) => s.tasks);

test('cada funcionário entra com o próprio PIN e vê só as próprias tarefas', async () => {
  const { app } = await makeApp();
  const ana = await employeeAgent(app, request);
  const bruno = await employeeAgent(app, request, BRUNO);
  const a = await ana.get(`/api/day/${MONDAY}`).expect(200);
  const b = await bruno.get(`/api/day/${MONDAY}`).expect(200);
  assert.equal(a.body.employee.name, 'Ana');
  assert.equal(b.body.employee.name, 'Bruno');
  assert.ok(tasksOf(a.body).some((t) => t.text === 'Conferir caixa e troco inicial'));
  assert.ok(!tasksOf(b.body).some((t) => t.text === 'Conferir caixa e troco inicial'));
  assert.ok(tasksOf(b.body).some((t) => t.text.startsWith('Conferir a validade')));
  // Entrada é das duas pessoas: cada uma bate o próprio ponto.
  await ana.post(`/api/day/${MONDAY}/checkin`).expect(200);
  const again = await bruno.post(`/api/day/${MONDAY}/checkin`).expect(200);
  assert.equal(again.body.day.points.earned, 10);

  // A tarefa do outro não pode ser marcada.
  const caixa = tasksOf(a.body).find((t) => t.text === 'Conferir caixa e troco inicial');
  await bruno.put(`/api/day/${MONDAY}/tasks/${caixa.id}`).expect(404);
});

test('gestora troca o responsável de uma tarefa e o dia seguinte já segue a troca', async () => {
  const { app, clock } = await makeApp();
  const m = await managerAgent(app);
  const team = (await m.get('/api/manager/employees').expect(200)).body.employees;
  assert.deepEqual(team.map((e) => e.name), ['Ana', 'Bruno']);
  const [ana, bruno] = team;

  const { checklist } = (await m.get('/api/manager/checklist/2').expect(200)).body;
  const caixa = checklist.sections[0].tasks.find((t) => t.text === 'Conferir caixa e troco inicial');
  assert.equal(caixa.assignee, ana.id);
  caixa.assignee = bruno.id;
  await m.put('/api/manager/checklist/2').send(checklist).expect(200);

  // Entrada, saída e fechamento não aceitam responsável.
  const bad = structuredClone(checklist);
  bad.sections[0].tasks[0].assignee = ana.id;
  const res = await m.put('/api/manager/checklist/2').send(bad);
  assert.equal(res.status, 400);
  assert.match(res.body.message, /todos os funcionários/);

  clock.now = at('2026-10-27', '09:00');
  const b = await employeeAgent(app, request, BRUNO);
  const day = await b.get('/api/day/2026-10-27').expect(200);
  assert.ok(tasksOf(day.body).some((t) => t.text === 'Conferir caixa e troco inicial'));
  assert.equal(day.body.day.points.max, 110);
});

test('comparativo da equipe traz os dois funcionários lado a lado', async () => {
  const { app, clock } = await makeApp();
  const ana = await employeeAgent(app, request);
  const bruno = await employeeAgent(app, request, BRUNO);
  // Segunda: Ana faz tudo; Bruno só bate entrada e saída.
  clock.now = at(MONDAY, '08:00');
  let res = await ana.post(`/api/day/${MONDAY}/checkin`).expect(200);
  for (const t of tasksOf(res.body).filter((x) => !x.auto)) {
    if (t.requires_photo) {
      await ana.post(`/api/day/${MONDAY}/tasks/${t.id}/photo`)
        .attach('photo', FAKE_JPEG, { filename: 'f.jpg', contentType: 'image/jpeg' })
        .expect(200);
    } else await ana.put(`/api/day/${MONDAY}/tasks/${t.id}`).expect(200);
  }
  await bruno.post(`/api/day/${MONDAY}/checkin`).expect(200);
  clock.now = at(MONDAY, '18:00');
  for (const agent of [ana, bruno]) {
    await agent.post(`/api/day/${MONDAY}/checkout`).expect(200);
    await agent.post(`/api/day/${MONDAY}/close`).expect(200);
  }

  clock.now = at('2026-10-27', '10:00');
  const m = await managerAgent(app);
  const team = await m.get(`/api/manager/team?from=${MONDAY}&to=2026-10-27`).expect(200);
  assert.equal(team.body.meta, 100);
  const [a, b] = team.body.team;
  assert.equal(a.employee.name, 'Ana');
  assert.equal(a.summary.adherence, 1);
  assert.equal(a.summary.tier.id, 'ouro');
  assert.equal(b.employee.name, 'Bruno');
  assert.equal(b.summary.total_points, 30);
  assert.equal(b.summary.tier.id, 'abaixo');
  assert.equal(b.failures[0].missed, 1);
  // Terça ainda não começou para ninguém.
  assert.equal(a.today, null);

  // O painel individual aceita o id do Bruno.
  const solo = await m.get(`/api/manager/summary?from=${MONDAY}&user_id=${b.employee.id}`).expect(200);
  assert.equal(solo.body.employee.name, 'Bruno');
  assert.equal(solo.body.summary.total_points, 30);
  await ana.get('/api/manager/team').expect(403);
});

test('gestora renomeia funcionário e define PIN provisório', async () => {
  const { app, db } = await makeApp();
  const bruno = await employeeAgent(app, request, BRUNO);
  const m = await managerAgent(app);
  const [ana, b] = (await m.get('/api/manager/employees').expect(200)).body.employees;

  const renamed = await m.put(`/api/manager/employees/${b.id}`).send({ name: ' Bruna ' }).expect(200);
  assert.equal(renamed.body.employee.name, 'Bruna');
  await m.put(`/api/manager/employees/${b.id}`).send({ name: '' }).expect(400);
  await m.put('/api/manager/employees/9999').send({ name: 'X' }).expect(404);

  // PIN de outra pessoa é recusado: o login é só pelo PIN.
  const taken = await m.post(`/api/manager/employees/${b.id}/reset-pin`).send({ pin: '1234' });
  assert.equal(taken.status, 409);
  await m.post(`/api/manager/employees/${b.id}/reset-pin`).send({ pin: '12' }).expect(400);
  await m.post(`/api/manager/employees/${b.id}/reset-pin`).send({ pin: '2468' }).expect(200);

  // A sessão aberta cai e o PIN novo exige troca.
  await bruno.get('/api/me').expect(401);
  const login = await request(app).post('/api/auth/login/pin').send({ pin: '2468' }).expect(200);
  assert.equal(login.body.user.name, 'Bruna');
  assert.equal(login.body.user.must_change_pin, true);
  assert.equal((await db.all("SELECT * FROM audit_log WHERE action LIKE 'employee.%'")).length, 2);
  assert.ok(ana.id < b.id);
});
