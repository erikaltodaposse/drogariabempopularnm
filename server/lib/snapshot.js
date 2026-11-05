// Funções puras do congelamento do checklist (brief, seção 7.2). Nada aqui toca banco ou Express.

export const FOCUS_PLACEHOLDER = '{foco}';

/** A tarefa é desta pessoa? Sem responsável (`assignee` nulo), é das duas. */
export function isAssignedTo(task, userId) {
  return task.assignee == null || userId == null || Number(task.assignee) === Number(userId);
}

/**
 * Cópia profunda do template vigente, já com o foco de limpeza aplicado.
 * `template` = { version_id, weekday, cleaning_focus, sections: [{ title, subtitle, tasks: [...] }] }.
 * `userId` = dono do dia: entram só as tarefas dele e as sem responsável. Blocos que ficam vazios saem.
 */
export function buildSnapshot(template, userId = null) {
  const focus = template.cleaning_focus ?? '';
  return {
    version_id: template.version_id ?? null,
    weekday: template.weekday,
    cleaning_focus: focus,
    user_id: userId,
    sections: template.sections.map((section) => ({
      title: section.title,
      subtitle: section.subtitle ?? null,
      tasks: section.tasks.filter((task) => isAssignedTo(task, userId)).map((task) => ({
        id: task.id,
        text: String(task.text).replaceAll(FOCUS_PLACEHOLDER, focus),
        // Texto original, com {foco}: identifica a mesma tarefa em dias com focos diferentes.
        template_text: String(task.text),
        points: Number(task.points),
        requires_photo: Boolean(task.requires_photo),
        auto: task.auto ?? null,
        due_time: task.due_time ?? null,
        assignee: task.assignee ?? null,
      })),
    })).filter((section) => section.tasks.length > 0),
  };
}

export function snapshotTasks(snapshot) {
  return snapshot.sections.flatMap((section) => section.tasks);
}

export function findSnapshotTask(snapshot, taskId) {
  return snapshotTasks(snapshot).find((task) => task.id === taskId) ?? null;
}

/** Dia sem check-in, sem check-out e sem nenhuma tarefa marcada. */
export function isDayEmpty(day, checks) {
  return !day.check_in_at && !day.check_out_at && checks.length === 0;
}

/** Só o dia de hoje, ainda vazio, pode ter o snapshot regravado após uma edição do checklist. */
export function canRewriteSnapshot(day, checks, today) {
  return day.date === today && isDayEmpty(day, checks);
}
