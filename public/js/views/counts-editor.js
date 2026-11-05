// Aba "Contagens" da gestão: criar contagem de estoque, acompanhar o andamento e editar as partes.
import { api } from '../api.js';
import { h, fill, showError, busy } from '../dom.js';
import { formatWhen } from '../format.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function progressBar(done, total) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return h('span', { class: 'bar', 'aria-hidden': 'true' }, h('span', { class: 'bar-fill', style: `width:${pct}%` }));
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const day = (iso) => new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'America/Manaus' })).setHours(0, 0, 0, 0);
  return Math.round((day(b) - day(a)) / DAY_MS) + 1;
}

export function countsEditor({ setGuard }) {
  let editing = null; // id da contagem em edição
  let dirty = false;
  setGuard(() => !dirty || window.confirm('Há uma contagem não salva. Sair mesmo assim?'));

  const list = h('div', {}, h('p', { class: 'boot' }, 'Carregando as contagens…'));

  // ---------- Nova contagem ----------
  const createError = h('p', { class: 'alert alert-error', role: 'alert', hidden: true });
  const createOk = h('p', { class: 'alert alert-ok', role: 'status', hidden: true });
  const title = h('input', { id: 'count-title', type: 'text', maxlength: '80', placeholder: 'Ex.: Inventário de novembro' });
  const parts = h('textarea', { id: 'count-parts', rows: '6', placeholder: 'Infantil: leite, fralda, pomada\nHigiene e beleza\nPrateleira A1\nPrateleira A2' });
  for (const el of [title, parts]) el.addEventListener('input', () => { dirty = true; });
  const create = h('button', { type: 'submit', class: 'btn' }, 'Criar contagem');
  const form = h(
    'form',
    { class: 'card', novalidate: true },
    h('h2', {}, 'Nova contagem de estoque'),
    h('p', { class: 'muted' }, 'Divida o estoque em partes, na ordem em que vão ser contadas. Os dois funcionários veem a contagem no dia deles, marcam cada parte contada e anotam onde pararam. No dia seguinte, quem abrir o app continua dali.'),
    h('div', { class: 'field mt' }, h('label', { for: title.id }, 'Nome da contagem'), title),
    h('div', { class: 'field' }, h('label', { for: parts.id }, 'Partes, uma por linha'), parts),
    createError,
    createOk,
    create,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(createError, '');
    showError(createOk, '');
    try {
      await busy(create, 'Criando…', () => api.createCount({ title: title.value, parts: parts.value }));
      title.value = '';
      parts.value = '';
      dirty = false;
      showError(createOk, 'Contagem criada. Ela já aparece no dia dos funcionários.');
      await load();
    } catch (err) {
      showError(createError, err.message);
    }
  });

  // ---------- Contagens ----------
  function editForm(count) {
    const error = h('p', { class: 'alert alert-error', role: 'alert', hidden: true });
    const t = h('input', { id: `edit-title-${count.id}`, type: 'text', maxlength: '80', value: count.title });
    const rows = count.parts.map((p) => ({ ...p }));
    const box = h('ol', { class: 'edit-tasks' });
    const addInput = h('textarea', { id: `add-parts-${count.id}`, rows: '3', placeholder: 'Novas partes, uma por linha' });
    const mark = () => { dirty = true; };
    t.addEventListener('input', mark);
    addInput.addEventListener('input', mark);

    function drawRows() {
      fill(box, rows.map((p, i) => {
        const input = h('input', { type: 'text', maxlength: '120', value: p.name, 'aria-label': `Parte ${i + 1}` });
        input.addEventListener('input', () => { p.name = input.value; mark(); });
        return h('li', { class: 'edit-task' },
          h('div', { class: 'field' }, input),
          p.done_at && h('p', { class: 'field-hint' }, `Contada por ${p.done_by ?? ''} em ${formatWhen(p.done_at)}. Não pode sair da lista.`),
          h('div', { class: 'row-actions' },
            h('button', { type: 'button', class: 'mini', disabled: i === 0, onclick: () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; mark(); drawRows(); } }, 'Subir'),
            h('button', { type: 'button', class: 'mini', disabled: i === rows.length - 1, onclick: () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; mark(); drawRows(); } }, 'Descer'),
            !p.done_at && h('button', { type: 'button', class: 'mini mini-danger', onclick: () => { rows.splice(i, 1); mark(); drawRows(); } }, 'Tirar')));
      }));
    }
    drawRows();

    const save = h('button', { type: 'button', class: 'btn' }, 'Salvar alterações');
    save.addEventListener('click', async () => {
      showError(error, '');
      const added = addInput.value.split('\n').map((s) => s.trim()).filter(Boolean).map((name) => ({ name }));
      try {
        await busy(save, 'Salvando…', () => api.updateCount(count.id, { title: t.value, parts: [...rows.map((p) => ({ id: p.id, name: p.name })), ...added] }));
        editing = null;
        dirty = false;
        await load();
      } catch (err) {
        showError(error, err.message);
      }
    });
    const cancelCount = h('button', { type: 'button', class: 'mini mini-danger' }, 'Cancelar esta contagem');
    cancelCount.addEventListener('click', async () => {
      if (!window.confirm(`Cancelar "${count.title}"? Ela some do dia dos funcionários.`)) return;
      try {
        await api.cancelCount(count.id);
        editing = null;
        dirty = false;
        await load();
      } catch (err) {
        showError(error, err.message);
      }
    });
    return h('div', { class: 'mt' },
      h('div', { class: 'field' }, h('label', { for: t.id }, 'Nome da contagem'), t),
      h('h3', { class: 'sub-title' }, `Partes (${rows.length})`),
      box,
      h('div', { class: 'field' }, h('label', { for: addInput.id }, 'Acrescentar partes no fim'), addInput),
      error,
      save,
      h('button', { type: 'button', class: 'btn btn-outline mt', onclick: () => { editing = null; dirty = false; load(); } }, 'Voltar sem salvar'),
      h('div', { class: 'row-actions mt' }, cancelCount));
  }

  function openCard(count) {
    const next = count.parts.find((p) => p.id === count.next_part_id);
    const notes = count.parts.filter((p) => !p.done_at && p.note);
    const people = [...new Set(count.parts.filter((p) => p.done_by).map((p) => p.done_by))];
    return h('li', { class: 'card' },
      h('div', { class: 'sec-head' },
        h('h2', {}, count.title),
        h('span', { class: 'sec-count' }, `${count.done}/${count.total}`)),
      progressBar(count.done, count.total),
      h('p', { class: 'muted' },
        count.started_at ? `Começou ${formatWhen(count.started_at)}` : 'Ainda não começou',
        people.length ? ` · contaram: ${people.join(' e ')}` : ''),
      next && h('p', { class: 'count-next' }, h('strong', {}, 'Próxima parte: '), next.name),
      notes.map((p) => h('p', { class: 'part-note flush' }, h('strong', {}, `${p.name}: `), `"${p.note}" (${p.note_by ?? ''}, ${formatWhen(p.note_at)})`)),
      editing === count.id
        ? editForm(count)
        : h('button', { type: 'button', class: 'btn btn-outline mt', onclick: () => { editing = count.id; render(); } }, 'Editar partes'));
  }

  function closedRow(count) {
    const days = daysBetween(count.started_at, count.finished_at);
    return h('li', {},
      h('strong', {}, count.title),
      ` · ${count.total} partes · terminou ${formatWhen(count.finished_at)}`,
      days ? ` · ${days} ${days === 1 ? 'dia' : 'dias'}` : '');
  }

  let data = { open: [], closed: [] };
  function render() {
    fill(
      list,
      h('h2', { class: 'section-title' }, 'Em andamento'),
      data.open.length
        ? h('ul', { class: 'count-list' }, data.open.map(openCard))
        : h('section', { class: 'card' }, h('p', { class: 'muted' }, 'Nenhuma contagem em andamento. Crie uma abaixo.')),
      data.closed?.length > 0 && h('section', { class: 'card' },
        h('h2', {}, 'Terminadas'),
        h('ul', { class: 'pending-list' }, data.closed.map(closedRow))),
    );
  }

  async function load() {
    try {
      data = await api.counts(true);
      render();
    } catch (err) {
      fill(list, h('p', { class: 'alert alert-error', role: 'alert' }, err.message));
    }
  }

  load();
  return h('div', {}, list, h('div', { class: 'mt' }, form));
}
