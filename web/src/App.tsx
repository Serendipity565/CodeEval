import { FormEvent, lazy, Suspense, useEffect, useMemo, useState } from "react";
import type {
  Assignment,
  AuthState as Auth,
  Rubric,
  Submission,
  TestCase,
  View,
} from "./types";
import { login, register } from "./api/auth";
import { apiRequest as req } from "./api/client";
import { clearAuth, loadAuth, saveAuth } from "./auth/storage";
import { useCourseData } from "./hooks/useCourseData";
import { Empty, Head, Icon, Score, Title } from "./components/ui";
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
    }),
  left = (x: string) =>
    Math.ceil((new Date(x).getTime() - Date.now()) / 86400000);
function App() {
  const [a, setA] = useState<Auth | null>(loadAuth);
  return a ? (
    <Workspace
      auth={a}
      logout={() => {
        clearAuth();
        setA(null);
      }}
    />
  ) : (
    <Login
      done={(v) => {
        saveAuth(v);
        setA(v);
      }}
    />
  );
}
function Login({ done }: { done: (a: Auth) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login"),
    [u, setU] = useState("teacher"),
    [p, setP] = useState("CodeEval123!"),
    [confirmPassword, setConfirmPassword] = useState(""),
    [displayName, setDisplayName] = useState(""),
    [role, setRole] = useState<"student" | "teacher">("student"),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  async function go(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    if (mode === "register" && p !== confirmPassword) {
      setErr("两次输入的密码不一致");
      setBusy(false);
      return;
    }
    try {
      done(mode === "login" ? await login(u, p) : await register({ username: u, displayName, password: p, role }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section className="login-intro">
        <Logo />
        <div>
          <h1>编程作业与评估工作台</h1>
          <p>发布作业、检查运行结果，并给出有依据的学习反馈。</p>
          <ul>
            <li><Icon name="assignments" />集中管理作业、测试和评分量规</li>
            <li><Icon name="code" />追踪每次代码提交和运行结果</li>
            <li><Icon name="check" />让每条反馈都能回到具体证据</li>
          </ul>
        </div>
        <small>面向编程课程的日常教学工具</small>
      </section>
      <form onSubmit={go}>
        <div className="login-mobile-brand"><Logo /></div>
        <div>
          <h2>{mode === "login" ? "登录 CodeEval" : "注册 CodeEval"}</h2>
          <p>{mode === "login" ? "使用课程账号继续" : "创建你的课程账号"}</p>
        </div>
        <div className="auth-switch" role="tablist" aria-label="账号操作">
          <button type="button" className={mode === "login" ? "on" : ""} onClick={() => { setMode("login"); setErr(""); }}>登录</button>
          <button type="button" className={mode === "register" ? "on" : ""} onClick={() => { setMode("register"); setU(""); setP(""); setConfirmPassword(""); setErr(""); }}>注册</button>
        </div>
        <label>
          账号
          <input autoComplete="username" minLength={3} maxLength={32} required value={u} onChange={(e) => setU(e.target.value)} placeholder="3-32 位字母或数字" />
        </label>
        {mode === "register" && <>
          <label>
            姓名
            <input autoComplete="name" minLength={2} maxLength={30} required value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="用于课程内展示" />
          </label>
          <label>
            身份
            <select value={role} onChange={(e) => setRole(e.target.value as "student" | "teacher")}>
              <option value="student">学生</option>
              <option value="teacher">教师</option>
            </select>
          </label>
        </>}
        <label>
          密码
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={8}
            maxLength={72}
            required
            value={p}
            onChange={(e) => setP(e.target.value)}
          />
        </label>
        {mode === "register" && <label>
          确认密码
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>}
        {err && <i className="error">{err}</i>}
        <button className="primary" disabled={busy}>
          {busy ? (mode === "login" ? "登录中…" : "注册中…") : (mode === "login" ? "登录" : "注册并进入")}
        </button>
        {mode === "login" && <details className="demo-accounts">
          <summary>使用演示账号</summary>
          <div>
            <button type="button" onClick={() => setU("teacher")}>教师账号 <span>teacher</span></button>
            <button type="button" onClick={() => setU("student")}>学生账号 <span>student</span></button>
            <small>演示密码：CodeEval123!</small>
          </div>
        </details>}
      </form>
    </main>
  );
}
function Logo() {
  return (
    <div className="logo">
      <i aria-hidden="true">{"{}"}</i>
      <span>CodeEval</span>
    </div>
  );
}
function Workspace({ auth, logout }: { auth: Auth; logout: () => void }) {
  const teacher = auth.user.role === "teacher",
    [view, setView] = useState<View>("home"),
    [as, setAs] = useState<Assignment[]>([]),
    [ss, setSs] = useState<Submission[]>([]),
    [err, setErr] = useState(""),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<Submission>(),
    [editingAssignmentId, setEditingAssignmentId] = useState("");
  const load = () => {
    setLoading(true);
    return Promise.all([
      req("/assignments", auth.token),
      req("/submissions", auth.token),
    ])
      .then(([a, s]) => {
        setAs(a);
        setSs(s);
        setErr("");
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  const avg = ss.length
    ? Math.round(
        ss.reduce((n, s) => n + (s.evaluation?.total || 0), 0) / ss.length,
      )
    : 0;
  return (
    <div className={`shell ${view === "publish" || view === "edit" ? "task-flow" : ""}`}>
      <aside className="side">
        <Logo />
        <nav>
          {(
            [
              ["home", "工作台"],
              ["assignments", teacher ? "作业" : "我的作业"],
              ["submissions", teacher ? "提交" : "提交记录"],
            ] as [View, string][]
          ).map(([v, n]) => (
            <button
              className={view === v ? "on" : ""}
              onClick={() => {
                setView(v);
                setSelected(undefined);
              }}
              key={v}
            >
              <Icon name={v === "home" ? "home" : v === "assignments" ? "assignments" : "submissions"} />
              <span>{n}</span>
              {v === "submissions" && <em>{ss.length}</em>}
            </button>
          ))}
        </nav>
        <footer>
          <i>{auth.user.displayName[0]}</i>
          <span>
            <b>{auth.user.displayName}</b>
            <small>{teacher ? "教师账号" : "学生账号"}</small>
          </span>
          <button aria-label="退出登录" title="退出登录" onClick={logout}><Icon name="logout" /></button>
        </footer>
      </aside>
      <main className="work">
        <header>
          <span>
            <h1>
              {
                {
                  home: "工作台",
                  assignments: "作业",
                  submissions: "提交记录",
                  publish: "发布作业",
                  edit: "修改作业",
                }[view]
              }
            </h1>
          </span>
          <div className="header-account">
            <span>{auth.user.displayName[0]}</span>
            <b>{auth.user.displayName}</b>
            <small>{teacher ? "教师" : "学生"}</small>
            <button aria-label="退出登录" title="退出登录" onClick={logout}><Icon name="logout" /></button>
          </div>
        </header>
        {err && <p className="alert">{err}</p>}
        {loading ? (
          <Empty text="正在加载课程数据…" />
        ) : selected ? (
          <Detail
            sub={selected}
            assignment={as.find((a) => a.id === selected.assignmentId)}
            back={() => setSelected(undefined)}
          />
        ) : view === "home" ? (
          <Home
            teacher={teacher}
            as={as}
            ss={ss}
            avg={avg}
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
                setEditingAssignmentId(id);
                setView("edit");
              }}
            />
          ) : (
            <StudentAssignments as={as} ss={ss} go={setView} />
          )
        ) : view === "submissions" ? (
          <Submissions teacher={teacher} as={as} ss={ss} pick={setSelected} />
        ) : view === "publish" ? (
          <Publish
            token={auth.token}
            back={() => setView("assignments")}
            done={async () => {
              await load();
              setView("assignments");
            }}
          />
        ) : (
          <Publish
            token={auth.token}
            assignmentId={editingAssignmentId}
            back={() => setView("assignments")}
            done={async () => {
              await load();
              setView("assignments");
            }}
          />
        )}
      </main>
    </div>
  );
}
function Home({
  teacher,
  as,
  ss,
  avg,
  go,
  pick,
}: {
  teacher: boolean;
  as: Assignment[];
  ss: Submission[];
  avg: number;
  go: (v: View) => void;
  pick: (s: Submission) => void;
}) {
  const activeAssignments = as.filter((a) => a.status === "open" && left(a.dueAt) >= 0);
  const actionableAssignments = teacher
    ? activeAssignments
    : activeAssignments.filter((a) => ss.filter((s) => s.assignmentId === a.id).length < a.maxSubmissions);
  const failed = ss.filter((s) => s.status === "failed" || s.status === "needs_review");
  const lowScores = ss.filter((s) => s.evaluation && s.evaluation.total < 60);
  const dueSoon = actionableAssignments.filter((a) => left(a.dueAt) <= 3);
  return (
    <>
      <section className="dashboard-intro">
        <div>
          <h2>{teacher ? "课程概览" : "学习概览"}</h2>
          <p>{teacher ? "先处理需要关注的提交，再查看课程整体进度。" : "查看待完成作业和最近一次评估反馈。"}</p>
        </div>
        <button className="primary" onClick={() => go(teacher ? "publish" : "assignments")}>
          <Icon name={teacher ? "plus" : "assignments"} />
          {teacher ? "发布作业" : "查看作业"}
        </button>
      </section>
      {(failed.length > 0 || dueSoon.length > 0) && <section className="attention-list" aria-label="待处理事项">
        <h3>需要关注</h3>
        {failed.length > 0 && <button onClick={() => go("submissions")}><Icon name="alert" /><span><b>{failed.length} 份提交需要复核</b><small>运行或评估未正常完成</small></span><Icon name="chevronRight" /></button>}
        {dueSoon.length > 0 && <button onClick={() => go("assignments")}><Icon name="clock" /><span><b>{dueSoon.length} 项作业即将截止</b><small>{teacher ? "请检查提交进度" : "查看要求并按时提交"}</small></span><Icon name="chevronRight" /></button>}
      </section>}
      <section className="stats overview-strip">
        <Stat
          name={teacher ? "进行中作业" : "可提交作业"}
          n={actionableAssignments.length}
          note={`共 ${as.length} 项`}
        />
        <Stat
          name={teacher ? "学生提交" : "我的提交"}
          n={ss.length}
          note="本课程"
        />
        <Stat name="平均得分" n={ss.length ? avg : "—"} note="满分 100" />
        <Stat name={teacher ? "待复核" : "低于 60 分"} n={teacher ? failed.length : lowScores.length} note="当前" />
      </section>
      <div className="cols">
        <section className="panel">
          <Head
            name={teacher ? "最近提交" : "最近反馈"}
            action={() => go("submissions")}
          />
          {ss.slice(0, 4).map((s) => (
            <button className="recent" onClick={() => pick(s)} key={s.id}>
              <i><Icon name="code" /></i>
              <span>
                <b>
                  {teacher
                    ? s.studentName
                    : as.find((a) => a.id === s.assignmentId)?.title}
                </b>
                <small>{fmt(s.submittedAt)}</small>
              </span>
              <Score n={s.evaluation?.total} />
              <em><Icon name="chevronRight" /></em>
            </button>
          ))}
          {!ss.length && <Empty text="还没有提交记录" />}
        </section>
        <section className="panel">
          <Head
            name={teacher ? "作业进度" : "即将截止"}
            action={() => go("assignments")}
          />
          {as.slice(0, 4).map((a) => (
            <div className="due" key={a.id}>
              <i>
                <b>{new Date(a.dueAt).getDate()}</b>
                <small>{new Date(a.dueAt).getMonth() + 1}月</small>
              </i>
              <span>
                <b>{a.title}</b>
                <small>
                  {a.language} ·{" "}
                  {teacher
                    ? `${ss.filter((s) => s.assignmentId === a.id).length} 份提交`
                    : left(a.dueAt) < 0
                      ? "已截止"
                      : `${left(a.dueAt)} 天后截止`}
                </small>
              </span>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
function Stat({
  name,
  n,
  note,
}: {
  name: string;
  n: number | string;
  note: string;
}) {
  return (
    <div>
      <small>{name}</small>
      <b>{n}</b>
      <span>{note}</span>
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
          <Icon name="plus" />发布作业
        </button>
      </Title>
      {message && <p className="inline-message">{message}</p>}
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
            avg = sub.length
              ? Math.round(
                  sub.reduce((n, s) => n + (s.evaluation?.total || 0), 0) /
                    sub.length,
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
    </section>
  );
}
function StudentAssignments({
  as,
  ss,
}: {
  as: Assignment[];
  ss: Submission[];
  go: (v: View) => void;
}) {
  const [f, setF] = useState("all"),
    [teacher, setTeacher] = useState("all"),
    [active, setActive] = useState(""),
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
    selected = as.find((a) => a.id === active);
  if (selected)
    return (
      <div className="assignment-submit-view">
        <button className="back" onClick={() => setActive("")}>
          ‹ 返回我的作业
        </button>
        <Title
          title={selected.title}
          note={`${selected.teacherName || "未命名教师"} · ${selected.language} · 截止 ${fmt(selected.dueAt)}`}
        />
        <StudentSubmit assignments={[selected]} />
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
                  <button disabled={!canSubmit} onClick={() => setActive(a.id)}>
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
          (!q ||
            (s.studentName + as.find((a) => a.id === s.assignmentId)?.title)
              .toLowerCase()
              .includes(q.toLowerCase())),
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
            placeholder={teacher ? "搜索学生或作业" : "搜索作业"}
          />
        </label>
        <select value={aid} onChange={(e) => setAid(e.target.value)}>
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
            <i className="status done">已评估</i>
            <Score n={s.evaluation?.total} />
            <b>›</b>
          </button>
        ))}
      </div>
      {!list.length && <Empty text="没有符合条件的提交" />}
    </section>
  );
}
function StudentSubmit({ assignments }: { assignments: Assignment[] }) {
  const assignment = assignments[0],
    token = loadAuth()?.token || "",
    [history, setHistory] = useState<Submission[]>([]),
    [created, setCreated] = useState<Submission>(),
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
  useEffect(() => {
    if (
      !created ||
      created.status === "graded" ||
      created.status === "needs_review" ||
      created.status === "failed"
    )
      return;
    const timer = window.setInterval(async () => {
      try {
        const items = await req<Submission[]>("/submissions", token),
          current = items.find((s) => s.id === created.id);
        if (current) setCreated(current);
      } catch {
        /* 下一轮继续查询 */
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [created?.id, created?.status]);
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
      setCreated(submission);
      setCode("");
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }
  if (created)
    return (
      <div className="submitted-detail">
        <Detail
          sub={created}
          assignment={assignment}
          back={() => setCreated(undefined)}
        />
      </div>
    );
  return (
    <div className="submit-layout">
      <aside className="panel assignment-brief">
        <button className="brief-toggle" type="button" aria-expanded={briefOpen} onClick={() => setBriefOpen((v) => !v)}>
          <span><Icon name="assignments" />作业要求与评分标准</span>
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
        <Title title="编写并提交" note="支持语法高亮、自动缩进与代码格式化" />
        <form onSubmit={send}>
          <div className="editor-toolbar fixed-assignment">
            <span>
              <i className={`availability ${canSubmit ? "open" : "closed"}`} />
              {assignment?.status === "closed"
                ? "提交已关闭"
                : `还可提交 ${Math.max(0, (assignment?.maxSubmissions ?? 0) - used)} 次`}
            </span>
          </div>
          <Suspense
            fallback={<div className="editor-loading">正在加载代码编辑器…</div>}
          >
            <CodeEditor
              language={assignment?.language ?? "Plain text"}
              value={code}
              onChange={setCode}
              height="520px"
            />
          </Suspense>
          <div className="editor-actions">
            <small>提交后将按评分量规运行测试并生成反馈</small>
            <button
              className="primary"
              disabled={busy || !canSubmit || !code.trim()}
            >
              {busy ? "正在评估…" : <>提交并评估<Icon name="chevronRight" /></>}
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
        ‹ 返回
        {sub.status === "queued" || sub.status === "evaluating"
          ? "作业"
          : "提交列表"}
      </button>
      <Title
        title={assignment?.title || "作业提交"}
        note={`${sub.studentName} · ${fmt(sub.submittedAt)}`}
      />
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
                <Score n={sub.evaluation.total} />
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
                          style={{ width: `${(d.score / d.maxScore) * 100}%` }}
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
                      {((d.evidenceType && d.evidenceType !== "未标注") || d.confidence > 0 || d.verified) && (
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
                    查看详细分析证据（{sub.evaluation.analysis.length}{" "}
                    项）
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
            <strong>{codeOpen ? "收起代码 ↑" : "展开代码 ↓"}</strong>
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
            title: t,
            language: lang,
            description: desc,
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
            title: t,
            language: lang,
            description: desc,
            status,
            maxSubmissions: max,
            dueAt: new Date(due).toISOString(),
            llmEvaluationEnabled: llm,
            referenceSolution,
            knowledgeBase,
            testCases: tests,
            rubric,
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
      {back && <button className="back publish-back" onClick={back}><Icon name="chevronLeft" />返回作业</button>}
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
            onChange={(e) => setStatus(e.target.value as Assignment["status"])}
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
          <Suspense fallback={<div className="editor-loading">正在加载代码编辑器…</div>}>
            <CodeEditor
              language={lang}
              value={referenceSolution}
              onChange={setReferenceSolution}
              height="360px"
            />
          </Suspense>
        </section>
        <label className="wide">
          课程知识库（仅教师和评估智能体可见）
          <textarea
            value={knowledgeBase}
            onChange={(e) => setKnowledgeBase(e.target.value)}
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
                onChange={(e) => update(index, { name: e.target.value })}
                placeholder="评分项名称"
              />
              <input
                required
                value={r.description}
                onChange={(e) => update(index, { description: e.target.value })}
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
            <Icon name="plus" />添加评分项
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
          <p className="execution-contract-inline">{executionContract(lang)}</p>
          <div className="test-case-list">
            {tests.map((test, index) => (
              <article className="test-case-card" key={`${test.name}-${index}`}>
                <header>
                  <input
                    required
                    value={test.name}
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
                        updateTest(index, { timeoutMs: Number(e.target.value) })
                      }
                    />
                  </label>
                </footer>
              </article>
            ))}
          </div>
          <button className="add-criterion" type="button" onClick={addTest}>
            <Icon name="plus" />添加测试用例
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
