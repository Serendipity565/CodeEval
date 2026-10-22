import { FormEvent, useRef, useState } from "react";
import type { Course } from "../../types";
import { apiRequest } from "../../api/client";
import { Empty, Icon, Title } from "../ui";
import "./courses.css";

export default function Courses({
  courses,
  teacher,
  token,
  open,
  reload,
}: {
  courses: Course[];
  teacher: boolean;
  token: string;
  open: (id: string) => void;
  reload: () => Promise<void>;
}) {
  const [tab, setTab] = useState<"all" | "selected">("all");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [queries, setQueries] = useState({ all: "", selected: "" });
  const query = queries[tab];
  const setQuery = (value: string) =>
    setQueries((current) => ({ ...current, [tab]: value }));
  const searchLabel = teacher
    ? "搜索我的课程"
    : tab === "all"
      ? "搜索全部课程"
      : "搜索已选课程";
  const searchInput = useRef<HTMLInputElement>(null);
  const scoped =
    teacher || tab === "all" ? courses : courses.filter((c) => c.enrolled);
  const search = query.trim().toLocaleLowerCase();
  const shown = scoped.filter((course) =>
    [course.title, course.teacherName, course.description].some((value) =>
      value.toLocaleLowerCase().includes(search),
    ),
  );
  const clearSearch = () => {
    setQuery("");
    searchInput.current?.focus();
  };
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy("create");
    setError("");
    try {
      const c = await apiRequest<Course>("/courses", token, {
        method: "POST",
        body: JSON.stringify({ title, description }),
      });
      await reload();
      open(c.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setBusy("");
    }
  }
  async function enroll(c: Course) {
    setBusy(c.id);
    setError("");
    try {
      await apiRequest(`/courses/${c.id}/enroll`, token, { method: "POST" });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "选课失败");
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="courses-page">
      <Title
        title={teacher ? "我的课程" : "课程"}
        note={
          teacher
            ? "进入课程，发布作业并跟进学生提交情况"
            : "选择课程后，可查看该课程作业并提交代码"
        }
      >
        {teacher && (
          <button
            className="primary"
            aria-expanded={creating}
            onClick={() => setCreating(!creating)}
          >
            <Icon name="plus" />
            创建课程
          </button>
        )}
      </Title>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {teacher && creating && (
        <form className="panel course-create" onSubmit={create}>
          <div className="course-create-heading">
            <Icon name="courses" />
            <h3>新建课程</h3>
            <span>创建后即可发布作业</span>
          </div>
          <label>
            课程名称
            <input
              autoFocus
              required
              maxLength={100}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            课程说明
            <textarea
              maxLength={2000}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="course-actions">
            <button
              className="course-button"
              type="button"
              onClick={() => setCreating(false)}
            >
              取消
            </button>
            <button className="primary" disabled={!!busy}>
              {busy === "create" ? "正在创建…" : "创建课程"}
            </button>
          </div>
        </form>
      )}
      <div className="course-catalog-controls">
        {!teacher && (
          <div className="course-tabs" role="tablist" aria-label="课程范围">
            <button
              id="courses-all"
              role="tab"
              aria-controls="course-list"
              aria-selected={tab === "all"}
              tabIndex={tab === "all" ? 0 : -1}
              onClick={() => setTab("all")}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  setTab("selected");
                  document.getElementById("courses-selected")?.focus();
                }
              }}
            >
              全部课程 <span>{courses.length}</span>
            </button>
            <button
              id="courses-selected"
              role="tab"
              aria-controls="course-list"
              aria-selected={tab === "selected"}
              tabIndex={tab === "selected" ? 0 : -1}
              onClick={() => setTab("selected")}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  setTab("all");
                  document.getElementById("courses-all")?.focus();
                }
              }}
            >
              已选课程 <span>{courses.filter((c) => c.enrolled).length}</span>
            </button>
          </div>
        )}
        {teacher && <span className="course-catalog-label">课程列表</span>}
        <div
          className="course-catalog-search"
          role="search"
          aria-label={searchLabel}
        >
          <div className="course-search-field">
            <label className="course-catalog-input">
              <span className="sr-only">{searchLabel}</span>
              <Icon name="search" />
              <input
                ref={searchInput}
                type="search"
                placeholder="搜索课程"
                aria-label={searchLabel}
                className={query ? "has-query" : undefined}
                title="按课程名称、授课教师或课程说明搜索"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-controls="course-list"
              />
            </label>
            {query && (
              <button
                className="course-search-clear"
                type="button"
                onClick={clearSearch}
                aria-label="清空课程搜索"
                title="清空搜索"
              >
                <Icon name="close" />
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="course-catalog-count" role="status">
        {search
          ? `找到 ${shown.length} 门课程 · 当前范围共 ${scoped.length} 门`
          : `共 ${scoped.length} 门课程`}
      </p>
      <div
        id="course-list"
        role={teacher ? undefined : "tabpanel"}
        aria-labelledby={
          teacher
            ? undefined
            : tab === "all"
              ? "courses-all"
              : "courses-selected"
        }
        className="course-list"
      >
        {shown.map((c) => (
          <article
            className="panel course-card"
            key={c.id}
            aria-label={c.title}
          >
            <div className="course-card-top">
              <span className="course-symbol" aria-hidden="true">
                <Icon name="courses" />
              </span>
              <span
                className={`course-membership ${!teacher && c.enrolled ? "is-enrolled" : ""}`}
              >
                {!teacher && c.enrolled && <Icon name="check" />}
                {teacher ? "我的授课" : c.enrolled ? "已选课程" : "可选课程"}
              </span>
            </div>
            <div className="course-card-copy">
              <h3>
                {teacher || c.enrolled ? (
                  <button
                    className="course-title-link"
                    onClick={() => open(c.id)}
                  >
                    {c.title}
                  </button>
                ) : (
                  c.title
                )}
              </h3>
              <p>{c.description || "暂无课程说明"}</p>
            </div>
            <dl className="course-card-metrics">
              <div>
                <dt>
                  <Icon name="user" />
                  选课学生
                </dt>
                <dd>
                  {c.studentCount}
                  <small>人</small>
                </dd>
              </div>
              <div>
                <dt>
                  <Icon name="assignments" />
                  课程作业
                </dt>
                <dd>
                  {c.assignmentCount}
                  <small>项</small>
                </dd>
              </div>
            </dl>
            <footer>
              <span className="course-teacher">
                <span className="course-teacher-avatar" aria-hidden="true">
                  {c.teacherName.slice(0, 1)}
                </span>
                <span>
                  {c.teacherName}
                  <small>授课教师</small>
                </span>
              </span>
              {teacher || c.enrolled ? (
                <button className="course-button" onClick={() => open(c.id)}>
                  进入课程
                  <Icon name="arrowRight" />
                </button>
              ) : (
                <button
                  className="course-button course-enroll-button"
                  disabled={!!busy}
                  onClick={() => void enroll(c)}
                >
                  <Icon name="plus" />
                  {busy === c.id ? "正在选课…" : "选择课程"}
                </button>
              )}
            </footer>
          </article>
        ))}
        {!shown.length && (
          <Empty
            text={
              search && scoped.length
                ? "没有匹配的课程，请修改关键词或清空搜索。"
                : teacher
                  ? "还没有课程，创建课程后即可发布作业。"
                  : tab === "selected"
                    ? "还没有选择课程，请到全部课程中选课。"
                    : "暂无课程，等待教师创建课程。"
            }
            action={
              search && scoped.length ? (
                <button className="course-button" onClick={clearSearch}>
                  清空搜索
                </button>
              ) : !teacher && tab === "selected" ? (
                <button className="course-button" onClick={() => setTab("all")}>
                  浏览全部课程
                </button>
              ) : undefined
            }
          />
        )}
      </div>
    </section>
  );
}
