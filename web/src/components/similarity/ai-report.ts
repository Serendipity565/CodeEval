import type { AIDetection, AIDimension, Submission } from "../../types";

export type AIDetectionRow = {
  source: Submission;
  state: "pending" | "running" | "done" | "error" | "stopped";
  result?: AIDetection;
  error?: string;
};
export type AIDetectionReport = {
  assignmentId: string;
  language: string;
  selection: "latest_per_student" | "selected_submission";
  generatedAt: string;
  rows: AIDetectionRow[];
};
export const aiRateBands = [
  { min: 0, range: "0% ≤ AI 率 < 30%", label: "低生成倾向", tone: "low" },
  {
    min: 30,
    range: "30% ≤ AI 率 < 50%",
    label: "部分生成倾向",
    tone: "moderate",
  },
  {
    min: 50,
    range: "50% ≤ AI 率 < 80%",
    label: "较高生成倾向",
    tone: "suspected",
  },
  { min: 80, range: "80% ≤ AI 率 ≤ 100%", label: "高生成倾向", tone: "high" },
] as const;
export type AIResultFilter =
  "all" | (typeof aiRateBands)[number]["tone"] | "insufficient" | "unfinished";
export type AIResultSort = "rate_desc" | "rate_asc" | "student";
export const aiRateBandNote = "按 AI 率划分生成倾向；证据不足单独标记。";
export const aiDetectionMethod =
  "报告可能采用代码分类检测或上下文多维度分析，具体方法见每份报告。分类检测按片段新增覆盖词元数加权，维度分析按保存的权重规则汇总。分数均表示生成倾向，不是 AI 编写行数占比或已校准概率；不同方法的结果应分别评估，不能直接平均或比较为同一种测量值。";
export const aiLegacyScoringNote =
  "旧版报告：总分为模型直接估计，未记录多维度评分；重新生成后使用新规则。";
