import { useRef, useState } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import type { Extension } from "@codemirror/state";
import { formatDocument, hasFormatter } from "../../formatters";

const languageExtensions: Record<string, () => Extension> = {
  Python: python,
  Go: go,
  Java: java,
  "C++": cpp,
  JavaScript: () => javascript({ jsx: true, typescript: true }),
};

export default function CodeEditor({
  language,
  value,
  onChange = () => {},
  readOnly = false,
  height,
}: {
  language: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
}) {
  const editor = useRef<ReactCodeMirrorRef>(null);
  const [formatState, setFormatState] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [formatError, setFormatError] = useState("");
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const extension = languageExtensions[language]?.();
  const lines = value ? value.split("\n").length : 1;

  async function formatCode() {
    const view = editor.current?.view;
    if (!view) return;
    setFormatState("loading");
    setFormatError("");
    try {
      const formatted = await formatDocument(
        language,
        view.state.doc.toString(),
      );
      if (formatted !== view.state.doc.toString()) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: formatted },
        });
      }
      setFormatState("done");
      window.setTimeout(() => setFormatState("idle"), 1600);
    } catch (error) {
      setFormatError(
        error instanceof Error ? error.message : "代码存在语法错误，无法格式化",
      );
      setFormatState("error");
    }
  }

  async function copyCode() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div
      className={`code-editor ${expanded ? "is-expanded" : ""}`}
      onKeyDown={(event) => {
        if (event.shiftKey && event.altKey && event.key.toLowerCase() === "f") {
          event.preventDefault();
          void formatCode();
        }
        if (event.key === "Escape") setExpanded(false);
      }}
    >
      <header>
        <span>
          <i />
          <b>solution.{extensionFor(language)}</b>
        </span>
        <span className="editor-tools">
          <em>{language}</em>
          {!readOnly && (
            <button
              type="button"
              disabled={!hasFormatter(language) || formatState === "loading"}
              onClick={() => void formatCode()}
            >
              {formatState === "loading"
                ? "正在格式化…"
                : formatState === "done"
                  ? "✓ 已格式化"
                  : "格式化"}
            </button>
          )}
          <button type="button" onClick={() => void copyCode()}>
            {copied ? "✓ 已复制" : "复制"}
          </button>
          <button type="button" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "退出全屏" : "全屏"}
          </button>
        </span>
      </header>
      <CodeMirror
        ref={editor}
        value={value}
        height={
          expanded
            ? "calc(100vh - 70px)"
            : (height ?? (readOnly ? "420px" : "460px"))
        }
        theme="dark"
        readOnly={readOnly}
        editable={!readOnly}
        extensions={extension ? [extension] : []}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: !readOnly,
          foldGutter: true,
          bracketMatching: true,
          autocompletion: true,
          closeBrackets: true,
          indentOnInput: true,
        }}
      />
      {formatError && (
        <div className="format-error">
          <span>格式化失败</span>
          {formatError}
          <button
            type="button"
            onClick={() => {
              setFormatError("");
              setFormatState("idle");
            }}
          >
            关闭
          </button>
        </div>
      )}
      <footer>
        <span>UTF-8</span>
        <span>空格缩进</span>
        <span>
          {lines} 行 · {value.length} 字符
        </span>
      </footer>
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
