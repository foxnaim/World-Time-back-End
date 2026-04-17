import { Markup } from 'telegraf';

export type UserRole = 'b2b' | 'b2c' | 'both';

export function mainMenu(role: UserRole) {
  const rows: string[][] = [];

  if (role === 'b2b' || role === 'both') {
    rows.push(['Отметиться']);
  }

  if (role === 'b2c' || role === 'both') {
    rows.push(['Проекты', 'Таймер']);
  }

  rows.push(['Статистика', 'Войти']);

  return Markup.keyboard(rows).resize();
}

export function shareLocation() {
  return Markup.keyboard([
    [Markup.button.locationRequest('Отправить геолокацию')],
  ])
    .oneTime()
    .resize();
}

export interface ProjectLite {
  id: string;
  name: string;
}

export function projectsInline(projects: ProjectLite[]) {
  const buttons = projects.map((p) => [
    Markup.button.callback(`Старт: ${p.name}`, `start_${p.id}`),
  ]);
  return Markup.inlineKeyboard(buttons);
}

export function stopInline(entryId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Остановить', `stop_${entryId}`)],
  ]);
}

export function confirmInline(action: string, id: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Да', `confirm_${action}_${id}`),
      Markup.button.callback('Отмена', `cancel_${action}_${id}`),
    ],
  ]);
}
