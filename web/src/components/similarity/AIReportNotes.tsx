import type { AIDetection } from "../../types";
import TestResults from "../assessment/TestResults";
import { aiLegacyChecksNote, aiLegacyScoringNote } from "./ai-report";

const noteKey = (text: string) =>
  text.replace(/\s+/g, "").replace(/[。；;.!！]+$/, "");

function distinctNotes(notes: string[]) {
  const seen = new Set<string>();
  return notes.filter((note) => {
    const key = noteKey(note);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Merge repeated statements about missing material, while keeping the first
// (server-recorded) failure reason and any more specific analytical limitations.
function unavailableMaterial(note: string) {
  if (
    /样本.*(不可用|未提供|未生成|生成失败|读取失败|保存失败|生成、读取或保存失败)|(未提供|未生成|缺少|没有).{0,12}样本/.test(
      note,
    )
  )
    return "samples";
  if (
    /(没有|未提供|缺少|无可用).*(历史|此前|提交之前)|(历史|此前|提交之前).*(未提供|不可用|没有|缺少)/.test(
      note,
    )
  )
    return "history";
  return undefined;
}

export default function AIReportNotes({ result }: { result: AIDetection }) {
  const comparison = result.sampleComparison;
  const comparisonInDimension =
    comparison?.status === "compared" &&
    comparison.samples.length > 0 &&
    result.dimensions?.some((dimension) => dimension.key === "sample_match");
  const missingMaterials = new Set<string>();
  const checks = distinctNotes(result.checks ?? []).filter((note) => {
    if (
      comparisonInDimension &&
      noteKey(comparison!.note).includes(noteKey(note))
    )
      return false;
    const missing = unavailableMaterial(note);
    if (missing && missingMaterials.has(missing)) return false;
    if (missing) missingMaterials.add(missing);
    return true;
  });
  const rules = distinctNotes(result.aggregationNotes ?? []);
  const existing = new Set(
    [
      ...checks,
      ...rules,
      result.summary,
      ...(result.dimensions ?? []).flatMap((dimension) => [
        dimension.reason,
        dimension.exclusionReason ?? "",
      ]),
    ].map(noteKey),
  );
  const limitations = distinctNotes(result.limitations).filter(
    (note) =>
      !existing.has(noteKey(note)) &&
      !missingMaterials.has(unavailableMaterial(note) ?? ""),
  );
  const execution = result.execution;
  const reviewSummary = [
    checks.length ? `${checks.length} 项记录` : "材料记录",
    execution
      ? execution.compileOk
        ? `测试 ${execution.passed}/${execution.total} 通过`
        : "编译未通过"
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="ai-report-notes" aria-label="报告补充信息">
      <details className="ai-report-note">
        <summary>
          <span className="ai-report-note-label">核验材料</span>
          <span className="ai-report-note-meta">{reviewSummary}</span>
          <span className="ai-report-note-chevron" aria-hidden="true" />
        </summary>
        <div className="ai-report-note-body">
          {checks.length ? (
            <ul>
              {checks.map((note) => (
                <li key={noteKey(note)}>{note}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">{aiLegacyChecksNote}</p>
          )}
          {execution && <TestResults execution={execution} />}
        </div>
      </details>
      <details className="ai-report-note">
        <summary>
          <span className="ai-report-note-label">评分方法</span>
          <span className="ai-report-note-meta">
            {limitations.length
              ? `含 ${limitations.length} 项本次说明`
              : "权重与计分口径"}
          </span>
          <span className="ai-report-note-chevron" aria-hidden="true" />
        </summary>
        <div className="ai-report-note-body">
          {rules.length ? (
            <ul>
              {rules.map((note) => (
                <li key={noteKey(note)}>{note}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              {result.scoringVersion
                ? "此报告未记录详细计分规则。"
                : aiLegacyScoringNote}
            </p>
          )}
          {limitations.length > 0 && (
            <div className="ai-report-specific-notes">
              <h4>本次说明</h4>
              <ul>
                {limitations.map((note) => (
                  <li key={noteKey(note)}>{note}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
