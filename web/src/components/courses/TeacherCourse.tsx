import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Course, CourseStudent } from "../../types";
import { apiRequest } from "../../api/client";
import { Empty, Icon, Title } from "../ui";

export default function TeacherCourse({
  course,
  token,
  children,
}: {
  course: Course;
  token: string;
  children: ReactNode;
}) {
  const [tab, setTab] = useState<"assignments" | "students">("assignments");
  const assignmentsTab = useRef<HTMLButtonElement>(null);
  const studentsTab = useRef<HTMLButtonElement>(null);
  const prefix = `course-${course.id}`;
  return (
    <>
      <div className="course-tabs" role="tablist" aria-label="课程内容">
        <button
          ref={assignmentsTab}
          id={`${prefix}-assignments`}
          role="tab"
          aria-controls={`${prefix}-content`}
          aria-selected={tab === "assignments"}
          tabIndex={tab === "assignments" ? 0 : -1}
          onClick={() => setTab("assignments")}
          onKeyDown={(e) => {
            if (["ArrowLeft", "ArrowRight", "End"].includes(e.key)) {
              e.preventDefault();
              setTab("students");
              studentsTab.current?.focus();
            }
          }}
        >
          课程作业 <span>{course.assignmentCount}</span>
        </button>
        <button
          ref={studentsTab}
          id={`${prefix}-students`}
          role="tab"
          aria-controls={`${prefix}-content`}
          aria-selected={tab === "students"}
          tabIndex={tab === "students" ? 0 : -1}
          onClick={() => setTab("students")}
          onKeyDown={(e) => {
            if (["ArrowLeft", "ArrowRight", "Home"].includes(e.key)) {
              e.preventDefault();
              setTab("assignments");
              assignmentsTab.current?.focus();
            }
          }}
        >
          选课学生 <span>{course.studentCount}</span>
        </button>
      </div>
      <div
        role="tabpanel"
        id={`${prefix}-content`}
        aria-labelledby={`${prefix}-${tab}`}
      >
        {tab === "assignments" ? (
          children
        ) : (
          <CourseRoster courseId={course.id} token={token} />
        )}
      </div>
    </>
  );
}
function CourseRoster({
  courseId,
  token,
}: {
  courseId: string;
  token: string;
}) {
  const [students, setStudents] = useState<CourseStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    apiRequest<CourseStudent[]>(`/courses/${courseId}/students`, token)
      .then((rows) => {
        if (active) setStudents(rows);
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "选课名单加载失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [courseId, token, retry]);
  const search = query.trim().toLocaleLowerCase();
  const shown = students.filter((s) =>
    `${s.name}\n${s.username}`.toLocaleLowerCase().includes(search),
  );
  return (
    <section className="course-enrollment-panel" aria-busy={loading}>
      <Title
        title="选课学生"
        note={
          loading
            ? "正在读取选课名单"
            : error
              ? "选课名单暂时无法加载"
              : `共 ${students.length} 人选课 · 包含尚未提交作业的学生`
        }
      >
        <button
          type="button"
          className="course-button"
          disabled={loading}
          onClick={() => setRetry((v) => v + 1)}
        >
          <Icon name="refresh" />
          刷新名单
        </button>
      </Title>
      <div className="course-roster-toolbar">
        <label className="course-student-search">
          搜索学生
          <span className="course-search-field">
            <Icon name="search" />
            <input
              type="search"
              placeholder="输入姓名或账号"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>
        </label>
        {!loading && !error && (
          <span className="course-result-count" aria-live="polite">
            {search
              ? `找到 ${shown.length} 位学生`
              : `${students.length} 位学生已加入课程`}
          </span>
        )}
      </div>
      {loading ? (
        <p role="status">正在加载选课学生…</p>
      ) : error ? (
        <div className="alert" role="alert">
          {error}
          <button
            className="text-action"
            onClick={() => setRetry((v) => v + 1)}
          >
            重新加载
          </button>
        </div>
      ) : (
        <>
          {shown.length ? (
            <ul className="course-enrollment-list" aria-label="选课学生名单">
              {shown.map((s) => (
                <li key={s.id} className="course-enrollment-card">
                  <div className="course-enrollment-person">
                    <span className="course-student-avatar" aria-hidden="true">
                      {s.name.slice(0, 1)}
                    </span>
                    <div className="course-student-identity">
                      <strong>{s.name}</strong>
                      <span>账号：{s.username}</span>
                    </div>
                  </div>
                  <div className="course-student-date">
                    <span>
                      <Icon name="calendar" />
                      选课时间
                    </span>
                    <time dateTime={s.enrolledAt}>
                      {new Date(s.enrolledAt).toLocaleString("zh-CN")}
                    </time>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              text={
                students.length
                  ? "没有匹配的学生，请修改姓名或账号后重试。"
                  : "暂时没有学生选择这门课程。"
              }
            />
          )}
        </>
      )}
    </section>
  );
}
