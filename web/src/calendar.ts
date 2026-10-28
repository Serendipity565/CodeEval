import type { Assignment } from "./types";

// Use the same local timezone as deadline labels throughout the workspace.
export function calendarDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function calendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = first.getDay();
  const length = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();
  return Array.from(
    { length: Math.ceil((offset + length) / 7) * 7 },
    (_, i) => new Date(month.getFullYear(), month.getMonth(), 1 - offset + i),
  );
}

export function assignmentsByDate(assignments: Assignment[]) {
  const days = new Map<string, Assignment[]>();
  const dated = assignments.filter((a) => Number.isFinite(Date.parse(a.dueAt)));
  for (const assignment of dated.sort(
    (a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt),
  )) {
    const due = new Date(assignment.dueAt);
    const key = calendarDateKey(due);
    const items = days.get(key) ?? [];
    items.push(assignment);
    days.set(key, items);
  }
  return days;
}

export function calendarSubmissionState(
  assignment: Assignment,
  submitted: boolean,
  now: number,
): { tone: "submitted" | "pending" | "overdue" | "closed"; label: string } {
  if (submitted) return { tone: "submitted", label: "已提交" };
  if (Date.parse(assignment.dueAt) <= now)
    return { tone: "overdue", label: "逾期未交" };
  if (assignment.status === "closed")
    return { tone: "closed", label: "已关闭 · 未提交" };
  return { tone: "pending", label: "未提交" };
}
