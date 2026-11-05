import { api } from '../api.js';
import { h, fill } from '../dom.js';
import { formatDateKey, formatTime } from '../format.js';

/** Detalhe de um dia para a gerência: cumpridas com horário, pendentes e fotos ampliáveis. */
export function dayDetail({ date, userId, onBack }) {
  const dialogImg = h('img', { class: 'zoom-img', alt: '' });
  const dialog = h(
    'dialog',
    { class: 'zoom', 'aria-label': 'Foto ampliada' },
    dialogImg,
    h('form', { method: 'dialog' }, h('button', { class: 'btn', type: 'submit' }, 'Fechar foto')),
  );
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  const body = h('div', {}, h('p', { class: 'boot' }, 'Carregando o dia…'));

  function render(data) {
    const { day } = data;
    if (!day) {
      fill(body, h('section', { class: 'card' }, h('p', { class: 'muted' }, 'Nada foi registrado neste dia.')));
      return;
    }
    const tasks = day.sections.flatMap((s) => s.tasks);
    const done = tasks.filter((t) => t.done).sort((a, b) => a.done_at.localeCompare(b.done_at));
    const pending = tasks.filter((t) => !t.done);
    const timed = tasks.filter((t) => t.done && t.due_time);
    const onTime = timed.filter((t) => !t.late).length;
    const status = day.closed_at ? `Fechado às ${formatTime(day.closed_at)}` : data.is_today ? 'Em andamento' : 'Não foi fechado no app';

    const photoButton = (t) => {
      const src = api.photoUrl(data.date, t.id, t.done_at, data.employee?.id);
      return h(
        'button',
        {
          type: 'button',
          class: 'thumb-btn',
          'aria-label': `Ampliar foto: ${t.text}`,
          onclick: () => {
            dialogImg.src = src;
            dialogImg.alt = `Foto: ${t.text}`;
            if (dialog.showModal) dialog.showModal();
            else window.open(src, '_blank', 'noopener');
          },
        },
        h('img', { src, alt: '', class: 'thumb', loading: 'lazy', width: '64', height: '64' }),
      );
    };

    fill(
      body,
      h(
        'section',
        { class: 'card' },
        h('h2', {}, formatDateKey(data.date)),
        h('p', { class: 'muted' }, `${data.employee?.name ?? ''} · ${status}`),
        h('p', { class: 'big' }, `${day.points.earned} de ${day.points.meta} pontos · ${day.points.done} de ${day.points.total} tarefas`),
        h(
          'dl',
          { class: 'times' },
          h('div', {}, h('dt', {}, 'Primeira tarefa'), h('dd', {}, done.length ? formatTime(done[0].done_at) : 'Nenhuma')),
          h('div', {}, h('dt', {}, 'Fechamento'), h('dd', {}, day.closed_at ? formatTime(day.closed_at) : 'Não fechado')),
        ),
        timed.length > 0 && h('p', { class: 'muted' }, `No horário: ${onTime} de ${timed.length} tarefas com horário (tolerância de 15 minutos).`),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, `Cumpridas (${done.length})`),
        done.length
          ? h('ul', { class: 'detail-list' }, done.map((t) =>
              h('li', {}, h('span', { class: 'detail-time' }, formatTime(t.done_at)), h('span', { class: 'detail-text' }, t.text, h('span', { class: 'pts' }, ` +${t.points}`),
                t.due_time && h('span', { class: 'muted' }, ` · previsto ${t.due_time}`),
                t.late && h('span', { class: 'tag tag-late' }, 'com atraso')), t.has_photo && photoButton(t)),
            ))
          : h('p', { class: 'muted' }, 'Nenhuma tarefa marcada neste dia.'),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, `Pendentes (${pending.length})`),
        pending.length
          ? h('ul', { class: 'pending-list' }, pending.map((t) => h('li', {}, `${t.text} (${t.points} pontos)${t.requires_photo ? ', exigia foto' : ''}`)))
          : h('p', { class: 'muted' }, 'Todas as tarefas foram cumpridas.'),
      ),
    );
  }

  api.dayOf(date, userId).then(render).catch((err) => fill(body, h('p', { class: 'alert alert-error', role: 'alert' }, err.message)));

  const back = h('button', { type: 'button', class: 'btn btn-outline', onclick: onBack }, 'Voltar ao painel');
  queueMicrotask(() => back.focus());
  return h('div', {}, back, body, dialog);
}