export function aiScoringVersionNote(result: AIDetection) {
  if (result.localDetection)
    return "代码分类检测：按片段新增覆盖词元数加权；未生成五维度分数或来源解释。当前权重尚未通过本项目课程样本验证。";
  if (result.scoringVersion === "dimensions-v8")
    return "动态权重：强／中／弱证据系数为 3／2／1，基础权重乘以系数后归一化为实际占比；按实际占比汇总原始维度分。";
  if (result.scoringVersion === "dimensions-v7")
    return (
      "此报告使用固定权重；重新生成后按证据强弱调整占比。样本维度由 AI 结合三份样本源码与比对统计评分；没有连续匹配片段也正常评分。词元匹配率与生成倾向值分别展示，匹配率不直接充当维度分数。" +
      (result.citationVersion === "source-blocks-v1"
        ? "代码依据通过服务器片段编号定位，原文与行号由服务器提取。"
        : result.dimensions?.some((d) =>
              d.reason.includes("模型修正后引用仍未通过源码校验"),
            )
          ? "这份旧报告曾因引用定位失败丢失维度；需点击重新生成，使用已修复的片段编号定位。"
          : "") +
      (result.recalculatedFromVersion
        ? "已使用保存的原始分析值重新汇总，未重新调用 AI，原始报告保留；缺失的样本分析值需重新生成。"
        : "")
    );
  if (
    ["dimensions-v6", "dimensions-v7", "dimensions-v8"].includes(
      result.scoringVersion ?? "",
    ) &&
    result.recalculatedFromVersion
  )
    return "已用保存的原始分析值重新汇总，各维度不再因引用重叠或证据强弱被排除；未重新调用 AI，原始报告保留。缺少样本分析值时需重新生成，由 AI 结合三份源码评分。";
  if (result.scoringVersion === "dimensions-v1")
    return "此报告使用三维度旧规则，并按证据强度限制计分；重新检测后使用五维度百分比量表，并按证据强弱调整占比。";
  if (result.scoringVersion === "dimensions-v2")
    return "此报告使用旧评分规则，证据强度曾影响出分和分数上限；重新检测后使用 0–100% 百分比量表，并按证据强弱调整占比。";
  if (result.scoringVersion === "dimensions-v3")
    return "此报告使用每维满分 4 分的旧量表；重新检测后使用 0–100% 百分比量表。原分数和综合结果保持不变。";
  if (result.scoringVersion === "dimensions-v4")
    return "此报告使用每维满分 10 分的旧量表；重新检测后使用 0–100% 百分比量表。原分数和综合结果保持不变。";
  if (result.scoringVersion === "dimensions-v5")
    return "此报告使用旧的跨维度去重规则；新规则保留每个已有分析值的维度，不再因引用重叠排除分数。";
  if (result.scoringVersion === "dimensions-v6")
    return "此报告使用旧的样本分析规则；重新生成后，即使没有连续匹配片段也由 AI 分析三份样本并评分。";
  return "";
}
export function aiAnalysisLabel(result: AIDetection) {
  if (result.localDetection)
    return `代码分类 · ${result.localDetection.chunks.length} 个片段 · 词元覆盖 ${result.localDetection.coveredTokens}/${result.localDetection.totalTokens}`;
  if (
    [
      "dimensions-v3",
      "dimensions-v4",
      "dimensions-v5",
      "dimensions-v6",
      "dimensions-v7",
      "dimensions-v8",
    ].includes(result.scoringVersion ?? "")
  ) {
    const dimensions = result.dimensions ?? [];
    const included = dimensions.filter(
      (d) => d.included && d.effectiveScore !== null,
    ).length;
    return `可用维度 ${included}/${dimensions.length} · 权重覆盖 ${((result.coverage ?? 0) * 100).toFixed(0)}%`;
  }
  return result.scoringVersion
    ? `维度覆盖率 ${((result.coverage ?? 0) * 100).toFixed(0)}%`
    : `判断置信度 ${(result.confidence * 100).toFixed(0)}%`;
}
export function aiUsesDynamicWeights(
  result: Pick<AIDetection, "scoringVersion">,
) {
  return result.scoringVersion === "dimensions-v8";
}
export function aiDimensionWeight(dimension: AIDimension, result: AIDetection) {
  return aiUsesDynamicWeights(result)
    ? (dimension.effectiveWeight ?? 0)
    : dimension.weight;
}
export function aiDimensionWeightLabel(
  dimension: AIDimension,
  result: AIDetection,
) {
  return aiUsesDynamicWeights(result)
    ? `实际占比 ${aiDimensionWeight(dimension, result).toFixed(1)}%`
    : `基础权重 ${dimension.weight}%`;
}
export function aiDimensionStrengthLabel(strength: AIDimension["strength"]) {
  return {
    none: "证据强度：无可用证据",
    weak: "证据强度：弱",
    moderate: "证据强度：中等",
    strong: "证据强度：强",
  }[strength];
}
export function aiSampleAnalysisLabel(result: AIDetection) {
  const comparison = result.sampleComparison;
  if (comparison?.status !== "compared") return "本报告未完成样本比对";
  const count = comparison.samples.length;
  const matches = comparison.samples.reduce(
    (sum, sample) => sum + sample.pair.matchedTokens,
    0,
  );
  const dimension = result.dimensions?.find((d) => d.key === "sample_match");
  if (dimension?.evidenceBasis === "sample_comparison" && dimension.included)
    return `已比对 ${count} 份样本；最高匹配率 ${Math.max(...comparison.samples.map((sample) => sample.pair.similarity)).toFixed(2)}%；生成倾向由 AI 分析评分，参与综合计算`;
  if (
    dimension?.included &&
    ["dimensions-v6", "dimensions-v7", "dimensions-v8"].includes(
      result.scoringVersion ?? "",
    )
  )
    return `已比对 ${count} 份样本；本维度参与综合计算`;
  if (matches > 0 && dimension?.status === "assessed" && !dimension.included) {
    const reason = aiDimensionExclusionReason(dimension, result);
    if (reason) return `已比对 ${count} 份样本；未计分：${reason}`;
  }
  return matches === 0
    ? `已比对 ${count} 份样本，未找到符合条件的匹配片段`
    : `已比对 ${count} 份样本，匹配是否计分见具体依据`;
}
export function aiDimensionExclusionReason(
  dimension: AIDimension,
  result: AIDetection,
) {
  if (dimension.included) return "";
  const normalized = (quote: string) =>
    quote
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .join("\n");
  const overlaps = new Set<string>();
  for (const evidence of dimension.evidence) {
    if (evidence.counted) continue;
    for (const owner of result.dimensions ?? []) {
      if (owner.key === dimension.key || !owner.included) continue;
      for (const used of owner.evidence) {
        if (!used.counted) continue;
        const sameQuote =
          normalized(evidence.quote) !== "" &&
          normalized(evidence.quote) === normalized(used.quote);
        const sameRange =
          evidence.startLine <= used.endLine &&
          used.startLine <= evidence.endLine;
        if (sameQuote || sameRange)
          overlaps.add(
            `与「${owner.label}」第 ${used.startLine}${used.endLine === used.startLine ? "" : `–${used.endLine}`} 行${sameQuote ? "引用重复" : "范围重叠"}`,
          );
      }
    }
  }
  return overlaps.size
    ? `${[...overlaps].join("；")}，不重复计入综合结果`
    : (dimension.exclusionReason ?? "");
}
export function aiDimensionMaxScore(
  result?: Pick<AIDetection, "scoringVersion">,
) {
  if (
    [
      "dimensions-v5",
      "dimensions-v6",
      "dimensions-v7",
      "dimensions-v8",
    ].includes(result?.scoringVersion ?? "")
  )
    return 100;
  return result?.scoringVersion === "dimensions-v4" ? 10 : 4;
}
export function aiDimensionScoreLabel(
  dimension: AIDimension,
  result?: Pick<AIDetection, "scoringVersion">,
) {
  return dimension.included && dimension.effectiveScore !== null
    ? [
        "dimensions-v5",
        "dimensions-v6",
        "dimensions-v7",
        "dimensions-v8",
      ].includes(result?.scoringVersion ?? "")
      ? `${dimension.effectiveScore}%`
      : `${dimension.effectiveScore} / ${aiDimensionMaxScore(result)}`
    : ["dimensions-v6", "dimensions-v7", "dimensions-v8"].includes(
          result?.scoringVersion ?? "",
        )
      ? "无法判断"
      : "不计分";
}
export const aiLegacyChecksNote =
  "此报告未记录核验材料；如需纳入运行结果、历史版本与代码框架，请重新生成。";
