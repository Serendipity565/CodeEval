import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import CodeMirror, {
  EditorView,
  EditorState,
  type ReactCodeMirrorRef,
  type ViewUpdate,
} from "@uiw/react-codemirror";
import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import type { Extension } from "@codemirror/state";
import {
  gotoLine,
  openSearchPanel,
  search,
  searchPanelOpen,
} from "@codemirror/search";
import { formatDocument, hasFormatter } from "../../formatters";
import { Icon } from "../ui";
import { forestTheme } from "./theme";

const languageExtensions: Record<string, () => Extension> = {
  Python: python,
  Go: go,
  Java: java,
  "C++": cpp,
  JavaScript: () => javascript({ jsx: true, typescript: true }),
};
const setup = {
  lineNumbers: true,
  highlightActiveLineGutter: true,
  foldGutter: true,
  bracketMatching: true,
  autocompletion: true,
  closeBrackets: true,
  indentOnInput: true,
};
const noop = () => {};

const editorPhrases = EditorState.phrases.of({
  Find: "查找代码",
  Replace: "替换为",
  next: "下一个",
  previous: "上一个",
  all: "选中全部",
  "match case": "区分大小写",
  regexp: "正则表达式",
  "by word": "全词匹配",
  replace: "替换",
  "replace all": "全部替换",
  close: "关闭面板",
  "Go to line": "跳转到行",
  go: "跳转",
  "current match": "当前匹配",
  "on line": "所在行",
  "replaced match on line $": "已替换第 $ 行的匹配项",
  "replaced $ matches": "已替换 $ 处匹配项",
  "Fold line": "折叠代码行",
  "Unfold line": "展开代码行",
});

type Glyph =
  "format" | "copy" | "expand" | "collapse" | "wrap" | "lock" | "search";
