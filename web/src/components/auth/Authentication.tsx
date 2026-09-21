import { useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { login, register } from "../../api/auth";
import type { AuthState } from "../../types";
import "./auth.css";

type AuthProps = { done: (auth: AuthState) => void };

export function Authentication({ done }: AuthProps) {
  const [page, setPage] = useState<"login" | "register">("login");

  return (
    <main className={`ce-auth ce-auth--${page}`}>
      <AuthStory />
      <section
        className="ce-auth-access"
        aria-label={page === "login" ? "账号登录" : "创建账号"}
      >
        <div className="ce-auth-mobile-brand">
          <AuthBrand />
        </div>
        <div className="ce-auth-form-wrap" key={page}>
          {page === "login" ? (
            <Login done={done} openRegister={() => setPage("register")} />
          ) : (
            <Register done={done} back={() => setPage("login")} />
          )}
        </div>
        <footer className="ce-auth-access-footer">
          <span>CodeEval</span>
          <span>让学习的过程被看见</span>
        </footer>
      </section>
    </main>
  );
}

function AuthBrand() {
  return (
    <div className="ce-auth-brand">
      <img
        className="ce-auth-brand-mark"
        src="/favicon.svg"
        alt=""
        aria-hidden="true"
      />
      <span>
        CodeEval<span className="ce-auth-brand-period">.</span>
      </span>
    </div>
  );
}

function AuthStory() {
  return (
    <aside className="ce-auth-story" aria-label="CodeEval 编程课程工作台">
      <header className="ce-auth-story-header">
        <AuthBrand />
        <span className="ce-auth-edition">编程课程工作台</span>
      </header>
      <div className="ce-auth-story-main">
        <div className="ce-auth-kicker">
          <span /> 从第一行代码开始
        </div>
        <h1>
          每一次提交，
          <br />
          都有迹可循<span className="ce-auth-heading-dot">。</span>
        </h1>
        <p className="ce-auth-story-description">
          把作业、运行结果与学习反馈连在一起。
          <br />
          看见进步，也找到下一步。
        </p>
        <CodeSample />
      </div>
      <footer className="ce-auth-story-footer">
        <span>
          写下想法<span aria-hidden="true">↗</span>验证结果
          <span aria-hidden="true">↗</span>理解代码
        </span>
        <span className="ce-auth-footer-symbol" aria-hidden="true">
          ⌘
        </span>
      </footer>
    </aside>
  );
}

function CodeSample() {
  const lines: ReactNode[] = [
    <>
      <span className="ce-auth-code-comment"># 每一个解法，都值得被理解</span>
    </>,
    <>
      <span className="ce-auth-code-keyword">def</span>{" "}
      <span className="ce-auth-code-function">sum_even</span>(numbers):
    </>,
    <>
      {"    "}
      <span className="ce-auth-code-keyword">return</span>{" "}
      <span className="ce-auth-code-function">sum</span>(
    </>,
    <>
      {"        "}
      n <span className="ce-auth-code-keyword">for</span> n{" "}
      <span className="ce-auth-code-keyword">in</span> numbers
    </>,
    <>
      {"        "}
      <span className="ce-auth-code-keyword">if</span> n %{" "}
      <span className="ce-auth-code-number">2</span> =={" "}
      <span className="ce-auth-code-number">0</span>
    </>,
    <>
      {"    "}
      )<span className="ce-auth-code-caret" />
    </>,
  ];
  return (
    <div className="ce-auth-sample">
      <div className="ce-auth-sample-caption">
        <span>从代码到反馈</span>
        <span>评估示例 / PYTHON</span>
      </div>
      <div className="ce-auth-code-window">
        <div className="ce-auth-code-toolbar">
          <span className="ce-auth-code-tab">
            <AuthGlyph name="code" />
            solution.py
          </span>
          <span>UTF-8</span>
        </div>
        <div
          className="ce-auth-code-body"
          aria-label="示例代码：求列表中所有偶数的和"
        >
          {lines.map((line, index) => (
            <div className="ce-auth-code-line" key={index}>
              <span aria-hidden="true">{index + 1}</span>
              <code>{line}</code>
            </div>
          ))}
        </div>
        <div className="ce-auth-code-result">
          <span>
            <AuthGlyph name="check" />
            测试通过
          </span>
          <span>3 / 3</span>
          <span className="ce-auth-result-bars" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
      <div className="ce-auth-review-note">
        <span className="ce-auth-note-symbol" aria-hidden="true">
          <AuthGlyph name="comment" />
        </span>
        <div>
          <strong>不止看结果，也看思路。</strong>
          <p>用测试验证正确性，用反馈找到改进方向。</p>
        </div>
        <span className="ce-auth-note-line" aria-hidden="true" />
      </div>
    </div>
  );
}

function Login({
  done,
  openRegister,
}: AuthProps & { openRegister: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [demoRole, setDemoRole] = useState<"teacher" | "student" | null>(null);
  const usernameId = useId();
  const errorId = useId();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      done(await login(username.trim(), password));
    } catch (error) {
      setError(error instanceof Error ? error.message : "登录失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }
  function chooseDemo(role: "teacher" | "student") {
    setUsername(role);
    setPassword("CodeEval123!");
    setDemoRole(role);
    setError("");
  }
  return (
    <form
      className="ce-auth-form"
      onSubmit={submit}
      aria-busy={busy}
      aria-describedby={error ? errorId : undefined}
    >
      <div className="ce-auth-form-heading">
        <div className="ce-auth-form-eyebrow">
          <span>01</span> / 进入工作台
        </div>
        <h2>
          欢迎回来<span>。</span>
        </h2>
        <p>登录课程账号，继续你的编程旅程。</p>
      </div>
      <div className="ce-auth-fields">
        <div className="ce-auth-field">
          <label htmlFor={usernameId}>账号</label>
          <input
            id={usernameId}
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            disabled={busy}
            onChange={(event) => {
              setUsername(event.target.value);
              setDemoRole(null);
            }}
            placeholder="输入你的账号"
          />
        </div>
        <PasswordField
          label="密码"
          value={password}
          onChange={(value) => {
            setPassword(value);
            setDemoRole(null);
          }}
          autoComplete="current-password"
          disabled={busy}
        />
      </div>
      {error && (
        <div className="ce-auth-error" id={errorId} role="alert">
          <AuthGlyph name="alert" />
          {error}
        </div>
      )}
      <SubmitButton busy={busy} label="进入工作台" busyLabel="正在登录" />
      <p className="ce-auth-switch">
        还没有账号？
        <button type="button" onClick={openRegister} disabled={busy}>
          创建账号
          <AuthGlyph name="arrow" />
        </button>
      </p>
      {import.meta.env.DEV && (
        <details className="ce-auth-demo">
          <summary>
            <span>
              <AuthGlyph name="code" />
              先体验一下
            </span>
            <span className="ce-auth-demo-chevron" aria-hidden="true">
              +
            </span>
          </summary>
          <div className="ce-auth-demo-content">
            <p>选择一个身份，自动填入演示账号。</p>
            <div className="ce-auth-demo-options">
              <button
                type="button"
                onClick={() => chooseDemo("teacher")}
                disabled={busy}
                aria-pressed={demoRole === "teacher"}
              >
                <AuthGlyph name="teacher" />
                <span>
                  教师<small>发布与评阅</small>
                </span>
                <AuthGlyph name={demoRole === "teacher" ? "check" : "arrow"} />
              </button>
              <button
                type="button"
                onClick={() => chooseDemo("student")}
                disabled={busy}
                aria-pressed={demoRole === "student"}
              >
                <AuthGlyph name="student" />
                <span>
                  学生<small>练习与提交</small>
                </span>
                <AuthGlyph name={demoRole === "student" ? "check" : "arrow"} />
              </button>
            </div>
            <div className="ce-auth-demo-hint" aria-live="polite">
              {demoRole ? (
                `已填入${demoRole === "teacher" ? "教师" : "学生"}演示账号，点击「进入工作台」继续。`
              ) : (
                <>
                  演示密码 <code>CodeEval123!</code>
                </>
              )}
            </div>
          </div>
        </details>
      )}
    </form>
  );
}

function Register({ done, back }: AuthProps & { back: () => void }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"student" | "teacher">("student");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (password !== confirmation) {
      setError("两次输入的密码不一致，请检查后重试。");
      return;
    }
    setBusy(true);
    try {
      done(
        await register({
          username: username.trim(),
          displayName: displayName.trim(),
          password,
          role,
        }),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "注册失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="ce-auth-form ce-auth-registration"
      onSubmit={submit}
      aria-busy={busy}
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <div className="ce-auth-form-heading">
        <button
          className="ce-auth-back"
          type="button"
          onClick={back}
          disabled={busy}
        >
          <AuthGlyph name="arrow" />
          返回登录
        </button>
        <h2>
          从这里开始<span>。</span>
        </h2>
        <p>创建账号，让每一行代码有所收获。</p>
      </div>
      <div className="ce-auth-fields">
        <div className="ce-auth-field-pair">
          <div className="ce-auth-field">
            <label htmlFor={`${id}-username`}>账号</label>
            <input
              id={`${id}-username`}
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              minLength={3}
              maxLength={32}
              required
              value={username}
              disabled={busy}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="3–32 位字符"
            />
          </div>
          <div className="ce-auth-field">
            <label htmlFor={`${id}-name`}>姓名</label>
            <input
              id={`${id}-name`}
              autoComplete="name"
              minLength={2}
              maxLength={30}
              required
              value={displayName}
              disabled={busy}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="课程中展示的名字"
            />
          </div>
        </div>
        <fieldset className="ce-auth-role-field" disabled={busy}>
          <legend>我的身份</legend>
          <div className="ce-auth-role-options">
            {(["student", "teacher"] as const).map((option) => (
              <label
                className={`ce-auth-role-option${role === option ? " is-selected" : ""}`}
                key={option}
              >
                <input
                  type="radio"
                  name={`${id}-role`}
                  value={option}
                  checked={role === option}
                  onChange={() => setRole(option)}
                />
                <AuthGlyph name={option} />
                <span>
                  {option === "student" ? "学生" : "教师"}
                  <small>
                    {option === "student"
                      ? "完成练习，查看反馈"
                      : "布置作业，评阅代码"}
                  </small>
                </span>
                <span className="ce-auth-radio-mark" aria-hidden="true">
                  {role === option && <AuthGlyph name="check" />}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <PasswordField
          label="设置密码"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          disabled={busy}
          hint="至少 8 个字符"
        />
        <PasswordField
          label="确认密码"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
          disabled={busy}
          placeholder="再次输入密码"
        />
      </div>
      {error && (
        <div className="ce-auth-error" id={`${id}-error`} role="alert">
          <AuthGlyph name="alert" />
          {error}
        </div>
      )}
      <SubmitButton
        busy={busy}
        label="创建并进入工作台"
        busyLabel="正在创建账号"
      />
      <p className="ce-auth-switch">
        已有账号？
        <button type="button" onClick={back} disabled={busy}>
          返回登录
          <AuthGlyph name="arrow" />
        </button>
      </p>
    </form>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  disabled,
  hint,
  placeholder = "输入密码",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  disabled: boolean;
  hint?: string;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const id = useId();
  return (
    <div className="ce-auth-field">
      <div className="ce-auth-field-label">
        <label htmlFor={id}>{label}</label>
        {hint && <span id={`${id}-hint`}>{hint}</span>}
      </div>
      <div className="ce-auth-password">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={autoComplete === "new-password" ? 8 : undefined}
          maxLength={autoComplete === "new-password" ? 72 : undefined}
          value={value}
          required
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyUp={(event) => setCapsLock(event.getModifierState("CapsLock"))}
          onBlur={() => setCapsLock(false)}
          placeholder={placeholder}
          aria-describedby={
            [hint ? `${id}-hint` : "", capsLock ? `${id}-caps` : ""]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
        <button
          type="button"
          className="ce-auth-password-toggle"
          aria-label={`${visible ? "隐藏" : "显示"}${label}`}
          aria-controls={id}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
          disabled={disabled}
        >
          <AuthGlyph name={visible ? "eye-off" : "eye"} />
        </button>
      </div>
      {capsLock && (
        <small className="ce-auth-caps" id={`${id}-caps`} role="status">
          大写锁定已开启
        </small>
      )}
    </div>
  );
}

function SubmitButton({
  busy,
  label,
  busyLabel,
}: {
  busy: boolean;
  label: string;
  busyLabel: string;
}) {
  return (
    <button className="ce-auth-submit" type="submit" disabled={busy}>
      <span>{busy ? busyLabel : label}</span>
      {busy ? (
        <span className="ce-auth-spinner" aria-hidden="true" />
      ) : (
        <AuthGlyph name="arrow" />
      )}
    </button>
  );
}

function AuthGlyph({
  name,
}: {
  name:
    | "arrow"
    | "eye"
    | "eye-off"
    | "check"
    | "code"
    | "comment"
    | "teacher"
    | "student"
    | "alert";
}) {
  const paths: Record<typeof name, ReactNode> = {
    arrow: (
      <>
        <path d="M4 12h15m-6-6 6 6-6 6" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    "eye-off": (
      <>
        <path d="m3 3 18 18M10.6 5.1 12 5c6.4 0 10 7 10 7a22 22 0 0 1-3.2 4M6.1 6.1C3.4 8.4 2 12 2 12s3.6 7 10 7a10 10 0 0 0 5-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    code: (
      <>
        <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16" />
      </>
    ),
    comment: (
      <path d="M20 15a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v9ZM7 8h9M7 12h6" />
    ),
    teacher: (
      <>
        <path d="M4 3h16v12H4V3Zm4 18 4-6 4 6M8 7h8M8 11h5" />
      </>
    ),
    student: (
      <>
        <path d="m2 8 10-5 10 5-10 5L2 8Zm4 2v7s2 3 6 3 6-3 6-3v-7m4-2v8" />
      </>
    ),
    alert: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v6m0 3v.1" />
      </>
    ),
  };
  return (
    <svg
      className="ce-auth-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
