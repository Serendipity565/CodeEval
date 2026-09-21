import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { Assignment, Submission, View } from "../types";
import { Empty, Head, Icon, Score, SubmissionStatus } from "./ui";

const date = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const daysLeft = (value: string) =>
  Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);

function Count({ value }: { value: number | string }) {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    if (
      typeof value !== "number" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setDisplay(value);
      return;
    }
    let frame: number;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / 480, 1);
      setDisplay(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <>
      <span aria-hidden="true">{display}</span>
      <span className="sr-only">{value}</span>
    </>
  );
}

export default function Home({
  teacher,
  as,
  ss,
  go,
  pick,
}: {
  teacher: boolean;
  as: Assignment[];
  ss: Submission[];
  go: (view: View) => void;
  pick: (submission: Submission) => void;
}) {
  const open = as.filter((a) => a.status === "open");
  const active = open.filter((a) => new Date(a.dueAt).getTime() > Date.now());
  const submitted = new Set(ss.map((s) => s.assignmentId));
  const available = teacher
    ? active
    : open.filter(
        (a) =>
          ss.filter((s) => s.assignmentId === a.id).length < a.maxSubmissions,
      );
  const pending = active.filter((a) => !submitted.has(a.id));
  const reviews = ss.filter(
    (s) => s.status === "failed" || s.status === "needs_review",
  );
  const evaluated = ss.filter((s) => s.evaluation);
  const average = evaluated.length
    ? Math.round(
        evaluated.reduce((sum, s) => sum + s.evaluation!.total, 0) /
          evaluated.length,
      )
    : "—";
  const low = evaluated.filter((s) => s.evaluation!.total < 60);
  const deadlines = [...(teacher ? active : pending)].sort(
    (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
  );
  const next = deadlines[0];
  const recent = [...ss]
    .sort(
      (a, b) =>
        new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
    )
    .slice(0, 5);
  const activity = Array.from({ length: 7 }, (_, i) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - 6 + i);
    const end = new Date(day);
    end.setDate(end.getDate() + 1);
    return {
      label: day.toLocaleDateString("zh-CN", { weekday: "short" }),
      date: day.toLocaleDateString("zh-CN", {
        month: "numeric",
        day: "numeric",
      }),
      count: ss.filter(
        (s) => new Date(s.submittedAt) >= day && new Date(s.submittedAt) < end,
      ).length,
    };
  });
  const activityMax = Math.max(1, ...activity.map((d) => d.count));
  const weekly = activity.reduce((sum, d) => sum + d.count, 0);
  const metrics = [
    {
      label: teacher ? "进行中的作业" : "可继续提交",
      value: available.length,
      unit: "项",
      note: `全部 ${as.length} 项作业`,
      icon: "assignments" as const,
      destination: "assignments" as const,
    },
    {
      label: teacher ? "收到的提交" : "我的提交",
      value: ss.length,
      unit: "份",
      note: `近 7 天新增 ${weekly} 份`,
      icon: "submissions" as const,
      destination: "submissions" as const,
    },
    {
      label: "平均得分",
      value: average,
      unit: "/ 100",
      note: `来自 ${evaluated.length} 份评估`,
      icon: "activity" as const,
      destination: "submissions" as const,
    },
    {
      label: teacher ? "需要复核" : "低于 60 分",
      value: teacher ? reviews.length : low.length,
      unit: "份",
      note: teacher ? "失败与待复核提交" : "查看反馈，继续改进",
      icon: "alert" as const,
      destination: "submissions" as const,
    },
  ];
  return (
    <div className="dashboard">
      <section className="dashboard-heading">
        <div>
          <div className="section-kicker">
            <span />
            {teacher ? "教学工作台" : "学习工作台"}
          </div>
          <h2>{teacher ? "课程概览" : "我的学习进度"}</h2>
          <p>
            {teacher
              ? "查看学生的新提交，跟进每一项作业。"
              : "安排接下来的作业，查看最近的评估反馈。"}
          </p>
        </div>
        <button
          className="primary"
          onClick={() => go(teacher ? "publish" : "assignments")}
        >
          <Icon name={teacher ? "plus" : "arrowRight"} />
          {teacher ? "发布新作业" : "继续我的作业"}
        </button>
      </section>

      <section className="metric-strip" aria-label="课程数据概览">
        {metrics.map((m, i) => (
          <button
            className="metric"
            onClick={() => go(m.destination)}
            key={m.label}
            style={{ "--item-index": i } as CSSProperties}
          >
            <span className="metric-label">
              {m.label}
              <Icon name={m.icon} />
            </span>
            <span className="metric-value">
              <Count value={m.value} />
              <small>{m.unit}</small>
            </span>
            <span className="metric-note">
              {m.note}
              <Icon name="arrowUpRight" />
            </span>
          </button>
        ))}
      </section>

      {reviews.length > 0 && (
        <button className="review-notice" onClick={() => go("submissions")}>
          <span className="notice-mark">
            <Icon name="alert" />
          </span>
          <span>
            <b>
              {reviews.length} 份提交需要{teacher ? "你" : "教师"}关注
            </b>
            <small>评估失败或结果需要复核，查看具体原因。</small>
          </span>
          <span className="notice-action">
            查看提交
            <Icon name="arrowRight" />
          </span>
        </button>
      )}

      <div className="dashboard-grid">
        <section className="recent-section">
          <Head
            name={teacher ? "最近提交" : "最近反馈"}
            action={() => go("submissions")}
          />
          <p className="section-description">
            {teacher ? "学生的最新进展，按提交时间排序" : "每次评估都有迹可循"}
          </p>
          {recent.length ? (
            <div className="activity-list">
              <div className="activity-list-head">
                <span>{teacher ? "学生 / 作业" : "作业 / 提交时间"}</span>
                <span>评估状态</span>
                <span>得分</span>
              </div>
              {recent.map((s, i) => (
                <button
                  className="activity-row"
                  onClick={() => pick(s)}
                  key={s.id}
                  style={{ "--item-index": i } as CSSProperties}
                >
                  <span className={`submission-avatar avatar-${i % 3}`}>
                    {teacher ? s.studentName.slice(0, 1) : <Icon name="code" />}
                  </span>
                  <span className="activity-person">
                    <b>
                      {teacher
                        ? s.studentName
                        : as.find((a) => a.id === s.assignmentId)?.title ||
                          "作业提交"}
                    </b>
                    <small>
                      {teacher
                        ? as.find((a) => a.id === s.assignmentId)?.title ||
                          "作业提交"
                        : date(s.submittedAt)}
                    </small>
                    {teacher && (
                      <time dateTime={s.submittedAt}>
                        {date(s.submittedAt)}
                      </time>
                    )}
                  </span>
                  <SubmissionStatus status={s.status} />
                  {s.evaluation ? (
                    <Score n={s.evaluation.total} max={s.evaluation.maxTotal} />
                  ) : (
                    <span className="score-placeholder">—</span>
                  )}
                  <Icon name="arrowUpRight" />
                </button>
              ))}
            </div>
          ) : (
            <Empty
              text={
                teacher
                  ? "学生提交作业后，会在这里显示评估进度。"
                  : "完成第一次提交后，在这里查看你的反馈。"
              }
              action={
                <button
                  className="text-action"
                  onClick={() => go("assignments")}
                >
                  查看作业
                  <Icon name="arrowRight" />
                </button>
              }
            />
          )}
          <div className="recent-footnote">
            <Icon name="check" />
            {teacher
              ? "反馈来自测试结果、代码分析与评分量规"
              : "打开提交，可查看代码、测试结果和改进建议"}
          </div>
        </section>

        <aside className="dashboard-aside">
          <section className="deadline-card">
            <div className="deadline-card-top">
              <span>
                <Icon name="calendar" />
                下一项截止
              </span>
              <span>{next ? next.language : "日程"}</span>
            </div>
            {next ? (
              <>
                <div className="deadline-date">
                  <b>
                    {new Date(next.dueAt).getDate().toString().padStart(2, "0")}
                  </b>
                  <span>
                    {new Date(next.dueAt).getMonth() + 1} 月
                    <small>
                      {new Date(next.dueAt).toLocaleDateString("zh-CN", {
                        weekday: "long",
                      })}
                    </small>
                  </span>
                  <em>
                    {daysLeft(next.dueAt) <= 1
                      ? "24 小时内"
                      : `还剩 ${daysLeft(next.dueAt)} 天`}
                  </em>
                </div>
                <h3>{next.title}</h3>
                <p>
                  {teacher
                    ? `${ss.filter((s) => s.assignmentId === next.id).length} 份提交 · 查看学生完成情况`
                    : `最多提交 ${next.maxSubmissions} 次 · 记得预留调试时间`}
                </p>
                <button onClick={() => go("assignments")}>
                  {teacher ? "查看作业进度" : "前往完成作业"}
                  <Icon name="arrowUpRight" />
                </button>
              </>
            ) : (
              <div className="deadline-clear">
                <Icon name="check" />
                <h3>暂时没有临近的截止日</h3>
                <p>
                  {teacher
                    ? "发布新作业后，在这里跟进日程。"
                    : "可前往作业列表查看开放状态。"}
                </p>
                <button onClick={() => go("assignments")}>
                  查看全部作业
                  <Icon name="arrowUpRight" />
                </button>
              </div>
            )}
          </section>

          <section className="weekly-activity">
            <div className="weekly-heading">
              <h3>提交节奏</h3>
              <span>近 7 天</span>
            </div>
            <p>
              <b>{weekly}</b> 份提交
              <span>{teacher ? "课程提交活动" : "我的提交活动"}</span>
            </p>
            <div className="activity-bars" aria-label="近七天每日提交数量">
              {activity.map((d, i) => (
                <div
                  className={`activity-day ${i === 6 ? "today" : ""}`}
                  key={d.date}
                >
                  <div
                    className="activity-bar-track"
                    tabIndex={0}
                    aria-label={`${d.date}，${d.count} 份提交`}
                  >
                    <span className="bar-tooltip" aria-hidden="true">
                      {d.date} · {d.count} 份
                    </span>
                    <i
                      style={
                        {
                          "--bar-height": `${(d.count / activityMax) * 100}%`,
                          "--item-index": i,
                        } as CSSProperties
                      }
                    />
                  </div>
                  <small>{i === 6 ? "今天" : d.label}</small>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <section className="schedule-section">
        <Head
          name={teacher ? "作业日程" : "待完成作业"}
          action={() => go("assignments")}
        />
        {deadlines.length ? (
          <div className="schedule-list">
            {deadlines.slice(0, 3).map((a, i) => (
              <button
                className="schedule-item"
                onClick={() => go("assignments")}
                key={a.id}
              >
                <span className="schedule-index">0{i + 1}</span>
                <span>
                  <b>{a.title}</b>
                  <small>
                    {a.language} <span>·</span> 截止 {date(a.dueAt)}
                  </small>
                </span>
                <span
                  className={`schedule-days ${daysLeft(a.dueAt) <= 3 ? "soon" : ""}`}
                >
                  {daysLeft(a.dueAt) <= 1
                    ? "24 小时内"
                    : `${daysLeft(a.dueAt)} 天后`}
                  <Icon name="arrowUpRight" />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="schedule-empty">
            {teacher
              ? "目前没有未来截止的开放作业。"
              : "近期没有待完成的截止日程，可到作业列表查看所有作业。"}
          </p>
        )}
      </section>
    </div>
  );
}
