// Contagem de estoque que atravessa dias. A gerência cria a contagem com a lista de partes (prateleiras, seções);
// os funcionários marcam cada parte contada e anotam onde pararam. Guarda só o andamento, não as quantidades.
import express from 'express';
import { ah, requireAuth, requireRole, sendError } from '../http.js';
import { nowISO } from '../lib/date.js';
import { logAudit } from '../lib/audit.js';

export const MAX_PARTS = 200;

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t && t.length <= max ? t : null;
}

/** Partes enviadas pela gerência: texto com uma por linha ou lista. Linhas vazias saem. */
export function parseParts(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split('\n') : null;
  if (!list) return { error: 'Envie as partes da contagem, uma por linha.' };
  const parts = [];
  for (const item of list) {
    const name = typeof item === 'string' ? item : item?.name;
    if (typeof name !== 'string' || !name.trim()) continue;
    if (name.trim().length > 120) return { error: 'Cada parte tem no máximo 120 caracteres.' };
    parts.push({ id: Number.isInteger(item?.id) ? item.id : null, name: name.trim() });
  }
  if (parts.length === 0) return { error: 'A contagem precisa de pelo menos uma parte.' };
  if (parts.length > MAX_PARTS) return { error: `A contagem aceita até ${MAX_PARTS} partes.` };
  return { value: parts };
}

/** Contagem com as partes, quem contou cada uma e por onde continuar. */
async function countView(db, count) {
  const parts = await db.all(
    `SELECT p.*, d.name AS done_by_name, n.name AS note_by_name
     FROM stock_count_parts p
     LEFT JOIN users d ON d.id = p.done_by
     LEFT JOIN users n ON n.id = p.note_by
     WHERE p.count_id = ? ORDER BY p.position, p.id`,
    [count.id],
  );
  const done = parts.filter((p) => p.done_at);
  const next = parts.find((p) => !p.done_at) ?? null;
  const doneDates = done.map((p) => p.done_at).sort();
  return {
    id: count.id,
    title: count.title,
    created_at: count.created_at,
    closed_at: count.closed_at,
    cancelled_at: count.cancelled_at,
    total: parts.length,
    done: done.length,
    next_part_id: next?.id ?? null,
    started_at: doneDates[0] ?? null,
    finished_at: count.closed_at ? doneDates.at(-1) ?? count.closed_at : null,
    parts: parts.map((p) => ({
      id: p.id,
      name: p.name,
      done_at: p.done_at,
      done_by: p.done_by_name ?? null,
      note: p.note,
      note_at: p.note_at,
      note_by: p.note_by_name ?? null,
    })),
  };
}

async function openCounts(db) {
  return db.all('SELECT * FROM stock_counts WHERE closed_at IS NULL AND cancelled_at IS NULL ORDER BY created_at, id');
}

/** Fecha a contagem quando todas as partes estão contadas; reabre se uma for desmarcada. */
async function syncClosed(db, countId, at) {
  const left = (await db.get('SELECT COUNT(*) AS n FROM stock_count_parts WHERE count_id = ? AND done_at IS NULL', [countId])).n;
  await db.run('UPDATE stock_counts SET closed_at = ? WHERE id = ?', [left === 0 ? at : null, countId]);
}

