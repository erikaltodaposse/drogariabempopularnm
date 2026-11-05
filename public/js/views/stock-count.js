// Cartão da contagem de estoque na tela do funcionário: progresso, por onde continuar e as partes.
import { api } from '../api.js';
import { h, fill, showError } from '../dom.js';
import { formatWhen } from '../format.js';

function progressBar(done, total) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return h('span', { class: 'bar', 'aria-hidden': 'true' }, h('span', { class: 'bar-fill', style: `width:${pct}%` }));
}

/**
 * Uma lista de partes por contagem em andamento. Recarrega sozinha depois de cada ação.
 * `embedded`: aparece dentro da tarefa de contagem do checklist, sem cartão próprio.
 * `onChange`: chamado depois de contar ou desmarcar uma parte (a tarefa do dia pode mudar).
 */
export function stockCountsSection({ embedded = false, onChange = null } = {}) {
  const root = h('div', { class: 'counts' });
  let pending = false;
  let editingNote = null; // id da parte com o campo "parei aqui" aberto

  async function act(fn, error, changesDay = false) {
    if (pending) return;
    pending = true;
    showError(error, '');
    try {
      await fn();
      editingNote = null;
      await load();
      if (changesDay) onChange?.();
    } catch (err) {
      showError(error, err.message);
    } finally {
      pending = false;
    }
  }

  function partRow(count, part, error) {
    const isNext = part.id === count.next_part_id;
    const id = `part-${part.id}`;
    const meta = part.done_at
      ? h('span', { class: 'task-meta' }, h('span', { class: 'when' }, `${part.done_by ?? ''} · ${formatWhen(part.done_at)}`))
      : h('span', { class: 'task-meta' },
          isNext && h('span', { class: 'tag tag-next' }, 'Continue daqui'),
          part.note && h('span', { class: 'tag' }, 'Parou no meio'));
    const check = h(
      'button',
      {
        id,
        type: 'button',
        class: `task${part.done_at ? ' done' : ''}`,
        role: 'checkbox',
        'aria-checked': String(Boolean(part.done_at)),
        onclick: () => {
          if (part.done_at && !window.confirm(`Desmarcar "${part.name}"? Ela volta a ficar por contar.`)) return;
          act(() => (part.done_at ? api.uncountPart(count.id, part.id) : api.countPart(count.id, part.id)), error, true);
        },
      },
      h('span', { class: 'box', 'aria-hidden': 'true' }),
      h('span', { class: 'task-body' }, h('span', { class: 'task-text' }, part.name), meta),
    );
    let note = null;
    if (!part.done_at && editingNote === part.id) {
      const input = h('input', { type: 'text', maxlength: '200', value: part.note ?? '', id: `note-${part.id}`, placeholder: 'Ex.: parei na fralda G, segunda prateleira' });
      const save = () => act(() => api.countNote(count.id, part.id, input.value), error);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      note = h('div', { class: 'part-note' },
        h('label', { for: input.id }, `Onde parou em "${part.name}"?`),
        input,
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'mini', onclick: save }, 'Salvar'),
          h('button', { type: 'button', class: 'mini', onclick: () => { editingNote = null; render(); } }, 'Cancelar')));
      queueMicrotask(() => input.focus());
    } else if (!part.done_at && part.note) {
      note = h('p', { class: 'part-note' },
        h('strong', {}, 'Parou em: '), part.note,
        h('span', { class: 'when' }, ` (${part.note_by ?? ''}, ${formatWhen(part.note_at)}) `),
        h('button', { type: 'button', class: 'link-btn inline', onclick: () => { editingNote = part.id; render(); } }, 'Mudar'));
    } else if (!part.done_at && isNext) {
      note = h('button', { type: 'button', class: 'link-btn', onclick: () => { editingNote = part.id; render(); } }, 'Parei no meio desta parte');
    }
    return h('li', { class: 'task-item' }, check, note);
  }

  let counts = [];

  function countCard(count) {
    const error = h('p', { class: 'alert alert-error', role: 'alert', hidden: true });
    const done = count.parts.filter((p) => p.done_at);
    const todo = count.parts.filter((p) => !p.done_at);
    // A próxima parte já vem marcada com "Continue daqui" e com o "parou em", então o topo fica só com o andamento.
    return h(
      'section',
      { class: embedded ? 'count-card embedded' : 'card count-card', 'aria-labelledby': `count-${count.id}` },
      h('div', { class: 'sec-head' },
        h(embedded ? 'h3' : 'h2', { id: `count-${count.id}` }, count.title),
        h('span', { class: 'sec-count', 'aria-label': `${count.done} de ${count.total} partes contadas` }, `${count.done}/${count.total}`)),
      progressBar(count.done, count.total),
      error,
      h('ul', { class: 'tasks' }, todo.map((p) => partRow(count, p, error))),
      done.length > 0 && h('details', { class: 'count-done' },
        h('summary', {}, `Já contadas (${done.length})`),
        h('ul', { class: 'tasks' }, done.map((p) => partRow(count, p, error)))),
    );
  }

  function render() {
    fill(root, counts.map(countCard));
  }

  async function load() {
    try {
      counts = (await api.counts()).open;
      render();
    } catch {
      // A contagem é um extra: se falhar, o resto do dia continua funcionando.
      fill(root);
    }
  }

  load();
  return root;
}
