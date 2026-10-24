import { useState } from "react";
import type { Evaluation } from "../../types";
import { Empty, Icon } from "../ui";
import "./test-results.css";

type Execution = NonNullable<Evaluation["execution"]>;

function OutputBlock({
  label,
  value,
  empty,
  failed = false,
}: {
  label: string;
  value?: string;
  empty: string;
  failed?: boolean;
}) {
  return (
    <section className={`test-data${failed ? " test-data--failed" : ""}`}>
      <h4>{label}</h4>
      <pre tabIndex={0} aria-label={label}>
        {value || <span className="test-data-empty">{empty}</span>}
      </pre>
    </section>
  );
}

export default function TestResults({ execution }: { execution: Execution }) {
  const [onlyFailed, setOnlyFailed] = useState(false);
  const failedCount = execution.results.filter(
    (result) => !result.passed,
  ).length;
  const results = execution.results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => !onlyFailed || !result.passed);

  return (
    <div className="test-results">
      <div className="test-results-toolbar">
        <div className="test-results-summary">
          <span className="test-results-count">
            <strong>{execution.passed}</strong>
            <span>/ {execution.total} 通过</span>
          </span>
          <span className="test-results-language">
            <Icon name="code" />
            {execution.language}
          </span>
        </div>
        {execution.results.length > 0 && (
          <div
            className="test-results-filters"
            role="group"
            aria-label="筛选测试用例"
          >
            <button
              type="button"
              aria-pressed={!onlyFailed}
              onClick={() => setOnlyFailed(false)}
            >
              全部 <span>{execution.results.length}</span>
            </button>
            <button
              type="button"
              aria-pressed={onlyFailed}
              onClick={() => setOnlyFailed(true)}
            >
              未通过 <span>{failedCount}</span>
            </button>
          </div>
        )}
      </div>

      {!execution.compileOk && (
        <section className="test-run-error" aria-label="编译错误">
          <h3>
            <Icon name="alert" />
            编译失败
          </h3>
          <p>请根据编译信息检查代码后重新提交。</p>
          {execution.compileError && (
            <pre tabIndex={0}>{execution.compileError}</pre>
          )}
        </section>
      )}

      <div className="test-results-list">
        {results.map(({ result, index }) => (
          <article className="test-case" key={`${result.name}-${index}`}>
            <header className="test-case-header">
              <span
                className="test-case-index"
                aria-label={`用例 ${index + 1}`}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3>{result.name}</h3>
              <span
                className={`test-case-outcome ${result.passed ? "is-passed" : "is-failed"}`}
              >
                <Icon name={result.passed ? "check" : "close"} />
                {result.passed ? "通过" : "未通过"}
              </span>
              <div className="test-case-meta">
                <span>
                  <Icon name="clock" />
                  {result.durationMs} ms
                </span>
                <span>
                  退出码 <b>{result.exitCode}</b>
                </span>
              </div>
            </header>

            {result.hidden ? (
              <div className="test-case-hidden">
                <Icon name="eyeOff" />
                <div>
                  <strong>隐藏用例</strong>
                  <p>仅展示运行结果，输入与输出不公开。</p>
                </div>
              </div>
            ) : (
              <div className="test-case-body">
                {result.error && (
                  <div className="test-case-error">
                    <Icon name="alert" />
                    <div>
                      <strong>运行信息</strong>
                      <pre tabIndex={0}>{result.error}</pre>
                    </div>
                  </div>
                )}
                <OutputBlock
                  label="输入"
                  value={result.input}
                  empty="（空输入）"
                />
                <div className="test-case-outputs">
                  <OutputBlock
                    label="期望输出"
                    value={result.expected}
                    empty="（无输出）"
                  />
                  <OutputBlock
                    label="实际输出"
                    value={result.actual}
                    empty="（无输出）"
                    failed={!result.passed}
                  />
                </div>
              </div>
            )}
          </article>
        ))}
        {!results.length && execution.compileOk && (
          <Empty
            text={onlyFailed ? "没有未通过的用例。" : "暂无测试用例结果。"}
          />
        )}
      </div>
    </div>
  );
}
