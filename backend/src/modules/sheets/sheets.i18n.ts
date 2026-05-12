/**
 * Sheets export localization.
 *
 * Headers and tab titles are picked from the user's chosen locale,
 * defaulting to Russian. The frontend forwards the user's `NEXT_LOCALE`
 * cookie (or an explicit `x-locale` header) so we can resolve it here
 * without a DB round-trip.
 */

export type Locale = 'ru' | 'en' | 'kz';

export const DEFAULT_LOCALE: Locale = 'ru';

export function normalizeLocale(v: string | undefined | null): Locale {
  if (v === 'ru' || v === 'en' || v === 'kz') return v;
  return DEFAULT_LOCALE;
}

interface Dict {
  attendanceSheet: string;
  summarySheet: string;
  attendanceHeaders: string[];
  summaryHeaders: string[];
  typeIn: string;
  typeOut: string;
  timesheetSheet: string;
  timesheetEmployeeHeader: string;
  timesheetStateGlyphs: Record<
    'present' | 'late' | 'vacation' | 'sick' | 'dayoff' | 'trip' | 'weekend' | 'absent',
    string
  >;
  payrollSheet: string;
  payrollHeaders: string[];
}

export const SHEETS_I18N: Record<Locale, Dict> = {
  ru: {
    attendanceSheet: 'Посещаемость',
    summarySheet: 'Сводка',
    attendanceHeaders: [
      'Дата',
      'Сотрудник',
      'Должность',
      'Тип',
      'Время',
      'Опоздание',
      'Опоздание (мин)',
      'Широта',
      'Долгота',
    ],
    summaryHeaders: [
      'Сотрудник',
      'Должность',
      'Отработано часов',
      'Кол-во опозданий',
      'Всего опозданий (мин)',
      'Переработка (ч)',
      'Оклад',
      'К выплате',
    ],
    typeIn: 'Приход',
    typeOut: 'Уход',
    timesheetSheet: 'Табель',
    timesheetEmployeeHeader: 'Сотрудник',
    timesheetStateGlyphs: {
      present: '·',
      late: 'О',
      vacation: 'ОТП',
      sick: 'Б',
      dayoff: 'В',
      trip: 'К',
      weekend: '—',
      absent: 'Н',
    },
    payrollSheet: 'Зарплата',
    payrollHeaders: [
      'Сотрудник',
      'Должность',
      'Ставка',
      'Ожидаемые часы',
      'Отработано',
      'Δ часов',
      'К выплате',
      'Пропорц. оплата',
    ],
  },
  en: {
    attendanceSheet: 'Attendance',
    summarySheet: 'Summary',
    attendanceHeaders: [
      'Date',
      'Employee',
      'Position',
      'Type',
      'Time',
      'Late',
      'Late (min)',
      'Latitude',
      'Longitude',
    ],
    summaryHeaders: [
      'Employee',
      'Position',
      'Worked Hours',
      'Late Count',
      'Total Late (min)',
      'Overtime Hours',
      'Monthly Salary',
      'Final Payout',
    ],
    typeIn: 'Check-in',
    typeOut: 'Check-out',
    timesheetSheet: 'Timesheet',
    timesheetEmployeeHeader: 'Employee',
    timesheetStateGlyphs: {
      present: '·',
      late: 'L',
      vacation: 'VAC',
      sick: 'S',
      dayoff: 'OFF',
      trip: 'T',
      weekend: '—',
      absent: 'A',
    },
    payrollSheet: 'Payroll',
    payrollHeaders: [
      'Employee',
      'Position',
      'Rate',
      'Expected Hours',
      'Worked',
      'Δ Hours',
      'Estimated Pay',
      'Prorated Pay',
    ],
  },
  kz: {
    attendanceSheet: 'Қатысу',
    summarySheet: 'Қорытынды',
    attendanceHeaders: [
      'Күні',
      'Қызметкер',
      'Лауазым',
      'Түрі',
      'Уақыт',
      'Кешігу',
      'Кешігу (мин)',
      'Ендік',
      'Бойлық',
    ],
    summaryHeaders: [
      'Қызметкер',
      'Лауазым',
      'Жұмыс уақыты (сағ)',
      'Кешігу саны',
      'Барлық кешігу (мин)',
      'Қосымша (сағ)',
      'Айлық жалақы',
      'Төлемге',
    ],
    typeIn: 'Кіру',
    typeOut: 'Шығу',
    timesheetSheet: 'Табель',
    timesheetEmployeeHeader: 'Қызметкер',
    timesheetStateGlyphs: {
      present: '·',
      late: 'К',
      vacation: 'ДЕМ',
      sick: 'А',
      dayoff: 'БК',
      trip: 'ІС',
      weekend: '—',
      absent: 'Ж',
    },
    payrollSheet: 'Жалақы',
    payrollHeaders: [
      'Қызметкер',
      'Лауазым',
      'Мөлшерлеме',
      'Күтілетін сағаттар',
      'Істелген',
      'Δ сағат',
      'Төленетін',
      'Пропорц. төлем',
    ],
  },
};
