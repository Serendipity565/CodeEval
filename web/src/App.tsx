import TeacherCourse from "./components/courses/TeacherCourse";
import Courses from "./components/courses/Courses";
import AssignmentProgress from "./components/courses/AssignmentProgress";
import AssignmentActions from "./components/assessment/AssignmentActions";
import { FormEvent, lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  Assignment,
  Course,
  AuthState as Auth,
  Rubric,
  Submission,
  TestCase,
  View,
} from "./types";
import { Authentication } from "./components/auth/Authentication";
import { apiRequest as req } from "./api/client";
import { clearAuth, loadAuth, saveAuth } from "./auth/storage";
import {
  Empty,
  Icon,
  Score,
  Title,
  WorkspaceSkeleton,
  SubmissionStatus,
} from "./components/ui";
import Home from "./components/Home";
import Dialog from "./components/ui/Dialog";
import TeacherAssessment, {
  FinalReview,
} from "./components/assessment/TeacherAssessment";
const CodeSimilarity = lazy(
  () => import("./components/similarity/CodeSimilarity"),
);
import SubmissionScore from "./components/assessment/SubmissionScore";
import EvaluationEvidence from "./components/assessment/EvaluationEvidence";
import {
  latestSubmissions,
  submissionAttempts,
  visibleSubmissions,
} from "./submissions";
import { useDeadlineClock } from "./hooks/useDeadlineClock";
import {
  dimensionUnscored,
  evaluationIncomplete,
  finalScore,
} from "./assessment";
import {
  coursePath,
  assignmentPath,
  assignmentHistoryPath,
  similarityPath,
  editPath,
  readWorkspaceRoute,
  submissionPath,
  viewPath,
} from "./navigation";
import {
  editorTemplate,
  executionContract,
} from "./components/editor/templates";
const CodeEditor = lazy(() => import("./components/editor/CodeEditor"));
const fmt = (x: string) =>
  new Date(x).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
