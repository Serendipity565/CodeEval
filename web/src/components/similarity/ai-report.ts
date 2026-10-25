import type { AIDetection, Submission } from "../../types";

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
export const aiDetectionCaution =
  "AI 率是模型对代码生成倾向的估计，不是实际 AI 生成代码占比，也不是经过校准的概率。请结合代码、过程记录与学生说明复核，不宜单独用于判定违规或评分。";
export const aiRateBandNote =
  "区间仅用于整理复核顺序，不是作者身份判定。低 AI 率不能证明人工编写；证据不足单独标记，不归入低 AI 率。";
export const aiDetectionMethod =
  "结合题目要求、参考实现与逐行源码分析 AI 生成倾向。代码引用须与原始源码对应；每份提交独立识别，不根据同学间的相似度推算 AI 率。判断置信度是本次判断的自评，不代表检测准确率。";
export function aiRateBand(result?: AIDetection) {
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
export function formatAIRate(result?: AIDetection) {
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

export function buildAIDetectionHTML(title: string, report: AIDetectionReport) {
  const stats = aiReportStats(report.rows);
  const rows = filterAIRows(report.rows, "all", "rate_desc");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)} · AI 生成识别报告</title><style>
body{font:14px/1.7 system-ui,sans-serif;color:#182238;max-width:1100px;margin:36px auto;padding:0 24px}h1{font-size:25px}h2{font-size:19px;margin-top:30px}h3{font-size:15px}table{border-collapse:collapse;width:100%}td,th{padding:9px;text-align:left;border:1px solid #e4e8f1;overflow-wrap:anywhere}th{background:#f3f5fb}a{color:inherit}pre{font:12px/1.7 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;padding:14px;background:#1e1e1e;color:#d4d4d4;border:1px solid #454545}.line{display:block}.line b{display:inline-block;min-width:3ch;color:#858585;user-select:none}.note{background:#f3f5fb;padding:14px}.evidence{break-inside:avoid}small{color:#5f6b80}.risk{display:inline-block;padding:2px 9px;border-radius:4px;font-size:12px;font-weight:600;white-space:nowrap;print-color-adjust:exact;-webkit-print-color-adjust:exact}.risk-low{color:#5f6b80;background:#f3f5fb}.risk-moderate{color:#6b6027;background:#f4f0df}.risk-suspected{color:#925511;background:#fff0da}.risk-high{color:#a13732;background:#fbe9e7}@media(max-width:600px){body{padding:0 16px}.table-scroll{overflow:auto}table{min-width:560px}}@media print{body{margin:0;padding:0;font-size:11px}pre{font-size:9px;background:#fff;color:#182238;border-color:#e4e8f1}h2,h3{break-after:avoid}.table-scroll{overflow:visible}table{min-width:0}thead{display:table-header-group}}@page{size:A4;margin:14mm}
</style></head><body><h1>${escapeHTML(title)} · AI 生成识别报告</h1>
<p>作业 #${escapeHTML(report.assignmentId)} · 语言：${escapeHTML(report.language)} · 报告时间：${date(report.generatedAt)}</p>
<p>检测范围：${report.selection === "latest_per_student" ? "每名学生最新一次提交" : "教师指定的单份提交"}；参与 ${stats.total} 份，成功 ${stats.completed} 份，有 AI 率估计 ${stats.estimated} 份，证据不足 ${stats.insufficient} 份，未完成 ${stats.unfinished} 份。</p>
${stats.unfinished ? '<p class="note">本报告包含未完成项；识别失败、已停止及等待中的提交不作为低 AI 率或已完成结果。</p>' : ""}
<p class="note">${aiDetectionCaution}</p><p>${aiDetectionMethod}</p>
<h2>AI 率区间分类</h2><p>${aiRateBands.map((band) => `<span class="risk risk-${band.tone}">${band.label}</span> ${escapeHTML(band.range)}`).join("； ")}；<span class="risk risk-low">证据不足</span> 不生成百分比</p><p>${aiRateBandNote}</p>
<h2>识别结果汇总</h2><p>按 AI 率降序排列，包含本次全部提交，不受页面筛选和分页影响。</p><div class="table-scroll"><table><thead><tr><th>学生 / 提交</th><th>AI 率（估计）与分类</th><th>判断置信度</th><th>结论 / 状态</th></tr></thead><tbody>${rows.map((row, index) => `<tr><td><a href="#submission-${index + 1}">${escapeHTML(row.source.studentName)}（学生 ${escapeHTML(row.source.studentId)}，提交 #${escapeHTML(row.source.id)}）</a></td><td>${rateHTML(row)} ${badgeHTML(row)}</td><td>${row.state === "done" && row.result ? `${(row.result.confidence * 100).toFixed(0)}%` : "—"}</td><td>${escapeHTML(row.result?.summary ?? row.error ?? aiRowLabel(row))}</td></tr>`).join("")}</tbody></table></div>
<h2>逐份识别依据与提交快照</h2>${rows
    .map((row, index) => {
      const result = row.state === "done" ? row.result : undefined;
      return `<section id="submission-${index + 1}"><h2>${index + 1}. ${escapeHTML(row.source.studentName)} · 提交 #${escapeHTML(row.source.id)}</h2><p>学生 ${escapeHTML(row.source.studentId)} · 提交时间：${date(row.source.submittedAt)}</p><p>AI 率（估计）：${rateHTML(row)} ${badgeHTML(row)}${result ? ` · 判断置信度 ${(result.confidence * 100).toFixed(0)}% · 识别时间：${date(result.generatedAt)}` : ""}</p><p>${escapeHTML(result?.summary ?? row.error ?? aiRowLabel(row))}</p>
${result ? `<h3>代码依据</h3>${result.evidence.length ? result.evidence.map((item) => `<article class="evidence"><b>第 ${item.startLine}${item.endLine === item.startLine ? "" : `–${item.endLine}`} 行</b><pre>${escapeHTML(item.quote)}</pre><p>${escapeHTML(item.explanation)}</p></article>`).join("") : "<p>证据不足，未生成可靠的来源判断。</p>"}<h3>判断局限</h3><ul>${result.limitations.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}</ul>` : "<p>本份提交未完成识别，没有可供判读的 AI 率或代码依据。</p>"}
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
    )}<p class="note">${aiDetectionCaution}</p><small>报告为本次检测快照，分类不改变成绩。</small></body></html>`;
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
