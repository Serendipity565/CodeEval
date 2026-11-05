import type { AIDetection } from "../../types";
import CodeEditor from "../editor/CodeEditor";

export default function LocalDetectionAnalysis({ result, language, code }: {
  result: AIDetection;
  language: string;
  code: string;
}) {
  const detection = result.localDetection;
  if (!detection) return null;
  const lines = code.split("\n");
  return (
    <section className="ai-dimensions" aria-label="代码片段检测">
      <h3>代码片段检测</h3>
      <p className="muted">
        完整分析 {detection.coveredTokens}/{detection.totalTokens} 个代码词元，
        共 {detection.chunks.length} 个片段。分数表示分类器的生成倾向，
        不是 AI 编写行数占比。片段范围用于复核，不表示其中每行均由 AI 编写。
      </p>
      {detection.chunks.map((chunk) => (
        <details className="ai-detection-evidence" key={chunk.index}>
          <summary>
            片段 {chunk.index} · 第 {chunk.startLine}–{chunk.endLine} 行 ·
            生成倾向 {(chunk.aiScore * 100).toFixed(1)}%
          </summary>
          <p className="muted">
            内容词元 {chunk.tokenCount} 个，新增覆盖 {chunk.weightTokens} 个。
            以下展示原始代码对应行；模型窗口可能从行中间开始或结束。
          </p>
          <CodeEditor
            language={language}
            value={lines.slice(chunk.startLine - 1, chunk.endLine).join("\n")}
            readOnly allowFullscreen={false} height="260px"
            label={`检测片段 ${chunk.index} · 第 ${chunk.startLine}–${chunk.endLine} 行`}
          />
        </details>
      ))}
    </section>
  );
}
