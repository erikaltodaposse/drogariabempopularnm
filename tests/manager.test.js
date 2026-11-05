import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, MANAGER, MONDAY, employeeAgent, BRUNO } from './helpers.js';

async function managerAgent(app) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login/password').send(MANAGER).expect(200);
  return agent;
}

function tasksOf(body) {
  return body.day.sections.flatMap((s) => s.tasks);
}

test('gestora lê o checklist de um dia da semana', async () => {
  const { app } = await makeApp();
  const m = await managerAgent(app);
  const res = await m.get('/api/manager/checklist/1').expect(200);
  assert.equal(res.body.checklist.version, 1);
  assert.equal(res.body.checklist.cleaning_focus, 'balcão e vitrine');
  assert.deepEqual(res.body.checklist.sections.map((sec) => sec.title), ['Abertura', 'Caixa e atendimento', 'Farmácia', 'Fechamento']);
  await m.get('/api/manager/checklist/7').expect(400);
});

test('editar e salvar vale para o dia seguinte e não altera o passado', async () => {
  const { app, clock } = await makeApp();
  const employee = await employeeAgent(app, request);
  const bruno = await employeeAgent(app, request, BRUNO);
  const m = await managerAgent(app);

  // Segunda: funcionária registra o dia com o checklist original.
  const first = (await employee.get(`/api/day/${MONDAY}`).expect(200)).body.day.sections[0].tasks[0];
  await employee.put(`/api/day/${MONDAY}/tasks/${first.id}`).expect(200);

  // Gestora cadastra uma tarefa nova para segunda e terça.
  const { body } = await m.get('/api/manager/checklist/1');
  const checklist = body.checklist;
  checklist.sections[1].tasks.push({ text: 'Conferir validade dos testers', points: 10, requires_photo: false });
  checklist.cleaning_focus = 'balcão e caixa';
  const saved = await m.put('/api/manager/checklist/1').send({ ...checklist, also_weekdays: [2] }).expect(200);
  assert.deepEqual(saved.body.saved_weekdays, [1, 2]);
  assert.equal(saved.body.checklist.version, 2);

  // O dia de segunda já registrado continua igual.
  const monday = await employee.get(`/api/day/${MONDAY}`).expect(200);
  assert.equal(monday.body.day.points.max, 100);
  assert.ok(!tasksOf(monday.body).some((t) => t.text.includes('testers')));

  // Terça já usa o checklist novo, com o foco de terça preservado.
  clock.now = new Date('2026-10-27T19:00:00Z');
  const tuesday = await employee.get('/api/day/2026-10-27').expect(200);
  assert.equal(tuesday.body.day.points.max, 110);
  assert.ok(tasksOf(tuesday.body).some((t) => t.text === 'Conferir validade dos testers'));
  assert.ok(tasksOf(tuesday.body).some((t) => t.text === 'Limpeza do foco do dia: prateleiras de medicamentos'));
  // A tarefa nova, sem responsável, aparece também para o Bruno, que não tem a limpeza.
  const brunoTuesday = await bruno.get('/api/day/2026-10-27').expect(200);
  assert.ok(!tasksOf(brunoTuesday.body).some((t) => t.text.startsWith('Limpeza do foco')));
  assert.ok(tasksOf(brunoTuesday.body).some((t) => t.text === 'Conferir validade dos testers'));

  // Segunda seguinte usa o foco novo.
  clock.now = new Date('2026-11-02T19:00:00Z');
  const next = await employee.get('/api/day/2026-11-02').expect(200);
  assert.ok(tasksOf(next.body).some((t) => t.text === 'Limpeza do foco do dia: balcão e caixa'));
});

test('salvar com o dia de hoje vazio já aplica hoje', async () => {
  const { app } = await makeApp();
  const employee = await employeeAgent(app, request);
  const m = await managerAgent(app);
  await employee.get(`/api/day/${MONDAY}`).expect(200); // abre a tela, sem registrar nada
  const { body } = await m.get('/api/manager/checklist/1');
  body.checklist.sections[0].tasks[1].points = 25;
  await m.put('/api/manager/checklist/1').send(body.checklist).expect(200);
  const day = await employee.get(`/api/day/${MONDAY}`).expect(200);
  assert.equal(day.body.day.points.max, 115);
});

test('restaurar padrão volta às 14 tarefas por função, num dia ou em vários', async () => {
  const { app } = await makeApp();
  const m = await managerAgent(app);
  await m
    .put('/api/manager/checklist/3')
    .send({ cleaning_focus: 'x', sections: [{ title: 'Único', tasks: [{ text: 'Uma tarefa', points: 5 }] }] })
    .expect(200);
  const res = await m.post('/api/manager/checklist/3/restore').expect(200);
  const tasks = res.body.checklist.sections.flatMap((s) => s.tasks);
  assert.equal(tasks.length, 14);
  assert.equal(tasks.reduce((s, t) => s + t.points, 0), 190);
  assert.equal(tasks.filter((t) => t.assignee != null).length, 13);
  assert.equal(res.body.checklist.cleaning_focus, 'perfumaria e higiene');
  assert.equal(res.body.checklist.version, 3);
  assert.deepEqual(res.body.saved_weekdays, [3]);

  // Vários dias de uma vez: cada um mantém o próprio foco de limpeza.
  const all = await m.post('/api/manager/checklist/1/restore').send({ also_weekdays: [2, 3, 4, 5, 6] }).expect(200);
  assert.deepEqual(all.body.saved_weekdays, [1, 2, 3, 4, 5, 6]);
  const saturday = (await m.get('/api/manager/checklist/6').expect(200)).body.checklist;
  assert.equal(saturday.cleaning_focus, 'gôndolas e piso');
  assert.equal(saturday.version, 2);
  await m.post('/api/manager/checklist/1/restore').send({ also_weekdays: [9] }).expect(400);
});

