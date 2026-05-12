import { Markup } from 'telegraf';

/** 'owner' = company owner (web only, no check-in) */
export type UserRole = 'owner' | 'b2b' | 'b2c' | 'both';

type Keyboard = ReturnType<typeof Markup.keyboard>;
type InlineKeyboard = ReturnType<typeof Markup.inlineKeyboard>;

export function mainMenu(role: UserRole): Keyboard {
  const rows: string[][] = [];

  // Only non-owners check in via QR
  if (role === 'b2b' || role === 'both') {
    rows.push(['Отметиться']);
  }

  if (role === 'b2c' || role === 'both') {
    rows.push(['Проекты', 'Таймер']);
  }

  // STAFF / MANAGER (company employees) can request leave from the bot.
  if (role === 'b2b' || role === 'both') {
    rows.push(['Запросить отпуск']);
  }

  // Owners, managers (both), and freelancers see web login
  if (role === 'owner' || role === 'b2c' || role === 'both') {
    rows.push(['Статистика', 'Войти']);
  } else {
    rows.push(['Статистика']);
  }

  return Markup.keyboard(rows).resize();
}

export function checkinMenu(isCurrentlyIn: boolean): Keyboard {
  const label = isCurrentlyIn ? 'Уйти с работы' : 'Отметиться';
  return Markup.keyboard([[label], ['Запросить отпуск'], ['Статистика']]).resize();
}

export function shareLocation(): Keyboard {
  return Markup.keyboard([[Markup.button.locationRequest('Отправить геолокацию')]])
    .oneTime()
    .resize();
}

export interface ProjectLite {
  id: string;
  name: string;
}

export function projectsInline(projects: ProjectLite[]): InlineKeyboard {
  const buttons = projects.map((p) => [
    Markup.button.callback(`Старт: ${p.name}`, `start_${p.id}`),
  ]);
  return Markup.inlineKeyboard(buttons);
}

export function stopInline(entryId: string): InlineKeyboard {
  return Markup.inlineKeyboard([[Markup.button.callback('Остановить', `stop_${entryId}`)]]);
}

export function confirmInline(action: string, id: string): InlineKeyboard {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Да', `confirm_${action}_${id}`),
      Markup.button.callback('Отмена', `cancel_${action}_${id}`),
    ],
  ]);
}
