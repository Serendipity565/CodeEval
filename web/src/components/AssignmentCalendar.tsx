import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Assignment, Submission } from "../types";
import {
  assignmentsByDate,
  calendarDateKey,
  calendarDays,
  calendarSubmissionState,
} from "../calendar";
import { latestSubmissions } from "../submissions";
import { useDeadlineClock } from "../hooks/useDeadlineClock";
import Dialog from "./ui/Dialog";
import { Icon, SubmissionStatus } from "./ui";
import "./assignment-calendar.css";

export default function AssignmentCalendar({
  assignments,
  submissions,
  teacher,
  studentId,
  loading,
  error,
  onRetry,
  onClose,
  openAssignment,
}: {
  assignments: Assignment[];
  submissions: Submission[];
  teacher: boolean;
  studentId: string;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onClose: () => void;
  openAssignment: (id: string) => void;
}) {
  const [selected, setSelected] = useState(() => new Date());
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const gridRef = useRef<HTMLDivElement>(null);
  const focusDate = useRef(false);
  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 0, 0);
  const now = useDeadlineClock([
    ...assignments.map((a) => Date.parse(a.dueAt)),
    tomorrow.getTime(),
  ]);
  const todayKey = calendarDateKey(new Date(now));
  const selectedKey = calendarDateKey(selected);
  const grouped = useMemo(() => assignmentsByDate(assignments), [assignments]);
  const latest = useMemo(
    () =>
      new Map(
        latestSubmissions(
          submissions.filter((s) => s.studentId === studentId),
        ).map((s) => [s.assignmentId, s]),
      ),
    [submissions, studentId],
  );
  const days = calendarDays(month);
  const selectedAssignments = grouped.get(selectedKey) ?? [];
  const monthCount = assignments.filter((a) => {
    const due = new Date(a.dueAt);
    return (
      due.getFullYear() === month.getFullYear() &&
      due.getMonth() === month.getMonth()
    );
  }).length;
  useEffect(() => {
    if (focusDate.current) {
      gridRef.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${selectedKey}"]`)
        ?.focus();
      focusDate.current = false;
    }
  }, [selectedKey]);

  const selectDate = (date: Date) => {
    setSelected(date);
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  };
  const changeMonth = (offset: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    next.setDate(
      Math.min(
        selected.getDate(),
        new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate(),
      ),
    );
    selectDate(next);
  };
  const onDateKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    day: Date,
  ) => {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -day.getDay(),
      End: 6 - day.getDay(),
    };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    const next = new Date(day);
    next.setDate(day.getDate() + offsets[event.key]);
    focusDate.current = true;
    selectDate(next);
  };
  const stateFor = (assignment: Assignment) => {
    if (!teacher)
      return calendarSubmissionState(
        assignment,
        latest.has(assignment.id),
        now,
      );
    if (!assignment.expectedStudents)
      return { tone: "closed", label: "暂无学生" };
    return assignment.submittedStudents >= assignment.expectedStudents
      ? { tone: "submitted", label: "已收齐" }
      : { tone: "pending", label: "未收齐" };
  };
  return (
    <Dialog
      title="作业日历"
      note={
        teacher
          ? "按截止日期查看作业与学生提交进度。"
          : "按截止日期安排作业，查看提交状态。"
      }
      wide
      className="assignment-calendar-dialog"
      onClose={onClose}
    >
      {loading ? (
        <div className="calendar-message" role="status">
          正在加载作业日历…
        </div>
      ) : error ? (
        <div className="calendar-message" role="alert">
          <p>{error}</p>
          <button type="button" onClick={onRetry}>
            重新加载
          </button>
        </div>
      ) : (
        <>
          <div className="calendar-toolbar">
            <div>
              <h3 aria-live="polite">
                {month.getFullYear()}年{month.getMonth() + 1}月
              </h3>
              <span>本月 {monthCount} 项作业截止</span>
            </div>
            <div className="calendar-month-actions">
              <button
                type="button"
                aria-label="上个月"
                onClick={() => changeMonth(-1)}
              >
                <Icon name="chevronLeft" />
              </button>
              <button type="button" onClick={() => selectDate(new Date(now))}>
                今天
              </button>
              <button
                type="button"
                aria-label="下个月"
                onClick={() => changeMonth(1)}
              >
                <Icon name="chevronRight" />
              </button>
            </div>
          </div>
          <div className="calendar-layout">
            <section className="calendar-month" aria-label="作业截止月历">
              <div className="calendar-weekdays" aria-hidden="true">
                {["周日", "周一", "周二", "周三", "周四", "周五", "周六"].map(
                  (day) => (
                    <span key={day}>{day}</span>
                  ),
                )}
              </div>
              <div
                className="calendar-grid"
                ref={gridRef}
                role="group"
                aria-label="选择日期，可使用方向键移动"
              >
                {days.map((day) => {
                  const key = calendarDateKey(day);
                  const items = grouped.get(key) ?? [];
                  const today = key === todayKey;
                  return (
                    <button
                      type="button"
                      key={key}
                      data-date={key}
                      className={`calendar-day${day.getMonth() !== month.getMonth() ? " is-outside" : ""}${today ? " is-today" : ""}${day.getDay() === 0 || day.getDay() === 6 ? " is-weekend" : ""}${items.length ? " has-events" : ""}`}
                      aria-pressed={key === selectedKey}
                      aria-current={today ? "date" : undefined}
                      tabIndex={key === selectedKey ? 0 : -1}
                      aria-label={`${day.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}${today ? "，今天" : ""}，${items.length ? items.map((a) => `${a.title}，${stateFor(a).label}${teacher ? `，${a.submittedStudents}/${a.expectedStudents}人提交` : ""}`).join("；") : "无截止作业"}`}
                      onClick={() => selectDate(day)}
                      onKeyDown={(event) => onDateKeyDown(event, day)}
                    >
                      <span className="calendar-day-top">
                        <span className="calendar-day-number">
                          {day.getDate()}
                        </span>
                        {today && (
                          <span className="calendar-today-label">今天</span>
                        )}
                      </span>
                      <span className="calendar-day-events" aria-hidden="true">
                        {items.slice(0, 2).map((assignment) => (
                          <span
                            key={assignment.id}
                            className={`calendar-event calendar-tone--${stateFor(assignment).tone}`}
                          >
                            <i />
                            <span>{assignment.title}</span>
                          </span>
                        ))}
                        {items.length > 2 && (
                          <span className="calendar-more">
                            另 {items.length - 2} 项
                          </span>
                        )}
                      </span>
                      {items.length > 0 && (
                        <span className="calendar-day-count" aria-hidden="true">
                          {items.length} 项
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="calendar-legend">
                {(teacher
                  ? [
                      ["pending", "未收齐"],
                      ["submitted", "已收齐"],
                    ]
                  : [
                      ["pending", "未提交"],
                      ["submitted", "已提交"],
                      ["overdue", "逾期未交"],
                      ["closed", "已关闭"],
                    ]
                ).map(([tone, label]) => (
                  <span key={tone} className={`calendar-tone--${tone}`}>
                    <i />
                    {label}
                  </span>
                ))}
              </div>
            </section>
            <section
              className="calendar-agenda"
              aria-labelledby="calendar-agenda-title"
              aria-live="polite"
            >
              <div className="calendar-agenda-heading">
                <h3 id="calendar-agenda-title">
                  <strong className="calendar-agenda-date">
                    {String(selected.getDate()).padStart(2, "0")}
                  </strong>
                  <span className="calendar-agenda-date-context">
                    <span>
                      {selected.getFullYear()}年{selected.getMonth() + 1}月
                    </span>
                    <small>
                      {selected.toLocaleDateString("zh-CN", {
                        weekday: "long",
                      })}
                      {selectedKey === todayKey ? " · 今天" : ""}
                    </small>
                  </span>
                </h3>
                <p>
                  {selectedAssignments.length
                    ? `${selectedAssignments.length} 项作业截止`
                    : "当天没有截止作业"}
                </p>
              </div>
              {selectedAssignments.length ? (
                <ul>
                  {selectedAssignments.map((assignment) => {
                    const state = stateFor(assignment);
                    const submission = latest.get(assignment.id);
                    return (
                      <li
                        key={assignment.id}
                        className={`calendar-tone--${state.tone}`}
                      >
                        <span className="calendar-course">
                          {assignment.courseTitle}
                        </span>
                        <button
                          type="button"
                          className="calendar-assignment-link"
                          onClick={() => openAssignment(assignment.id)}
                        >
                          {assignment.title}
                        </button>
                        <time dateTime={assignment.dueAt}>
                          <Icon name="clock" />
                          {new Date(assignment.dueAt).toLocaleTimeString(
                            "zh-CN",
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            },
                          )}{" "}
                          截止
                          {assignment.status === "closed"
                            ? " · 已关闭"
                            : Date.parse(assignment.dueAt) <= now
                              ? " · 已截止"
                              : ""}
                        </time>
                        <div className="calendar-assignment-state">
                          <span
                            className={`calendar-badge calendar-tone--${state.tone}`}
                          >
                            <i />
                            {state.label}
                          </span>
                          {teacher ? (
                            <span>
                              {assignment.submittedStudents} /{" "}
                              {assignment.expectedStudents} 人已提交
                            </span>
                          ) : (
                            submission && (
                              <SubmissionStatus status={submission.status} />
                            )
                          )}
                        </div>
                        <button
                          type="button"
                          className="calendar-open-assignment"
                          onClick={() => openAssignment(assignment.id)}
                        >
                          {teacher ? "查看作业进度" : "进入作业"}
                          <Icon name="chevronRight" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="calendar-empty">
                  <Icon name="calendar" />
                  <p>
                    {monthCount
                      ? "选择有标记的日期查看作业。"
                      : "可切换月份，查看其他截止安排。"}
                  </p>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </Dialog>
  );
}
