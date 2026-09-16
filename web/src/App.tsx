import { FormEvent, lazy, Suspense, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  Assignment,
  AuthState as Auth,
  Rubric,
  Submission,
  TestCase,
  View,
} from "./types";
import { login } from "./api/auth";
import { apiRequest as req } from "./api/client";
import { clearAuth, loadAuth, saveAuth } from "./auth/storage";
import { useCourseData } from "./hooks/useCourseData";
import { Empty, Head, Score, Title } from "./components/ui";
import { editorTemplate } from "./components/editor/templates";
const CodeEditor = lazy(() => import("./components/editor/CodeEditor"));
const ico: Record<string, string> = {
  home: "⌂",
  assignments: "▤",
  submissions: "⇩",
  publish: "＋",
  out: "↗",
  search: "⌕",
  code: "</>",
};
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
  const [u, setU] = useState("teacher"),
    [p, setP] = useState("CodeEval123!"),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  async function go(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      done(await login(u, p));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section>
        <Logo />
        <div>
          <small>AI-POWERED ASSESSMENT</small>
          <h1>
            让每一行代码
            <br />
            都有回应。
          </h1>
          <p>从提交到反馈，只需片刻。清晰的评分证据，真正可执行的改进建议。</p>
        </div>
        <b>{"{ code → feedback }"}</b>
      </section>
      <form onSubmit={go}>
        <div>
          <h2>欢迎回来</h2>
          <p>登录你的教学工作台</p>
        </div>
        <label>
          账号
          <input value={u} onChange={(e) => setU(e.target.value)} />
        </label>
        <label>
          密码
          <input
            type="password"
            value={p}
            onChange={(e) => setP(e.target.value)}
          />
        </label>
        {err && <i className="error">{err}</i>}
        <button className="primary" disabled={busy}>
          {busy ? "登录中…" : "登录"}
        </button>
        <aside>
          <strong>体验账号</strong>
          <button type="button" onClick={() => setU("teacher")}>
            教师 teacher
          </button>
          <button type="button" onClick={() => setU("student")}>
            学生 student
          </button>
          <small>密码均为 CodeEval123!</small>
        </aside>
      </form>
    </main>
  );
}
function Logo() {
  return (
    <div className="logo">
      <i>C</i>
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
    [selected, setSelected] = useState<Submission>();
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
    <div className="shell">
      <aside className="side">
        <Logo />
        <nav>
          {(
            [
              ["home", "工作台"],
              ["assignments", teacher ? "作业管理" : "我的作业"],
              ["submissions", teacher ? "提交列表" : "提交记录"],
              ...(teacher ? [["publish", "发布作业"]] : []),
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
              <b>{ico[v]}</b>
              {n}
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
          <button onClick={logout}>{ico.out}</button>
        </footer>
      </aside>
      <main className="work">
        <header>
          <span>
            <small>数据结构与算法 · 2026 秋季</small>
            <h1>
              {
                {
                  home: "工作台",
                  assignments: "作业",
                  submissions: "提交记录",
                  publish: "发布作业",
                }[view]
              }
            </h1>
          </span>
          <b>{teacher ? "教师端" : "学生端"}</b>
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
            <TeacherAssignments as={as} ss={ss} go={setView} />
          ) : (
            <StudentAssignments as={as} ss={ss} go={setView} />
          )
        ) : view === "submissions" ? (
          <Submissions teacher={teacher} as={as} ss={ss} pick={setSelected} />
        ) : (
          <Publish
            token={auth.token}
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
  return (
    <>
      <section className="hero">
        <div>
          <small>{teacher ? "COURSE OVERVIEW" : "GOOD MORNING"}</small>
          <h2>
            {teacher
              ? "今天也一起把反馈做得更好。"
              : "继续保持，你的每次提交都有进步。"}
          </h2>
          <p>
            {teacher
              ? "查看最新提交，及时发现共性问题。"
              : "从待完成的作业开始，提交代码即可获得即时评估。"}
          </p>
        </div>
        <button onClick={() => go(teacher ? "publish" : "assignments")}>
          {teacher ? "＋ 发布新作业" : "▤ 查看待办作业"}
        </button>
      </section>
      <section className="stats">
        <Stat
          name={teacher ? "已发布作业" : "全部作业"}
          n={as.length}
          note={`${as.filter((a) => left(a.dueAt) >= 0).length} 项进行中`}
        />
        <Stat
          name={teacher ? "学生提交" : "我的提交"}
          n={ss.length}
          note="本课程累计"
        />
        <Stat name="平均得分" n={ss.length ? avg : "—"} note="满分 100" />
      </section>
      <div className="cols">
        <section className="panel">
          <Head
            name={teacher ? "最近提交" : "最近反馈"}
            action={() => go("submissions")}
          />
          {ss.slice(0, 4).map((s) => (
            <button className="recent" onClick={() => pick(s)} key={s.id}>
              <i>{ico.code}</i>
              <span>
                <b>
                  {teacher
                    ? s.studentName
                    : as.find((a) => a.id === s.assignmentId)?.title}
                </b>
                <small>{fmt(s.submittedAt)}</small>
              </span>
              <Score n={s.evaluation?.total} />
              <em>›</em>
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
}: {
  as: Assignment[];
  ss: Submission[];
  go: (v: View) => void;
}) {
  const [statuses, setStatuses] = useState<
      Record<string, Assignment["status"]>
    >({}),
    [limits, setLimits] = useState<Record<string, number>>({}),
    [saving, setSaving] = useState(""),
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
  async function saveLimit(a: Assignment) {
    const value = limits[a.id] ?? a.maxSubmissions;
    if (value < 1 || value > 100) {
      setMessage("提交次数必须在 1 到 100 之间");
      return;
    }
    setSaving(a.id);
    setMessage("");
    try {
      await req(
        `/assignments/${a.id}/max-submissions`,
        loadAuth()?.token || "",
        { method: "PATCH", body: JSON.stringify({ maxSubmissions: value }) },
      );
      setMessage(`${a.title}的提交上限已修改为 ${value} 次`);
    } catch (e) {
      setLimits((v) => ({ ...v, [a.id]: a.maxSubmissions }));
      setMessage(e instanceof Error ? e.message : "提交次数更新失败");
    } finally {
      setSaving("");
    }
  }
  return (
    <section className="panel">
      <Title title="全部作业" note="管理作业、提交次数和开放状态">
        <button className="primary" onClick={() => go("publish")}>
          ＋ 发布作业
        </button>
      </Title>
      {message && <p className="inline-message">{message}</p>}
      <div className="atable">
        <div className="row th">
          <span>作业</span>
          <span>截止时间</span>
          <span>提交</span>
          <span>平均分</span>
          <span>每人上限</span>
          <span>提交状态</span>
        </div>
        {as.map((a) => {
          const sub = ss.filter((s) => s.assignmentId === a.id),
            avg = sub.length
              ? Math.round(
                  sub.reduce((n, s) => n + (s.evaluation?.total || 0), 0) /
                    sub.length,
                )
              : "—",
            status = statuses[a.id] ?? a.status,
            limit = limits[a.id] ?? a.maxSubmissions;
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
              <span className="limit-editor">
                <input
                  aria-label={`${a.title}提交次数上限`}
                  type="number"
                  min="1"
                  max="100"
                  value={limit}
                  onChange={(e) =>
                    setLimits((v) => ({ ...v, [a.id]: Number(e.target.value) }))
                  }
                />
                <button
                  disabled={saving === a.id || limit === a.maxSubmissions}
                  onClick={() => void saveLimit(a)}
                >
                  {saving === a.id ? "保存中" : "保存"}
                </button>
              </span>
              <select
                className={`status-select ${status}`}
                value={status}
                onChange={(e) =>
                  void changeStatus(a, e.target.value as Assignment["status"])
                }
              >
                <option value="open">开放提交</option>
                <option value="closed">关闭提交</option>
              </select>
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
                  {ico.code} {a.language}
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
    <section className="panel">
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
          {ico.search}
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
        <span className="eyebrow">ASSIGNMENT BRIEF</span>
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
        <h4>评分标准</h4>
        <div className="brief-rubric">
          {assignment?.rubric.map((r) => (
            <div key={r.key}>
              <span>
                <b>{r.name}</b>
                <strong>{r.weight}%</strong>
              </span>
              <p>{r.description}</p>
            </div>
          ))}
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
            <small>代码将由 AI 按左侧评分标准逐项分析</small>
            <button
              className="primary"
              disabled={busy || !canSubmit || !code.trim()}
            >
              {busy ? "正在评估…" : "提交并评估 →"}
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
              <small>AI ASSESSMENT</small>
              <h3>评估反馈</h3>
            </span>
            {sub.evaluation && (
              <div className="score-orb">
                <Score n={sub.evaluation.total} />
                <small>总分</small>
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
                    title="问题点"
                    items={sub.evaluation.issues}
                  />
                ) : null}
                {sub.evaluation.improvements?.length ? (
                  <FeedbackGroup
                    kind="improve"
                    title="优化方向"
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
                      <div className="evaluation-evidence markdown-content">
                        <em>评价依据</em>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {d.evidence}
                        </ReactMarkdown>
                      </div>
                      <small>
                        <b>改进建议</b>
                        {d.suggestion}
                      </small>
                      <small className="dimension-meta">
                        证据：{d.evidenceType || "未标注"} · 置信度{" "}
                        {Math.round((d.confidence || 0) * 100)}% ·{" "}
                        {d.verified ? "已验证" : "未执行验证"}
                      </small>
                    </div>
                  );
                })}
              </div>
              {sub.evaluation.analysis?.length ? (
                <details className="agent-analysis">
                  <summary>
                    查看智能体第一阶段分析（{sub.evaluation.analysis.length}{" "}
                    项）
                  </summary>
                  {sub.evaluation.analysis.map((finding, index) => (
                    <article key={`${finding.category}-${index}`}>
                      <b>
                        {finding.category} · {finding.severity}
                      </b>
                      <small>{finding.location || "未标注位置"}</small>
                      <div className="agent-evidence markdown-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {finding.evidence}
                        </ReactMarkdown>
                      </div>
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
              <small>SUBMITTED CODE</small>
              <b>提交代码 · {assignment?.language || ""}</b>
            </span>
            <i>{sub.code.split("\n").length} 行</i>
            <strong>{codeOpen ? "收起代码 ↑" : "展开代码 ↓"}</strong>
          </button>
          {codeOpen && (
            <div className="code-collapse-body submitted-code-layout">
              <aside className="submitted-brief">
                <span className="eyebrow">ASSIGNMENT BRIEF</span>
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
}: {
  token: string;
  done: () => Promise<void>;
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
      await req("/assignments", token, {
        method: "POST",
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
      });
      await done();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "发布失败");
    }
  }
  return (
    <section className="panel publish">
      <Title
        title="创建新作业"
        note="按本次作业目标设置评分项、权重和提交规则"
      />
      <form onSubmit={go}>
        <label className="wide">
          作业标题
          <input
            required
            value={t}
            onChange={(e) => setT(e.target.value)}
            placeholder="例如：实现 LRU 缓存"
          />
        </label>
        <label>
          编程语言
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {languages.map((language) => (
              <option key={language}>{language}</option>
            ))}
          </select>
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
        <label className="wide">
          作业说明
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="描述任务目标、输入输出、约束条件和示例…"
          />
        </label>
        <label className="wide">
          参考实现（仅教师和评估智能体可见）
          <textarea
            value={referenceSolution}
            onChange={(e) => setReferenceSolution(e.target.value)}
            placeholder="可选：粘贴标准答案或优秀实现，不会返回给学生…"
          />
        </label>
        <label className="wide">
          课程知识库（仅教师和评估智能体可见）
          <textarea
            value={knowledgeBase}
            onChange={(e) => setKnowledgeBase(e.target.value)}
            placeholder="可选：填写知识点、常见错误、评分边界和典型改进方式…"
          />
        </label>
        <section className="rubric-editor wide">
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
            ＋ 添加评分项
          </button>
        </section>
        <section className="rubric-editor wide">
          <header>
            <span>
              <b>沙箱测试用例</b>
              <small>
                AI
                生成的是可编辑草稿；程序从标准输入读取，隐藏用例不会展示给学生
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
                  ? "AI 重新生成"
                  : "AI 生成用例"}
            </button>
          </header>
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
            ＋ 添加测试用例
          </button>
        </section>
        <label className="toggle wide">
          <input
            type="checkbox"
            checked={llm}
            onChange={(e) => setLlm(e.target.checked)}
          />
          <i />
          <span>
            <b>启用 AI 深度评估</b>
            <small>根据上方量规生成逐项评分、证据与建议</small>
          </span>
        </label>
        {err && <i className="error wide">{err}</i>}
        <footer className="wide">
          <button
            className="primary"
            disabled={total !== 100 || !languages.length}
          >
            发布作业
          </button>
        </footer>
      </form>
    </section>
  );
}
export default App;
