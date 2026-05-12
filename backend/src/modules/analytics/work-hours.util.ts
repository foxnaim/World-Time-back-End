/**
 * Resolve an employee's *effective* work-hours window.
 *
 * Precedence: employee override → assigned shift → company default.
 * Each of `start` / `end` is resolved independently, so an employee can
 * override just one boundary and inherit the other.
 */
export function effectiveWorkHours(
  emp: {
    workStartHour: number | null;
    workEndHour: number | null;
    shift?: { startHour: number; endHour: number } | null;
  },
  company: { workStartHour: number; workEndHour: number },
): { start: number; end: number } {
  return {
    start: emp.workStartHour ?? emp.shift?.startHour ?? company.workStartHour,
    end: emp.workEndHour ?? emp.shift?.endHour ?? company.workEndHour,
  };
}
