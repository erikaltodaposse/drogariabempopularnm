import express from 'express';
import { ah, requireRole, sendError } from '../http.js';
import { todayKey, isDateKey } from '../lib/date.js';
import { logAudit } from '../lib/audit.js';
import { hashSecret, PIN_RE, verifySecret } from '../lib/auth.js';
import { loadTemplate, createChecklistVersion, getSettings, employeeIds } from '../lib/checklist.js';
import { loadDayRows, summarize, failureRanking, historyRow, dayStats } from '../lib/report.js';
import { daysCsv, buildBackup } from '../lib/export.js';
import { DEFAULT_CLEANING_FOCUS, defaultSectionsFor } from '../lib/defaults.js';
import { parseChecklist, parseWeekdayList, parseSettings } from '../lib/validate.js';

async function templateResponse(db, weekday) {
  const t = await loadTemplate(db, weekday);
  return {
    weekday,
    version: t?.version ?? null,
    cleaning_focus: t?.cleaning_focus ?? null,
    sections: (t?.sections ?? []).map((s) => ({
      title: s.title,
      subtitle: s.subtitle,
      tasks: s.tasks.map((task) => ({
        text: task.text,
        points: task.points,
        requires_photo: Boolean(task.requires_photo),
        auto: task.auto,
        due_time: task.due_time,
        assignee: task.assignee ?? null,
      })),
    })),
  };
}

async function settingsResponse(db) {
  const s = await getSettings(db);
  return {
    meta_pontos: s.meta,
    turno_inicio: s.shiftStart,
    turno_fim: s.shiftEnd,
    bonus_base: Number(s.raw.bonus_base) || 0,
    nome_loja: s.storeName,
    dias_expediente: s.workdays,
  };
}

/** Lê ?from, ?to e ?user_id. Sem from/to, o período é tudo. Responde o erro e devolve null se algo for inválido. */
async function reportQuery(req, res) {
  const db = req.app.locals.db;
  const { from, to } = req.query;
  for (const v of [from, to]) {
    if (v != null && v !== '' && !isDateKey(v)) {
      sendError(res, 400, 'invalid_date', 'Data inválida. Use o formato AAAA-MM-DD.');
      return null;
    }
  }
  if (from && to && from > to) {
    sendError(res, 400, 'invalid_period', 'A data inicial precisa ser antes da final.');
    return null;
  }
  const id = Number(req.query.user_id);
  const employee = Number.isInteger(id) && id > 0
    ? await db.get("SELECT * FROM users WHERE id = ? AND role = 'employee'", [id])
    : await db.get("SELECT * FROM users WHERE role = 'employee' AND active = 1 ORDER BY id LIMIT 1");
  if (!employee) {
    sendError(res, 404, 'employee_not_found', 'Funcionário não encontrado.');
    return null;
  }
  const settings = await getSettings(db);
  return {
    db,
    employee,
    settings,
    from: from || null,
    to: to || null,
    today: todayKey(req.app.locals.now()),
  };
}

