import { vscodeClassHighlighter } from "../editor/theme";
import { highlightTree } from "@lezer/highlight";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { type ReactNode, useMemo, useState } from "react";
import type {
  SimilarityMatch,
  SimilarityPair,
  SimilaritySource,
} from "../../types";
import { Icon } from "../ui";
import Dialog from "../ui/Dialog";
import { matchLabel, similarityBand } from "./report";
import "./similarity.css";

const date = (value: string) => new Date(value).toLocaleString("zh-CN");

export default function SimilarityEvidence({
  pair,
  a,
  b,
  language,
  onClose,
}: {
  pair: SimilarityPair;
  a: SimilaritySource;
  b: SimilaritySource;
  language: string;
  onClose: () => void;
}) {
  const [matchIndex, setMatchIndex] = useState(0);
  const [wrapCode, setWrapCode] = useState(true);
  function focusMatch(index: number) {
    setMatchIndex(index);
    const match = pair.matches[index];
    if (!match) return;
    for (const side of ["a", "b"] as const) {
      const target = document.getElementById(
        `similarity-${side}-${match[side].startLine}`,
      );
      const viewer = target?.closest(".similarity-code");
      if (target && viewer) viewer.scrollTop = target.offsetTop - 24;
    }
  }
  return (
    <Dialog
      title="代码查重证据"
      note="选择相似片段，定位双方代码。相似性是复核线索，不能据此确定抄袭。"
      wide
      className="similarity-evidence-dialog"
      onClose={onClose}
    >
      <div className="similarity-evidence-toolbar">
        <div className="similarity-evidence-summary">
          <strong>
            {pair.similarity.toFixed(2)}
            <small>% 相似度</small>
          </strong>
          <RiskBadge score={pair.similarity} />
          <span>
            {pair.matches.length} 个片段，匹配 {pair.matchedTokens} 个词元
          </span>
        </div>
        <label>
          <input
            type="checkbox"
            checked={wrapCode}
            onChange={(event) => setWrapCode(event.target.checked)}
          />
          自动换行
        </label>
      </div>
      {pair.matches.length > 0 ? (
        <div
          className="similarity-match-list"
          role="group"
          aria-label="相似片段定位"
        >
          {pair.matches.map((match, i) => (
            <button
              type="button"
              key={i}
              className={i === matchIndex ? "active" : ""}
              aria-pressed={i === matchIndex}
              onClick={() => focusMatch(i)}
            >
              <b>片段 {String(i + 1).padStart(2, "0")}</b>
              <span>
                A {match.a.startLine}–{match.a.endLine} 行{" "}
                <Icon name="arrowRight" /> B {match.b.startLine}–
                {match.b.endLine} 行
              </span>
              <small>
                {matchLabel(match.kind)} · {match.tokens} 词元
              </small>
            </button>
          ))}
        </div>
      ) : (
        <p className="similarity-evidence-empty">
          未发现达到最小连续长度的相似片段，可查看双方完整代码。
        </p>
      )}
      <div className="similarity-viewers">
        <SourceViewer
          side="a"
          source={a}
          matches={pair.matches}
          active={matchIndex}
          wrap={wrapCode}
          language={language}
        />
        <SourceViewer
          side="b"
          source={b}
          matches={pair.matches}
          active={matchIndex}
          wrap={wrapCode}
          language={language}
        />
      </div>
    </Dialog>
  );
}
export function RiskBadge({ score }: { score: number }) {
  const band = similarityBand(score);
  return (
    <span className={`similarity-risk risk-${band.tone}`} title={band.range}>
      {band.label}
    </span>
  );
}
function SourceViewer({
  side,
  source,
  matches,
  active,
  wrap,
  language,
}: {
  side: "a" | "b";
  source: SimilaritySource;
  matches: SimilarityMatch[];
  active: number;
  wrap: boolean;
  language: string;
}) {
  const [copyState, setCopyState] = useState("");
  const coloredLines = useMemo(
    () => highlightCodeLines(source.code, language),
    [source.code, language],
  );
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(source.code);
      setCopyState("已复制");
    } catch {
      setCopyState("复制失败");
    }
    window.setTimeout(() => setCopyState(""), 2200);
  }
  return (
    <article className="similarity-source">
      <header>
        <span className="similarity-file-letter">{side.toUpperCase()}</span>
        <div>
          <b>{source.studentName}</b>
          <small>
            学生 {source.studentId} · 提交 #{source.id}
          </small>
        </div>
        <button
          onClick={() => void copyCode()}
          aria-label={`复制提交 ${side.toUpperCase()} 代码`}
        >
          <Icon name={copyState === "已复制" ? "check" : "code"} />
          <span role="status">{copyState || "复制代码"}</span>
        </button>
      </header>
      <pre
        className={`similarity-code ${wrap ? "wrap" : ""}`}
        tabIndex={0}
        aria-label={`提交 ${side.toUpperCase()} 代码`}
      >
        {source.code
          .replace(/\r\n/g, "\n")
          .split("\n")
          .map((text, index) => {
            const line = index + 1;
            const match = matches.findIndex(
              (item) =>
                line >= item[side].startLine && line <= item[side].endLine,
            );
            return (
              <span
                id={`similarity-${side}-${line}`}
                className={`similarity-line ${match >= 0 ? `hit tone-${match % 3}` : ""} ${match === active && match >= 0 ? "active" : ""}`}
                key={line}
              >
                <span className="similarity-line-number" aria-hidden="true">
                  {line}
                </span>
                <code>{coloredLines[index] || text || " "}</code>
              </span>
            );
          })}
      </pre>
      <footer>
        <span>{date(source.submittedAt)}</span>
        <span>
          有效 {source.tokenCount} 词元 · 排除 {source.excludedTokens}
        </span>
      </footer>
    </article>
  );
}

function highlightCodeLines(code: string, language: string): ReactNode[][] {
  const source = code.replace(/\r\n/g, "\n");
  const support = { Python: python, Java: java, "C++": cpp, Go: go }[language];
  if (!support) return source.split("\n").map((line) => [line]);
  const ranges: { from: number; to: number; classes: string }[] = [];
  highlightTree(
    support().language.parser.parse(source),
    vscodeClassHighlighter,
    (from, to, classes) => ranges.push({ from, to, classes }),
  );
  let offset = 0,
    cursor = 0;
  return source.split("\n").map((line) => {
    const end = offset + line.length,
      nodes: ReactNode[] = [];
    let position = offset;
    while (cursor < ranges.length && ranges[cursor].to <= offset) cursor++;
    for (let j = cursor; j < ranges.length && ranges[j].from < end; j++) {
      const token = ranges[j],
        from = Math.max(position, token.from),
        to = Math.min(end, token.to);
      if (from > position) nodes.push(source.slice(position, from));
      nodes.push(
        <span className={token.classes} key={j}>
          {source.slice(from, to)}
        </span>,
      );
      position = to;
    }
    if (position < end) nodes.push(source.slice(position, end));
    offset = end + 1;
    return nodes.length ? nodes : [" "];
  });
}
