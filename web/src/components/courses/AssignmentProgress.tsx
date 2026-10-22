import { useEffect, useState } from "react";
import type { Assignment, AssignmentStudent } from "../../types";
import { apiRequest } from "../../api/client";
import { Empty, Title } from "../ui";

export function SubmissionMetrics({
  assignment: a,
}: {
  assignment: Assignment;
}) {
  return (
    <dl className="course-progress">
      <div>
        <dt>应提交人数</dt>
        <dd>
          {a.expectedStudents}
          <small>人</small>
        </dd>
      </div>
      <div>
        <dt>已提交人数</dt>
        <dd>
          {a.submittedStudents}
          <small>人</small>
        </dd>
      </div>
      <div>
        <dt>未提交人数</dt>
        <dd>
          {Math.max(0, a.expectedStudents - a.submittedStudents)}
          <small>人</small>
        </dd>
      </div>
      <div>
        <dt>提交率</dt>
        <dd>
          {a.submissionRate == null
            ? "—"
            : `${Math.round(a.submissionRate * 10) / 10}%`}
        </dd>
      </div>
    </dl>
  );
}
export default function AssignmentProgress({
  assignment,
  token,
  back,
  edit,
  openSubmission,
}: {
  assignment: Assignment;
  token: string;
  back: () => void;
  edit: () => void;
  openSubmission: (id: string) => void;
}) {
  const [students, setStudents] = useState<AssignmentStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    apiRequest<AssignmentStudent[]>(
      `/assignments/${assignment.id}/students`,
      token,
    )
      .then((rows) => {
        if (active) setStudents(rows);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "加载失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [assignment.id, token, retry]);
  const shown = students.filter(
    (s) =>
      filter === "all" ||
      (filter === "submitted" ? !!s.submissionId : !s.submissionId),
  );
  return (
    <section>
      <button className="back" onClick={back}>
        返回作业
      </button>
      <Title
        title={assignment.title}
        note={`${assignment.courseTitle} · ${assignment.language}`}
      >
        <button className="primary" onClick={edit}>
          修改作业
        </button>
      </Title>
      <SubmissionMetrics assignment={assignment} />
      <p className="course-note">
        按当前选课学生统计；每名学生提交多次只计一人。选课后可提交课程已有作业。
      </p>
      <section className="panel">
        <Title title="学生提交情况" note="查看所有选课学生及其最近一次提交" />
        <label className="course-filter">
          提交状态
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">全部学生</option>
            <option value="submitted">已提交</option>
            <option value="pending">未提交</option>
          </select>
        </label>
        {loading ? (
          <p role="status">正在加载学生名单…</p>
        ) : error ? (
          <div className="alert" role="alert">
            {error}
            <button onClick={() => setRetry((v) => v + 1)}>重新加载</button>
          </div>
        ) : (
          <div className="course-roster">
            {shown.map((s) => (
              <div className="course-student" key={s.id}>
                <b>{s.name}</b>
                <span>{s.submissionId ? "已提交" : "未提交"}</span>
                {s.submittedAt && (
                  <time>{new Date(s.submittedAt).toLocaleString("zh-CN")}</time>
                )}
                {s.submissionId && (
                  <button
                    className="text-action"
                    onClick={() => openSubmission(s.submissionId!)}
                  >
                    查看提交
                  </button>
                )}
              </div>
            ))}
            {!shown.length && (
              <Empty
                text={
                  students.length
                    ? "没有符合条件的学生。"
                    : "暂时没有学生选课。"
                }
              />
            )}
          </div>
        )}
      </section>
    </section>
  );
}
