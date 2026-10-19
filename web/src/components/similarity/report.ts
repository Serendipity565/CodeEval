import type {
  SimilarityReport,
  SimilaritySource,
  SimilarityRange,
} from "../../types";

const escapeHTML = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const matchLabel = (kind: string) =>
  kind === "exact" ? "代码词元一致（忽略空白与注释）" : "标识符替换后匹配";
export const similarityMethod =
  "相似度 = 2 × 匹配词元数 ÷ 双方有效词元总数；覆盖率分别以各自有效词元数为分母。忽略空白、注释及 import/package/include 声明，保留运算符和字面量。每个连续片段至少 20 个词元，同一词元在同一配对内只计一次。公共代码按至少 8 个连续原始词元匹配后排除。";
export const similarityCaution =
  "相似结果仅作为教师复核线索，不能据此确定抄袭或复制方向，不自动扣分。检测范围仅限本次所选提交；未发现长片段不代表没有抄袭。本检测不判断语义等价、跨语言改写或 AI 生成。";
export const similarityBands = [
  { min: 0, range: "0% ≤ 相似度 < 30%", label: "低相似", tone: "low" },
  { min: 30, range: "30% ≤ 相似度 < 50%", label: "部分相似", tone: "moderate" },
  {
    min: 50,
    range: "50% ≤ 相似度 < 80%",
    label: "疑似抄袭",
    tone: "suspected",
  },
  {
    min: 80,
    range: "80% ≤ 相似度 ≤ 100%",
    label: "高度疑似抄袭",
    tone: "high",
  },
] as const;
export const similarityBand = (score: number) =>
  [...similarityBands].reverse().find((band) => score >= band.min) ??
  similarityBands[0];
export const similarityBandNote =
  "区间为默认复核提示，相似度不代表抄袭概率。请结合公共代码、解法限制与匹配片段判断；低相似也不代表已证明独立完成。";
const snippet = (source: SimilaritySource, range: SimilarityRange) => {
  const lines = source.code.replace(/\r\n/g, "\n").split("\n");
  return `<pre>${lines
    .slice(Math.max(0, range.startLine - 2), range.endLine + 1)
    .map((line, i) => {
      const number = Math.max(1, range.startLine - 1) + i;
      return `<span class="line ${number >= range.startLine && number <= range.endLine ? "hit" : ""}"><b>${number}</b> ${escapeHTML(line)}</span>`;
    })
    .join("")}</pre>`;
};
export function buildSimilarityHTML(title: string, report: SimilarityReport) {
  const sources = new Map(report.sources.map((source) => [source.id, source]));
  const pairs = report.pairs.filter((pair) => pair.matches.length);
  const name = (source: SimilaritySource) =>
    `${source.studentName}（学生 ${source.studentId}，提交 #${source.id}）`;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)} · 代码查重报告</title><style>