function EditorGlyph({ name }: { name: Glyph }) {
  const paths = {
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    format: (
      <>
        <path d="M8 5H4v4M16 19h4v-4M4 5l6 6M20 19l-6-6M14 5h6M16 9h4M4 15h4M4 19h6" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
      </>
    ),
    expand: <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" />,
    collapse: <path d="M3 8h5V3M21 8h-5V3M16 21v-5h5M8 21v-5H3" />,
    wrap: (
      <>
        <path d="M3 6h18M3 11h14a4 4 0 0 1 0 8h-5M3 16h3" />
        <path d="m15 16-3 3 3 3" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
      </>
    ),
  };
  return (
    <svg
      className="editor-glyph"
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

export default function CodeEditor({
  language,
  value,
  onChange = noop,
  readOnly = false,
  allowFullscreen = true,
  height,
  label,
  execution,
}: {
  language: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  allowFullscreen?: boolean;
  height?: string;
  label?: string;
  execution?: { passed: number; total: number };
}) {
  const editor = useRef<ReactCodeMirrorRef>(null);
  const container = useRef<HTMLDivElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const [portalHost] = useState(() => document.createElement("div"));
  const [formatState, setFormatState] = useState<"idle" | "loading" | "done">(
    "idle",
  );
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [searchOpen, setSearchOpen] = useState(false);
  const [position, setPosition] = useState({ line: 1, column: 1, selected: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const expandButton = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(false);
  const caption = label ?? (readOnly ? "提交代码" : "代码工作区");
  const lines = value ? value.split("\n").length : 1;
  const extensions = useMemo(() => {
    const lang = languageExtensions[language]?.();
    return [
      ...(lang ? [lang] : []),
      ...(wrap ? [EditorView.lineWrapping] : []),
      search({ top: true }),
      editorPhrases,
      EditorView.contentAttributes.of({
        "aria-label": `${caption}（${language}${readOnly ? "，只读" : ""}）`,
        tabindex: "0",
      }),
    ];
  }, [language, wrap, caption, readOnly]);
  const basicSetup = useMemo(
    () => ({ ...setup, highlightActiveLine: !readOnly }),
    [readOnly],
  );
  useEffect(() => {
    editor.current?.view?.requestMeasure();
  }, [fontSize]);

  // Move the portal's existing host: the editor, selection and undo history survive fullscreen.
  useLayoutEffect(() => {
    (expanded ? document.body : mount.current)?.appendChild(portalHost);
    return () => {
      portalHost.remove();
    };
  }, [expanded, portalHost]);
  useEffect(() => {
    if (!expanded) {
      if (wasExpanded.current)
        expandButton.current?.focus({ preventScroll: true });
      wasExpanded.current = false;
      return;
    }
    wasExpanded.current = true;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    container.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [expanded]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(copyTimer.current);
    },
    [],
  );

  const updatePosition = useCallback((update: ViewUpdate) => {
    const isSearchOpen = searchPanelOpen(update.state);
    setSearchOpen((current) =>
      current === isSearchOpen ? current : isSearchOpen,
    );
    if (!update.selectionSet && !update.docChanged) return;
    const cursor = update.state.selection.main.head;
    const line = update.state.doc.lineAt(cursor);
    const selected = update.state.selection.ranges.reduce(
      (total, range) => total + range.to - range.from,
      0,
    );
    setPosition((current) =>
      current.line === line.number &&
      current.column === cursor - line.from + 1 &&
      current.selected === selected
        ? current
        : { line: line.number, column: cursor - line.from + 1, selected },
    );
  }, []);
  async function formatCode() {
    const view = editor.current?.view;
    if (
      !view ||
      readOnly ||
      formatState === "loading" ||
      !hasFormatter(language)
    )
      return;
    setFormatState("loading");
    setError("");
    clearTimeout(timer.current);
    const original = view.state.doc.toString();
    try {
      const formatted = await formatDocument(language, original);
      if (view.state.doc.toString() !== original)
        throw new Error("代码已变更，请重新格式化。");
      if (formatted !== original)
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: formatted },
        });
      setFormatState("done");
      timer.current = setTimeout(() => setFormatState("idle"), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "代码存在语法错误，无法格式化");
      setFormatState("idle");
    }
  }
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(
        editor.current?.view?.state.doc.toString() ?? value,
      );
      setError("");
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("未能访问剪贴板，请选中代码后手动复制。");
    }
  }

  const content = (
    <div
      ref={container}
      tabIndex={-1}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded || undefined}
      aria-label={expanded ? `${language} 全屏代码编辑器` : undefined}
      className={`code-editor studio-editor ${expanded ? "is-expanded" : ""} ${readOnly ? "is-readonly" : ""}`}
      style={{ "--editor-font-size": `${fontSize}px` } as CSSProperties}
      // CodeMirror's line dialog owns its form; do not submit the surrounding assignment.
      onSubmit={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (
          !readOnly &&
          event.shiftKey &&
          event.altKey &&
          event.key.toLowerCase() === "f"
        ) {
          event.preventDefault();
          void formatCode();
        }
        if (expanded && event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          setExpanded(false);
        }
        if (expanded && event.key === "Tab" && !event.defaultPrevented) {
          const focusable = Array.from(
            container.current?.querySelectorAll<HTMLElement>(
              'button, input, select, textarea, a[href], [contenteditable="true"], [tabindex]',
            ) ?? [],
          ).filter(
            (element) =>
              element.tabIndex >= 0 &&
              !element.matches(":disabled") &&
              element.getClientRects().length > 0,
          );
          const first = focusable[0],
            last = focusable[focusable.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === container.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <header className="studio-header">
        <span className="studio-file-tab">
          <Icon name="code" />
          <span className="studio-file-name">
            {expanded && <small>{caption}</small>}
            <b>
              {readOnly ? "submission" : "solution"}.{extensionFor(language)}
            </b>
          </span>
          <span className="studio-file-mode">{readOnly ? "只读" : "编辑"}</span>
        </span>
        <span
          className="editor-tools studio-tools"
          role="group"
          aria-label="代码工具"
        >
          {!readOnly && (
            <button
              type="button"
              className="studio-format"
              data-state={formatState}
              aria-label="格式化代码"
              aria-busy={formatState === "loading"}
              title="格式化代码 · Shift + Alt + F"
              disabled={!hasFormatter(language) || formatState === "loading"}
              onClick={() => void formatCode()}
            >
              {formatState === "done" ? (
                <Icon name="check" />
              ) : (
                <EditorGlyph name="format" />
              )}
              <span>
                {formatState === "loading"
                  ? "格式化中"
                  : formatState === "done"
                    ? "已格式化"
                    : "格式化"}
              </span>
            </button>
          )}
          <button
            type="button"
            aria-label="查找代码"
            aria-expanded={searchOpen}
            title="查找代码 · Ctrl / ⌘ + F"
            onClick={() => {
              if (editor.current?.view) openSearchPanel(editor.current.view);
            }}
          >
            <EditorGlyph name="search" />
            <span>查找</span>
          </button>
          <button
            type="button"
            className="studio-wrap"
            aria-pressed={wrap}
            aria-label="自动换行"
            title={wrap ? "关闭自动换行" : "开启自动换行"}
            onClick={() => setWrap((v) => !v)}
          >
            <EditorGlyph name="wrap" />
            <span>换行</span>
          </button>
          <button
            type="button"
            className="studio-copy"
            data-state={copied ? "done" : "idle"}
            aria-label="复制代码"
            onClick={() => void copyCode()}
            title="复制代码"
          >
            {copied ? <Icon name="check" /> : <EditorGlyph name="copy" />}
            <span>{copied ? "已复制" : "复制"}</span>
          </button>
          {allowFullscreen && (
            <button
              ref={expandButton}
              type="button"
              className="studio-expand"
              aria-label={expanded ? "退出全屏" : "全屏编辑器"}
              aria-pressed={expanded}
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? "退出全屏 · Esc" : "全屏编辑器"}
            >
              <EditorGlyph name={expanded ? "collapse" : "expand"} />
              <span>{expanded ? "退出" : "全屏"}</span>
            </button>
          )}
        </span>
      </header>
      <CodeMirror
        ref={editor}
        value={value}
        height={readOnly ? "auto" : (height ?? "460px")}
        minHeight={readOnly ? "180px" : undefined}
        maxHeight={readOnly && !expanded ? (height ?? "420px") : undefined}
        theme={forestTheme}
        readOnly={readOnly}
        editable={!readOnly}
        extensions={extensions}
        onChange={onChange}
        onUpdate={updatePosition}
        basicSetup={basicSetup}
        placeholder={readOnly ? "此提交没有代码内容" : "在这里写下你的解答…"}
      />
      {error && (
        <div className="studio-error" role="alert">
          <Icon name="alert" />
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>
            关闭
          </button>
        </div>
      )}
      <footer className="studio-footer">
        <span
          className={`studio-mode ${execution && execution.total > 0 && execution.passed < execution.total ? "has-failures" : ""}`}
        >
          {execution && execution.total > 0 ? (
            <>
              <Icon
                name={execution.passed === execution.total ? "check" : "alert"}
              />
              测试 {execution.passed} / {execution.total} 通过
            </>
          ) : readOnly ? (
            <>
              <EditorGlyph name="lock" />
              原始提交 · 只读
            </>
          ) : (
            <>
              <span className="studio-status-dot" />
              编辑模式
            </>
          )}
        </span>
        <button
          type="button"
          className="studio-cursor"
          title="跳转到指定行 · Ctrl / ⌘ + Alt + G"
          aria-label={`跳转到行，当前第 ${position.line} 行，第 ${position.column} 列`}
          onClick={() => {
            if (editor.current?.view) gotoLine(editor.current.view);
          }}
        >
          行 {position.line}，列 {position.column}
        </button>
        <span
          className={`studio-document-size ${position.selected ? "has-selection" : ""}`}
        >
          {position.selected ? (
            `已选 ${position.selected} 字符`
          ) : (
            <>
              {lines} 行
              <span className="studio-char-count"> · {value.length} 字符</span>
            </>
          )}
        </span>
        <span
          className="studio-type-controls"
          role="group"
          aria-label="代码字号"
        >
          <button
            type="button"
            aria-label="缩小代码字号"
            disabled={fontSize <= 12}
            onClick={() => setFontSize((size) => Math.max(12, size - 1))}
          >
            A−
          </button>
          <button
            type="button"
            className="studio-type-reset"
            aria-label={`当前字号 ${fontSize}，恢复默认字号`}
            title="恢复默认字号"
            onClick={() => setFontSize(14)}
          >
            {fontSize}
          </button>
          <button
            type="button"
            aria-label="放大代码字号"
            disabled={fontSize >= 20}
            onClick={() => setFontSize((size) => Math.min(20, size + 1))}
          >
            A+
          </button>
        </span>
      </footer>
      <span className="sr-only" role="status">
        {copied ? "代码已复制" : formatState === "done" ? "代码已格式化" : ""}
      </span>
    </div>
  );
  return (
    <div className="code-studio" ref={mount}>
      <div className="studio-caption">
        <span>{caption}</span>
        <span>
          {readOnly ? "提交记录" : "编辑器"} / {language.toUpperCase()}
        </span>
      </div>
      {createPortal(content, portalHost)}
    </div>
  );
}
function extensionFor(language: string) {
  return (
    (
      {
        Python: "py",
        Go: "go",
        Java: "java",
        "C++": "cpp",
        JavaScript: "ts",
      } as Record<string, string>
    )[language] ?? "txt"
  );
}