export function aiRateBand(result?: Pick<AIDetection, "status" | "aiRate">) {
  if (
    result?.status !== "estimated" ||
    result.aiRate === null ||
    !Number.isFinite(result.aiRate) ||
    result.aiRate < 0 ||
    result.aiRate > 100
  )
    return undefined;
  return [...aiRateBands].reverse().find((band) => result.aiRate! >= band.min);
}
export function aiRowLabel(row: AIDetectionRow) {
  if (row.state === "done" && row.result)
    return aiRateBand(row.result)?.label ?? "证据不足";
  return {
    pending: "等待识别",
    running: "正在识别…",
    error: "识别失败",
    stopped: "已停止",
    done: "结果缺失",
  }[row.state];
}
export function formatAIRate(result?: Pick<AIDetection, "status" | "aiRate">) {
  const band = aiRateBand(result);
  if (!band) return "—";
  const rate = result!.aiRate!;
  const rounded = Number(rate.toFixed(1));
  // Do not round a displayed percentage across its classification boundary.
  return aiRateBand({ ...result!, aiRate: rounded })?.tone === band.tone
    ? `${rate.toFixed(1)}%`
    : `${rate}%`;
}
export function filterAIRows(
  rows: AIDetectionRow[],
  filter: AIResultFilter,
  sort: AIResultSort,
) {
  const filtered = rows.filter((row) => {
    if (filter === "all") return true;
    if (filter === "unfinished") return row.state !== "done";
    if (row.state !== "done" || !row.result) return false;
    const band = aiRateBand(row.result);
    return filter === "insufficient" ? !band : band?.tone === filter;
  });
  return filtered.sort((a, b) => {
    const name =
      a.source.studentName.localeCompare(b.source.studentName, "zh-CN") ||
      a.source.id.localeCompare(b.source.id, "en", { numeric: true });
    if (sort === "student") return name;
    const aRate =
      a.state === "done" && aiRateBand(a.result) ? a.result!.aiRate : null;
    const bRate =
      b.state === "done" && aiRateBand(b.result) ? b.result!.aiRate : null;
    if (aRate === null || bRate === null)
      return aRate === bRate ? name : aRate === null ? 1 : -1;
    return (sort === "rate_desc" ? bRate - aRate : aRate - bRate) || name;
  });
}
export function aiReportStats(rows: AIDetectionRow[]) {
  const completed = rows.filter(
    (row) => row.state === "done" && row.result,
  ).length;
  const estimated = rows.filter(
    (row) => row.state === "done" && aiRateBand(row.result),
  ).length;
  return {
    total: rows.length,
    completed,
    estimated,
    insufficient: completed - estimated,
    unfinished: rows.length - completed,
  };
}
const escapeHTML = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const date = (value: string) =>
  escapeHTML(new Date(value).toLocaleString("zh-CN"));
