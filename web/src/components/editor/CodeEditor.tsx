import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CodeMirror, { EditorView, type ReactCodeMirrorRef, type ViewUpdate } from "@uiw/react-codemirror";
import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import type { Extension } from "@codemirror/state";
import { formatDocument, hasFormatter } from "../../formatters";
import { Icon } from "../ui";
import { forestTheme } from "./theme";

const languageExtensions: Record<string, () => Extension> = {
  Python: python, Go: go, Java: java, "C++": cpp,
  JavaScript: () => javascript({ jsx: true, typescript: true }),
};
const setup = { lineNumbers: true, highlightActiveLineGutter: true, foldGutter: true, bracketMatching: true, autocompletion: true, closeBrackets: true, indentOnInput: true };

type Glyph = 'format' | 'copy' | 'expand' | 'collapse' | 'wrap' | 'lock';
function EditorGlyph({ name }: { name: Glyph }) {
  const paths = {
    format: <><path d="M8 5H4v4M16 19h4v-4M4 5l6 6M20 19l-6-6M14 5h6M16 9h4M4 15h4M4 19h6" /></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
    expand: <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>,
    collapse: <path d="M3 8h5V3M21 8h-5V3M16 21v-5h5M8 21v-5H3"/>,
    wrap: <><path d="M3 6h18M3 11h14a4 4 0 0 1 0 8h-5M3 16h3"/><path d="m15 16-3 3 3 3"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
  };
  return <svg className="editor-glyph" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function CodeEditor({ language, value, onChange = () => {}, readOnly = false, height, label, execution }: {
  language: string; value: string; onChange?: (value: string) => void; readOnly?: boolean; height?: string; label?: string;
  execution?: { passed: number; total: number };
}) {
  const editor = useRef<ReactCodeMirrorRef>(null);
  const container = useRef<HTMLDivElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const [portalHost] = useState(() => document.createElement('div'));
  const [formatState, setFormatState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const expandButton = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(false);
  const caption = label ?? (readOnly ? '提交代码' : '代码工作区');
  const lines = value ? value.split('\n').length : 1;
  const extensions = useMemo(() => {
    const lang = languageExtensions[language]?.();
    return [...(lang ? [lang] : []), ...(wrap ? [EditorView.lineWrapping] : [])];
  }, [language, wrap]);
  const basicSetup = useMemo(() => ({ ...setup, highlightActiveLine: !readOnly }), [readOnly]);

  // Move the portal's existing host: the editor, selection and undo history survive fullscreen.
  useLayoutEffect(() => {
    (expanded ? document.body : mount.current)?.appendChild(portalHost);
    return () => { portalHost.remove(); };
  }, [expanded, portalHost]);
  useEffect(() => {
    if (!expanded) {
      if (wasExpanded.current) expandButton.current?.focus({ preventScroll: true });
      wasExpanded.current = false;
      return;
    }
    wasExpanded.current = true;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    container.current?.focus({ preventScroll: true });
    return () => { document.body.style.overflow = overflow; };
  }, [expanded]);
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(copyTimer.current); }, []);

  function updatePosition(update: ViewUpdate) {
    if (!update.selectionSet && !update.docChanged) return;
    const cursor = update.state.selection.main.head;
    const line = update.state.doc.lineAt(cursor);
    setPosition(current => current.line === line.number && current.column === cursor - line.from + 1 ? current : { line: line.number, column: cursor - line.from + 1 });
  }
  async function formatCode() {
    const view = editor.current?.view;
    if (!view || readOnly || formatState === 'loading' || !hasFormatter(language)) return;
    setFormatState('loading'); setError(''); clearTimeout(timer.current);
    const original = view.state.doc.toString();
    try {
      const formatted = await formatDocument(language, original);
      if (view.state.doc.toString() !== original) throw new Error('代码已变更，请重新格式化。');
      if (formatted !== original) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: formatted } });
      setFormatState('done');
      timer.current = setTimeout(() => setFormatState('idle'), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : '代码存在语法错误，无法格式化'); setFormatState('idle');
    }
  }
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(editor.current?.view?.state.doc.toString() ?? value);
      setError(''); setCopied(true); clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch { setError('未能访问剪贴板，请选中代码后手动复制。'); }
  }

  const content = <div ref={container} tabIndex={-1} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label={expanded ? `${language} 全屏代码编辑器` : undefined} className={`code-editor studio-editor ${expanded ? 'is-expanded' : ''} ${readOnly ? 'is-readonly' : ''}`} onKeyDown={event => {
    if (!readOnly && event.shiftKey && event.altKey && event.key.toLowerCase() === 'f') { event.preventDefault(); void formatCode(); }
    if (event.key === 'Escape') setExpanded(false);
    if (expanded && event.key === 'Tab' && !event.defaultPrevented) {
      const focusable = Array.from(container.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? []);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === container.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header className="studio-header">
      <span className="studio-file-tab"><Icon name="code" /><b>{readOnly ? 'submission' : 'solution'}.{extensionFor(language)}</b><span className="studio-file-mode">{readOnly ? '只读' : '编辑'}</span></span>
      <span className="editor-tools studio-tools">
        {!readOnly && <button type="button" title="格式化代码 · Shift + Alt + F" disabled={!hasFormatter(language) || formatState === 'loading'} onClick={() => void formatCode()}>{formatState === 'done' ? <Icon name="check" /> : <EditorGlyph name="format" />}<span>{formatState === 'loading' ? '格式化中' : formatState === 'done' ? '已格式化' : '格式化'}</span></button>}
        <button type="button" className="studio-wrap" aria-pressed={wrap} aria-label="自动换行" title={wrap ? '关闭自动换行' : '开启自动换行'} onClick={() => setWrap(v => !v)}><EditorGlyph name="wrap" /><span>换行</span></button>
        <button type="button" onClick={() => void copyCode()} title="复制代码">{copied ? <Icon name="check" /> : <EditorGlyph name="copy" />}<span>{copied ? '已复制' : '复制'}</span></button>
        <button ref={expandButton} type="button" aria-pressed={expanded} onClick={() => setExpanded(v => !v)} title={expanded ? '退出全屏 · Esc' : '全屏编辑器'}><EditorGlyph name={expanded ? 'collapse' : 'expand'} /><span>{expanded ? '退出全屏' : '全屏'}</span></button>
      </span>
    </header>
    <CodeMirror ref={editor} value={value} height={height ?? (readOnly ? '420px' : '460px')} theme={forestTheme} readOnly={readOnly} editable={!readOnly} extensions={extensions} onChange={onChange} onUpdate={updatePosition} basicSetup={basicSetup} aria-label={`${caption}（${language}）`} />
    {error && <div className="studio-error" role="alert"><Icon name="alert" /><span>{error}</span><button type="button" onClick={() => setError('')}>关闭</button></div>}
    <footer className="studio-footer">
      <span className={`studio-mode ${execution && execution.total > 0 && execution.passed < execution.total ? 'has-failures' : ''}`}>
        {execution && execution.total > 0 ? <><Icon name={execution.passed === execution.total ? 'check' : 'alert'} />测试 {execution.passed} / {execution.total} 通过</> : readOnly ? <><EditorGlyph name="lock" />原始提交 · 只读</> : <><span className="studio-status-dot" />编辑模式</>}
      </span>
      <span className="studio-cursor">行 {position.line}，列 {position.column}</span>
      <span className="studio-document-size">{lines} 行<span className="studio-char-count"> · {value.length} 字符</span></span>
      <span className="studio-encoding">UTF-8</span>
    </footer>
    <span className="sr-only" role="status">{copied ? '代码已复制' : formatState === 'done' ? '代码已格式化' : ''}</span>
  </div>;
  return <div className="code-studio" ref={mount}>
    <div className="studio-caption"><span>{caption}</span><span>{readOnly ? '提交记录' : '编辑器'} / {language.toUpperCase()}</span></div>
    {createPortal(content, portalHost)}
  </div>;
}
function extensionFor(language: string) { return ({ Python:'py', Go:'go', Java:'java', 'C++':'cpp', JavaScript:'ts' } as Record<string,string>)[language] ?? 'txt'; }