body{font:14px/1.7 system-ui,sans-serif;color:#172b25;max-width:1100px;margin:36px auto;padding:0 24px}h1{font-size:25px}h2{font-size:19px;margin-top:30px}h3{font-size:15px}table{border-collapse:collapse;width:100%}td,th{padding:9px;text-align:left;border:1px solid #cdd9d1}pre{font:12px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #cdd9d1;padding:10px}.line{display:block}.line b{color:#65766d;display:inline-block;min-width:3ch}.hit{background:#fff0b8;color:#422f00;print-color-adjust:exact;-webkit-print-color-adjust:exact}.columns{display:grid;grid-template-columns:1fr 1fr;gap:16px;min-width:0}.columns>div{min-width:0}.note{background:#f1f6f3;padding:14px}.evidence{break-inside:avoid}small{color:#52695c}@media print{body{margin:0;padding:0;font-size:11px}pre{font-size:9px}h2{break-after:avoid}.columns{gap:10px}}@page{size:A4 landscape;margin:14mm}
.risk{display:inline-block;padding:2px 9px;border-radius:4px;font-size:12px;font-weight:600;white-space:nowrap;print-color-adjust:exact;-webkit-print-color-adjust:exact}.risk-low{color:#52695c;background:#edf2ee}.risk-moderate{color:#6b6027;background:#f4f0df}.risk-suspected{color:#925511;background:#fff0da}.risk-high{color:#a13732;background:#fbe9e7}
</style><h1>${escapeHTML(title)} · 代码查重报告</h1>
<p>检测时间：${escapeHTML(new Date(report.generatedAt).toLocaleString("zh-CN"))} · 语言：${escapeHTML(report.language)} · 算法：${escapeHTML(report.version)}</p>
<p>范围：${report.selection === "latest_per_student" ? "每名学生最新一次提交" : "教师指定的两份提交"}；共 ${report.sources.length} 份提交，完成 ${report.comparedPairs} 组比对，${pairs.length} 组发现相似片段。</p>
<p class="note">${similarityCaution}</p><p>${similarityMethod}</p>
<h2>相似度区间分类</h2><p>${similarityBands.map((band) => `<span class="risk risk-${band.tone}">${band.label}</span> ${escapeHTML(band.range)}`).join("； ")}</p><p>${similarityBandNote}</p>
<h2>参与检测的提交快照</h2><table><thead><tr><th>学生／提交</th><th>提交时间</th><th>有效词元</th><th>排除的公共代码词元</th></tr></thead><tbody>${report.sources.map((source) => `<tr><td>${escapeHTML(name(source))}</td><td>${escapeHTML(new Date(source.submittedAt).toLocaleString("zh-CN"))}</td><td>${source.tokenCount}</td><td>${source.excludedTokens}</td></tr>`).join("")}</tbody></table>
${
  report.sources.some((source) => source.tokenCount < report.minTokens)
    ? `<p class="note">有效内容不足 ${report.minTokens} 个词元的提交无法形成检测片段：${report.sources
        .filter((source) => source.tokenCount < report.minTokens)
        .map((source) => escapeHTML(name(source)))
        .join("、")}。</p>`
    : ""
}
${report.template ? `<h2>本次排除的公共代码</h2><pre>${escapeHTML(report.template)}</pre>` : "<p>本次未提供额外公共代码。</p>"}
<h2>相似配对与证据</h2>${
    pairs.length
      ? pairs
          .map((pair, p) => {
            const a = sources.get(pair.a)!,
              b = sources.get(pair.b)!;
            const band = similarityBand(pair.similarity);
            return `<section><h2>${p + 1}. ${escapeHTML(a.studentName)} ↔ ${escapeHTML(b.studentName)}</h2><p>相似度 ${pair.similarity}% <span class="risk risk-${band.tone}">${band.label}</span> · A 覆盖率 ${pair.coverageA}% · B 覆盖率 ${pair.coverageB}% · 匹配 ${pair.matchedTokens} 个词元</p>${pair.matches.map((match, i) => `<article class="evidence"><h3>片段 ${i + 1} · ${matchLabel(match.kind)} · ${match.tokens} 个词元</h3><div class="columns"><div><b>A：${escapeHTML(name(a))} · 第 ${match.a.startLine}–${match.a.endLine} 行</b>${snippet(a, match.a)}</div><div><b>B：${escapeHTML(name(b))} · 第 ${match.b.startLine}–${match.b.endLine} 行</b>${snippet(b, match.b)}</div></div></article>`).join("")}</section>`;
          })
          .join("")
      : "<p>未发现达到最小连续长度的相似片段。</p>"
  }<small>高亮表示匹配词元所在的行范围；范围内的注释、空白与非匹配字符不单独计为证据。报告为本次检测快照。</small></html>`;
}
export function downloadSimilarityHTML(
  title: string,
  report: SimilarityReport,
) {
  const url = URL.createObjectURL(
    new Blob([buildSimilarityHTML(title, report)], {
      type: "text/html;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `代码查重-${report.assignmentId}-${report.generatedAt.slice(0, 10)}.html`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function printSimilarityReport(title: string, report: SimilarityReport) {
  const frame = document.createElement("iframe");
  frame.title = "代码查重报告打印预览";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;left:-9999px";
  frame.onload = () => {
    if (frame.contentWindow) {
      frame.contentWindow.onafterprint = () => frame.remove();
      frame.contentWindow.print();
    }
  };
  frame.srcdoc = buildSimilarityHTML(title, report);
  document.body.appendChild(frame);
  window.setTimeout(() => frame.remove(), 60000);
}
