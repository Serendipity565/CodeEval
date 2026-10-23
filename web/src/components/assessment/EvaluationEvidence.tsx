import { useState } from "react";
import type { Evaluation } from "../../types";
import Dialog from "../ui/Dialog";
import { Empty, Icon } from "../ui";

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
              ? `${execution.passed} / ${execution.total} 个测试通过，隐藏用例的输入输出不公开。`
              : `共 ${findings.length} 项代码分析记录`
          }
          wide={view === "tests"}
          onClose={() => setView(null)}
        >
          <div className="evaluation-evidence-list">
            {view === "tests" && execution ? (
              <>
                {!execution.compileOk && execution.compileError && (
                  <article className="test-failed">
                    <h3>编译失败</h3>
                    <pre className="evidence-text">
                      {execution.compileError}
                    </pre>
                  </article>
                )}
                {execution.results.map((result, index) => (
                  <article key={`${result.name}-${index}`}>
                    <header>
                      <h3>{result.name}</h3>
                      <span
                        className={`test-outcome ${result.passed ? "passed" : "failed"}`}
                      >
                        {result.passed ? "通过" : "未通过"}
                      </span>
                      <small>
                        {result.durationMs} ms · 退出码 {result.exitCode}
                      </small>
                    </header>
                    {result.error && (
                      <p className="evidence-text">{result.error}</p>
                    )}
                    {result.hidden ? (
                      <p className="hidden-test-note">
                        隐藏用例 · 输入输出不公开
                      </p>
                    ) : (
                      <div className="test-result-io">
                        <section>
                          <em>输入</em>
                          <pre>{result.input || "（空输入）"}</pre>
                        </section>
                        <section>
                          <em>期望输出</em>
                          <pre>{result.expected || "（无输出）"}</pre>
                        </section>
                        <section>
                          <em>实际输出</em>
                          <pre>{result.actual || "（无输出）"}</pre>
                        </section>
                      </div>
                    )}
                  </article>
                ))}
                {!execution.results.length && !execution.compileError && (
                  <Empty text="暂无测试用例结果。" />
                )}
              </>
            ) : (
              findings.map((finding, index) => (
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
              ))
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