export function countsRouter() {
  const router = express.Router();

  router.param('countId', (req, res, next, raw) => {
    if (!/^\d+$/.test(raw)) return sendError(res, 400, 'invalid_count', 'Contagem inválida.');
    req.countId = Number(raw);
    next();
  });
  router.param('partId', (req, res, next, raw) => {
    if (!/^\d+$/.test(raw)) return sendError(res, 400, 'invalid_part', 'Parte inválida.');
    req.partId = Number(raw);
    next();
  });

  // Contagens em andamento, para todos. A gerência pede ?all=1 para ver também as terminadas.
  router.get('/', requireAuth(), ah(async (req, res) => {
    const db = req.app.locals.db;
    const open = await Promise.all((await openCounts(db)).map((c) => countView(db, c)));
    const body = { open };
    if (req.user.role === 'manager' && req.query.all) {
      const closed = await db.all('SELECT * FROM stock_counts WHERE closed_at IS NOT NULL AND cancelled_at IS NULL ORDER BY closed_at DESC LIMIT 20');
      body.closed = await Promise.all(closed.map((c) => countView(db, c)));
    }
    res.json(body);
  }));

  // ---------- Funcionário: marcar parte contada e anotar onde parou ----------

  const employeePart = [
    ...requireRole('employee'),
    ah(async (req, res, next) => {
      const db = req.app.locals.db;
      const part = await db.get(
        `SELECT p.* FROM stock_count_parts p JOIN stock_counts c ON c.id = p.count_id
         WHERE p.id = ? AND p.count_id = ? AND c.cancelled_at IS NULL`,
        [req.partId, req.countId],
      );
      if (!part) return sendError(res, 404, 'part_not_found', 'Esta parte não está em nenhuma contagem aberta.');
      req.part = part;
      next();
    }),
  ];

  const respond = async (req, res) => {
    const db = req.app.locals.db;
    res.json({ count: await countView(db, await db.get('SELECT * FROM stock_counts WHERE id = ?', [req.countId])) });
  };

  router.put('/:countId/parts/:partId', employeePart, ah(async (req, res) => {
    const db = req.app.locals.db;
    const at = nowISO(req.app.locals.now());
    if (!req.part.done_at) {
      // Contada: o "parei aqui" desta parte deixa de valer.
      await db.run('UPDATE stock_count_parts SET done_at = ?, done_by = ?, note = NULL, note_at = NULL, note_by = NULL WHERE id = ?', [
        at, req.user.id, req.part.id,
      ]);
      await syncClosed(db, req.countId, at);
    }
    await respond(req, res);
  }));

  router.delete('/:countId/parts/:partId', employeePart, ah(async (req, res) => {
    const db = req.app.locals.db;
    await db.run('UPDATE stock_count_parts SET done_at = NULL, done_by = NULL WHERE id = ?', [req.part.id]);
    await syncClosed(db, req.countId, null);
    await respond(req, res);
  }));

  // "Parei aqui": texto livre sobre onde a contagem desta parte parou. Vazio apaga.
  router.put('/:countId/parts/:partId/note', employeePart, ah(async (req, res) => {
    const db = req.app.locals.db;
    if (req.part.done_at) return sendError(res, 409, 'part_done', 'Esta parte já foi contada.');
    const raw = req.body?.note ?? '';
    if (typeof raw !== 'string' || raw.trim().length > 200) {
      return sendError(res, 400, 'invalid_note', 'Escreva onde parou em até 200 caracteres.');
    }
    const note = raw.trim() || null;
    await db.run('UPDATE stock_count_parts SET note = ?, note_at = ?, note_by = ? WHERE id = ?', [
      note, note ? nowISO(req.app.locals.now()) : null, note ? req.user.id : null, req.part.id,
    ]);
    await respond(req, res);
  }));

  // ---------- Gerência: criar, editar e cancelar ----------

  const manager = requireRole('manager');

  router.post('/', manager, ah(async (req, res) => {
    const db = req.app.locals.db;
    const title = cleanText(req.body?.title, 80);
    if (!title) return sendError(res, 400, 'invalid_count', 'Dê um nome à contagem (até 80 caracteres).');
    const parsed = parseParts(req.body?.parts);
    if (parsed.error) return sendError(res, 400, 'invalid_count', parsed.error);
    const now = nowISO(req.app.locals.now());
    const id = await db.transaction(async (tx) => {
      const countId = (await tx.run('INSERT INTO stock_counts (title, created_by, created_at) VALUES (?, ?, ?)', [title, req.user.id, now])).lastInsertRowid;
      for (const [i, p] of parsed.value.entries()) {
        await tx.run('INSERT INTO stock_count_parts (count_id, position, name) VALUES (?, ?, ?)', [countId, i, p.name]);
      }
      await logAudit(tx, req.user.id, 'count.create', { id: countId, title, parts: parsed.value.length }, req.app.locals.now());
      return countId;
    });
    res.status(201).json({ count: await countView(db, await db.get('SELECT * FROM stock_counts WHERE id = ?', [id])) });
  }));

  // Edita nome e partes. Partes enviadas com id mantêm o andamento; sem id, entram novas; as que não vierem saem
  // (só se ainda não foram contadas).
  router.put('/:countId', manager, ah(async (req, res) => {
    const db = req.app.locals.db;
    const count = await db.get('SELECT * FROM stock_counts WHERE id = ? AND cancelled_at IS NULL', [req.countId]);
    if (!count) return sendError(res, 404, 'count_not_found', 'Contagem não encontrada.');
    const title = cleanText(req.body?.title, 80);
    if (!title) return sendError(res, 400, 'invalid_count', 'Dê um nome à contagem (até 80 caracteres).');
    const parsed = parseParts(req.body?.parts);
    if (parsed.error) return sendError(res, 400, 'invalid_count', parsed.error);
    const existing = await db.all('SELECT * FROM stock_count_parts WHERE count_id = ?', [count.id]);
    const byId = new Map(existing.map((p) => [p.id, p]));
    const kept = new Set(parsed.value.filter((p) => byId.has(p.id)).map((p) => p.id));
    const removedDone = existing.filter((p) => !kept.has(p.id) && p.done_at);
    if (removedDone.length) {
      return sendError(res, 409, 'part_done', `A parte "${removedDone[0].name}" já foi contada e não pode sair da lista.`);
    }
    await db.transaction(async (tx) => {
      await tx.run('UPDATE stock_counts SET title = ? WHERE id = ?', [title, count.id]);
      for (const p of existing) if (!kept.has(p.id)) await tx.run('DELETE FROM stock_count_parts WHERE id = ?', [p.id]);
      for (const [i, p] of parsed.value.entries()) {
        if (byId.has(p.id)) await tx.run('UPDATE stock_count_parts SET position = ?, name = ? WHERE id = ?', [i, p.name, p.id]);
        else await tx.run('INSERT INTO stock_count_parts (count_id, position, name) VALUES (?, ?, ?)', [count.id, i, p.name]);
      }
      await syncClosed(tx, count.id, count.closed_at ?? nowISO(req.app.locals.now()));
      await logAudit(tx, req.user.id, 'count.update', { id: count.id, title, parts: parsed.value.length }, req.app.locals.now());
    });
    await respond(req, res);
  }));

  router.delete('/:countId', manager, ah(async (req, res) => {
    const db = req.app.locals.db;
    const { changes } = await db.run('UPDATE stock_counts SET cancelled_at = ? WHERE id = ? AND cancelled_at IS NULL', [
      nowISO(req.app.locals.now()), req.countId,
    ]);
    if (!changes) return sendError(res, 404, 'count_not_found', 'Contagem não encontrada.');
    await logAudit(db, req.user.id, 'count.cancel', { id: req.countId }, req.app.locals.now());
    res.json({ ok: true });
  }));

  return router;
}
