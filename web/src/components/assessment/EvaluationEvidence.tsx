import { useState } from "react";
import type { Evaluation } from "../../types";
import Dialog from "../ui/Dialog";
import TestResults from "./TestResults";
import { Icon } from "../ui";

export default function EvaluationEvidence({
  evaluation,
}: {
  evaluation: Evaluation;
}) {
  const [view, setView] = useState<"tests" | "analysis" | null>(null);
  const execution = evaluation.execution;
  const findings = evaluation.analysis ?? [];
  if (!execution && !findings.length) return null;
  return (
    <>
      <div className="report-evidence-actions" aria-label="评估证据">
        {execution && (
          <>
            <span>
              <Icon name="code" />
              沙箱测试{" "}
              <b>
                {execution.passed} / {execution.total} 通过
              </b>
            </span>
            <button
              type="button"
              className="submission-action"
              aria-haspopup="dialog"
              onClick={() => setView("tests")}
            >
              查看测试用例
            </button>
          </>
        )}
        {findings.length > 0 && (
          <button
            type="button"
            className="submission-action"
            aria-haspopup="dialog"
            onClick={() => setView("analysis")}
          >
            <Icon name="eye" />
            分析证据 · {findings.length} 项
          </button>
        )}
      </div>
      {view && (
        <Dialog
          title={view === "tests" ? "测试用例详情" : "详细分析证据"}
          note={
            view === "tests" && execution
              ? "查看每个用例的运行状态，对照期望输出与实际结果。"
              : `共 ${findings.length} 项代码分析记录`
          }
          wide={view === "tests"}
          className={view === "tests" ? "test-results-dialog" : undefined}
          onClose={() => setView(null)}
        >
          {view === "tests" && execution ? (
            <TestResults execution={execution} />
          ) : (
            <div className="evaluation-evidence-list">
              {findings.map((finding, index) => (
                <article key={`${finding.category}-${index}`}>
                  <header>
                    <h3>{finding.category}</h3>
                    <small>
                      {finding.severity} · {finding.location || "未标注位置"}
                    </small>
                  </header>
                  <pre className="evidence-text">{finding.evidence}</pre>
                  <p>{finding.explanation}</p>
                </article>
              ))}
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