export function managerRouter() {
  const router = express.Router();
  router.use(requireRole('manager'));

  router.param('weekday', (req, res, next, raw) => {
    if (!/^[0-6]$/.test(raw)) return sendError(res, 400, 'invalid_weekday', 'Dia da semana inválido (0 a 6).');
    req.weekday = Number(raw);
    next();
  });

  // ---------- Painel ----------

  router.get('/summary', ah(async (req, res) => {
    const q = await reportQuery(req, res);
    if (!q) return;
    const rows = await loadDayRows(q.db, q.employee.id, q.from, q.to);
    const bonusBase = Number(q.settings.raw.bonus_base) || 0;
    res.json({
      employee: { id: q.employee.id, name: q.employee.name },
      period: { from: q.from, to: q.to, today: q.today },
      meta: q.settings.meta,
      bonus_base: bonusBase,
      summary: summarize(rows, {
        today: q.today,
        meta: q.settings.meta,
        bonusBase,
        workdays: q.settings.workdays,
        // Sem data inicial, as faltas contam desde o cadastro da funcionária.
        from: q.from ?? q.employee.created_at.slice(0, 10),
        to: q.to,
      }),
    });
  }));

  router.get('/days', ah(async (req, res) => {
    const q = await reportQuery(req, res);
    if (!q) return;
    const rows = await loadDayRows(q.db, q.employee.id, q.from, q.to);
    res.json({
      employee: { id: q.employee.id, name: q.employee.name },
      meta: q.settings.meta,
      days: rows.map((r) => historyRow(r, q)).reverse(),
    });
  }));

  router.get('/failures', ah(async (req, res) => {
    const q = await reportQuery(req, res);
    if (!q) return;
    const rows = await loadDayRows(q.db, q.employee.id, q.from, q.to);
    res.json({ employee: { id: q.employee.id, name: q.employee.name }, failures: failureRanking(rows, q.today) });
  }));

  // Comparativo da equipe: o mesmo resumo do painel para cada funcionário ativo, mais o dia de hoje.
  router.get('/team', ah(async (req, res) => {
    const q = await reportQuery(req, res);
    if (!q) return;
    const bonusBase = Number(q.settings.raw.bonus_base) || 0;
    const employees = await q.db.all("SELECT * FROM users WHERE role = 'employee' AND active = 1 ORDER BY id");
    const team = [];
    for (const emp of employees) {
      const rows = await loadDayRows(q.db, emp.id, q.from, q.to);
      const summary = summarize(rows, {
        today: q.today,
        meta: q.settings.meta,
        bonusBase,
        workdays: q.settings.workdays,
        from: q.from ?? emp.created_at.slice(0, 10),
        to: q.to,
      });
      const todayRow = (await loadDayRows(q.db, emp.id, q.today, q.today))[0] ?? null;
      team.push({
        employee: { id: emp.id, name: emp.name },
        summary,
        failures: failureRanking(rows, q.today).slice(0, 3),
        today: todayRow
          ? { ...historyRow(todayRow, q), points: dayStats(todayRow).earned }
          : null,
      });
    }
    res.json({ period: { from: q.from, to: q.to, today: q.today }, meta: q.settings.meta, bonus_base: bonusBase, team });
  }));

  // ---------- Equipe ----------

  const employeeRow = 'id, name, must_change_pin, created_at';

  router.get('/employees', ah(async (req, res) => {
    const rows = await req.app.locals.db.all(`SELECT ${employeeRow} FROM users WHERE role = 'employee' AND active = 1 ORDER BY id`);
    res.json({ employees: rows.map((e) => ({ ...e, must_change_pin: Boolean(e.must_change_pin) })) });
  }));

  async function findEmployee(req, res) {
    const id = Number(req.params.employeeId);
    const emp = Number.isInteger(id)
      ? await req.app.locals.db.get("SELECT * FROM users WHERE id = ? AND role = 'employee' AND active = 1", [id])
      : null;
    if (!emp) sendError(res, 404, 'employee_not_found', 'Funcionário não encontrado.');
    return emp;
  }

  router.put('/employees/:employeeId', ah(async (req, res) => {
    const db = req.app.locals.db;
    const emp = await findEmployee(req, res);
    if (!emp) return;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 60) return sendError(res, 400, 'invalid_employee', 'Informe o nome (até 60 caracteres).');
    await db.run('UPDATE users SET name = ? WHERE id = ?', [name, emp.id]);
    await logAudit(db, req.user.id, 'employee.rename', { id: emp.id, name }, req.app.locals.now());
    res.json({ employee: { id: emp.id, name, must_change_pin: Boolean(emp.must_change_pin), created_at: emp.created_at } });
  }));

  // PIN provisório: o funcionário troca no próximo acesso. As sessões abertas dele são encerradas.
  router.post('/employees/:employeeId/reset-pin', ah(async (req, res) => {
    const db = req.app.locals.db;
    const emp = await findEmployee(req, res);
    if (!emp) return;
    const pin = req.body?.pin;
    if (typeof pin !== 'string' || !PIN_RE.test(pin)) return sendError(res, 400, 'invalid_pin', 'O PIN precisa ter de 4 a 6 números.');
    const others = await db.all("SELECT pin_hash FROM users WHERE role = 'employee' AND active = 1 AND id <> ?", [emp.id]);
    if (others.some((o) => verifySecret(pin, o.pin_hash))) {
      return sendError(res, 409, 'pin_taken', 'Este PIN já é de outro funcionário. Escolha outro.');
    }
    await db.batch([
      ['UPDATE users SET pin_hash = ?, must_change_pin = 1 WHERE id = ?', [hashSecret(pin), emp.id]],
      ['DELETE FROM sessions WHERE user_id = ?', [emp.id]],
    ]);
    await logAudit(db, req.user.id, 'employee.reset_pin', { id: emp.id }, req.app.locals.now());
    res.json({ ok: true });
  }));

  // ---------- Exportação ----------

  router.get('/export.csv', ah(async (req, res) => {
    const q = await reportQuery(req, res);
    if (!q) return;
    const rows = await loadDayRows(q.db, q.employee.id, q.from, q.to);
    const slug = q.employee.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const name = `checkpoint-${slug}-${q.from ?? 'inicio'}-a-${q.to ?? q.today}.csv`;
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${name}"`);
    res.send(daysCsv(rows, { employeeName: q.employee.name, meta: q.settings.meta }));
  }));

  router.get('/backup.json', ah(async (req, res) => {
    const db = req.app.locals.db;
    const backup = await buildBackup(db, req.app.locals.now());
    await logAudit(db, req.user.id, 'backup.download', null, req.app.locals.now());
    res.set('Content-Disposition', `attachment; filename="checkpoint-backup-${todayKey(req.app.locals.now())}.json"`);
    res.json(backup);
  }));

  // ---------- Configurações ----------

  router.get('/settings', ah(async (req, res) => {
    res.json({ settings: await settingsResponse(req.app.locals.db) });
  }));

  router.put('/settings', ah(async (req, res) => {
    const db = req.app.locals.db;
    const parsed = parseSettings(req.body);
    if (parsed.error) return sendError(res, 400, 'invalid_settings', parsed.error);
    const merged = { ...(await getSettings(db)).raw, ...parsed.value };
    if (merged.turno_inicio >= merged.turno_fim) {
      return sendError(res, 400, 'invalid_settings', 'O fim do turno precisa ser depois do início.');
    }
    await db.batch(
      Object.entries(parsed.value).map(([key, value]) => [
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value],
      ]),
    );
    await logAudit(db, req.user.id, 'settings.update', parsed.value, req.app.locals.now());
    res.json({ settings: await settingsResponse(db) });
  }));

  // ---------- Gestoras ----------

  const managerRow = 'id, name, email, active, created_at';

  router.get('/managers', ah(async (req, res) => {
    const managers = await req.app.locals.db.all(`SELECT ${managerRow} FROM users WHERE role = 'manager' AND active = 1 ORDER BY id`);
    res.json({ managers: managers.map((m) => ({ ...m, active: Boolean(m.active), is_me: m.id === req.user.id })) });
  }));

  router.post('/managers', ah(async (req, res) => {
    const db = req.app.locals.db;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!name || name.length > 60) return sendError(res, 400, 'invalid_manager', 'Informe o nome (até 60 caracteres).');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return sendError(res, 400, 'invalid_manager', 'E-mail inválido.');
    if (typeof password !== 'string' || password.length < 8 || password.length > 100) {
      return sendError(res, 400, 'invalid_manager', 'A senha precisa ter pelo menos 8 caracteres.');
    }
    const existing = await db.get('SELECT id, role, active FROM users WHERE email = ?', [email]);
    if (existing && (existing.active || existing.role !== 'manager')) {
      return sendError(res, 409, 'email_taken', 'Já existe um acesso com este e-mail.');
    }
    const now = req.app.locals.now();
    if (existing) {
      await db.run('UPDATE users SET name = ?, password_hash = ?, active = 1 WHERE id = ?', [name, hashSecret(password), existing.id]);
    } else {
      await db.run("INSERT INTO users (name, role, email, password_hash, created_at) VALUES (?, 'manager', ?, ?, ?)", [
        name, email, hashSecret(password), now.toISOString(),
      ]);
    }
    const created = await db.get(`SELECT ${managerRow} FROM users WHERE email = ?`, [email]);
    await logAudit(db, req.user.id, 'manager.create', { id: created.id, email }, now);
    res.status(201).json({ manager: { ...created, active: true, is_me: false } });
  }));

  // Remove o acesso (exclusão lógica) e encerra as sessões abertas. A própria gestora não se remove.
  router.delete('/managers/:managerId', ah(async (req, res) => {
    const db = req.app.locals.db;
    const id = Number(req.params.managerId);
    if (!Number.isInteger(id)) return sendError(res, 400, 'invalid_manager', 'Acesso inválido.');
    if (id === req.user.id) return sendError(res, 409, 'cannot_remove_self', 'Você não pode remover o seu próprio acesso.');
    const { changes } = await db.run("UPDATE users SET active = 0 WHERE id = ? AND role = 'manager' AND active = 1", [id]);
    if (!changes) return sendError(res, 404, 'manager_not_found', 'Acesso não encontrado.');
    await db.run('DELETE FROM sessions WHERE user_id = ?', [id]);
    await logAudit(db, req.user.id, 'manager.remove', { id }, req.app.locals.now());
    res.json({ ok: true });
  }));

  // ---------- Checklist ----------

  router.get('/checklist/:weekday', ah(async (req, res) => {
    res.json({ checklist: await templateResponse(req.app.locals.db, req.weekday) });
  }));

  // Salvar cria nova versão: vale de hoje (se o dia ainda estiver vazio) em diante; o passado não muda.
  // `also_weekdays` copia blocos e tarefas para outros dias, cada um mantendo o próprio foco de limpeza.
  router.put('/checklist/:weekday', ah(async (req, res) => {
    const db = req.app.locals.db;
    const parsed = parseChecklist(req.body, await employeeIds(db));
    if (parsed.error) return sendError(res, 400, 'invalid_checklist', parsed.error);
    const others = parseWeekdayList(req.body.also_weekdays);
    if (others.error) return sendError(res, 400, 'invalid_checklist', others.error);
    const today = todayKey(req.app.locals.now());
    const targets = [req.weekday, ...others.value.filter((d) => d !== req.weekday)];
    await db.transaction(async (tx) => {
      for (const weekday of targets) {
        const focus = weekday === req.weekday
          ? parsed.value.cleaning_focus
          : (await loadTemplate(tx, weekday))?.cleaning_focus ?? null;
        await createChecklistVersion(tx, weekday, { ...parsed.value, cleaning_focus: focus }, today);
      }
      await logAudit(tx, req.user.id, 'checklist.save', { weekdays: targets, ...parsed.value }, req.app.locals.now());
    });
    res.json({ checklist: await templateResponse(db, req.weekday), saved_weekdays: targets });
  }));

  // Volta ao checklist padrão por função. `also_weekdays` aplica o mesmo a outros dias da semana.
  router.post('/checklist/:weekday/restore', ah(async (req, res) => {
    const db = req.app.locals.db;
    const others = parseWeekdayList(req.body?.also_weekdays);
    if (others.error) return sendError(res, 400, 'invalid_checklist', others.error);
    const targets = [req.weekday, ...others.value.filter((d) => d !== req.weekday)];
    const today = todayKey(req.app.locals.now());
    await db.transaction(async (tx) => {
      const sections = defaultSectionsFor(await employeeIds(tx));
      for (const weekday of targets) {
        await createChecklistVersion(tx, weekday, { cleaning_focus: DEFAULT_CLEANING_FOCUS[weekday], sections }, today);
      }
      await logAudit(tx, req.user.id, 'checklist.restore', { weekdays: targets }, req.app.locals.now());
    });
    res.json({ checklist: await templateResponse(db, req.weekday), saved_weekdays: targets });
  }));

  return router;
}