const badgeHTML = (row: AIDetectionRow) => {
  const band = row.state === "done" ? aiRateBand(row.result) : undefined;
  return `<span class="risk risk-${band?.tone ?? "low"}">${aiRowLabel(row)}</span>`;
};
const rateHTML = (row: AIDetectionRow) =>
  row.state === "done" ? formatAIRate(row.result) : "—";

function executionHTML(result: AIDetection) {
  const execution = result.execution;
  if (!execution) return "";
  return `<h3>测试结果快照</h3><p>编译${execution.compileOk ? "通过" : "失败"}；测试通过 ${execution.passed}/${execution.total}。仅包含本次提供给分析的用例详情，长输出可能已截断。</p>${execution.compileError ? `<pre>${escapeHTML(execution.compileError)}</pre>` : ""}${execution.results.map((item, index) => `<article class="evidence"><b>${index + 1}. ${escapeHTML(item.name)} · ${item.passed ? "通过" : "未通过"}</b><p>退出码 ${item.exitCode} · ${item.durationMs} ms</p>${item.hidden ? "<p>隐藏用例，输入与输出不公开。</p>" : `<p>输入</p><pre>${escapeHTML(item.input ?? "")}</pre><p>期望输出</p><pre>${escapeHTML(item.expected ?? "")}</pre><p>实际输出</p><pre>${escapeHTML(item.actual ?? "")}</pre>${item.error ? `<p>运行信息</p><pre>${escapeHTML(item.error)}</pre>` : ""}`}</article>`).join("")}`;
}

function dimensionsHTML(result: AIDetection) {
  if (result.localDetection) {
    const local = result.localDetection;
    return `<h3>代码片段检测</h3><p>${escapeHTML(aiScoringVersionNote(result))}</p><p>${escapeHTML(aiAnalysisLabel(result))}。片段范围为分析区域，不是逐行来源证据。原始代码见下方提交快照。</p><table><thead><tr><th>片段</th><th>原始行范围</th><th>内容词元 / 新增覆盖</th><th>生成倾向分</th></tr></thead><tbody>${local.chunks.map((chunk) => `<tr><td>${chunk.index}</td><td>${chunk.startLine}–${chunk.endLine}</td><td>${chunk.tokenCount} / ${chunk.weightTokens}</td><td>${(chunk.aiScore * 100).toFixed(1)}%</td></tr>`).join("")}</tbody></table><h3>汇总方法</h3><ul>${(result.aggregationNotes ?? []).map((note) => `<li>${escapeHTML(note)}</li>`).join("")}</ul>`;
  }
  if (!result.scoringVersion)
    return `<p class="note">${aiLegacyScoringNote}</p>`;
  return `${aiScoringVersionNote(result) ? `<p class="note">${escapeHTML(aiScoringVersionNote(result))}</p>` : ""}<h3>多维度分析</h3><p>${aiAnalysisLabel(result)}。${["dimensions-v5", "dimensions-v6", "dimensions-v7", "dimensions-v8"].includes(result.scoringVersion ?? "") ? "各维度使用 0–100% 的生成倾向值；百分比越高生成倾向越高，缺少材料时标为无法判断。" : `每维满分 ${aiDimensionMaxScore(result)} 分，分数越高生成倾向越高，缺少材料时标为无法判断。`}${aiUsesDynamicWeights(result) ? "实际占比按证据强弱动态调整。" : ["dimensions-v3", "dimensions-v4", "dimensions-v5", "dimensions-v6", "dimensions-v7"].includes(result.scoringVersion ?? "") ? "证据强度单独展示，不参与计分。" : ""}</p>${(result.dimensions ?? []).map((d) => `<article class="evidence"><h4>${escapeHTML(d.label)} · ${aiDimensionScoreLabel(d, result)} · ${aiDimensionWeightLabel(d, result)}</h4><p>${aiDimensionStrengthLabel(d.strength)}${d.score !== null && d.score !== d.effectiveScore ? `；${["dimensions-v5", "dimensions-v6", "dimensions-v7", "dimensions-v8"].includes(result.scoringVersion ?? "") ? `分析原始值 ${d.score}%` : `分析原始分 ${d.score}/${aiDimensionMaxScore(result)}`}` : ""}</p><p>${escapeHTML(d.reason)}</p>${d.key === "sample_match" ? `<p>${escapeHTML(aiSampleAnalysisLabel(result))}</p>` : ""}${d.exclusionReason ? `<p>${["dimensions-v6", "dimensions-v7", "dimensions-v8"].includes(result.scoringVersion ?? "") ? "无法判断原因" : "未计分原因"}：${escapeHTML(d.exclusionReason)}</p>` : ""}${d.evidence.map((e) => `<b>第 ${e.startLine}${e.endLine !== e.startLine ? `–${e.endLine}` : ""} 行 · ${e.counted ? "参与计分" : ["dimensions-v6", "dimensions-v7", "dimensions-v8"].includes(result.scoringVersion ?? "") ? "引用未用于计算，原因见维度说明" : "重复或公共框架引用，不计分"}</b><pre>${escapeHTML(e.quote)}</pre><p>${escapeHTML(e.explanation)}</p>${e.sourceQuote ? `<b>对照 ${escapeHTML(e.sourceId ?? "")} · 第 ${e.sourceStartLine}–${e.sourceEndLine} 行</b><pre>${escapeHTML(e.sourceQuote)}</pre>` : ""}`).join("")}</article>`).join("")}<h3>综合评分规则</h3><ul>${(
    result.aggregationNotes ?? []
  )
    .map((note) => `<li>${escapeHTML(note)}</li>`)
    .join("")}</ul>`;
}

