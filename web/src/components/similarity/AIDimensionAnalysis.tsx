import { useId, useRef } from "react";
import type { AIDetection } from "../../types";
import CodeEditor from "../editor/CodeEditor";
import {
  aiDimensionScoreLabel,
  aiDimensionMaxScore,
  aiDimensionStrengthLabel,
  aiLegacyScoringNote,
  aiScoringVersionNote,
  aiSampleAnalysisLabel,
  aiUsesDynamicWeights,
  aiDimensionWeight,
  aiDimensionWeightLabel,
} from "./ai-report";

function SampleMatchRecords({ result }: { result: AIDetection }) {
  const comparison = result.sampleComparison;
  if (comparison?.status !== "compared" || !comparison.samples.length)
    return null;
  return (
    <section className="ai-dimension-matches" aria-label="样本匹配明细">
      <h4>样本匹配明细</h4>
      <table>
        <thead>
          <tr>
            <th scope="col">实现方式</th>
            <th scope="col">相似度</th>
            <th scope="col">匹配词元</th>
          </tr>
        </thead>
        <tbody>
          {comparison.samples.map((sample) => (
            <tr key={sample.id}>
              <th scope="row">{sample.approach}</th>
              <td>{sample.pair.similarity.toFixed(1)}%</td>
              <td>{sample.pair.matchedTokens}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">{comparison.note}</p>
    </section>
  );
}

export default function AIDimensionAnalysis({
  result,
  language,
}: {
  result: AIDetection;
  language: string;
}) {
  const id = useId();
  const detailRefs = useRef(new Map<string, HTMLDetailsElement>());
  const dimensions = result.dimensions ?? [];
  const dynamicWeights = aiUsesDynamicWeights(result);
  const weightLabel = dynamicWeights ? "实际占比" : "基础权重";
  const percentageScale = [
    "dimensions-v5",
    "dimensions-v6",
    "dimensions-v7",
    "dimensions-v8",
  ].includes(result.scoringVersion ?? "");
  const maxScore = aiDimensionMaxScore(result);
  const scoringNote = aiScoringVersionNote(result);
  const includedCount = dimensions.filter(
    (dimension) => dimension.included && dimension.effectiveScore !== null,
  ).length;
  const totalWeight = dimensions.reduce(
    (sum, dimension) => sum + aiDimensionWeight(dimension, result),
    0,
  );
  let weightOffset = 0;

  function showDimension(key: string) {
    const detail = detailRefs.current.get(key);
    if (!detail) return;
    detail.open = true;
    detail.querySelector("summary")?.focus({ preventScroll: true });
    detail.scrollIntoView({ block: "start" });
  }

  if (!result.scoringVersion)
    return <p className="muted">{aiLegacyScoringNote}</p>;
  return (
    <section
      className="ai-dimensions"
      aria-label="多维度分析"
      data-score-max={maxScore}
    >
      <header className="ai-dimensions-heading">
        <h3>多维度分析</h3>
        <span>点击维度查看具体依据</span>
      </header>
      <p className="muted ai-dimensions-note">
        {percentageScale
          ? "各维度使用 0–100% 表示生成倾向；"
          : `每维满分 ${maxScore} 分，分数表示生成倾向；`}
        证据强度由模型单独评估，表示依据的支持程度。
        {dynamicWeights
          ? "强／中／弱系数为 3／2／1，按实际占比汇总。"
          : [
              "dimensions-v3",
              "dimensions-v4",
              "dimensions-v5",
              "dimensions-v6",
              "dimensions-v7",
              "dimensions-v8",
            ].includes(result.scoringVersion ?? "") &&
            "强度不参与计分，低分也正常参与综合计算。"}
        {["dimensions-v6", "dimensions-v7", "dimensions-v8"].includes(
          result.scoringVersion ?? "",
        )
          ? "引用重叠也正常计分；缺少材料时标为无法判断。"
          : percentageScale
            ? "未计分不等于 0%。"
            : "未计分不等于 0 分。"}
      </p>
      {scoringNote && <p className="muted">{scoringNote}</p>}
      {dimensions.length > 0 ? (
        <div className="ai-dimension-overview">
          <figure className="ai-weight-chart">
            <figcaption>维度{weightLabel}</figcaption>
            <div className="ai-weight-ring">
              <svg
                viewBox="0 0 200 200"
                role="img"
                aria-label={`维度${weightLabel}分布，${includedCount} 个维度已计分，共 ${dimensions.length} 个维度。各维度权重与得分见得分列表。`}
              >
                <circle
                  className="ai-weight-track"
                  cx="100"
                  cy="100"
                  r="76"
                  fill="none"
                  strokeWidth="18"
                />
                {dimensions.map((dimension) => {
                  const share =
                    totalWeight > 0
                      ? (aiDimensionWeight(dimension, result) / totalWeight) *
                        100
                      : 0;
                  const offset = weightOffset;
                  weightOffset += share;
                  return (
                    <circle
                      key={dimension.key}
                      data-dimension={dimension.key}
                      className={`ai-weight-segment${dimension.included && dimension.effectiveScore !== null ? "" : " is-excluded"}`}
                      cx="100"
                      cy="100"
                      r="76"
                      fill="none"
                      strokeWidth="18"
                      pathLength="100"
                      strokeDasharray={`${Math.max(0, share - 1.5)} ${100 - Math.max(0, share - 1.5)}`}
                      strokeDashoffset={-offset}
                      transform="rotate(-90 100 100)"
                    >
                      <title>
                        {dimension.label}：
                        {aiDimensionWeightLabel(dimension, result)}，
                        {aiDimensionScoreLabel(dimension, result)}
                      </title>
                    </circle>
                  );
                })}
              </svg>
              <div className="ai-weight-center" aria-hidden="true">
                <strong>
                  {includedCount}
                  <small> / {dimensions.length}</small>
                </strong>
                <span>已计分维度</span>
              </div>
            </div>
            <p>
              {dynamicWeights
                ? "扇区表示实际占比，按证据强弱分配；未计分维度占比为 0。"
                : "扇区表示基础权重，灰色为未计分。"}
            </p>
          </figure>
          <div className="ai-dimension-scores" aria-label="维度得分对比">
            <div className="ai-dimension-scale">
              <span>维度 / {weightLabel}</span>
              <span>{percentageScale ? "生成倾向（%）" : "生成倾向得分"}</span>
            </div>
            {dimensions.map((dimension) => {
              const scored =
                dimension.included && dimension.effectiveScore !== null;
              return (
                <button
                  type="button"
                  key={dimension.key}
                  data-dimension={dimension.key}
                  className={`ai-dimension-score-row${scored ? "" : " is-excluded"}`}
                  aria-controls={`${id}-${dimension.key}`}
                  aria-label={`${dimension.label}，${aiDimensionWeightLabel(dimension, result)}，${aiDimensionScoreLabel(dimension, result)}，${aiDimensionStrengthLabel(dimension.strength)}，查看依据`}
                  onClick={() => showDimension(dimension.key)}
                >
                  <span className="ai-dimension-score-title">
                    <span className="ai-dimension-dot" aria-hidden="true" />
                    <b>{dimension.label}</b>
                    <small>
                      {dynamicWeights
                        ? aiDimensionWeight(dimension, result).toFixed(1)
                        : dimension.weight}
                      %
                    </small>
                  </span>
                  <span className="ai-dimension-score-value">
                    {aiDimensionScoreLabel(dimension, result)}
                  </span>
                  <span
                    className="ai-dimension-evidence-strength"
                    data-strength={dimension.strength}
                  >
                    {aiDimensionStrengthLabel(dimension.strength)}
                    {dimension.key === "sample_match" && (
                      <span className="ai-sample-analysis-status">
                        {aiSampleAnalysisLabel(result)}
                      </span>
                    )}
                  </span>
                  <span className="ai-dimension-meter" aria-hidden="true">
                    {scored && (
                      <span
                        style={{
                          width: `${(Math.min(maxScore, Math.max(0, dimension.effectiveScore!)) / maxScore) * 100}%`,
                        }}
                      />
                    )}
                  </span>
                </button>
              );
            })}
            <div className="ai-dimension-scale">
              <span>{percentageScale ? "0%" : "0"} · 低生成倾向</span>
              <span>
                {maxScore}
                {percentageScale ? "%" : ""} · 高生成倾向
              </span>
            </div>
          </div>
        </div>
      ) : (
        <p className="muted">
          此报告未记录维度数据，重新生成后可查看详细分析。
        </p>
      )}
      {dimensions.map((dimension) => (
        <details
          className="ai-dimension"
          data-dimension={dimension.key}
          id={`${id}-${dimension.key}`}
          key={dimension.key}
          ref={(element) => {
            if (element) detailRefs.current.set(dimension.key, element);
            else detailRefs.current.delete(dimension.key);
          }}
        >
          <summary>
            <span className="ai-dimension-dot" aria-hidden="true" />
            <span className="ai-dimension-title">
              {dimension.label}
              <small>
                {aiDimensionWeightLabel(dimension, result)} ·{" "}
                {dimension.evidenceBasis === "sample_comparison"
                  ? `${result.sampleComparison?.samples.length ?? 0} 份样本整体分析 · ${dimension.evidence.length} 条匹配引用`
                  : `${dimension.evidence.length} 条依据`}{" "}
                · {aiDimensionStrengthLabel(dimension.strength)}
                {dimension.key === "sample_match" && (
                  <span className="ai-sample-analysis-status">
                    {aiSampleAnalysisLabel(result)}
                  </span>
                )}
              </small>
            </span>
            <b
              className={`ai-dimension-score-badge${dimension.included && dimension.effectiveScore !== null ? "" : " is-excluded"}`}
            >
              {aiDimensionScoreLabel(dimension, result)}
            </b>
            <span className="ai-dimension-chevron" aria-hidden="true">
              ⌄
            </span>
          </summary>
          <div className="ai-dimension-body">
            <p className="ai-dimension-strength">
              <b>{aiDimensionStrengthLabel(dimension.strength)}</b>
              {dimension.score !== null &&
              dimension.score !== dimension.effectiveScore
                ? percentageScale
                  ? `分析原始值 ${dimension.score}%`
                  : `分析原始分 ${dimension.score}/${maxScore}`
                : ""}
            </p>
            <p>{dimension.reason}</p>
            {dimension.exclusionReason && (
              <p className="ai-dimension-context">
                <b>
                  {["dimensions-v6", "dimensions-v7", "dimensions-v8"].includes(
                    result.scoringVersion ?? "",
                  )
                    ? "无法判断原因"
                    : "未计分原因"}
                </b>
                {dimension.exclusionReason}
              </p>
            )}
            {dimension.key === "sample_match" && (
              <SampleMatchRecords result={result} />
            )}
            {dimension.evidence.map((item, index) => (
              <article className="ai-detection-evidence" key={index}>
                <b>
                  第 {item.startLine}
                  {item.endLine !== item.startLine ? `–${item.endLine}` : ""} 行
                  {" · "}
                  {item.counted
                    ? "参与计分"
                    : [
                          "dimensions-v6",
                          "dimensions-v7",
                          "dimensions-v8",
                        ].includes(result.scoringVersion ?? "")
                      ? "引用未用于计算，原因见维度说明"
                      : "重复或公共框架引用，不计分"}
                </b>
                <CodeEditor
                  language={language}
                  value={item.quote}
                  readOnly
                  allowFullscreen={false}
                  height="260px"
                  label={`提交片段 · 第 ${item.startLine}–${item.endLine} 行`}
                />
                <p>{item.explanation}</p>
                {item.sourceQuote && (
                  <>
                    <b>
                      对照
                      {dimension.key === "sample_match"
                        ? " AI 样本"
                        : "历史提交"}{" "}
                      #{item.sourceId}
                      {" · "}第 {item.sourceStartLine}–{item.sourceEndLine} 行
                    </b>
                    <CodeEditor
                      language={language}
                      value={item.sourceQuote}
                      readOnly
                      allowFullscreen={false}
                      height="260px"
                      label={`对照${dimension.key === "sample_match" ? " AI 样本" : "历史提交"} #${item.sourceId} · 第 ${item.sourceStartLine}–${item.sourceEndLine} 行`}
                    />
                  </>
                )}
              </article>
            ))}
          </div>
        </details>
      ))}
      {!dimensions.some((dimension) => dimension.key === "sample_match") && (
        <SampleMatchRecords result={result} />
      )}
    </section>
  );
}