function App() {
  const [a, setA] = useState<Auth | null>(loadAuth);
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    if (path === "/" || (a && (path === "/login" || path === "/register"))) {
      const next = a ? viewPath("home") : "/login";
      window.history.replaceState(window.history.state, "", next);
      setPath(next);
    }
  }, [a, path]);
  const navigate = (next: string, replace = false) => {
    if (window.location.pathname !== next) {
      window.history[replace ? "replaceState" : "pushState"](
        replace ? window.history.state : { from: window.location.pathname },
        "",
        next,
      );
    }
    setPath(next);
  };
  return a ? (
    <Workspace
      auth={a}
      path={path}
      navigate={navigate}
      logout={() => {
        clearAuth();
        setA(null);
        navigate("/login", true);
      }}
    />
  ) : (
    <Authentication
      page={path === "/register" ? "register" : "login"}
      navigate={navigate}
      done={(v) => {
        saveAuth(v);
        setA(v);
        navigate(
          path.startsWith("/workspace/") ||
            path.startsWith("/assignments/") ||
            path.startsWith("/submissions/") ||
            path.startsWith("/courses/")
            ? path
            : viewPath("home"),
          true,
        );
      }}
    />
  );
}
function Logo() {
  return (
    <div className="logo">
      <i aria-hidden="true">
        <img src="/favicon.svg" alt="" />
      </i>
      <span>
        CodeEval<span className="brand-period">.</span>
      </span>
    </div>
  );
}
function Workspace({
  auth,
  logout,
  path,
  navigate,
}: {
  auth: Auth;
  logout: () => void;
  path: string;
  navigate: (path: string, replace?: boolean) => void;
}) {
  const route = readWorkspaceRoute(path);
  const teacher = auth.user.role === "teacher",
    view = route.view,
    [as, setAs] = useState<Assignment[]>([]),
    [courses, setCourses] = useState<Course[]>([]),
    [ss, setSs] = useState<Submission[]>([]),
    [err, setErr] = useState(""),
    [loading, setLoading] = useState(true),
    [hasLoaded, setHasLoaded] = useState(false),
    selected = ss.find((item) => item.id === route.submissionId);
  const setView = (next: View) => navigate(viewPath(next));
  const activeView: View = route.courseId
    ? "courses"
    : view === "publish" || view === "edit" || view === "similarity"
      ? "assignments"
      : view;
  const ownedCourses = courses.filter(
    (item) => item.teacherId === String(auth.user.id),
  );
  const course = courses.find((c) => c.id === route.courseId);
  const courseAssignments = route.courseId
    ? as.filter((a) => a.courseId === route.courseId)
    : as;
  const publishInCourse = (next: View) =>
    next === "publish" && course
      ? navigate(`${coursePath(course.id)}/publish`)
      : setView(next);
  const backTo = (fallback: string) => {
    const from = window.history.state?.from;
    if (
      typeof from === "string" &&
      (from.startsWith("/workspace/") ||
        from.startsWith("/assignments/") ||
        from.startsWith("/submissions/") ||
        from.startsWith("/courses/"))
    ) {
      window.history.back();
    } else {
      navigate(fallback, true);
    }
  };
  const setSelected = (next: Submission | undefined) =>
    navigate(next ? submissionPath(next.id) : viewPath("submissions"));
  const upsertSubmission = (submission: Submission) => {
    setSs((current) => [
      submission,
      ...current.filter((item) => item.id !== submission.id),
    ]);
  };
  const load = () => {
    setLoading(true);
    return Promise.all([
      req("/assignments", auth.token),
      req("/submissions", auth.token),
      req("/courses", auth.token),
    ])
      .then(([a, s, c]) => {
        setCourses(c);
        setAs(a);
        setSs(s);
        setHasLoaded(true);
        setErr("");
      })
      .catch((e) =>
        setErr(e instanceof Error ? e.message : "数据加载失败，请稍后重试。"),
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, [auth.token, path]);
  useEffect(() => {
    if (
      !selected ||
      ["graded", "needs_review", "failed"].includes(selected.status)
    )
      return;
    const timer = window.setInterval(() => {
      void req<Submission[]>("/submissions", auth.token)
        .then((items) => setSs(items))
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [selected?.id, selected?.status, auth.token]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [path]);
  const initialLoading = loading && !hasLoaded;
  const stageKey = initialLoading
    ? "loading"
    : !hasLoaded
      ? "load-error"
      : path;
  return (
    <div
      className={`shell ${view === "publish" || view === "edit" ? "task-flow" : ""}`}
    >
      <aside className="side">
        <Logo />
        <span className="workspace-label">
          {teacher ? "教学空间" : "学习空间"}
        </span>
        <nav aria-label="主要导航">
          {(
            [
              ["home", "工作台"],
              ["courses", "课程"],
              ["assignments", teacher ? "作业" : "我的作业"],
              ["submissions", teacher ? "提交" : "提交记录"],
            ] as [View, string][]
          ).map(([v, n]) => (
            <button
              className={activeView === v ? "on" : ""}
              aria-current={activeView === v ? "page" : undefined}
              onClick={() => {
                setView(v);
              }}
              key={v}
            >
              <Icon
                name={
                  v === "home"
                    ? "home"
                    : v === "courses"
                      ? "courses"
                      : v === "assignments"
                        ? "assignments"
                        : "submissions"
                }
              />
              <span>{n}</span>
              {v === "submissions" && (
                <em>
                  {hasLoaded ? visibleSubmissions(ss, teacher).length : "—"}
                </em>
              )}
            </button>
          ))}
        </nav>
        <footer>
          <i>{auth.user.displayName[0]}</i>
          <span>
            <b>{auth.user.displayName}</b>
            <small>{teacher ? "教师账号" : "学生账号"}</small>
          </span>
          <button aria-label="退出登录" title="退出登录" onClick={logout}>
            <Icon name="logout" />
          </button>
        </footer>
      </aside>
      <main className="work">
        <header>
          <span>
            <span className="workspace-breadcrumb">
              {teacher ? "教学空间" : "学习空间"}
              <Icon name="chevronRight" />
            </span>
            <h1>
              {selected
                ? "提交详情"
                : {
                    home: "工作台",
                    courses: "课程",
                    assignments: "作业",
                    submissions: "提交记录",
                    publish: "发布作业",
                    edit: "修改作业",
                    similarity: "代码检测",
                  }[view]}
            </h1>
          </span>
          <div className="workspace-date">
            <Icon name="calendar" />
            <time dateTime={new Date().toISOString()}>
              {new Date().toLocaleDateString("zh-CN", {
                month: "long",
                day: "numeric",
                weekday: "long",
              })}
            </time>
          </div>
          <div className="header-account">
            <span>{auth.user.displayName[0]}</span>
            <b>{auth.user.displayName}</b>
            <small>{teacher ? "教师" : "学生"}</small>
            <button aria-label="退出登录" title="退出登录" onClick={logout}>
              <Icon name="logout" />
            </button>
          </div>
        </header>
        {err && (
          <div className="alert workspace-error" role="alert">
            <Icon name="alert" />
            <span>{err}</span>
            <button
              type="button"
              disabled={loading}
              onClick={() => void load()}
            >
              {loading ? "正在加载…" : "重新加载"}
            </button>
          </div>
        )}
        <div className="view-stage" key={stageKey} aria-busy={loading}>
          {initialLoading ? (
            <WorkspaceSkeleton
              variant={view === "home" ? "dashboard" : "list"}
            />
          ) : !hasLoaded ? (
            <section className="panel">
              <Title
                title="工作台暂时无法加载"
                note="数据尚未加载成功，请重新加载后继续。"
              />
            </section>
          ) : route.submissionId && !selected ? (
            <section className="panel">
              <Empty
                text="这份提交不存在或无法访问。"
                action={
                  <button
                    className="text-action"
                    onClick={() => setView("submissions")}
                  >
                    返回提交记录
                  </button>
                }
              />
            </section>
          ) : selected ? (
            <Detail
              sub={selected}
              assignment={as.find((a) => a.id === selected.assignmentId)}
              back={() => backTo(viewPath("submissions"))}
              key={selected.id}
              auth={auth}
              onUpdated={upsertSubmission}
              openHistory={
                !teacher
                  ? () => navigate(assignmentHistoryPath(selected.assignmentId))
                  : undefined
              }
            />
          ) : view === "similarity" ? (
            teacher &&
            as.some(
              (item) =>
                item.id === route.assignmentId &&
                item.teacherId === String(auth.user.id),
            ) ? (
              <Suspense
                fallback={
                  <section className="panel" role="status">
                    正在加载代码检测工作台…
                  </section>
                }
              >
                <CodeSimilarity
                  key={route.assignmentId}
                  assignment={as.find(
                    (item) => item.id === route.assignmentId,
                  )!}
                  submissions={ss}
                  token={auth.token}
                  back={() => backTo(viewPath("assignments"))}
                />
              </Suspense>
            ) : (
              <section className="panel">
                <Empty text="这项作业不存在或无权查看代码检测。" />
              </section>
            )
          ) : view === "courses" ? (
            route.courseId && view === "courses" ? (
              course && (teacher || course.enrolled) ? (
                <section className="course-detail-page">
                  <button className="back" onClick={() => setView("courses")}>
                    <Icon name="chevronLeft" />
                    返回课程
                  </button>
                  <div className="course-context">
                    <div className="course-context-copy">
                      <span className="course-context-label">
                        <Icon name="courses" />
                        课程详情
                      </span>
                      <h2>{course.title}</h2>
                      <span className="course-context-teacher">
                        <Icon name="user" />
                        {course.teacherName} · 授课教师
                      </span>
                      {course.description && <p>{course.description}</p>}
                    </div>
                    <dl className="course-context-metrics">
                      <div>
                        <dt>选课学生</dt>
                        <dd>
                          {course.studentCount}
                          <small>人</small>
                        </dd>
                      </div>
                      <div>
                        <dt>课程作业</dt>
                        <dd>
                          {course.assignmentCount}
                          <small>项</small>
                        </dd>
                      </div>
                    </dl>
                  </div>
                  {teacher ? (
                    <TeacherCourse course={course} token={auth.token}>
                      <TeacherAssignments
                        course={course}
                        as={courseAssignments}
                        ss={ss}
                        go={publishInCourse}
                        teacherId={String(auth.user.id)}
                        similarity={(id) => navigate(similarityPath(id))}
                        edit={(id) => navigate(assignmentPath(id))}
                      />
                    </TeacherCourse>
                  ) : (
                    <StudentAssignments
                      as={courseAssignments}
                      ss={ss}
                      open={(id) => navigate(assignmentPath(id))}
                      openHistory={(id) => navigate(assignmentHistoryPath(id))}
                      back={() => setView("courses")}
                      onSubmissionChange={upsertSubmission}
                      onCreated={(submission) =>
                        navigate(submissionPath(submission.id))
                      }
                    />
                  )}
                </section>
              ) : (
                <section className="panel">
                  <Empty
                    text="课程不存在或尚未选课。"
                    action={
                      <button onClick={() => setView("courses")}>
                        浏览课程
                      </button>
                    }
                  />
                </section>
              )
            ) : (
              <Courses
                courses={courses}
                teacher={teacher}
                token={auth.token}
                open={(id) => navigate(coursePath(id))}
                reload={load}
              />
            )
          ) : view === "home" ? (
            <Home
              teacher={teacher}
              as={as}
              ss={ss}
              go={setView}
              pick={setSelected}
            />
          ) : view === "assignments" ? (
            teacher && route.assignmentId ? (
              as.find((a) => a.id === route.assignmentId) ? (
                <AssignmentProgress
                  assignment={as.find((a) => a.id === route.assignmentId)!}
                  token={auth.token}
                  back={() => backTo(viewPath("assignments"))}
                  edit={() => navigate(editPath(route.assignmentId!))}
                  openSubmission={(id) => navigate(submissionPath(id))}
                />
              ) : (
                <Empty text="作业不存在或无权查看。" />
              )
            ) : teacher ? (
              <TeacherAssignments
                as={as}
                ss={ss}
                go={setView}
                teacherId={String(auth.user.id)}
                similarity={(id) => navigate(similarityPath(id))}
                edit={(id) => {
                  navigate(assignmentPath(id));
                }}
              />
            ) : (
              <StudentAssignments
                as={as}
                ss={ss}
                assignmentId={route.assignmentId}
                open={(id) => navigate(assignmentPath(id))}
                openHistory={(id) => navigate(assignmentHistoryPath(id))}
                back={() => backTo(viewPath("assignments"))}
                onSubmissionChange={upsertSubmission}
                onCreated={(submission) =>
                  navigate(submissionPath(submission.id))
                }
              />
            )
          ) : view === "submissions" ? (
            <Submissions
              teacher={teacher}
              as={as}
              ss={ss}
              pick={setSelected}
              assignmentId={route.assignmentId}
            />
          ) : view === "publish" ? (
            teacher &&
            (!route.courseId || course?.teacherId === String(auth.user.id)) ? (
              <Publish
                key={`publish-${route.courseId ?? "all"}`}
                token={auth.token}
                course={course}
                courses={ownedCourses}
                backLabel={course ? "返回课程作业" : "返回作业"}
                openCourses={() => setView("courses")}
                back={() =>
                  navigate(
                    course ? coursePath(course.id) : viewPath("assignments"),
                  )
                }
                done={async () => {
                  await load();
                  navigate(
                    course ? coursePath(course.id) : viewPath("assignments"),
                    true,
                  );
                }}
              />
            ) : (
              <Empty text="课程不存在或无权发布作业。" />
            )
          ) : teacher && as.some((a) => a.id === route.assignmentId) ? (
            <Publish
              token={auth.token}
              assignmentId={route.assignmentId}
              back={() => backTo(viewPath("assignments"))}
              done={async () => {
                await load();
                navigate(viewPath("assignments"), true);
              }}
            />
          ) : (
            <Empty text="无权访问此页面。" />
          )}
        </div>
        <footer className="workspace-footer">
          <span>
            CodeEval <span>·</span> 让反馈回到代码本身
          </span>
          <span>编程作业与评估工作台</span>
        </footer>
      </main>
    </div>
  );
}
function TeacherAssignments({
  as,
  ss,
  go,
  edit,
  similarity,
  teacherId,
  course,
}: {
  as: Assignment[];
  ss: Submission[];
  go: (v: View) => void;
  edit: (id: string) => void;
  similarity: (id: string) => void;
  teacherId: string;
  course?: Course;
}) {
  const [statuses, setStatuses] = useState<
      Record<string, Assignment["status"]>
    >({}),
    [message, setMessage] = useState("");
  async function changeStatus(a: Assignment, status: Assignment["status"]) {
    const previous = statuses[a.id] ?? a.status;
    setStatuses((v) => ({ ...v, [a.id]: status }));
    setMessage("");
    try {
      await req(`/assignments/${a.id}/status`, loadAuth()?.token || "", {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setMessage(`${a.title}已${status === "open" ? "开放" : "关闭"}提交`);
    } catch (e) {
      setStatuses((v) => ({ ...v, [a.id]: previous }));
      setMessage(e instanceof Error ? e.message : "状态更新失败");
    }
  }
  return (
    <section className="teacher-assignment-page">
      <Title
        title={course ? "课程作业" : "全部作业"}
        note={`共 ${as.length} 项作业 · 查看提交进度，管理教学评估`}
      >
        <button className="primary" onClick={() => go("publish")}>
          <Icon name="plus" />
          发布作业
        </button>
      </Title>
      {message && <p className="inline-message">{message}</p>}
      {as.length ? (
        <div className="assignment-collection">
          {as.map((a) => {
            const sub = ss.filter((s) => s.assignmentId === a.id),
              evaluated = sub.filter((s) => finalScore(s) !== undefined),
              avg = evaluated.length
                ? Math.round(
                    evaluated.reduce((n, s) => n + finalScore(s)!, 0) /
                      evaluated.length,
                  )
                : "—",
              status = statuses[a.id] ?? a.status;
            return (
              <article
                className="assignment-sheet"
                key={a.id}
                aria-label={a.title}
              >
                <div className="assignment-sheet-top">
                  <span className="assignment-language">
                    <Icon name="code" />
                    {a.language}
                  </span>
                  <span className="status-select-wrap">
                    <select
                      className={`status-select ${status}`}
                      aria-label={`${a.title}的提交状态`}
                      value={status}
                      onChange={(e) =>
                        void changeStatus(
                          a,
                          e.target.value as Assignment["status"],
                        )
                      }
                    >
                      <option value="open">开放提交</option>
                      <option value="closed">关闭提交</option>
                    </select>
                  </span>
                </div>
                <div className="assignment-sheet-body">
                  <div className="assignment-sheet-copy">
                    <h3>
                      <button type="button" onClick={() => edit(a.id)}>
                        {a.title}
                      </button>
                    </h3>
                    <p>
                      {a.courseTitle} · {a.description || "暂无作业说明"}
                    </p>
                  </div>
                  <dl className="assignment-sheet-metrics">
                    <div>
                      <dt>已提交 / 应提交</dt>
                      <dd>
                        {a.submittedStudents} / {a.expectedStudents}
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
                    <div>
                      <dt>平均得分</dt>
                      <dd>
                        {avg}
                        <small>/ 100</small>
                      </dd>
                    </div>
                  </dl>
                </div>
                <footer className="assignment-sheet-footer">
                  <span className="assignment-due">
                    <Icon name="calendar" />
                    <span>
                      截止时间 <b>{fmt(a.dueAt)}</b>
                    </span>
                  </span>
                  <AssignmentActions
                    title={a.title}
                    owner={a.teacherId === teacherId}
                    edit={() => edit(a.id)}
                    similarity={() => similarity(a.id)}
                  />
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          text="还没有发布作业。创建第一项作业，设置提交要求和评分标准。"
          action={
            <button
              type="button"
              className="primary"
              onClick={() => go("publish")}
            >
              <Icon name="plus" />
              发布第一项作业
            </button>
          }
        />
      )}
    </section>
  );
}
function StudentAssignments({
  as,
  ss,
  assignmentId,
  open,
  openHistory,
  back,
  onSubmissionChange,
  onCreated,
}: {
  as: Assignment[];
  ss: Submission[];
  assignmentId?: string;
  open: (id: string) => void;
  openHistory: (id: string) => void;
  back: () => void;
  onSubmissionChange: (submission: Submission) => void;
  onCreated: (submission: Submission) => void;
}) {
  const now = useDeadlineClock(as.map((a) => new Date(a.dueAt).getTime()));
  const [f, setF] = useState("all"),
    [teacher, setTeacher] = useState("all"),
    teachers = Array.from(
      new Map(
        as.map((a) => [a.teacherId, a.teacherName || "未命名教师"]),
      ).entries(),
    ),
    list = as.filter(
      (a) =>
        (teacher === "all" || a.teacherId === teacher) &&
        (f === "all" ||
          (f === "done") === ss.some((s) => s.assignmentId === a.id)),
    ),
    selected = as.find((a) => a.id === assignmentId);
  if (assignmentId && !selected)
    return (
      <section className="panel">
        <Empty
          text="这项作业不存在或无法访问。"
          action={
            <button className="text-action" onClick={back}>
              返回我的作业
            </button>
          }
        />
      </section>
    );
  if (selected)
    return (
      <div className="assignment-submit-view">
        <button className="back" onClick={back}>
          ‹ 返回我的作业
        </button>
        <Title
          title={selected.title}
          note={`${selected.teacherName || "未命名教师"} · ${selected.language} · 截止 ${fmt(selected.dueAt)}`}
        />
        <StudentSubmit
          assignments={[selected]}
          openHistory={() => openHistory(selected.id)}
          onSubmissionChange={onSubmissionChange}
          onCreated={onCreated}
        />
      </div>
    );
  return (
    <>
      <Title title="课程作业" note="选择作业进入代码编辑和提交界面">
        <div className="assignment-controls">
          <select
            aria-label="按教师筛选"
            value={teacher}
            onChange={(e) => setTeacher(e.target.value)}
          >
            <option value="all">全部教师</option>
            {teachers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <div className="tabs">
            {[
              ["all", "全部"],
              ["todo", "待提交"],
              ["done", "已提交"],
            ].map((x) => (
              <button
                className={f === x[0] ? "on" : ""}
                onClick={() => setF(x[0])}
                key={x[0]}
              >
                {x[1]}
              </button>
            ))}
          </div>
        </div>
      </Title>
      <div className="cards">
        {list.map((a) => {
          const submissions = ss.filter((s) => s.assignmentId === a.id),
            highest = submissions.reduce<number | undefined>(
              (best, s) =>
                finalScore(s) !== undefined
                  ? Math.max(best ?? 0, finalScore(s)!)
                  : best,
              undefined,
            ),
            expired = !(now < new Date(a.dueAt).getTime()),
            canSubmit =
              a.status === "open" &&
              !expired &&
              submissions.length < a.maxSubmissions;
          return (
            <article key={a.id}>
              <header>
                <b>
                  <Icon name="code" /> {a.language}
                </b>
                <i
                  className={`status ${a.status === "closed" || expired ? "closed" : submissions.length ? "done" : "open"}`}
                >
                  {a.status === "closed"
                    ? "已关闭"
                    : expired
                      ? "已截止"
                      : submissions.length
                        ? "已提交"
                        : "待提交"}
                </i>
              </header>
              <h3>{a.title}</h3>
              <p className="teacher-name">
                教师：{a.teacherName || "未命名教师"}
              </p>
              <p>{a.description || "教师暂未添加作业说明。"}</p>
              <div>
                {a.rubric.slice(0, 3).map((r) => (
                  <small key={r.key}>
                    {r.name} {r.weight}%
                  </small>
                ))}
              </div>
              <footer>
                <span>
                  已提交 {submissions.length}/{a.maxSubmissions} 次
                </span>
                <span className="card-actions">
                  {highest !== undefined && (
                    <span className="best-score">
                      最高 <Score n={highest} />
                    </span>
                  )}
                  {submissions.length > 0 && (
                    <button type="button" onClick={() => openHistory(a.id)}>
                      历史提交
                    </button>
                  )}
                  <button disabled={!canSubmit} onClick={() => open(a.id)}>
                    {expired
                      ? "已截止"
                      : submissions.length
                        ? "再次提交"
                        : "进入作业"}{" "}
                    ›
                  </button>
                </span>
              </footer>
            </article>
          );
        })}
        {!list.length && <Empty text="没有符合当前筛选条件的作业" />}
      </div>
    </>
  );
}
function Submissions({
  teacher,
  as,
  ss,
  pick,
  assignmentId,
}: {
  teacher: boolean;
  as: Assignment[];
  ss: Submission[];
  pick: (s: Submission) => void;
  assignmentId?: string;
}) {
  const [q, setQ] = useState(""),
    [aid, setAid] = useState(assignmentId ?? "all"),
    [scoreFilter, setScoreFilter] = useState("all"),
    [sort, setSort] = useState("newest");
  const attempts = useMemo(() => submissionAttempts(ss), [ss]);
  const latestIds = useMemo(
    () => new Set(latestSubmissions(ss).map((s) => s.id)),
    [ss],
  );
  const list = useMemo(
    () =>
      visibleSubmissions(ss, teacher)
        .filter(
          (s) =>
            (aid === "all" || s.assignmentId === aid) &&
            (scoreFilter === "all" ||
              (scoreFilter === "unscored"
                ? finalScore(s) === undefined
                : scoreFilter === "reviewed"
                  ? Boolean(s.review)
                  : finalScore(s) !== undefined && finalScore(s)! < 60)) &&
            (!q.trim() ||
              (s.studentName + as.find((a) => a.id === s.assignmentId)?.title)
                .toLowerCase()
                .includes(q.trim().toLowerCase())),
        )
        .sort((left, right) => {
          if (sort === "newest")
            return (
              new Date(right.submittedAt).getTime() -
              new Date(left.submittedAt).getTime()
            );
          const a = finalScore(left),
            b = finalScore(right);
          if (a === undefined) return b === undefined ? 0 : 1;
          if (b === undefined) return -1;
          return sort === "score-desc" ? b - a : a - b;
        }),
    [q, aid, ss, as, scoreFilter, sort, teacher],
  );
  return (
    <section className="panel list-page">
      <Title
        title={teacher ? "学生提交列表" : "我的提交记录"}
        note={
          teacher
            ? "每项作业仅显示每位学生的最新一次提交"
            : "查看全部历史提交，点击任一记录查看当次代码、测试结果和评分反馈"
        }
      />
      <div className="filters">
        <label>
          <Icon name="search" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={(e) => setQ(e.target.value.trim())}
            aria-label={teacher ? "搜索学生或作业" : "搜索作业"}
            placeholder={teacher ? "搜索学生或作业" : "搜索作业"}
          />
        </label>
        <select
          aria-label="按作业筛选"
          value={aid}
          onChange={(e) => setAid(e.target.value)}
        >
          <option value="all">全部作业</option>
          {as.map((a) => (
            <option value={a.id} key={a.id}>
              {a.title}
            </option>
          ))}
        </select>
        <select
          aria-label="按成绩筛选"
          value={scoreFilter}
          onChange={(event) => setScoreFilter(event.target.value)}
        >
          <option value="all">全部成绩</option>
          <option value="unscored">尚无最终成绩</option>
          <option value="low">低于 60 分</option>
          <option value="reviewed">教师已复核</option>
        </select>
        <select
          aria-label="提交排序"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="newest">最新提交优先</option>
          <option value="score-desc">最终成绩从高到低</option>
          <option value="score-asc">最终成绩从低到高</option>
        </select>
      </div>
      <div className="stable">
        <div className="srow th">
          <span>{teacher ? "学生" : "作业"}</span>
          <span>{teacher ? "作业" : "提交时间"}</span>
          <span>状态</span>
          <span>得分</span>
          <span />
        </div>
        {list.map((s) => (
          <button className="srow" onClick={() => pick(s)} key={s.id}>
            <span className="student">
              <i>
                {
                  (teacher
                    ? s.studentName
                    : as.find((a) => a.id === s.assignmentId)?.title || "作")[0]
                }
              </i>
              <b>
                {teacher
                  ? s.studentName
                  : as.find((a) => a.id === s.assignmentId)?.title}
              </b>
            </span>
            <span>
              {teacher
                ? as.find((a) => a.id === s.assignmentId)?.title
                : fmt(s.submittedAt)}
              <small>
                {teacher
                  ? fmt(s.submittedAt)
                  : `第 ${attempts.get(s.id)} 次提交${latestIds.has(s.id) ? " · 最新" : ""}`}
              </small>
            </span>
            <SubmissionStatus status={s.status} />
            <SubmissionScore submission={s} />
            <b>
              <Icon name="chevronRight" />
            </b>
          </button>
        ))}
      </div>
      {!list.length && <Empty text="没有符合条件的提交" />}
    </section>
  );
}
function StudentSubmit({
  assignments,
  openHistory,
  onSubmissionChange,
  onCreated,
}: {
  assignments: Assignment[];
  openHistory: () => void;
  onSubmissionChange: (submission: Submission) => void;
  onCreated: (submission: Submission) => void;
}) {
  const assignment = assignments[0],
    token = loadAuth()?.token || "",
    [history, setHistory] = useState<Submission[]>([]),
    [code, setCode] = useState(() =>
      editorTemplate(assignment?.language ?? ""),
    ),
    [briefOpen, setBriefOpen] = useState(false),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  const dueAt = new Date(assignment?.dueAt ?? "").getTime();
  const now = useDeadlineClock([dueAt]);
  const refresh = () =>
    req<Submission[]>("/submissions", token).then(setHistory);
  useEffect(() => {
    void refresh();
  }, []);
  const used = history.filter((s) => s.assignmentId === assignment?.id).length,
    expired = !(now < dueAt),
    canSubmit =
      !!assignment &&
      assignment.status === "open" &&
      !expired &&
      used < assignment.maxSubmissions;
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!assignment || busy) return;
    if (!(Date.now() < dueAt)) {
      setMsg("该作业已截止，无法提交");
      return;
    }
    if (!canSubmit || !code.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      const submission = await req<Submission>("/submissions", token, {
        method: "POST",
        body: JSON.stringify({ assignmentId: assignment.id, code }),
      });
      onSubmissionChange(submission);
      onCreated(submission);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="submit-layout">
      <aside className="panel assignment-brief">
        <button
          className="brief-toggle"
          type="button"
          aria-expanded={briefOpen}
          onClick={() => setBriefOpen((v) => !v)}
        >
          <span>
            <Icon name="assignments" />
            作业要求与评分标准
          </span>
          <Icon name="chevronRight" />
        </button>
        <div className={`brief-details ${briefOpen ? "open" : ""}`}>
          <span className="eyebrow">作业信息</span>
          <h3>{assignment?.title}</h3>
          <p>{assignment?.description || "教师暂未添加作业说明。"}</p>
          <div className="brief-meta">
            <span>
              <small>语言</small>
              <b>{assignment?.language}</b>
            </span>
            <span>
              <small>截止</small>
              <b>{assignment ? fmt(assignment.dueAt) : "—"}</b>
            </span>
            <span>
              <small>提交次数</small>
              <b>
                {used} / {assignment?.maxSubmissions ?? 0}
              </b>
            </span>
          </div>
          <div className="execution-contract">
            <b>运行约定</b>
            <p>{executionContract(assignment?.language ?? "")}</p>
          </div>
          <h4>评分标准</h4>
          <div className="brief-rubric">
            {(assignment?.rubric || []).map((r) => (
              <div key={r.key}>
                <span>
                  <b>{r.name}</b>
                  <strong>{r.weight}%</strong>
                </span>
                <p>{r.description}</p>
              </div>
            ))}
          </div>
          {assignment?.testCases?.length ? (
            <>
              <h4>公开测试用例</h4>
              <div className="brief-tests">
                {(assignment.testCases || []).map((test, index) => (
                  <article key={`${test.name}-${index}`}>
                    <b>{test.name}</b>
                    <span>
                      <em>输入</em>
                      <pre>{test.input || "（空输入）"}</pre>
                    </span>
                    <span>
                      <em>期望</em>
                      <pre>{test.expected || "（无输出）"}</pre>
                    </span>
                  </article>
                ))}
              </div>
            </>
          ) : null}
          {assignment?.hasHiddenTests && (
            <small className="hidden-tests-hint">
              另有隐藏测试用例，其输入输出不会公开。
            </small>
          )}
        </div>
      </aside>
      <section className="panel submitbox">
        <Title title="编写解答" note="完成代码后提交，查看测试结果与评估反馈。">
          <div className="submission-detail-actions">
            <button
              type="button"
              className="submission-action"
              onClick={openHistory}
            >
              <Icon name="clock" />
              历史提交
            </button>
            <span className="studio-availability">
              <i className={`availability ${canSubmit ? "open" : "closed"}`} />
              {assignment?.status === "closed"
                ? "提交已关闭"
                : expired
                  ? "已截止"
                  : `还可提交 ${Math.max(0, (assignment?.maxSubmissions ?? 0) - used)} 次`}
            </span>
          </div>
        </Title>
        <form onSubmit={send}>
          <Suspense
            fallback={<div className="editor-loading">正在加载代码编辑器…</div>}
          >
            <CodeEditor
              language={assignment?.language ?? "Plain text"}
              value={code}
              onChange={setCode}
              label="我的解答"
              height="520px"
            />
          </Suspense>
          <div className="editor-actions">
            <small>提交后将按评分量规运行测试并生成反馈</small>
            <button
              className="primary"
              disabled={busy || !canSubmit || !code.trim()}
            >
              {busy ? (
                "正在评估…"
              ) : (
                <>
                  提交并评估
                  <Icon name="chevronRight" />
                </>
              )}
            </button>
          </div>
        </form>
        {!canSubmit && (
          <small className="attempt-hint limit">
            {assignment?.status === "closed"
              ? "该作业当前已关闭提交"
              : expired
                ? "该作业已截止，无法提交"
                : "已达到该作业的提交次数上限"}
          </small>
        )}
        {msg && <small className="submitmsg">{msg}</small>}
      </section>
    </div>
  );
}
function Detail({
  sub,
  assignment,
  back,
  auth,
  onUpdated,
  openHistory,
}: {
  sub: Submission;
  assignment?: Assignment;
  back: () => void;
  auth: Auth;
  onUpdated: (submission: Submission) => void;
  openHistory?: () => void;
}) {
  const [codeOpen, setCodeOpen] = useState(false);
  return (
    <>
      <button className="back" onClick={back}>
        <Icon name="chevronLeft" />
        返回
      </button>
      <Title
        title={assignment?.title || "作业提交"}
        note={`${sub.studentName} · ${fmt(sub.submittedAt)}`}
      >
        <div className="submission-detail-actions">
          <SubmissionStatus status={sub.status} />
          {openHistory && (
            <button
              type="button"
              className="submission-action"
              onClick={openHistory}
            >
              <Icon name="clock" />
              历史提交
            </button>
          )}
          <button
            type="button"
            className="submission-action"
            aria-haspopup="dialog"
            onClick={() => setCodeOpen(true)}
          >
            <Icon name="code" />
            查看代码
          </button>
          {auth.user.role === "teacher" &&
            assignment?.teacherId === String(auth.user.id) &&
            sub.evaluation &&
            ["graded", "needs_review"].includes(sub.status) && (
              <TeacherAssessment
                token={auth.token}
                submission={sub}
                onUpdated={onUpdated}
              />
            )}
        </div>
      </Title>
      {sub.review && <FinalReview review={sub.review} />}
      <div className="detail">
        <section
          className="panel feedback-panel evaluation-report"
          aria-label="原始自动评估"
        >
          <div className="feedback-head">
            <span>
              <small>{sub.review ? "保留原始记录" : "评估结果"}</small>
              <h3>原始自动评估</h3>
            </span>
            {sub.evaluation && (
              <div className="score-orb">
                <small>原始总分</small>
                {evaluationIncomplete(sub.evaluation) ? (
                  <span className="score-placeholder">未形成总分</span>
                ) : (
                  <Score
                    n={sub.evaluation.total}
                    max={sub.evaluation.maxTotal}
                  />
                )}
              </div>
            )}
          </div>
          {sub.evaluation ? (
            <>
              {evaluationIncomplete(sub.evaluation) && (
                <div className="report-notice">
                  <Icon name="alert" />
                  <p>
                    <b>部分维度尚未评分</b>
                    <span>
                      未评分项目不按零分计算。
                      {sub.review
                        ? "教师已完成复核，最终成绩以上方复核结果为准。"
                        : "尚无有效自动总分，等待教师复核。"}
                    </span>
                  </p>
                </div>
              )}
              <div className="report-summary">
                <div className="report-section-heading">
                  <h4>评估概览</h4>
                  <span>
                    置信度 {Math.round((sub.evaluation.confidence || 0) * 100)}%
                  </span>
                </div>
                <p className="feedback-summary">{sub.evaluation.summary}</p>
                <div className="report-provenance">
                  <div className="evaluation-meta">
                    <span>
                      {sub.evaluation.execution
                        ? "有沙箱执行证据"
                        : "无沙箱执行证据"}
                    </span>
                    <span>评估来源 · {sub.evaluation.provider}</span>
                    {sub.evaluation.promptVersion && (
                      <span>版本 · {sub.evaluation.promptVersion}</span>
                    )}
                  </div>
                  {sub.evaluation.contextSources?.length ? (
                    <p className="evaluation-context">
                      <b>本次评估依据</b>
                      {sub.evaluation.contextSources.map((source) => (
                        <span key={source}>
                          {{
                            assignment_instructions: "作业说明",
                            grading_rubric: "评分量规",
                            reference_solution: "参考实现",
                            course_knowledge_base: "课程知识库",
                            knowledge_base: "课程知识库",
                            test_cases: "测试用例",
                          }[source] || source}
                        </span>
                      ))}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="feedback-overview">
                {sub.evaluation.strengths?.length ? (
                  <FeedbackGroup
                    kind="good"
                    title="做得好的地方"
                    items={sub.evaluation.strengths}
                  />
                ) : null}
                {sub.evaluation.issues?.length ? (
                  <FeedbackGroup
                    kind="issue"
                    title="需要改进"
                    items={sub.evaluation.issues}
                  />
                ) : null}
                {sub.evaluation.improvements?.length ? (
                  <FeedbackGroup
                    kind="improve"
                    title="建议下一步"
                    items={sub.evaluation.improvements}
                  />
                ) : null}
              </div>
              <EvaluationEvidence evaluation={sub.evaluation} />
              <div className="dimension-list">
                <div className="report-section-heading">
                  <h4>评分明细</h4>
                  <span>{sub.evaluation.dimensions.length} 个维度</span>
                </div>
                {sub.evaluation.dimensions.map((d, index) => {
                  const unscored = dimensionUnscored(sub.evaluation!, d);
                  const criterion =
                    d.criterion ||
                    assignment?.rubric.find((r) => r.key === d.key)
                      ?.description;
                  return (
                    <section
                      className={`dimension${unscored ? " is-unscored" : ""}`}
                      key={d.key}
                      aria-label={d.name}
                    >
                      <header className="dimension-heading">
                        <h5>
                          <span className="dimension-number">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          {d.name}
                        </h5>
                        <strong>
                          {unscored ? (
                            <span className="dimension-unscored">未评分</span>
                          ) : (
                            <>
                              {d.score}
                              <small> / {d.maxScore}</small>
                            </>
                          )}
                        </strong>
                      </header>
                      {!unscored && (
                        <div className="dimension-meter" aria-hidden="true">
                          <span
                            style={{
                              width: `${d.maxScore > 0 ? Math.max(0, Math.min(100, (d.score / d.maxScore) * 100)) : 0}%`,
                            }}
                          />
                        </div>
                      )}
                      <div className="dimension-content">
                        {criterion && (
                          <p className="criterion">
                            <em>教师评判标准</em>
                            {criterion}
                          </p>
                        )}
                        <p>
                          <em>评价依据</em>
                          {d.evidence}
                        </p>
                        {d.suggestion && (
                          <small className="dimension-suggestion">
                            <b>改进建议</b>
                            {d.suggestion}
                          </small>
                        )}
                      </div>
                      {((d.evidenceType && d.evidenceType !== "未标注") ||
                        d.confidence > 0 ||
                        d.verified) && (
                        <small className="dimension-meta">
                          证据：{d.evidenceType || "未标注"} · 置信度{" "}
                          {Math.round((d.confidence || 0) * 100)}% ·{" "}
                          {d.verified ? "已验证" : "未执行验证"}
                        </small>
                      )}
                    </section>
                  );
                })}
              </div>
            </>
          ) : (
            <EvaluationProgress submission={sub} />
          )}
        </section>
        {codeOpen && (
          <Dialog
            title="提交代码"
            note={`${sub.studentName} · ${assignment?.language || "代码"} · ${sub.code.split("\n").length} 行`}
            wide
            flush
            onClose={() => setCodeOpen(false)}
          >
            <div className="submitted-code-layout">
              <aside className="submitted-brief">
                <span className="eyebrow">作业信息</span>
                <h3>{assignment?.title || "题目说明"}</h3>
                <p>{assignment?.description || "教师暂未添加作业说明。"}</p>
                <div className="brief-meta">
                  <span>
                    <small>语言</small>
                    <b>{assignment?.language || "—"}</b>
                  </span>
                  <span>
                    <small>截止</small>
                    <b>{assignment ? fmt(assignment.dueAt) : "—"}</b>
                  </span>
                </div>
                {assignment?.rubric.length ? (
                  <>
                    <h4>评分标准</h4>
                    <div className="brief-rubric">
                      {assignment.rubric.map((r) => (
                        <div key={r.key}>
                          <span>
                            <b>{r.name}</b>
                            <strong>{r.weight}%</strong>
                          </span>
                          <p>{r.description}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </aside>
              <div className="submitted-code">
                <Suspense
                  fallback={
                    <div className="editor-loading">正在加载代码高亮…</div>
                  }
                >
                  <CodeEditor
                    language={assignment?.language ?? "Plain text"}
                    value={sub.code}
                    label="提交快照"
                    execution={sub.evaluation?.execution}
                    readOnly
                    allowFullscreen={false}
                    height="530px"
                  />
                </Suspense>
              </div>
            </div>
          </Dialog>
        )}
      </div>
    </>
  );
}
function FeedbackGroup({
  title,
  items,
  kind,
}: {
  title: string;
  items: string[];
  kind: "good" | "issue" | "improve";
}) {
  return (
    <section className={`feedback-group ${kind}`}>
      <h4>
        <Icon
          name={
            kind === "good"
              ? "check"
              : kind === "issue"
                ? "alert"
                : "arrowRight"
          }
        />
        {title}
      </h4>
      <ul>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
function EvaluationProgress({ submission }: { submission: Submission }) {
  const failed = submission.status === "failed",
    progress = submission.progress || 10,
    label =
      submission.status === "queued"
        ? "已收到提交，等待评估"
        : submission.status === "evaluating"
          ? "模型正在阅读并评估代码"
          : failed
            ? "评估失败"
            : "正在准备评估";
  return (
    <div className={`evaluation-progress ${failed ? "failed" : ""}`}>
      <span className="progress-icon">{failed ? "!" : "✦"}</span>
      <h3>{label}</h3>
      <p>
        {failed
          ? "模型评估未能完成，请稍后重新提交或联系教师。"
          : "页面会自动更新，你可以留在这里查看实时状态。"}
      </p>
      <div className="progress-track">
        <i style={{ width: `${progress}%` }} />
      </div>
      <footer>
        <span>
          {failed
            ? "已停止"
            : submission.status === "queued"
              ? "排队中"
              : "分析代码 · 对照评分量规 · 生成反馈"}
        </span>
        <b>{progress}%</b>
      </footer>
    </div>
  );
}
function Publish({
  token,
  done,
  assignmentId,
  course,
  back,
  courses = [],
  openCourses,
  backLabel = "返回作业",
}: {
  token: string;
  course?: Course;
  done: () => Promise<void>;
  assignmentId?: string;
  back?: () => void;
  courses?: Course[];
  openCourses?: () => void;
  backLabel?: string;
}) {
  const [materialDialog, setMaterialDialog] = useState<
    "reference" | "knowledge" | null
  >(null);
  const [materialDraft, setMaterialDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [testGenerationError, setTestGenerationError] = useState("");
  const [t, setT] = useState(""),
    [courseID, setCourseID] = useState(
      course?.id || (courses.length === 1 ? courses[0].id : ""),
    ),
    [courseTitle, setCourseTitle] = useState(course?.title || ""),
    [lang, setLang] = useState("Python"),
    [languages, setLanguages] = useState<string[]>([]),
    [desc, setDesc] = useState(""),
    [referenceSolution, setReferenceSolution] = useState(""),
    [knowledgeBase, setKnowledgeBase] = useState(""),
    [due, setDue] = useState(""),
    [max, setMax] = useState(3),
    [status, setStatus] = useState<Assignment["status"]>("open"),
    [llm, setLlm] = useState(true),
    [tests, setTests] = useState<TestCase[]>([]),
    [generatingTests, setGeneratingTests] = useState(false),
    [err, setErr] = useState(""),
    [rubric, setRubric] = useState<Rubric[]>([
      {
        key: "correctness",
        name: "功能实现",
        description: "功能符合题目要求",
        weight: 60,
      },
      {
        key: "quality",
        name: "代码质量",
        description: "结构清晰、命名合理、易于维护",
        weight: 40,
      },
    ]);
  useEffect(() => {
    void req<{ supportedLanguages: string[] }>("/capabilities", token)
      .then((result) => {
        setLanguages(result.supportedLanguages);
        if (
          result.supportedLanguages.length &&
          !result.supportedLanguages.includes(lang)
        )
          setLang(result.supportedLanguages[0]);
      })
      .catch((e) =>
        setErr(e instanceof Error ? e.message : "读取服务器语言配置失败"),
      );
  }, [token]);
  useEffect(() => {
    if (!assignmentId) return;
    setErr("");
    void req<Assignment>(`/assignments/${assignmentId}`, token)
      .then((item) => {
        setCourseID(item.courseId);
        setCourseTitle(item.courseTitle);
        setT(item.title);
        setLang(item.language);
        setDesc(item.description);
        setReferenceSolution(item.referenceSolution || "");
        setKnowledgeBase(item.knowledgeBase || "");
        const date = new Date(item.dueAt);
        date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
        setDue(date.toISOString().slice(0, 16));
        setMax(item.maxSubmissions);
        setStatus(item.status);
        setLlm(item.llmEvaluationEnabled);
        setTests(item.testCases || []);
        setRubric(item.rubric);
      })
      .catch((e) =>
        setErr(e instanceof Error ? e.message : "读取作业详情失败"),
      );
  }, [assignmentId, token]);
  const total = rubric.reduce((n, r) => n + r.weight, 0),
    update = (index: number, patch: Partial<Rubric>) =>
      setRubric((items) =>
        items.map((r, i) => (i === index ? { ...r, ...patch } : r)),
      ),
    remove = (index: number) =>
      setRubric((items) => items.filter((_, i) => i !== index)),
    add = () =>
      setRubric((items) => [
        ...items,
        {
          key: `criterion_${Date.now()}`,
          name: "",
          description: "",
          weight: 0,
        },
      ]);
  const addTest = () =>
    setTests((items) => [
      ...items,
      {
        name: `测试 ${items.length + 1}`,
        input: "",
        expected: "",
        hidden: true,
        weight: 1,
        timeoutMs: 2000,
      },
    ]);
  const updateTest = (index: number, patch: Partial<TestCase>) =>
    setTests((items) =>
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  async function generateTests() {
    if (!t.trim() || !desc.trim()) {
      setTestGenerationError("请先填写作业标题和说明，再生成测试用例。");
      return;
    }
    setGeneratingTests(true);
    setTestGenerationError("");
    try {
      const result = await req<{ testCases: TestCase[] }>(
        "/assignments/generate-tests",
        token,
        {
          method: "POST",
          body: JSON.stringify({
            title: t.trim(),
            language: lang,
            description: desc.trim(),
            referenceSolution,
          }),
        },
      );
      setTests(result.testCases);
    } catch (e) {
      setTestGenerationError(
        e instanceof Error ? e.message : "AI 生成测试用例失败",
      );
    } finally {
      setGeneratingTests(false);
    }
  }
  async function go(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!assignmentId && !courses.some((item) => item.id === courseID)) {
      setErr("请选择您授课的课程");
      return;
    }
    if (!t.trim()) {
      setErr("请填写作业标题");
      return;
    }
    if (rubric.some((item) => !item.name.trim() || !item.description.trim())) {
      setErr("请填写评分项名称和评判标准说明");
      return;
    }
    if (tests.some((test) => !test.name.trim())) {
      setErr("请填写测试用例名称");
      return;
    }
    if (total !== 100) {
      setErr("评分项权重之和必须为 100%");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      await req(
        assignmentId ? `/assignments/${assignmentId}` : "/assignments",
        token,
        {
          method: assignmentId ? "PUT" : "POST",
          body: JSON.stringify({
            courseId: courseID,
            title: assignmentId ? t : t.trim(),
            language: lang,
            description: desc.trim(),
            status,
            maxSubmissions: max,
            dueAt: new Date(due).toISOString(),
            llmEvaluationEnabled: llm,
            referenceSolution,
            knowledgeBase: knowledgeBase.trim(),
            testCases: tests.map((test) => ({
              ...test,
              name: test.name.trim(),
            })),
            rubric: rubric.map((item) => ({
              ...item,
              name: item.name.trim(),
              description: item.description.trim(),
            })),
          }),
        },
      );
      await done();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "发布失败");
    } finally {
      setSaving(false);
    }
  }
  if (!assignmentId && !course && !courses.length) {
    return (
      <section className="panel">
        {back && (
          <button className="back" onClick={back}>
            <Icon name="chevronLeft" />
            返回作业
          </button>
        )}
        <Title
          title="发布作业"
          note="每项作业需要归属一门课程，学生选课后才能提交。"
        />
        <Empty
          text="您还没有授课课程，请先创建课程，再发布作业。"
          action={
            openCourses && (
              <button className="primary" onClick={openCourses}>
                前往课程页创建课程
              </button>
            )
          }
        />
      </section>
    );
  }
  const selectedCourseTitle =
    courseTitle ||
    courses.find((item) => item.id === courseID)?.title ||
    "尚未选择课程";
  const sections = [
    ["assignment-basic", "基本信息"],
    ["assignment-content", "题目与资料"],
    ["assignment-rubric", "评分标准"],
    ["assignment-tests", "测试用例"],
    ["assignment-evaluation", "评估与提交"],
  ];
  return (
    <div className="assignment-builder">
      <header className="builder-page-heading">
        <div>
          <h2>{assignmentId ? "编辑作业" : "发布新作业"}</h2>
          <p>设置清晰的任务要求、评分标准和提交规则。</p>
        </div>
        {back && (
          <button
            className="back builder-back"
            onClick={back}
            disabled={saving}
          >
            <Icon name="chevronLeft" />
            {backLabel}
          </button>
        )}
      </header>
      <div className="publish-layout">
        <section className="publish">
          <form onSubmit={go} aria-busy={saving}>
            <section className="builder-section" id="assignment-basic">
              <BuilderSectionHeading
                number="01"
                title="基本信息"
                note="选择课程，设置作业名称和提交期限。"
              />
              <div className="builder-fields">
                <label className="wide builder-title-field">
                  <span className="builder-label-text">
                    作业标题 <i aria-hidden="true">*</i>
                  </span>
                  {assignmentId ? (
                    <span className="read-only-field">
                      <b>{t || "正在读取作业…"}</b>
                      <small>发布后不可修改</small>
                    </span>
                  ) : (
                    <input
                      required
                      aria-label="作业标题"
                      value={t}
                      onChange={(event) => setT(event.target.value)}
                      onBlur={(event) => setT(event.target.value.trim())}
                      placeholder="为这次练习起一个清晰的名称"
                    />
                  )}
                </label>
                <label>
                  <span className="builder-label-text">
                    所属课程 <i aria-hidden="true">*</i>
                  </span>
                  {assignmentId || course ? (
                    <span className="read-only-field">
                      <Icon name="courses" />
                      <b>{selectedCourseTitle}</b>
                    </span>
                  ) : (
                    <span className="builder-control-with-icon">
                      <Icon name="courses" />
                      <select
                        required
                        aria-label="所属课程"
                        value={courseID}
                        onChange={(event) => setCourseID(event.target.value)}
                      >
                        <option value="" disabled>
                          请选择授课课程
                        </option>
                        {courses.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title}
                          </option>
                        ))}
                      </select>
                    </span>
                  )}
                </label>
                <label>
                  <span className="builder-label-text">
                    编程语言 <i aria-hidden="true">*</i>
                  </span>
                  {assignmentId ? (
                    <span className="read-only-field">
                      <Icon name="code" />
                      <b>{lang || "—"}</b>
                      <small>发布后不可修改</small>
                    </span>
                  ) : (
                    <span className="builder-control-with-icon">
                      <Icon name="code" />
                      <select
                        aria-label="编程语言"
                        value={lang}
                        onChange={(event) => setLang(event.target.value)}
                      >
                        {languages.map((language) => (
                          <option key={language}>{language}</option>
                        ))}
                      </select>
                    </span>
                  )}
                </label>
                <div className="builder-schedule wide">
                  <div className="builder-schedule-caption">
                    <Icon name="clock" />
                    <span>提交安排</span>
                  </div>
                  <div className="builder-schedule-fields">
                    <label>
                      截止时间
                      <input
                        required
                        aria-label="截止时间"
                        type="datetime-local"
                        value={due}
                        onChange={(event) => setDue(event.target.value)}
                      />
                      <small>学生需在此时间前完成提交</small>
                    </label>
                    <label>
                      每名学生最多提交次数
                      <span className="builder-unit-input">
                        <input
                          required
                          aria-label="每名学生最多提交次数"
                          type="number"
                          min="1"
                          max="100"
                          value={max}
                          onChange={(event) =>
                            setMax(Number(event.target.value))
                          }
                        />
                        <span>次</span>
                      </span>
                      <small>允许学生在截止前修改并重新提交</small>
                    </label>
                  </div>
                </div>
              </div>
            </section>
            <section className="builder-section" id="assignment-content">
              <BuilderSectionHeading
                number="02"
                title="题目与资料"
                note="说明任务要求，按需补充评分时使用的教学资料。"
              />
              <label className="builder-description">
                作业说明
                <textarea
                  rows={7}
                  value={desc}
                  onChange={(event) => setDesc(event.target.value)}
                  onBlur={(event) => setDesc(event.target.value.trim())}
                  placeholder={
                    "建议包含以下内容：\n· 需要完成的任务\n· 输入、输出格式和示例\n· 约束条件与边界情况"
                  }
                />
              </label>
              <div className="builder-materials-heading">
                <span>辅助资料</span>
                <small>
                  <Icon name="eyeOff" />
                  仅教师与评估流程可见
                </small>
              </div>
              <div className="builder-materials">
                {(
                  [
                    [
                      "reference",
                      "参考实现",
                      "提供参考代码，辅助核查解答。",
                      referenceSolution,
                      "code",
                    ],
                    [
                      "knowledge",
                      "课程知识库",
                      "补充知识点、评分边界与常见错误。",
                      knowledgeBase,
                      "courses",
                    ],
                  ] as const
                ).map(([kind, name, note, value, icon]) => (
                  <div className="builder-material" key={kind}>
                    <span className="builder-material-icon">
                      <Icon name={icon} />
                    </span>
                    <div>
                      <b>{name}</b>
                      <p>
                        {value.trim()
                          ? `已添加 · ${value.split("\n").length} 行`
                          : note}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="builder-text-button"
                      aria-haspopup="dialog"
                      aria-label={`${value.trim() ? "编辑" : "添加"}${name}`}
                      onClick={() => {
                        setMaterialDraft(value);
                        setMaterialDialog(kind);
                      }}
                    >
                      <Icon name={value.trim() ? "settings" : "plus"} />
                      {value.trim() ? "编辑" : "添加"}
                    </button>
                  </div>
                ))}
              </div>
            </section>
            <section className="builder-section" id="assignment-rubric">
              <BuilderSectionHeading
                number="03"
                title="评分标准"
                note="明确每个评分项及其权重，合计为 100%。"
              >
                <span
                  className={`builder-total ${total === 100 ? "valid" : "invalid"}`}
                >
                  <Icon name={total === 100 ? "check" : "alert"} />
                  合计 {total}%
                </span>
              </BuilderSectionHeading>
              <div className="builder-weight-bar" aria-hidden="true">
                {rubric.map((item, index) => (
                  <span
                    key={item.key}
                    style={{
                      width: `${(Math.max(0, item.weight) / Math.max(100, total)) * 100}%`,
                      opacity: 1 - (index % 4) * 0.18,
                    }}
                  />
                ))}
              </div>
              <div className="builder-rubric-list">
                {rubric.map((r, index) => (
                  <div className="builder-rubric-row" key={r.key}>
                    <label>
                      评分项
                      <input
                        required
                        aria-label={`评分项 ${index + 1} 名称`}
                        value={r.name}
                        onBlur={(event) =>
                          update(index, { name: event.target.value.trim() })
                        }
                        onChange={(event) =>
                          update(index, { name: event.target.value })
                        }
                        placeholder="例如：功能实现"
                      />
                    </label>
                    <label>
                      评判标准
                      <input
                        required
                        aria-label={`评分项 ${index + 1} 评判标准`}
                        value={r.description}
                        onBlur={(event) =>
                          update(index, {
                            description: event.target.value.trim(),
                          })
                        }
                        onChange={(event) =>
                          update(index, { description: event.target.value })
                        }
                        placeholder="说明达到该评分项的要求"
                      />
                    </label>
                    <label>
                      权重
                      <span className="builder-unit-input">
                        <input
                          required
                          aria-label={`评分项 ${index + 1} 权重`}
                          type="number"
                          min="1"
                          max="100"
                          value={r.weight}
                          onChange={(event) =>
                            update(index, {
                              weight: Number(event.target.value),
                            })
                          }
                        />
                        <span>%</span>
                      </span>
                    </label>
                    <button
                      type="button"
                      className="builder-remove"
                      aria-label={`删除评分项 ${index + 1}`}
                      title="删除评分项"
                      disabled={rubric.length === 1}
                      onClick={() => remove(index)}
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                ))}
              </div>
              <button className="builder-add" type="button" onClick={add}>
                <Icon name="plus" />
                添加评分项
              </button>
            </section>
            <section className="builder-section" id="assignment-tests">
              <BuilderSectionHeading
                number="04"
                title="测试用例"
                note="使用输入和期望输出，验证程序的运行结果。"
              >
                <button
                  className="builder-secondary"
                  type="button"
                  disabled={generatingTests}
                  onClick={generateTests}
                  aria-describedby={
                    testGenerationError ? "test-generation-error" : undefined
                  }
                >
                  <Icon name="refresh" />
                  {generatingTests
                    ? "正在生成…"
                    : tests.length
                      ? "重新生成草稿"
                      : "AI 生成用例"}
                </button>
              </BuilderSectionHeading>
              {testGenerationError && (
                <div
                  className="builder-generation-error"
                  id="test-generation-error"
                  role="alert"
                >
                  <Icon name="alert" />
                  <span>{testGenerationError}</span>
                  {(!t.trim() || !desc.trim()) && (
                    <a
                      href={
                        !t.trim() ? "#assignment-basic" : "#assignment-content"
                      }
                    >
                      去填写
                      <Icon name="arrowUpRight" />
                    </a>
                  )}
                </div>
              )}
              <p className="builder-test-hint">
                <Icon name="code" />
                {executionContract(lang)}
              </p>
              {!tests.length && (
                <div className="builder-tests-empty">
                  <Icon name="code" />
                  <b>从一个测试用例开始</b>
                  <p>可手动添加，也可让 AI 生成草稿后再核对。</p>
                </div>
              )}
              <div className="builder-test-list">
                {tests.map((test, index) => (
                  <article className="builder-case-card" key={index}>
                    <header className="builder-case-heading">
                      <span className="builder-case-index">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <label className="builder-case-name">
                        <span className="sr-only">用例名称</span>
                        <input
                          required
                          aria-label={`测试用例 ${index + 1} 名称`}
                          value={test.name}
                          onBlur={(event) =>
                            updateTest(index, {
                              name: event.target.value.trim(),
                            })
                          }
                          onChange={(event) =>
                            updateTest(index, { name: event.target.value })
                          }
                          placeholder="为测试用例命名"
                        />
                      </label>
                      <span
                        className={`builder-case-badge ${test.hidden ? "hidden" : "public"}`}
                      >
                        {test.hidden ? "隐藏用例" : "公开用例"}
                      </span>
                      <button
                        type="button"
                        className="builder-remove"
                        aria-label={`删除测试用例 ${index + 1}`}
                        title="删除此用例"
                        onClick={() =>
                          setTests((items) =>
                            items.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Icon name="close" />
                      </button>
                    </header>
                    <div className="builder-case-io">
                      <label>
                        <span>
                          <Icon name="code" />
                          标准输入
                        </span>
                        <textarea
                          aria-label={`测试用例 ${index + 1} 标准输入`}
                          value={test.input}
                          onChange={(event) =>
                            updateTest(index, { input: event.target.value })
                          }
                          placeholder={"输入程序运行时读取的数据\n例如：1 2"}
                        />
                      </label>
                      <label>
                        <span>
                          <Icon name="check" />
                          期望输出
                        </span>
                        <textarea
                          aria-label={`测试用例 ${index + 1} 期望输出`}
                          value={test.expected}
                          onChange={(event) =>
                            updateTest(index, { expected: event.target.value })
                          }
                          placeholder={"输入正确运行时应输出的结果\n例如：3"}
                        />
                      </label>
                    </div>
                    <footer className="builder-case-settings">
                      <div className="builder-case-parameters">
                        <label>
                          用例权重
                          <input
                            aria-label={`测试用例 ${index + 1} 权重`}
                            type="number"
                            min="1"
                            max="100"
                            value={test.weight}
                            onChange={(event) =>
                              updateTest(index, {
                                weight: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          运行超时
                          <span className="builder-unit-input">
                            <input
                              aria-label={`测试用例 ${index + 1} 超时毫秒`}
                              type="number"
                              min="100"
                              max="10000"
                              step="100"
                              value={test.timeoutMs}
                              onChange={(event) =>
                                updateTest(index, {
                                  timeoutMs: Number(event.target.value),
                                })
                              }
                            />
                            <span>ms</span>
                          </span>
                        </label>
                      </div>
                      <label className="builder-case-visibility">
                        <input
                          type="checkbox"
                          checked={test.hidden}
                          onChange={(event) =>
                            updateTest(index, { hidden: event.target.checked })
                          }
                        />
                        <span>
                          <b>设为隐藏用例</b>
                          <small>
                            {test.hidden
                              ? "输入和期望输出不向学生公开"
                              : "学生可查看此用例的输入和期望输出"}
                          </small>
                        </span>
                      </label>
                    </footer>
                  </article>
                ))}
              </div>
              <button className="builder-add" type="button" onClick={addTest}>
                <Icon name="plus" />
                添加测试用例
              </button>
            </section>
            <section className="builder-section" id="assignment-evaluation">
              <BuilderSectionHeading
                number="05"
                title="评估与提交"
                note="设置评估方式，以及发布后的提交状态。"
              />
              <label className="builder-switch">
                <span>
                  <b>模型辅助评估</b>
                  <small>
                    结合评分标准和教学资料，生成评价依据与改进建议。
                  </small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={llm}
                  onChange={(event) => setLlm(event.target.checked)}
                />
                <i className="builder-switch-track" aria-hidden="true" />
              </label>
              <div className="builder-release-row">
                <label>
                  提交开放状态
                  <select
                    value={status}
                    onChange={(event) =>
                      setStatus(event.target.value as Assignment["status"])
                    }
                  >
                    <option value="open">发布后立即开放</option>
                    <option value="closed">暂不开放提交</option>
                  </select>
                </label>
                <p>
                  {status === "open"
                    ? "发布后，选课学生即可在截止时间前提交解答。"
                    : "作业发布后暂不接收提交，可在作业列表中手动开放。"}
                </p>
              </div>
            </section>
            {err && (
              <p className="builder-error" role="alert">
                <Icon name="alert" />
                {err}
              </p>
            )}
            <footer className="builder-actions">
              <span>
                <Icon name={total === 100 ? "check" : "alert"} />
                {total === 100
                  ? `${rubric.length} 个评分项 · ${tests.length} 个测试用例`
                  : `评分权重合计 ${total}%，需调整为 100%`}
              </span>
              <div>
                {back && (
                  <button
                    type="button"
                    className="builder-secondary"
                    onClick={back}
                    disabled={saving}
                  >
                    取消
                  </button>
                )}
                <button
                  className="primary"
                  disabled={
                    saving ||
                    generatingTests ||
                    total !== 100 ||
                    !languages.length ||
                    (!assignmentId && !courseID)
                  }
                >
                  {saving
                    ? "正在保存…"
                    : assignmentId
                      ? "保存修改"
                      : "发布作业"}
                  <Icon name={saving ? "refresh" : "arrowRight"} />
                </button>
              </div>
            </footer>
          </form>
        </section>
        <aside className="publish-outline" aria-label="作业设置概览">
          <div className="builder-summary">
            <span className="builder-summary-icon">
              <Icon name="assignments" />
            </span>
            <h3>发布概览</h3>
            <p className="builder-summary-title">
              {t.trim() || "尚未填写作业标题"}
            </p>
            <dl>
              <div>
                <dt>所属课程</dt>
                <dd>{selectedCourseTitle}</dd>
              </div>
              <div>
                <dt>编程语言</dt>
                <dd>{lang}</dd>
              </div>
              <div>
                <dt>截止时间</dt>
                <dd>{due ? due.replace("T", " ") : "尚未设置"}</dd>
              </div>
            </dl>
            <div className="builder-summary-metrics">
              <span>
                <b>{max || "—"}</b>次提交机会
              </span>
              <span>
                <b>
                  {total}
                  <small>%</small>
                </b>
                评分权重
              </span>
            </div>
            <p className="builder-summary-note">
              <Icon name="user" />
              仅所选课程的学生可提交本作业
            </p>
          </div>
          <nav aria-label="作业设置目录">
            {sections.map(([id, name], index) => (
              <a key={id} href={`#${id}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {name}
                <Icon name="chevronRight" />
              </a>
            ))}
          </nav>
        </aside>
      </div>
      {materialDialog && (
        <Dialog
          title={materialDialog === "reference" ? "参考实现" : "课程知识库"}
          note="仅教师与评估流程可见，学生无法查看。"
          wide={materialDialog === "reference"}
          onClose={() => setMaterialDialog(null)}
        >
          <form
            className="builder-material-editor"
            onSubmit={(event) => {
              event.preventDefault();
              if (materialDialog === "reference")
                setReferenceSolution(materialDraft);
              else setKnowledgeBase(materialDraft.trim());
              setMaterialDialog(null);
            }}
          >
            {materialDialog === "reference" ? (
              <Suspense
                fallback={
                  <div className="editor-loading">正在加载代码编辑器…</div>
                }
              >
                <CodeEditor
                  language={lang}
                  value={materialDraft}
                  onChange={setMaterialDraft}
                  label="参考实现"
                  allowFullscreen={false}
                  height="420px"
                />
              </Suspense>
            ) : (
              <label>
                教学资料
                <textarea
                  rows={12}
                  value={materialDraft}
                  onChange={(event) => setMaterialDraft(event.target.value)}
                  placeholder="填写知识点、常见错误、评分边界和典型改进方式…"
                />
              </label>
            )}
            <div className="dialog-form-actions">
              <button
                type="button"
                className="submission-action"
                onClick={() => setMaterialDialog(null)}
              >
                取消
              </button>
              <button className="primary" type="submit">
                应用到作业
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}

function BuilderSectionHeading({
  number,
  title,
  note,
  children,
}: {
  number: string;
  title: string;
  note: string;
  children?: ReactNode;
}) {
  return (
    <header className="builder-section-heading">
      <span className="builder-section-number">{number}</span>
      <div>
        <h3>{title}</h3>
        <p>{note}</p>
      </div>
      {children}
    </header>
  );
}

export default App;
