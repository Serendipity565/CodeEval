import { useState } from "react";
import type { AIDetection } from "../../types";
import CodeEditor from "../editor/CodeEditor";
import { aiRateBand, formatAIRate } from "./ai-report";

type DetectionChunk = NonNullable<
  AIDetection["localDetection"]
>["chunks"][number];

function ChunkEvidence({
  chunk,
  language,
  lines,
  initialOpen,
}: {
  chunk: DetectionChunk;
  language: string;
  lines: string[];
  initialOpen: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const rate = Math.min(100, Math.max(0, chunk.aiScore * 100));
  const score = { status: "estimated" as const, aiRate: rate };
  const band = aiRateBand(score);
  return (
    <details
      className="ai-chunk-evidence"
      data-tone={band?.tone ?? "neutral"}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="ai-chunk-index" aria-hidden="true">
          {String(chunk.index).padStart(2, "0")}
        </span>
        <span className="ai-chunk-title">
          <b>片段 {chunk.index}</b>
          <small>
            第 {chunk.startLine}–{chunk.endLine} 行
          </small>
        </span>
        <span className="ai-chunk-meter" aria-hidden="true">
          <span style={{ width: `${rate}%` }} />
        </span>
        <span className="ai-chunk-score">
          <b>{formatAIRate(score)}</b>
          <small>{band?.label ?? "生成倾向"}</small>
        </span>
        <span className="ai-report-note-chevron" aria-hidden="true" />
      </summary>
      {open && (
        <div className="ai-chunk-body">
          <div className="ai-chunk-context">
            <span>
              内容词元 <b>{chunk.tokenCount}</b> 个
            </span>
            <span>
              新增覆盖 <b>{chunk.weightTokens}</b> 个
            </span>
          </div>
          <CodeEditor
            language={language}
            value={lines.slice(chunk.startLine - 1, chunk.endLine).join("\n")}
            readOnly
            allowFullscreen={false}
            height="300px"
            label={`检测片段 ${chunk.index} · 第 ${chunk.startLine}–${chunk.endLine} 行`}
          />
          <p className="muted">
            展示原始代码对应行；检测窗口可能从行中间开始或结束，片段范围不表示每行均由
            AI 编写。
          </p>
        </div>
      )}
    </details>
  );
}

export default function LocalDetectionAnalysis({
  result,
  language,
  code,
}: {
  result: AIDetection;
  language: string;
  code: string;
}) {
  const detection = result.localDetection;
  if (!detection) return null;
  const lines = code.replace(/\r\n/g, "\n").split("\n");
  return (
    <section
      className="ai-dimensions ai-local-analysis"
      aria-label="代码片段检测"
    >
      <header className="ai-dimensions-heading">
        <h3>代码片段检测</h3>
        <span>展开片段查看代码依据</span>
      </header>
      <p className="muted ai-dimensions-note">
        {detection.truncated || detection.coveredTokens < detection.totalTokens
          ? "已分析"
          : "完整分析"}{" "}
        {detection.coveredTokens.toLocaleString("zh-CN")} /{" "}
        {detection.totalTokens.toLocaleString("zh-CN")} 个代码词元， 共{" "}
        {detection.chunks.length}{" "}
        个片段。各片段分数独立展示，综合分按新增覆盖词元加权。
      </p>
      {detection.chunks.length ? (
        <div className="ai-chunk-list">
          {detection.chunks.map((chunk, index) => (
            <ChunkEvidence
              key={chunk.index}
              chunk={chunk}
              language={language}
              lines={lines}
              initialOpen={index === 0}
            />
          ))}
        </div>
      ) : (
        <p className="ai-chunk-empty">
          本次报告没有可展示的检测片段，可展开下方完整原始代码复核。
        </p>
      )}
    </section>
  );
}