test('checklist inválido é recusado com mensagem clara', async () => {
  const { app } = await makeApp();
  const m = await managerAgent(app);
  const cases = [
    { sections: [] },
    { sections: [{ title: '', tasks: [{ text: 'a', points: 1 }] }] },
    { sections: [{ title: 'A', tasks: [{ text: '', points: 1 }] }] },
    { sections: [{ title: 'A', tasks: [{ text: 'a', points: -1 }] }] },
    { sections: [{ title: 'A', tasks: [{ text: 'a', points: 1.5 }] }] },
    { sections: [{ title: 'A', tasks: [{ text: 'a', points: 1, due_time: '25:00' }] }] },
    { sections: [{ title: 'A', tasks: [{ text: 'a', points: 1, auto: 'close' }, { text: 'b', points: 1, auto: 'close' }] }] },
    { sections: [{ title: 'A', tasks: [] }] },
    { sections: [{ title: 'A', tasks: [{ text: 'a', points: 1, assignee: 9999 }] }] },
    { sections: [{ title: 'A', tasks: [{ text: 'a', points: 1, assignee: 'x' }] }] },
  ];
  for (const body of cases) {
    const res = await m.put('/api/manager/checklist/1').send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error, 'invalid_checklist');
    assert.ok(res.body.message.length > 0);
  }
  const check = await m.get('/api/manager/checklist/1');
  assert.equal(check.body.checklist.version, 1);
});

test('configurações: salvar, validar e registrar no audit_log', async () => {
  const { app, db } = await makeApp();
  const m = await managerAgent(app);
  const res = await m
    .put('/api/manager/settings')
    .send({ meta_pontos: 160, bonus_base: '250,50', turno_fim: '18:30', nome_loja: 'Drogaria', dias_expediente: [1, 2, 3, 4, 5, 6] })
    .expect(200);
  assert.equal(res.body.settings.meta_pontos, 160);
  assert.equal(res.body.settings.bonus_base, 250.5);
  assert.equal(res.body.settings.turno_fim, '18:30');
  assert.deepEqual(res.body.settings.dias_expediente, [1, 2, 3, 4, 5, 6]);

  await m.put('/api/manager/settings').send({ meta_pontos: 0 }).expect(400);
  await m.put('/api/manager/settings').send({ turno_inicio: '19:00' }).expect(400);
  await m.put('/api/manager/settings').send({ turno_fim: '25:00' }).expect(400);

  const log = await db.all("SELECT * FROM audit_log WHERE action = 'settings.update'");
  assert.equal(log.length, 1);
});

test('funcionária não acessa o editor', async () => {
  const { app } = await makeApp();
  const employee = await employeeAgent(app, request);
  await employee.get('/api/manager/checklist/1').expect(403);
  await employee.put('/api/manager/checklist/1').send({}).expect(403);
  await employee.post('/api/manager/posts').send({}).expect(403);
});

test('gestora cadastra outra gestora, que entra com e-mail e senha, e pode remover o acesso', async () => {
  const { app } = await makeApp();
  const m = await managerAgent(app);
  const second = { email: 'segunda@drogaria.com', password: 'outra-senha-1' };
  await m.post('/api/manager/managers').send({ name: 'Segunda', email: second.email, password: 'curta' }).expect(400);
  await m.post('/api/manager/managers').send({ name: 'Repetida', email: MANAGER.email, password: 'senha-longa-1' }).expect(409);
  const created = await m.post('/api/manager/managers').send({ name: 'Segunda', ...second, email: ' Segunda@Drogaria.com ' }).expect(201);
  assert.equal(created.body.manager.email, second.email);
  assert.equal(created.body.manager.password_hash, undefined);

  const other = request.agent(app);
  await other.post('/api/auth/login/password').send(second).expect(200);
  await other.get('/api/manager/summary').expect(200);
  const list = await m.get('/api/manager/managers').expect(200);
  assert.deepEqual(list.body.managers.map((x) => x.is_me), [true, false]);

  await other.delete(`/api/manager/managers/${created.body.manager.id}`).expect(409); // não remove a si mesma
  await m.delete(`/api/manager/managers/${created.body.manager.id}`).expect(200);
  await other.get('/api/manager/summary').expect(401);
  await request(app).post('/api/auth/login/password').send(second).expect(401);
});
