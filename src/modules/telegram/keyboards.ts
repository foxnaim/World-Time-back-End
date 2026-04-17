import { Markup } from 'telegraf';

export type UserRole = 'b2b' | 'b2c' | 'both';

/**
 * TS2742: telegraf's `Markup.keyboard` return type is anchored on a
 * `@telegraf/types` namespace path that isn't portable across workspaces.
 * The helpers here are only ever passed through to `ctx.reply(..., kbd)`,
 * so the concrete markup shape doesn't matter to call sites. Annotating
 * these returns as the type alias below keeps the public signatures stable
 * without forcing a `@telegraf/types` direct dependency.
 */
type Keyboard = ReturnType<typeof Markup.keyboard>;
type InlineKeyboard = ReturnType<typeof Markup.inlineKeyboard>;

export function mainMenu(role: UserRole): Keyboard {
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

export function shareLocation(): Keyboard {
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

export function projectsInline(projects: ProjectLite[]): InlineKeyboard {
  const buttons = projects.map((p) => [
    Markup.button.callback(`Старт: ${p.name}`, `start_${p.id}`),
  ]);
  return Markup.inlineKeyboard(buttons);
}

export function stopInline(entryId: string): InlineKeyboard {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Остановить', `stop_${entryId}`)],
  ]);
}

export function confirmInline(action: string, id: string): InlineKeyboard {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Да', `confirm_${action}_${id}`),
      Markup.button.callback('Отмена', `cancel_${action}_${id}`),
    ],
  ]);
}
