import type { AIDetection } from "../../types";
import { aiAnalysisLabel, aiRateBand, formatAIRate } from "./ai-report";

export default function AIDetectionOverview({
  result,
  language,
}: {
  result: AIDetection;
  language: string;
}) {
  const band = aiRateBand(result);
  const detection = result.localDetection;
  return (
    <section
      className="ai-evidence-overview"
      data-tone={band?.tone ?? "neutral"}
      aria-label="识别结论"
    >
      <figure className="ai-evidence-chart">
        <div className="ai-weight-ring">
          <svg
            viewBox="0 0 200 200"
            role="img"
            aria-label={
              band
                ? `生成倾向分 ${formatAIRate(result)}，${band.label}。轨道为 0–100 刻度，不代表代码行数占比。`
                : "证据不足，未生成倾向分"
            }
          >
            <circle
              className="ai-evidence-ring-track"
              cx="100"
              cy="100"
              r="78"
              fill="none"
              strokeWidth="14"
            />
            {band && (
              <circle
                className="ai-evidence-ring-value"
                cx="100"
                cy="100"
                r="78"
                fill="none"
                strokeWidth="14"
                pathLength="100"
                strokeDasharray={`${result.aiRate} 100`}
                transform="rotate(-90 100 100)"
              />
            )}
          </svg>
          <div className="ai-weight-center" aria-hidden="true">
            <strong>{band ? formatAIRate(result) : "—"}</strong>
            <span>{band ? "生成倾向分" : "证据不足"}</span>
          </div>
        </div>
        <figcaption>0–100 生成倾向刻度</figcaption>
      </figure>
      <div className="ai-evidence-conclusion">
        <div className="ai-evidence-conclusion-heading">
          <h3>识别结论</h3>
          <span className={`similarity-risk risk-${band?.tone ?? "low"}`}>
            {band?.label ?? "证据不足"}
          </span>
        </div>
        <p>{result.summary}</p>
        <dl className="ai-evidence-facts">
          <div>
            <dt>{detection ? "词元覆盖" : "分析情况"}</dt>
            <dd>
              {detection
                ? `${detection.coveredTokens.toLocaleString("zh-CN")} / ${detection.totalTokens.toLocaleString("zh-CN")}`
                : aiAnalysisLabel(result)}
            </dd>
          </div>
          {detection && (
            <div>
              <dt>检测片段</dt>
              <dd>
                {detection.chunks.length}
                <small> 个</small>
              </dd>
            </div>
          )}
          <div>
            <dt>代码语言</dt>
            <dd>{language}</dd>
          </div>
        </dl>
        <p className="ai-evidence-reading-note">
          分数表示生成倾向，不是 AI 编写行数占比；请结合代码依据复核。
        </p>
      </div>
    </section>
  );
}
