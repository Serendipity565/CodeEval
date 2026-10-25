import { useEffect, useMemo, useRef, useState } from "react";
import { detectAICode } from "../../api/ai-detection";
import { ApiError } from "../../api/client";
import type { Assignment, Submission } from "../../types";
import { latestSubmissions } from "../../submissions";
import CodeEditor from "../editor/CodeEditor";
import { Empty, Icon } from "../ui";
import Dialog from "../ui/Dialog";
import {
  aiDetectionCaution as caution,
  aiRateBand,
  aiRateBands,
  aiRateBandNote,
  aiReportStats,
  aiRowLabel,
  formatAIRate,
  filterAIRows,
  downloadAIDetectionHTML,
  printAIDetectionReport,
  type AIDetectionRow as DetectionRow,
  type AIDetectionReport,
  type AIResultFilter,
  type AIResultSort,
} from "./ai-report";

const date = (value: string) => new Date(value).toLocaleString("zh-CN");

export default function AICodeDetection({
  assignment,
  submissions,
  token,
}: {
  assignment: Assignment;
  submissions: Submission[];
  token: string;
}) {
  const [mode, setMode] = useState<"class" | "single">("class");
  const [submissionId, setSubmissionId] = useState("");
  const [rows, setRows] = useState<DetectionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [filter, setFilter] = useState<AIResultFilter>("all");
  const [sort, setSort] = useState<AIResultSort>("rate_desc");
  const [page, setPage] = useState(0);
  const [reportMeta, setReportMeta] =
    useState<Pick<AIDetectionReport, "selection" | "generatedAt">>();
  const controller = useRef<AbortController | null>(null);
  const runNumber = useRef(0);
  const choices = useMemo(
    () =>
      submissions
        .filter((s) => s.assignmentId === assignment.id)
        .sort(
          (a, b) =>
            Date.parse(b.submittedAt) - Date.parse(a.submittedAt) ||
            b.id.localeCompare(a.id, "en", { numeric: true }),
        ),
    [submissions, assignment.id],
  );
  const latest = latestSubmissions(choices);
  const targets =
    mode === "class" ? latest : choices.filter((s) => s.id === submissionId);
  const selected = rows.find((row) => row.source.id === selectedId);
  const stats = aiReportStats(rows);
  const categories = [
    { key: "all", label: "全部", count: rows.length, tone: "all" },
    ...aiRateBands.map((band) => ({
      key: band.tone,
      label: band.label,
      tone: band.tone,
      count: rows.filter(
        (row) =>
          row.state === "done" && aiRateBand(row.result)?.tone === band.tone,
      ).length,
    })),
    {
      key: "insufficient",
      label: "证据不足",
      count: stats.insufficient,
      tone: "neutral",
    },
    {
      key: "unfinished",
      label: "未完成",
      count: stats.unfinished,
      tone: "neutral",
    },
  ];
  const failed = rows.filter(
    (row) => row.state === "error" || row.state === "stopped",
  );
  const filteredRows = filterAIRows(rows, filter, sort);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / 25));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = filteredRows.slice(
    currentPage * 25,
    (currentPage + 1) * 25,
  );
  const report: AIDetectionReport | undefined =
    reportMeta && rows.length
      ? {
          ...reportMeta,
          assignmentId: assignment.id,
          language: assignment.language,
          rows,
        }
      : undefined;

  useEffect(
    () => () => {
      runNumber.current++;
      controller.current?.abort();
    },
    [],
  );

  function reset() {
    setRows([]);
    setSelectedId("");
    setReportMeta(undefined);
    setFilter("all");
    setPage(0);
  }
  function stop() {
    runNumber.current++;
    controller.current?.abort();
    setLoading(false);
    setReportMeta(
      (previous) =>
        previous && { ...previous, generatedAt: new Date().toISOString() },
    );
    setRows((previous) =>
      previous.map((row) =>
        row.state === "pending" || row.state === "running"
          ? { ...row, state: "stopped" }
          : row,
      ),
    );
  }
  async function run(sources: Submission[], retry = false) {
    if (!sources.length || loading) return;
    const current = ++runNumber.current;
    const activeController = new AbortController();
    controller.current = activeController;
    setLoading(true);
    setSelectedId("");
    setSettingsOpen(false);
    setPage(0);
    if (!retry) setFilter("all");
    setReportMeta((previous) => ({
      selection:
        retry && previous
          ? previous.selection
          : mode === "class"
            ? "latest_per_student"
            : "selected_submission",
      generatedAt: new Date().toISOString(),
    }));
    const ids = new Set(sources.map((s) => s.id));
    setRows((previous) =>
      retry
        ? previous.map((row) =>
            ids.has(row.source.id)
              ? { source: row.source, state: "pending" }
              : row,
          )
        : sources.map((source) => ({ source, state: "pending" })),
    );
    const update = (id: string, values: Partial<DetectionRow>) => {
      if (current === runNumber.current)
        setRows((previous) =>
          previous.map((row) =>
            row.source.id === id ? { ...row, ...values } : row,
          ),
        );
    };
    try {
      for (const source of sources) {
        if (current !== runNumber.current) break;
        update(source.id, { state: "running" });
        try {
          const result = await detectAICode(
            token,
            assignment.id,
            source.id,
            activeController.signal,
          );
          update(source.id, { state: "done", result });
        } catch (error) {
          if (current !== runNumber.current) break;
          const message =
            error instanceof Error ? error.message : "识别失败，请重试";
          update(source.id, { state: "error", error: message });
          if (
            error instanceof ApiError &&
            [401, 403, 503].includes(error.status)
          ) {
            setRows((previous) =>
              previous.map((row) =>
                row.state === "pending"
                  ? { ...row, state: "error", error: message }
                  : row,
              ),
            );
            break;
          }
        }
      }
    } finally {
      if (current === runNumber.current) {
        setLoading(false);
        setReportMeta(
          (previous) =>
            previous && { ...previous, generatedAt: new Date().toISOString() },
        );
      }
    }
  }

  return (
    <div className="ai-detection-workspace">
      <section
        className={`panel similarity-settings ai-detection-settings ${settingsOpen ? "" : "is-collapsed"}`}
      >
        {!settingsOpen && (
          <button
            className="similarity-settings-toggle"
            aria-expanded={false}
            disabled={loading}
            onClick={() => setSettingsOpen(true)}
          >
            <span>
              <Icon name="settings" />
              <b>{mode === "class" ? "全班识别" : "单份识别"}</b>
              <small>{rows.length} 份提交</small>
            </span>
            <span>
              修改范围
              <Icon name="chevronRight" />
            </span>
          </button>
        )}
        <fieldset disabled={loading} hidden={!settingsOpen}>
          <legend>
            <span className="similarity-step">01</span> 设置识别范围
          </legend>
          <div className="similarity-modes">
            <label>
              <input
                type="radio"
                name="ai-mode"
                checked={mode === "class"}
                onChange={() => {
                  reset();
                  setMode("class");
                }}
              />
              <span>
                <b>全班识别</b>
                <small>每人最新提交 · 当前 {latest.length} 人</small>
              </span>
              <Icon name="submissions" />
            </label>
            <label>
              <input
                type="radio"
                name="ai-mode"
                checked={mode === "single"}
                onChange={() => {
                  reset();
                  setMode("single");
                }}
              />
              <span>
                <b>单份识别</b>
                <small>选择一份当前或历史提交</small>
              </span>
              <Icon name="code" />
            </label>
          </div>
          {mode === "single" && (
            <div className="similarity-selects">
              <label>
                选择提交
                <select
                  value={submissionId}
                  onChange={(event) => {
                    reset();
                    setSubmissionId(event.target.value);
                  }}
                >
                  <option value="">请选择提交</option>
                  {choices.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.studentName} · 学生 {s.studentId} · #{s.id} ·{" "}
                      {date(s.submittedAt)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </fieldset>
        <div className="ai-detection-actions">
          <button
            className={`${report && !settingsOpen ? "submission-action" : "primary"} ${loading ? "similarity-loading" : ""}`}
            disabled={loading || !targets.length}
            onClick={() => void run(targets)}
          >
            <Icon name={loading ? "refresh" : "arrowRight"} />
            {loading ? "正在识别…" : rows.length ? "重新识别" : "开始 AI 识别"}
          </button>
          {loading && (
            <button className="submission-action" onClick={stop}>
              停止识别
            </button>
          )}
          {!loading && failed.length > 0 && (
            <button
              className="submission-action"
              onClick={() =>
                void run(
                  failed.map((row) => row.source),
                  true,
                )
              }
            >
              重试未完成项 · {failed.length}
            </button>
          )}
        </div>
        {settingsOpen && (
          <p className="similarity-run-note">
            逐份生成识别结果与代码依据；结果仅在本次页面保留。
          </p>
        )}
      </section>
      {!report && (
        <p className="ai-reading-note-empty">
          <Icon name="alert" />
          识别结果仅供复核，AI 率不等于实际生成代码占比。
        </p>
      )}
      {!choices.length && (
        <Empty text="暂无学生提交，收到代码后即可开始识别。" />
      )}
      {report && (
        <section className="panel ai-detection-overview">
          <div className="ai-overview-heading">
            <div className="ai-overview-title">
              <span
                className={`ai-report-status ${loading ? "is-running" : stats.unfinished ? "is-partial" : "is-complete"}`}
                role="status"
              >
                <Icon
                  name={
                    loading ? "refresh" : stats.unfinished ? "alert" : "check"
                  }
                />
                {loading
                  ? "识别中"
                  : stats.unfinished
                    ? "识别结束，部分未完成"
                    : "识别完成"}
              </span>
              <time dateTime={report.generatedAt}>
                {date(report.generatedAt)}
              </time>
            </div>
            <div className="ai-detection-export">
              <button
                className="submission-action ai-export-main"
                disabled={loading}
                onClick={() =>
                  downloadAIDetectionHTML(assignment.title, report)
                }
              >
                <Icon name="arrowDown" />
                下载报告 · HTML
              </button>
              <button
                className="submission-action"
                disabled={loading}
                onClick={() => printAIDetectionReport(assignment.title, report)}
              >
                <Icon name="submissions" />
                打印 / 保存 PDF
              </button>
            </div>
          </div>
          <dl className="ai-overview-stats">
            {[
              ["参与检测", stats.total],
              ["已给出 AI 率", stats.estimated],
              ["证据不足", stats.insufficient],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {value}
                  <small>份</small>
                </dd>
              </div>
            ))}
          </dl>
          <details className="ai-reading-note">
            <summary>
              <Icon name="alert" />
              <span>AI 率仅供复核参考，不代表实际生成占比</span>
              <Icon name="chevronRight" />
            </summary>
            <p>{caution}</p>
          </details>
          {loading && (
            <p className="ai-overview-progress">
              正在识别，已完成 {stats.completed}/{stats.total}{" "}
              份；结束或停止后可导出。
            </p>
          )}
        </section>
      )}
      {report && (
        <section className="panel similarity-results" aria-busy={loading}>
          <div className="ai-results-heading">
            <h3>
              识别结果<small>{rows.length} 份提交</small>
            </h3>
            <span>导出包含全部提交与代码依据</span>
          </div>
          <div
            className="ai-category-tabs"
            role="group"
            aria-label="AI 率分类筛选"
          >
            {categories.map((category) => (
              <button
                key={category.key}
                type="button"
                className={`ai-category ai-category-${category.tone}`}
                aria-pressed={filter === category.key}
                onClick={() => {
                  setFilter(category.key as AIResultFilter);
                  setPage(0);
                }}
              >
                <span className="ai-category-dot" aria-hidden="true" />
                <span>{category.label}</span>
                <b>{category.count}</b>
              </button>
            ))}
          </div>
          <div className="ai-results-toolbar">
            <span className="ai-detection-filter-count">
              显示 {filteredRows.length}/{rows.length} 份
            </span>
            <div className="ai-results-tools">
              <details className="ai-classification-help">
                <summary>
                  分类标准
                  <Icon name="chevronRight" />
                </summary>
                <div>
                  <b>AI 率区间（估计）</b>
                  {aiRateBands.map((band) => (
                    <p key={band.tone}>
                      <span className={`similarity-risk risk-${band.tone}`}>
                        {band.label}
                      </span>
                      <span>{band.range}</span>
                    </p>
                  ))}
                  <p>
                    <span className="similarity-risk risk-low">证据不足</span>
                    <span>不生成百分比</span>
                  </p>
                  <p>{aiRateBandNote}</p>
                </div>
              </details>
              <label>
                结果排序
                <select
                  value={sort}
                  onChange={(event) => {
                    setSort(event.target.value as AIResultSort);
                    setPage(0);
                  }}
                >
                  <option value="rate_desc">AI 率从高到低</option>
                  <option value="rate_asc">AI 率从低到高</option>
                  <option value="student">按学生姓名</option>
                </select>
              </label>
            </div>
          </div>
          {visibleRows.length ? (
            <div className="similarity-table-scroll">
              <table className="assessment-table ai-detection-table">
                <thead>
                  <tr>
                    <th>学生 / 提交</th>
                    <th>AI 率（估计）</th>
                    <th>识别结论</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr
                      key={row.source.id}
                      className={`ai-result-row state-${row.state}`}
                    >
                      <td data-label="学生 / 提交">
                        <div className="ai-student">
                          <span
                            className="ai-student-avatar"
                            aria-hidden="true"
                          >
                            {row.source.studentName.slice(0, 1)}
                          </span>
                          <div>
                            <b>{row.source.studentName}</b>
                            <small>
                              学生 {row.source.studentId} · #{row.source.id}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td data-label="AI 率（估计）">
                        {row.result ? (
                          <>
                            <div className="ai-detection-rate">
                              {aiRateBand(row.result) && (
                                <b className="similarity-percentage">
                                  {formatAIRate(row.result)}
                                </b>
                              )}
                              <span
                                className={`similarity-risk risk-${aiRateBand(row.result)?.tone ?? "low"}`}
                              >
                                {aiRowLabel(row)}
                              </span>
                            </div>
                            {aiRateBand(row.result) && (
                              <span
                                className={`ai-rate-meter tone-${aiRateBand(row.result)!.tone}`}
                                aria-hidden="true"
                              >
                                <i style={{ width: `${row.result.aiRate}%` }} />
                              </span>
                            )}
                            <small>
                              判断置信度{" "}
                              {(row.result.confidence * 100).toFixed(0)}%
                            </small>
                          </>
                        ) : (
                          <span>{aiRowLabel(row)}</span>
                        )}
                      </td>
                      <td
                        data-label="识别结论"
                        className="ai-detection-summary"
                      >
                        <p>
                          {row.result?.summary ??
                            row.error ??
                            (row.state === "stopped"
                              ? "可重试未完成项。"
                              : "等待生成代码分析与依据。")}
                        </p>
                        {row.result && row.result.evidence.length > 0 && (
                          <small>
                            {row.result.evidence.length} 条代码依据可查看
                          </small>
                        )}
                      </td>
                      <td>
                        {row.result && (
                          <button
                            className="text-action"
                            aria-haspopup="dialog"
                            onClick={() => setSelectedId(row.source.id)}
                          >
                            <Icon name="eye" />
                            查看依据
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="当前分类下没有结果，请切换分类查看。" />
          )}
          {filteredRows.length > 25 && (
            <nav className="similarity-pagination" aria-label="AI 识别结果分页">
              <button
                className="submission-action"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                上一页
              </button>
              <span>
                第 {currentPage + 1}/{pageCount} 页 · 共 {filteredRows.length}{" "}
                份
              </span>
              <button
                className="submission-action"
                disabled={currentPage + 1 >= pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                下一页
              </button>
            </nav>
          )}
        </section>
      )}
      {selected?.result && (
        <Dialog
          wide
          title={`${selected.source.studentName} · AI 生成识别`}
          note={`提交 #${selected.source.id} · ${date(selected.result.generatedAt)}`}
          onClose={() => setSelectedId("")}
        >
          <div className="ai-detection-detail">
            <div className="ai-detection-score">
              <strong>
                {aiRateBand(selected.result)
                  ? formatAIRate(selected.result)
                  : "证据不足"}
              </strong>
              <span>
                AI 率（估计） · 判断置信度{" "}
                {(selected.result.confidence * 100).toFixed(0)}%
              </span>
              {aiRateBand(selected.result) && (
                <span
                  className={`similarity-risk risk-${aiRateBand(selected.result)!.tone}`}
                >
                  {aiRateBand(selected.result)!.label}
                </span>
              )}
            </div>
            {report && (
              <div className="ai-detection-export">
                <button
                  className="submission-action"
                  onClick={() =>
                    downloadAIDetectionHTML(assignment.title, {
                      ...report,
                      selection: "selected_submission",
                      rows: [selected],
                    })
                  }
                >
                  <Icon name="arrowDown" />
                  下载本份报告 · HTML
                </button>
                <button
                  className="submission-action"
                  onClick={() =>
                    printAIDetectionReport(assignment.title, {
                      ...report,
                      selection: "selected_submission",
                      rows: [selected],
                    })
                  }
                >
                  <Icon name="submissions" />
                  打印本份 / 保存 PDF
                </button>
              </div>
            )}
            <p>{selected.result.summary}</p>
            <h3>代码依据</h3>
            {selected.result.evidence.length ? (
              selected.result.evidence.map((item, index) => (
                <article className="ai-detection-evidence" key={index}>
                  <b>
                    第 {item.startLine}
                    {item.endLine !== item.startLine
                      ? `–${item.endLine}`
                      : ""}{" "}
                    行
                  </b>
                  <pre>
                    <code>{item.quote}</code>
                  </pre>
                  <p>{item.explanation}</p>
                </article>
              ))
            ) : (
              <p>当前代码不足以提供可靠的来源判断依据，未生成 AI 率估计。</p>
            )}
            <h3>判断局限</h3>
            <ul>
              {selected.result.limitations.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
            <p>{caution}</p>
            <CodeEditor
              language={assignment.language}
              value={selected.source.code}
              readOnly
              allowFullscreen={false}
              label={`提交 #${selected.source.id} 原始代码`}
            />
          </div>
        </Dialog>
      )}
    </div>
  );
}
