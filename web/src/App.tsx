import { FormEvent, lazy, Suspense, useEffect, useMemo, useState } from "react";
import type {
  Assignment,
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
import {
  assignmentPath,
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
            path.startsWith("/submissions/")
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
    [ss, setSs] = useState<Submission[]>([]),
    [err, setErr] = useState(""),
    [loading, setLoading] = useState(true),
    [hasLoaded, setHasLoaded] = useState(false),
    selected = ss.find((item) => item.id === route.submissionId);
  const setView = (next: View) => navigate(viewPath(next));
  const backTo = (fallback: string) => {
    const from = window.history.state?.from;
    if (
      typeof from === "string" &&
      (from.startsWith("/workspace/") ||
        from.startsWith("/assignments/") ||
        from.startsWith("/submissions/"))
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
    ])
      .then(([a, s]) => {
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
  }, []);
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
              ["assignments", teacher ? "作业" : "我的作业"],
              ["submissions", teacher ? "提交" : "提交记录"],
            ] as [View, string][]
          ).map(([v, n]) => (
            <button
              className={
                view === v ||
                ((view === "publish" || view === "edit") && v === "assignments")
                  ? "on"
                  : ""
              }
              aria-current={view === v ? "page" : undefined}
              onClick={() => {
                setView(v);
              }}
              key={v}
            >
              <Icon
                name={
                  v === "home"
                    ? "home"
                    : v === "assignments"
                      ? "assignments"
                      : "submissions"
                }
              />
              <span>{n}</span>
              {v === "submissions" && <em>{hasLoaded ? ss.length : "—"}</em>}
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
                    assignments: "作业",
                    submissions: "提交记录",
                    publish: "发布作业",
                    edit: "修改作业",
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
            />
          ) : view === "home" ? (
            <Home
              teacher={teacher}
              as={as}
              ss={ss}
              go={setView}
              pick={setSelected}
            />
          ) : view === "assignments" ? (
            teacher ? (
              <TeacherAssignments
                as={as}
                ss={ss}
                go={setView}
                edit={(id) => {
                  navigate(editPath(id));
                }}
              />
            ) : (
              <StudentAssignments
                as={as}
                ss={ss}
                assignmentId={route.assignmentId}
                open={(id) => navigate(assignmentPath(id))}
                back={() => backTo(viewPath("assignments"))}
                onSubmissionChange={upsertSubmission}
                onCreated={(submission) =>
                  navigate(submissionPath(submission.id))
                }
              />
            )
          ) : view === "submissions" ? (
            <Submissions teacher={teacher} as={as} ss={ss} pick={setSelected} />
          ) : view === "publish" ? (
            <Publish
              token={auth.token}
              back={() => backTo(viewPath("assignments"))}
              done={async () => {
                await load();
                navigate(viewPath("assignments"), true);
              }}
            />
          ) : (
            <Publish
              token={auth.token}
              assignmentId={route.assignmentId}
              back={() => backTo(viewPath("assignments"))}
              done={async () => {
                await load();
                navigate(viewPath("assignments"), true);
              }}
            />
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
}: {
  as: Assignment[];
  ss: Submission[];
  go: (v: View) => void;
  edit: (id: string) => void;
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
    <section className="panel list-page">
      <Title title="全部作业" note="管理作业、提交次数和开放状态">
        <button className="primary" onClick={() => go("publish")}>
          <Icon name="plus" />
          发布作业
        </button>
      </Title>
      {message && <p className="inline-message">{message}</p>}
      {as.length ? (
        <div className="atable teacher-assignment-table">
          <div className="row th">
            <span>作业</span>
            <span>截止时间</span>
            <span>提交</span>
            <span>平均分</span>
            <span>提交状态</span>
            <span>操作</span>
          </div>
          {as.map((a) => {
            const sub = ss.filter((s) => s.assignmentId === a.id),
              evaluated = sub.filter((s) => s.evaluation),
              avg = evaluated.length
                ? Math.round(
                    evaluated.reduce((n, s) => n + s.evaluation!.total, 0) /
                      evaluated.length,
                  )
                : "—",
              status = statuses[a.id] ?? a.status;
            return (
              <div className="row" key={a.id}>
                <span className="aname">
                  <i>{a.language.slice(0, 2)}</i>
                  <b>
                    {a.title}
                    <small>{a.description || "暂无作业说明"}</small>
                  </b>
                </span>
                <span>{fmt(a.dueAt)}</span>
                <b>{sub.length}</b>
                <b>{avg}</b>
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
                <button
                  className="assignment-edit-link"
                  onClick={() => edit(a.id)}
                >
                  查看并修改 ›
                </button>
              </div>
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
  back,
  onSubmissionChange,
  onCreated,
}: {
  as: Assignment[];
  ss: Submission[];
  assignmentId?: string;
  open: (id: string) => void;
  back: () => void;
  onSubmissionChange: (submission: Submission) => void;
  onCreated: (submission: Submission) => void;
}) {
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
                s.evaluation ? Math.max(best ?? 0, s.evaluation.total) : best,
              undefined,
            ),
            canSubmit =
              a.status === "open" && submissions.length < a.maxSubmissions;
          return (
            <article key={a.id}>
              <header>
                <b>
                  <Icon name="code" /> {a.language}
                </b>
                <i
                  className={`status ${a.status === "closed" ? "closed" : submissions.length ? "done" : "open"}`}
                >
                  {a.status === "closed"
                    ? "已关闭"
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
                  <button disabled={!canSubmit} onClick={() => open(a.id)}>
                    {submissions.length ? "再次提交" : "进入作业"} ›
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
}: {
  teacher: boolean;
  as: Assignment[];
  ss: Submission[];
  pick: (s: Submission) => void;
}) {
  const [q, setQ] = useState(""),
    [aid, setAid] = useState("all");
  const list = useMemo(
    () =>
      ss.filter(
        (s) =>
          (aid === "all" || s.assignmentId === aid) &&
          (!q.trim() ||
            (s.studentName + as.find((a) => a.id === s.assignmentId)?.title)
              .toLowerCase()
              .includes(q.trim().toLowerCase())),
      ),
    [q, aid, ss, as],
  );
  return (
    <section className="panel list-page">
      <Title
        title={teacher ? "学生提交列表" : "我的提交记录"}
        note={
          teacher
            ? "查看每位学生的代码与评估结果"
            : "回顾每次提交的代码和对应评价"
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
              <small>{teacher && fmt(s.submittedAt)}</small>
            </span>
            <SubmissionStatus status={s.status} />
            {s.evaluation ? (
              <Score n={s.evaluation.total} max={s.evaluation.maxTotal} />
            ) : (
              <span className="score-placeholder">—</span>
            )}
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
  onSubmissionChange,
  onCreated,
}: {
  assignments: Assignment[];
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
  const refresh = () =>
    req<Submission[]>("/submissions", token).then(setHistory);
  useEffect(() => {
    void refresh();
  }, []);
  const used = history.filter((s) => s.assignmentId === assignment?.id).length,
    canSubmit =
      !!assignment &&
      assignment.status === "open" &&
      used < assignment.maxSubmissions;
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!assignment) return;
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
          <span className="studio-availability">
            <i className={`availability ${canSubmit ? "open" : "closed"}`} />
            {assignment?.status === "closed"
              ? "提交已关闭"
              : `还可提交 ${Math.max(0, (assignment?.maxSubmissions ?? 0) - used)} 次`}
          </span>
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
}: {
  sub: Submission;
  assignment?: Assignment;
  back: () => void;
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
        <SubmissionStatus status={sub.status} />
      </Title>
      <div className="detail">
        <section className="panel feedback-panel">
          <div className="feedback-head">
            <span>
              <small>评估结果</small>
              <h3>评估反馈</h3>
            </span>
            {sub.evaluation && (
              <div className="score-orb">
                <small>总分</small>
                <Score n={sub.evaluation.total} max={sub.evaluation.maxTotal} />
              </div>
            )}
          </div>
          {sub.evaluation ? (
            <>
              <p className="feedback-summary">{sub.evaluation.summary}</p>
              <div className="evaluation-meta">
                <span>
                  置信度 {Math.round((sub.evaluation.confidence || 0) * 100)}%
                </span>
                <span>
                  {sub.evaluation.verified ? "已执行验证" : "未经执行验证"}
                </span>
                <span>{sub.evaluation.provider}</span>
                {sub.evaluation.promptVersion && (
                  <span>{sub.evaluation.promptVersion}</span>
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
              {sub.evaluation.execution && (
                <details className="agent-analysis">
                  <summary>
                    沙箱测试：{sub.evaluation.execution.passed}/
                    {sub.evaluation.execution.total} 通过
                  </summary>
                  {sub.evaluation.execution.results.map((result, index) => (
                    <article key={`${result.name}-${index}`}>
                      <b>
                        {result.passed ? "✓" : "✕"} {result.name}
                      </b>
                      <span>
                        {result.durationMs}ms
                        {result.error ? ` · ${result.error}` : ""}
                      </span>
                      {result.hidden ? (
                        <small className="hidden-test-note">
                          隐藏用例 · 输入输出不公开
                        </small>
                      ) : (
                        <div className="test-result-io">
                          <section>
                            <em>输入</em>
                            <pre>{result.input || "（空输入）"}</pre>
                          </section>
                          <section>
                            <em>期望输出</em>
                            <pre>{result.expected || "（无输出）"}</pre>
                          </section>
                          <section>
                            <em>实际输出</em>
                            <pre>{result.actual || "（无输出）"}</pre>
                          </section>
                        </div>
                      )}
                    </article>
                  ))}
                </details>
              )}
              <div className="dimension-list">
                {sub.evaluation.dimensions.map((d) => {
                  const criterion =
                    d.criterion ||
                    assignment?.rubric.find((r) => r.key === d.key)
                      ?.description;
                  return (
                    <div className="dimension" key={d.key}>
                      <span>
                        <b>{d.name}</b>
                        <strong>
                          {d.score}/{d.maxScore}
                        </strong>
                      </span>
                      {criterion && (
                        <p className="criterion">
                          <em>教师评判标准</em>
                          {criterion}
                        </p>
                      )}
                      <i>
                        <b
                          style={{
                            width: `${d.maxScore > 0 ? Math.max(0, Math.min(100, (d.score / d.maxScore) * 100)) : 0}%`,
                          }}
                        />
                      </i>
                      <p>
                        <em>评价依据</em>
                        {d.evidence}
                      </p>
                      <small>
                        <b>改进建议</b>
                        {d.suggestion}
                      </small>
                      {((d.evidenceType && d.evidenceType !== "未标注") ||
                        d.confidence > 0 ||
                        d.verified) && (
                        <small className="dimension-meta">
                          证据：{d.evidenceType || "未标注"} · 置信度{" "}
                          {Math.round((d.confidence || 0) * 100)}% ·{" "}
                          {d.verified ? "已验证" : "未执行验证"}
                        </small>
                      )}
                    </div>
                  );
                })}
              </div>
              {sub.evaluation.analysis?.length ? (
                <details className="agent-analysis">
                  <summary>
                    查看详细分析证据（{sub.evaluation.analysis.length} 项）
                  </summary>
                  {sub.evaluation.analysis.map((finding, index) => (
                    <article key={`${finding.category}-${index}`}>
                      <b>
                        {finding.category} · {finding.severity}
                      </b>
                      <small>{finding.location || "未标注位置"}</small>
                      <p>{finding.evidence}</p>
                      <span>{finding.explanation}</span>
                    </article>
                  ))}
                </details>
              ) : null}
            </>
          ) : (
            <EvaluationProgress submission={sub} />
          )}
        </section>
        <section
          className={`panel highlighted-code collapsible-code ${codeOpen ? "open" : ""}`}
        >
          <button
            className="code-collapse-trigger"
            type="button"
            aria-expanded={codeOpen}
            onClick={() => setCodeOpen((v) => !v)}
          >
            <span>
              <small>提交代码</small>
              <b>提交代码 · {assignment?.language || ""}</b>
            </span>
            <i>{sub.code.split("\n").length} 行</i>
            <strong>
              {codeOpen ? "收起代码" : "展开代码"}
              <Icon name="chevronRight" />
            </strong>
          </button>
          {codeOpen && (
            <div className="code-collapse-body submitted-code-layout">
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
                    height="530px"
                  />
                </Suspense>
              </div>
            </div>
          )}
        </section>
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
      <h4>{title}</h4>
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
  back,
}: {
  token: string;
  done: () => Promise<void>;
  assignmentId?: string;
  back?: () => void;
}) {
  const [t, setT] = useState(""),
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
      setErr("请先填写作业标题和说明，再生成测试用例");
      return;
    }
    setGeneratingTests(true);
    setErr("");
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
      setErr(e instanceof Error ? e.message : "AI 生成测试用例失败");
    } finally {
      setGeneratingTests(false);
    }
  }
  async function go(e: FormEvent) {
    e.preventDefault();
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
    try {
      await req(
        assignmentId ? `/assignments/${assignmentId}` : "/assignments",
        token,
        {
          method: assignmentId ? "PUT" : "POST",
          body: JSON.stringify({
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
    }
  }
  return (
    <div className="publish-layout">
      <aside className="publish-outline" aria-label="作业设置目录">
        <span>作业设置</span>
        <nav>
          <a href="#assignment-basic">基本信息</a>
          <a href="#assignment-content">题目与资料</a>
          <a href="#assignment-rubric">评分量规</a>
          <a href="#assignment-tests">测试用例</a>
          <a href="#assignment-evaluation">评估方式</a>
        </nav>
        <p>发布前请确认截止时间、总分权重和测试用例。</p>
      </aside>
      <section className="panel publish">
        {back && (
          <button className="back publish-back" onClick={back}>
            <Icon name="chevronLeft" />
            返回作业
          </button>
        )}
        <Title
          title={assignmentId ? "作业详情与修改" : "创建新作业"}
          note={
            assignmentId
              ? "修改题目、评分规则、测试数据和提交设置"
              : "按本次作业目标设置评分项、权重和提交规则"
          }
        />
        <form onSubmit={go}>
          <label className="wide" id="assignment-basic">
            作业标题
            {assignmentId ? (
              <span className="read-only-field">
                <b>{t || "正在读取作业…"}</b>
                <small>发布后不可修改</small>
              </span>
            ) : (
              <input
                required
                value={t}
                onChange={(e) => setT(e.target.value)}
                onBlur={(e) => setT(e.target.value.trim())}
                placeholder="例如：实现 LRU 缓存"
              />
            )}
          </label>
          <label>
            编程语言
            {assignmentId ? (
              <span className="read-only-field">
                <b>{lang || "—"}</b>
                <small>发布后不可修改</small>
              </span>
            ) : (
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                {languages.map((language) => (
                  <option key={language}>{language}</option>
                ))}
              </select>
            )}
          </label>
          <label>
            截止时间
            <input
              required
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <label>
            初始提交状态
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as Assignment["status"])
              }
            >
              <option value="open">开放提交</option>
              <option value="closed">关闭提交</option>
            </select>
          </label>
          <label>
            每名学生最多提交次数
            <input
              required
              type="number"
              min="1"
              max="100"
              value={max}
              onChange={(e) => setMax(Number(e.target.value))}
            />
          </label>
          <label className="wide" id="assignment-content">
            作业说明
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              onBlur={(e) => setDesc(e.target.value.trim())}
              placeholder="描述任务目标、输入输出、约束条件和示例…"
            />
          </label>
          <section className="wide reference-editor-field">
            <header>
              <span>
                <b>参考实现</b>
                <small>仅教师和评估流程可见，不会返回给学生</small>
              </span>
              <em>{lang}</em>
            </header>
            <Suspense
              fallback={
                <div className="editor-loading">正在加载代码编辑器…</div>
              }
            >
              <CodeEditor
                language={lang}
                value={referenceSolution}
                onChange={setReferenceSolution}
                label="参考实现"
                height="360px"
              />
            </Suspense>
          </section>
          <label className="wide">
            课程知识库（仅教师和评估智能体可见）
            <textarea
              value={knowledgeBase}
              onChange={(e) => setKnowledgeBase(e.target.value)}
              onBlur={(e) => setKnowledgeBase(e.target.value.trim())}
              placeholder="可选：填写知识点、常见错误、评分边界和典型改进方式…"
            />
          </label>
          <section className="rubric-editor wide" id="assignment-rubric">
            <header>
              <span>
                <b>评分量规</b>
                <small>权重合计必须等于 100%</small>
              </span>
              <strong className={total === 100 ? "valid" : "invalid"}>
                {total}%
              </strong>
            </header>
            {rubric.map((r, index) => (
              <div className="rubric-row" key={r.key}>
                <input
                  required
                  value={r.name}
                  onBlur={(e) => update(index, { name: e.target.value.trim() })}
                  onChange={(e) => update(index, { name: e.target.value })}
                  placeholder="评分项名称"
                />
                <input
                  required
                  value={r.description}
                  onBlur={(e) =>
                    update(index, { description: e.target.value.trim() })
                  }
                  onChange={(e) =>
                    update(index, { description: e.target.value })
                  }
                  placeholder="评判标准说明"
                />
                <label>
                  <input
                    required
                    type="number"
                    min="1"
                    max="100"
                    value={r.weight}
                    onChange={(e) =>
                      update(index, { weight: Number(e.target.value) })
                    }
                  />
                  <span>%</span>
                </label>
                <button
                  type="button"
                  disabled={rubric.length === 1}
                  onClick={() => remove(index)}
                >
                  删除
                </button>
              </div>
            ))}
            <button className="add-criterion" type="button" onClick={add}>
              <Icon name="plus" />
              添加评分项
            </button>
          </section>
          <section className="rubric-editor wide" id="assignment-tests">
            <header>
              <span>
                <b>沙箱测试用例</b>
                <small>
                  自动生成的内容是可编辑草稿；程序从标准输入读取，隐藏用例不会展示给学生
                </small>
              </span>
              <button
                className="add-criterion"
                type="button"
                disabled={generatingTests}
                onClick={generateTests}
              >
                {generatingTests
                  ? "生成中…"
                  : tests.length
                    ? "重新生成草稿"
                    : "生成测试草稿"}
              </button>
            </header>
            <p className="execution-contract-inline">
              {executionContract(lang)}
            </p>
            <div className="test-case-list">
              {tests.map((test, index) => (
                <article
                  className="test-case-card"
                  key={`${test.name}-${index}`}
                >
                  <header>
                    <input
                      required
                      value={test.name}
                      onBlur={(e) =>
                        updateTest(index, { name: e.target.value.trim() })
                      }
                      onChange={(e) =>
                        updateTest(index, { name: e.target.value })
                      }
                      placeholder="用例名称"
                    />
                    <label className="test-hidden">
                      <input
                        type="checkbox"
                        checked={test.hidden}
                        onChange={(e) =>
                          updateTest(index, { hidden: e.target.checked })
                        }
                      />
                      <span>隐藏用例</span>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setTests((items) => items.filter((_, i) => i !== index))
                      }
                    >
                      删除
                    </button>
                  </header>
                  <div className="test-case-io">
                    <label>
                      标准输入
                      <textarea
                        value={test.input}
                        onChange={(e) =>
                          updateTest(index, { input: e.target.value })
                        }
                        placeholder="可为空，换行会原样传入 stdin"
                      />
                    </label>
                    <label>
                      期望输出
                      <textarea
                        value={test.expected}
                        onChange={(e) =>
                          updateTest(index, { expected: e.target.value })
                        }
                        placeholder="可为空，按标准输出比较"
                      />
                    </label>
                  </div>
                  <footer>
                    <label>
                      权重
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={test.weight}
                        onChange={(e) =>
                          updateTest(index, { weight: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label>
                      超时（毫秒）
                      <input
                        type="number"
                        min="100"
                        max="10000"
                        step="100"
                        value={test.timeoutMs}
                        onChange={(e) =>
                          updateTest(index, {
                            timeoutMs: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </footer>
                </article>
              ))}
            </div>
            <button className="add-criterion" type="button" onClick={addTest}>
              <Icon name="plus" />
              添加测试用例
            </button>
          </section>
          <label className="toggle wide" id="assignment-evaluation">
            <input
              type="checkbox"
              checked={llm}
              onChange={(e) => setLlm(e.target.checked)}
            />
            <i />
            <span>
              <b>启用模型辅助评估</b>
              <small>根据评分量规生成逐项理由、证据与改进建议</small>
            </span>
          </label>
          {err && <i className="error wide">{err}</i>}
          <footer className="wide">
            <button
              className="primary"
              disabled={total !== 100 || !languages.length}
            >
              {assignmentId ? "保存修改" : "发布作业"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
export default App;
