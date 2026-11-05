import { api } from '../api.js';
import { h, fill, showError, busy } from '../dom.js';
import { WEEKDAYS, WEEKDAYS_SHORT, AUTO_LABELS } from '../weekdays.js';

let uid = 0;
const nextId = () => `ce-${++uid}`;

// Entrada e saída saíram do app: num checklist antigo, essas tarefas somem ao abrir o editor e saem ao salvar.
const RETIRED_AUTO = ['check_in', 'check_out'];
function withoutRetired(checklist) {
  return { ...checklist, sections: checklist.sections.map((s) => ({ ...s, tasks: s.tasks.filter((t) => !RETIRED_AUTO.includes(t.auto)) })) };
}

function move(list, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
}

/** Troca a tarefa com a vizinha visível (no filtro por pessoa, as escondidas ficam no lugar). */
function moveAmong(list, visible, index, delta) {
  const pos = visible.indexOf(index);
  const target = visible[pos + delta];
  if (target == null) return;
  [list[index], list[target]] = [list[target], list[index]];
}

export function checklistEditor({ setGuard }) {
  let weekday = 1;
  let model = null;
  let settings = null;
  let employees = [];
  let person = null; // filtro: null mostra todas as tarefas; com um id, só as dessa pessoa e as de todos
  let dirty = false;

  const error = h('p', { class: 'alert alert-error', role: 'alert', hidden: true });
  const okMsg = h('p', { class: 'alert alert-ok', role: 'status', hidden: true });
  const dayChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Dia da semana' });
  const personChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Ver tarefas de' });
  const body = h('div', {}, h('p', { class: 'boot' }, 'Carregando o checklist…'));
  const totalLabel = h('div', { class: 'total', 'aria-live': 'polite' });

  setGuard(() => !dirty || window.confirm('Há alterações não salvas no checklist. Sair mesmo assim?'));

  function markDirty() {
    dirty = true;
    showError(okMsg, '');
    updateTotal();
  }

  // Cada pessoa soma as tarefas dela mais as sem responsável. Abaixo da meta, nem fazendo tudo ela chega a 100%.
  function updateTotal() {
    if (!model) return;
    const meta = settings?.meta_pontos ?? 100;
    const tasks = model.sections.flatMap((s) => s.tasks);
    const sumFor = (id) => tasks
      .filter((t) => t.assignee == null || t.assignee === id)
      .reduce((sum, t) => sum + (Number(t.points) || 0), 0);
    fill(
      totalLabel,
      h('p', { class: 'muted' }, `Meta de cada funcionário: ${meta} pontos por dia.`),
      h('ul', { class: 'totals' }, employees.map((e) => {
        const total = sumFor(e.id);
        return h('li', { class: total < meta ? 'short' : null },
          `${e.name}: ${total} pontos`,
          total < meta ? ` (abaixo da meta: nem fazendo tudo chega a 100%)` : '');
      })),
    );
  }

  function assigneeSelect(task) {
    const select = h('select', { id: nextId(), disabled: task.auto === 'close' },
      h('option', { value: '' }, 'Todos (cada um faz a sua)'),
      employees.map((e) => h('option', { value: String(e.id) }, e.name)));
    select.value = task.assignee == null ? '' : String(task.assignee);
    select.addEventListener('change', () => {
      task.assignee = select.value === '' ? null : Number(select.value);
      markDirty();
    });
    return h('div', { class: 'field' }, h('label', { for: select.id }, 'Responsável'), select,
      task.auto === 'close' && h('p', { class: 'field-hint' }, 'Fechar o dia é de todos: cada um fecha o seu.'));
  }

  const isVisible = (task) => person == null || task.assignee == null || task.assignee === person;
  const personName = (id) => employees.find((e) => e.id === id)?.name ?? '';

  function renderPersonChips() {
    const options = [{ id: null, label: 'Todos' }, ...employees.map((e) => ({ id: e.id, label: e.name }))];
    personChips.replaceChildren(
      ...options.map((o) => h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(o.id === person),
          onclick: () => {
            if (o.id === person) return;
            person = o.id;
            render();
          },
        },
        o.label,
      )),
    );
  }

  function renderChips() {
    renderPersonChips();
    dayChips.replaceChildren(
      ...WEEKDAYS.map((name, wd) => {
        const off = settings && !settings.dias_expediente.includes(wd);
        return h(
          'button',
          {
            type: 'button',
            class: `chip${off ? ' chip-off' : ''}`,
            'aria-pressed': String(wd === weekday),
            'aria-label': `${name}${off ? ' (sem expediente)' : ''}`,
            onclick: () => {
              if (wd === weekday) return;
              if (dirty && !window.confirm('Há alterações não salvas. Trocar de dia e descartar?')) return;
              weekday = wd;
              load();
            },
          },
          WEEKDAYS_SHORT[wd],
        );
      }),
    );
  }

  function field(label, input, hint) {
    const id = input.id || nextId();
    input.id = id;
    return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint && h('p', { class: 'field-hint' }, hint));
  }

  function textInput(value, onInput, attrs = {}) {
    const el = h('input', { type: 'text', value: value ?? '', ...attrs });
    el.addEventListener('input', () => { onInput(el.value); markDirty(); });
    return el;
  }

  function taskEditor(section, task, tIdx, visible) {
    const textId = nextId();
    const points = h('input', { type: 'number', inputmode: 'numeric', min: '0', max: '1000', step: '1', value: String(task.points), id: nextId() });
    points.addEventListener('input', () => { task.points = points.value === '' ? '' : Number(points.value); markDirty(); });

    const photo = h('input', { type: 'checkbox', id: nextId(), checked: task.requires_photo, disabled: task.auto === 'count' });
    photo.addEventListener('change', () => { task.requires_photo = photo.checked; markDirty(); });

    // Tarefa de contagem: mostra as partes da contagem em andamento e se marca quando a pessoa conta uma.
    const count = h('input', { type: 'checkbox', id: nextId(), checked: task.auto === 'count' });
    count.addEventListener('change', () => {
      task.auto = count.checked ? 'count' : null;
      if (count.checked) task.requires_photo = false;
      markDirty();
      render();
    });

    const due = h('input', { type: 'time', id: nextId(), value: task.due_time ?? '' });
    due.addEventListener('input', () => { task.due_time = due.value || null; markDirty(); });

    const structural = (fn) => () => { fn(); markDirty(); render(); };
    return h(
      'li',
      { class: 'edit-task' },
      h('label', { class: 'sr-only', for: textId }, `Texto da tarefa ${tIdx + 1}`),
      h('textarea', { id: textId, rows: '2', maxlength: '200', oninput: (e) => { task.text = e.target.value; markDirty(); } }, task.text),
      task.auto === 'close' && h('p', { class: 'field-hint' }, `Marcada automaticamente no ${AUTO_LABELS[task.auto]}.`),
      assigneeSelect(task),
      h(
        'div',
        { class: 'edit-row' },
        h('div', { class: 'field field-inline' }, h('label', { for: points.id }, 'Pontos'), points),
        h('div', { class: 'field field-inline' }, h('label', { for: due.id }, 'Horário'), due),
        h('div', { class: 'check-field' }, photo, h('label', { for: photo.id }, 'Exige foto')),
      ),
      task.auto !== 'close' && h('div', { class: 'check-field' }, count, h('label', { for: count.id }, 'É a contagem de estoque')),
      task.auto === 'count' && h('p', { class: 'field-hint' },
        'As partes da contagem aparecem dentro desta tarefa, e ela se marca sozinha quando a pessoa conta uma parte no dia. Sem contagem em andamento, é marcada à mão.'),
      h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', class: 'mini', disabled: tIdx === visible[0], onclick: structural(() => moveAmong(section.tasks, visible, tIdx, -1)) }, 'Subir'),
        h('button', { type: 'button', class: 'mini', disabled: tIdx === visible[visible.length - 1], onclick: structural(() => moveAmong(section.tasks, visible, tIdx, 1)) }, 'Descer'),
        h(
          'button',
          {
            type: 'button',
            class: 'mini mini-danger',
            onclick: () => {
              if (window.confirm(`Excluir a tarefa "${task.text || 'sem texto'}"?`)) structural(() => section.tasks.splice(tIdx, 1))();
            },
          },
          'Excluir',
        ),
      ),
    );
  }

  function sectionEditor(section, sIdx) {
    const visible = section.tasks.map((t, i) => (isVisible(t) ? i : -1)).filter((i) => i >= 0);
    const structural = (fn) => () => { fn(); markDirty(); render(); };
    return h(
      'section',
      { class: 'card' },
      field('Nome do bloco', textInput(section.title, (v) => { section.title = v; }, { maxlength: '60' })),
      field('Subtítulo (opcional)', textInput(section.subtitle, (v) => { section.subtitle = v; }, { maxlength: '120' })),
      h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', class: 'mini', disabled: sIdx === 0, onclick: structural(() => move(model.sections, sIdx, -1)) }, 'Subir bloco'),
        h('button', { type: 'button', class: 'mini', disabled: sIdx === model.sections.length - 1, onclick: structural(() => move(model.sections, sIdx, 1)) }, 'Descer bloco'),
        h(
          'button',
          {
            type: 'button',
            class: 'mini mini-danger',
            onclick: () => {
              const msg = `Excluir o bloco "${section.title || 'sem nome'}" e suas ${section.tasks.length} tarefas?`;
              if (window.confirm(msg)) structural(() => model.sections.splice(sIdx, 1))();
            },
          },
          'Excluir bloco',
        ),
      ),
      h('h3', { class: 'sub-title' }, person == null
        ? `Tarefas (${section.tasks.length})`
        : `Tarefas de ${personName(person)} e de todos (${visible.length} de ${section.tasks.length})`),
      visible.length
        ? h('ol', { class: 'edit-tasks' }, visible.map((i) => taskEditor(section, section.tasks[i], i, visible)))
        : h('p', { class: 'muted' }, person == null
          ? 'Este bloco ainda não tem tarefas. Adicione a primeira abaixo.'
          : `Nenhuma tarefa de ${personName(person)} neste bloco.`),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-outline',
          // Com uma pessoa escolhida no filtro, a tarefa nova já nasce dela.
          onclick: structural(() => section.tasks.push({ text: '', points: 5, requires_photo: false, auto: null, due_time: null, assignee: person })),
        },
        person == null ? 'Adicionar tarefa' : `Adicionar tarefa de ${personName(person)}`,
      ),
    );
  }

  function render() {
    renderChips();
    const isOff = !settings.dias_expediente.includes(weekday);
    const otherDays = settings.dias_expediente.filter((d) => d !== weekday);
    const applyBoxes = otherDays.map((d) => {
      const id = `apply-${d}`;
      return h('span', { class: 'check-field' }, h('input', { type: 'checkbox', id, value: String(d), class: 'apply-day' }), h('label', { for: id }, WEEKDAYS[d]));
    });

    const save = h('button', { type: 'button', class: 'btn' }, 'Salvar checklist');
    save.addEventListener('click', async () => {
      showError(error, '');
      showError(okMsg, '');
      const also = [...body.querySelectorAll('.apply-day:checked')].map((el) => Number(el.value));
      try {
        const res = await busy(save, 'Salvando…', () => api.saveChecklist(weekday, { ...model, also_weekdays: also }));
        model = res.checklist;
        dirty = false;
        render();
        const names = res.saved_weekdays.map((d) => WEEKDAYS[d]).join(', ');
        showError(okMsg, `Salvo para: ${names}. Vale para os próximos dias e para hoje, se o dia ainda não começou. Dias já registrados não mudam.`);
        okMsg.scrollIntoView({ block: 'nearest' });
      } catch (err) {
        showError(error, err.message);
        error.scrollIntoView({ block: 'nearest' });
      }
    });

    // Padrão por função: a primeira pessoa da equipe fica com caixa e atendimento, a segunda com a farmácia.
    const restoreButton = (label, allDays) => {
      const btn = h('button', { type: 'button', class: 'btn btn-outline' }, label);
      btn.addEventListener('click', async () => {
        const where = allDays ? 'de todos os dias com expediente' : `de ${WEEKDAYS[weekday].toLowerCase()}`;
        const msg = `Restaurar o checklist padrão ${where}? ${employees[0]?.name ?? 'O primeiro funcionário'} fica com caixa e atendimento, `
          + `${employees[1]?.name ?? 'o segundo'} com a farmácia, e cada um soma 100 pontos. As tarefas atuais serão substituídas.`;
        if (!window.confirm(msg)) return;
        try {
          const res = await busy(btn, 'Restaurando…', () => api.restoreChecklist(weekday, allDays ? otherDays : []));
          model = res.checklist;
          dirty = false;
          render();
          showError(okMsg, `Checklist padrão restaurado para: ${res.saved_weekdays.map((d) => WEEKDAYS[d]).join(', ')}.`);
        } catch (err) {
          showError(error, err.message);
        }
      });
      return btn;
    };
    const restore = restoreButton('Restaurar padrão deste dia', false);
    const restoreAll = otherDays.length > 0 && restoreButton('Restaurar padrão em todos os dias', true);

    fill(
      body,
      isOff && h('p', { class: 'notice' }, `${WEEKDAYS[weekday]} está sem expediente. Este checklist só é usado se o dia for incluído em Ajustes.`),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, WEEKDAYS[weekday]),
        h('p', { class: 'muted' }, `Versão ${model.version ?? 1}. Ao salvar, cria-se uma nova versão e o histórico fica intacto.`),
        field(
          'Foco de limpeza do dia',
          textInput(model.cleaning_focus, (v) => { model.cleaning_focus = v; }, { maxlength: '120' }),
          'Entra no lugar de {foco} no texto da tarefa de limpeza.',
        ),
      ),
      ...model.sections.map(sectionEditor),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-outline',
          onclick: () => {
            model.sections.push({ title: 'Novo bloco', subtitle: '', tasks: [] });
            markDirty();
            render();
          },
        },
        'Adicionar bloco',
      ),
      h(
        'section',
        { class: 'card save-card' },
        totalLabel,
        otherDays.length > 0 && h('fieldset', { class: 'apply' }, h('legend', {}, 'Aplicar estes blocos e tarefas também a:'), applyBoxes,
          h('p', { class: 'field-hint' }, 'Cada dia mantém o próprio foco de limpeza.')),
        error,
        okMsg,
        save,
        h('div', { class: 'mt row-actions' }, restore, restoreAll),
      ),
    );
    updateTotal();
  }

  async function load() {
    showError(error, '');
    showError(okMsg, '');
    body.replaceChildren(h('p', { class: 'boot' }, 'Carregando o checklist…'));
    try {
      if (!settings) settings = (await api.getSettings()).settings;
      if (!employees.length) employees = (await api.listEmployees()).employees;
      model = withoutRetired((await api.getChecklist(weekday)).checklist);
      dirty = false;
      render();
    } catch (err) {
      body.replaceChildren(h('p', { class: 'alert alert-error', role: 'alert' }, err.message));
    }
  }

  load();
  return h(
    'div',
    {},
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Tarefas do dia'),
      h('p', { class: 'muted' }, 'Escolha o dia da semana e a pessoa, ajuste as tarefas de cada um e salve.'),
      dayChips,
      h('h3', { class: 'sub-title mt' }, 'Ver tarefas de'),
      personChips,
    ),
    body,
  );
}