function sampleComparisonHTML(result: AIDetection) {
  const comparison = result.sampleComparison;
  if (!comparison) return "";
  return `<h3>同题 AI 样本比对记录</h3><p>${escapeHTML(comparison.note)}</p>${comparison.status === "compared" ? `<ul>${comparison.samples.map((sample) => `<li>${escapeHTML(sample.approach)}（${escapeHTML(sample.id)}）：相似度 ${sample.pair.similarity.toFixed(1)}%，匹配 ${sample.pair.matchedTokens} 个词元</li>`).join("")}</ul>` : ""}`;
}

export function buildAIDetectionHTML(title: string, report: AIDetectionReport) {
  const stats = aiReportStats(report.rows);
  const rows = filterAIRows(report.rows, "all", "rate_desc");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)} · AI 生成识别报告</title><style>
body{font:14px/1.7 system-ui,sans-serif;color:#182238;max-width:1100px;margin:36px auto;padding:0 24px}h1{font-size:25px}h2{font-size:19px;margin-top:30px}h3{font-size:15px}table{border-collapse:collapse;width:100%}td,th{padding:9px;text-align:left;border:1px solid #e4e8f1;overflow-wrap:anywhere}th{background:#f3f5fb}a{color:inherit}pre{font:12px/1.7 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;padding:14px;background:#1e1e1e;color:#d4d4d4;border:1px solid #454545}.line{display:block}.line b{display:inline-block;min-width:3ch;color:#858585;user-select:none}.note{background:#f3f5fb;padding:14px}.evidence{break-inside:avoid}small{color:#5f6b80}.risk{display:inline-block;padding:2px 9px;border-radius:4px;font-size:12px;font-weight:600;white-space:nowrap;print-color-adjust:exact;-webkit-print-color-adjust:exact}.risk-low{color:#5f6b80;background:#f3f5fb}.risk-moderate{color:#6b6027;background:#f4f0df}.risk-suspected{color:#925511;background:#fff0da}.risk-high{color:#a13732;background:#fbe9e7}@media(max-width:600px){body{padding:0 16px}.table-scroll{overflow:auto}table{min-width:560px}}@media print{body{margin:0;padding:0;font-size:11px}pre{font-size:9px;background:#fff;color:#182238;border-color:#e4e8f1}h2,h3{break-after:avoid}.table-scroll{overflow:visible}table{min-width:0}thead{display:table-header-group}}@page{size:A4;margin:14mm}
</style></head><body><h1>${escapeHTML(title)} · AI 生成识别报告</h1>
<p>作业 #${escapeHTML(report.assignmentId)} · 语言：${escapeHTML(report.language)} · 报告时间：${date(report.generatedAt)}</p>
<p>检测范围：${report.selection === "latest_per_student" ? "每名学生最新一次提交" : "教师指定的单份提交"}；参与 ${stats.total} 份，成功 ${stats.completed} 份，有 AI 率估计 ${stats.estimated} 份，证据不足 ${stats.insufficient} 份，未完成 ${stats.unfinished} 份。</p>
${stats.unfinished ? '<p class="note">本报告包含未完成项；识别失败、已停止及等待中的提交不作为低 AI 率或已完成结果。</p>' : ""}
<p>${aiDetectionMethod}</p>
<h2>AI 率区间分类</h2><p>${aiRateBands.map((band) => `<span class="risk risk-${band.tone}">${band.label}</span> ${escapeHTML(band.range)}`).join("； ")}；<span class="risk risk-low">证据不足</span> 不生成百分比</p><p>${aiRateBandNote}</p>
<h2>识别结果汇总</h2><p>按 AI 率降序排列，包含本次全部提交，不受页面筛选和分页影响。</p><div class="table-scroll"><table><thead><tr><th>学生 / 提交</th><th>生成倾向分与分类</th><th>分析覆盖 / 旧版自评</th><th>结论 / 状态</th></tr></thead><tbody>${rows.map((row, index) => `<tr><td><a href="#submission-${index + 1}">${escapeHTML(row.source.studentName)}（学生 ${escapeHTML(row.source.studentId)}，提交 #${escapeHTML(row.source.id)}）</a></td><td>${rateHTML(row)} ${badgeHTML(row)}</td><td>${row.state === "done" && row.result ? `${aiAnalysisLabel(row.result)}${!row.result.localDetection && !["dimensions-v6", "dimensions-v7", "dimensions-v8"].includes(row.result.scoringVersion ?? "") && aiScoringVersionNote(row.result) ? "<br>旧规则报告 · 重新生成后更新" : ""}` : "—"}</td><td>${escapeHTML(row.result?.summary ?? row.error ?? aiRowLabel(row))}</td></tr>`).join("")}</tbody></table></div>
<h2>逐份识别依据与提交快照</h2>${rows
    .map((row, index) => {
      const result = row.state === "done" ? row.result : undefined;
      return `<section id="submission-${index + 1}"><h2>${index + 1}. ${escapeHTML(row.source.studentName)} · 提交 #${escapeHTML(row.source.id)}</h2><p>学生 ${escapeHTML(row.source.studentId)} · 提交时间：${date(row.source.submittedAt)}</p><p>生成倾向分：${rateHTML(row)} ${badgeHTML(row)}${result ? ` · ${aiAnalysisLabel(result)} · 识别时间：${date(result.generatedAt)}` : ""}</p>${result ? `<h3>识别结论：${aiRateBand(result)?.label ?? "证据不足"}</h3>` : ""}<p>${escapeHTML(result?.summary ?? row.error ?? aiRowLabel(row))}</p>
${result ? `${dimensionsHTML(result)}${sampleComparisonHTML(result)}<h3>核验材料</h3>${result.checks?.length ? `<ul>${result.checks.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}</ul>` : `<p>${aiLegacyChecksNote}</p>`}${executionHTML(result)}${result.scoringVersion ? "" : `<h3>代码依据</h3>${result.evidence.length ? result.evidence.map((item) => `<article class="evidence"><b>第 ${item.startLine}${item.endLine === item.startLine ? "" : `–${item.endLine}`} 行</b><pre>${escapeHTML(item.quote)}</pre><p>${escapeHTML(item.explanation)}</p></article>`).join("") : "<p>证据不足，未生成可靠的来源判断。</p>"}`}${result.limitations.length ? `<h3>补充说明</h3><ul>${result.limitations.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}</ul>` : ""}` : "<p>本份提交未完成识别，没有可供判读的 AI 率或代码依据。</p>"}
<h3>原始提交代码</h3><pre>${row.source.code
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map(
          (line, lineIndex) =>
            `<span class="line"><b>${lineIndex + 1}</b> ${escapeHTML(line)}</span>`,
        )
        .join("")}</pre></section>`;
    })
    .join(
      "",
    )}<small>报告为本次检测快照，分类不改变成绩。</small></body></html>`;
}

export function downloadAIDetectionHTML(
  title: string,
  report: AIDetectionReport,
) {
  const url = URL.createObjectURL(
    new Blob([buildAIDetectionHTML(title, report)], {
      type: "text/html;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `AI生成识别-${report.assignmentId}-${report.generatedAt.slice(0, 10)}.html`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function printAIDetectionReport(
  title: string,
  report: AIDetectionReport,
) {
  const frame = document.createElement("iframe");
  frame.title = "AI 生成识别报告打印预览";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;left:-9999px";
  frame.onload = () => {
    if (frame.contentWindow) {
      frame.contentWindow.onafterprint = () => frame.remove();
      frame.contentWindow.print();
    }
  };
  frame.srcdoc = buildAIDetectionHTML(title, report);
  document.body.appendChild(frame);
  window.setTimeout(() => frame.remove(), 300000);
}
