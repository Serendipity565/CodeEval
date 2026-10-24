import { useMemo, useRef, useState } from "react";
import type {
  Assignment,
  SimilarityPair,
  SimilarityReport,
  Submission,
} from "../../types";
import { checkSimilarity } from "../../api/similarity";
import { Empty, Icon } from "../ui";
import Dialog from "../ui/Dialog";
import {
  downloadSimilarityHTML,
  printSimilarityReport,
  similarityCaution,
  similarityMethod,
  similarityBands,
  similarityBandNote,
} from "./report";
import SimilarityEvidence, { RiskBadge } from "./SimilarityEvidence";
import "./similarity.css";

const date = (value: string) => new Date(value).toLocaleString("zh-CN");
const keyOf = (pair: SimilarityPair) => `${pair.a}:${pair.b}`;
export default function CodeSimilarity({
  assignment,
  submissions,
  token,
  back,
}: {
  assignment: Assignment;
  submissions: Submission[];
  token: string;
  back: () => void;
}) {
  const [mode, setMode] = useState<"class" | "pair">("class");
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [template, setTemplate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<SimilarityReport>();
  const [selectedKey, setSelectedKey] = useState("");
  const [threshold, setThreshold] = useState(0);
  const [showEmpty, setShowEmpty] = useState(false);
  const [page, setPage] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateDraft, setTemplateDraft] = useState("");
  const requestNumber = useRef(0);
  const choices = useMemo(
    () =>
      submissions
        .filter((s) => s.assignmentId === assignment.id)
        .sort(
          (a, b) =>
            b.submittedAt.localeCompare(a.submittedAt) ||
            Number(b.id) - Number(a.id),
        ),
    [submissions, assignment.id],
  );
  const students = new Set(choices.map((s) => s.studentId)).size;
  const sourceMap = new Map(
    report?.sources.map((source) => [source.id, source]),
  );
  const pairs =
    report?.pairs.filter(
      (pair) =>
        pair.similarity >= threshold && (showEmpty || pair.matches.length > 0),
    ) ?? [];
  const pageCount = Math.max(1, Math.ceil(pairs.length / 25));
  const currentPage = Math.min(page, pageCount - 1);
  const visiblePairs = pairs.slice(currentPage * 25, (currentPage + 1) * 25);
  const selected = report?.pairs.find((pair) => keyOf(pair) === selectedKey);
  const a = selected && sourceMap.get(selected.a),
    b = selected && sourceMap.get(selected.b);
  const invalidate = () => {
    requestNumber.current++;
    setReport(undefined);
    setSelectedKey("");
    setError("");
    setLoading(false);
  };
  async function run() {
    const current = ++requestNumber.current;
    setLoading(true);
    setError("");
    setReport(undefined);
    setSelectedKey("");
    try {
      const result = await checkSimilarity(
        token,
        assignment.id,
        mode === "class" ? [] : [left, right],
        template,
      );
      if (current !== requestNumber.current) return;
      setReport(result);
      setSettingsOpen(false);
      setPage(0);
      setSelectedKey("");
    } catch (failure) {
      if (current === requestNumber.current)
        setError(
          failure instanceof Error ? failure.message : "查重失败，请重试",
        );
    } finally {
      if (current === requestNumber.current) setLoading(false);
    }
  }
  return (
    <div className="similarity-page">
      <button className="back" onClick={back}>
        <Icon name="chevronLeft" />
        返回作业
      </button>
      <header className="similarity-heading">
        <div>
          <span className="similarity-context">
            <Icon name="code" />
            {assignment.language}
            <span>代码审阅</span>
          </span>
          <h2>{assignment.title}</h2>
          <p>比对提交，沿着相似片段回到代码。</p>
        </div>
        <button
          type="button"
          className="submission-action"
          aria-haspopup="dialog"
          onClick={() => setHelpOpen(true)}
        >
          <Icon name="eye" />
          检测说明
        </button>
      </header>
      <section
        className={`panel similarity-settings ${settingsOpen ? "" : "collapsed"}`}
      >
        {!settingsOpen && (
          <button
            className="similarity-settings-toggle"
            aria-expanded={false}
            onClick={() => setSettingsOpen(true)}
          >
            <span>
              <Icon name="settings" />
              <b>{mode === "class" ? "全班查重" : "两份比对"}</b>
              <small>
                {report?.sources.length ?? students} 份提交
                {template ? " · 已排除公共代码" : " · 未设置公共代码"}
              </small>
            </span>
            <span>
              修改设置
              <Icon name="chevronRight" />
            </span>
          </button>
        )}
        <div hidden={!settingsOpen}>
          <fieldset disabled={loading}>
            <legend>
              <span className="similarity-step">01</span> 设置检测范围
            </legend>
            <div className="similarity-modes">
              <label>
                <input
                  type="radio"
                  name="similarity-mode"
                  checked={mode === "class"}
                  onChange={() => {
                    invalidate();
                    setMode("class");
                  }}
                />
                <span>
                  <b>全班查重</b>
                  <small>每人最新提交 · 当前 {students} 人</small>
                </span>
                <Icon name="submissions" />
              </label>
              <label>
                <input
                  type="radio"
                  name="similarity-mode"
                  checked={mode === "pair"}
                  onChange={() => {
                    invalidate();
                    setMode("pair");
                  }}
                />
                <span>
                  <b>两份比对</b>
                  <small>选择任意两份历史提交</small>
                </span>
                <Icon name="code" />
              </label>
            </div>
            {mode === "pair" && (
              <div className="similarity-selects">
                {([left, right] as const).map((value, side) => (
                  <label key={side}>
                    提交 {side === 0 ? "A" : "B"}
                    <select
                      value={value}
                      onChange={(e) => {
                        invalidate();
                        (side === 0 ? setLeft : setRight)(e.target.value);
                      }}
                    >
                      <option value="">请选择提交</option>
                      {choices.map((s) => (
                        <option
                          value={s.id}
                          key={s.id}
                          disabled={s.id === (side === 0 ? right : left)}
                        >
                          {s.studentName} · 学生 {s.studentId} · #{s.id} ·{" "}
                          {date(s.submittedAt)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
            <div className="similarity-template-setting">
              <span>
                公共代码{" "}
                <small>
                  {template
                    ? `已设置 · ${template.split("\n").length} 行`
                    : "可选，用于排除题目框架和示例代码"}
                </small>
              </span>
              <button
                type="button"
                className="submission-action"
                aria-haspopup="dialog"
                onClick={() => {
                  setTemplateDraft(template);
                  setTemplateOpen(true);
                }}
              >
                <Icon name={template ? "settings" : "plus"} />
                {template ? "修改公共代码" : "设置公共代码"}
              </button>
            </div>
          </fieldset>
          <button
            className={`primary ${loading ? "similarity-loading" : ""}`}
            disabled={
              loading ||
              (mode === "class"
                ? students < 2
                : !left || !right || left === right)
            }
            onClick={() => void run()}
          >
            {loading ? (
              <Icon name="refresh" />
            ) : (
              <Icon name={report ? "refresh" : "arrowRight"} />
            )}
            {loading ? "正在比对…" : report ? "重新检测" : "开始查重"}
          </button>
          <span className="similarity-run-note">
            {(mode === "class" ? students < 2 : choices.length < 2)
              ? "至少需要两名学生，或切换为两份比对。"
              : "仅分析代码相似性，成绩保持不变。"}
          </span>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      </section>
      {helpOpen && (
        <Dialog title="检测方法与判读说明" onClose={() => setHelpOpen(false)}>
          <div className="similarity-method">
            <p>{similarityMethod}</p>
            <p>
              标识符匹配要求片段内保持一致的替换关系；不自动排除“全班常见代码”，以免掩盖实际重复。Python
              保留每行缩进。
            </p>
            <p>{similarityCaution}</p>
            <small>
              每批最多 200 人；单份代码最多 20000 个词元、200000 字节，整批最多
              300000 个词元。超出计算预算时会明确提示，不返回部分结果。
            </small>
          </div>
        </Dialog>
      )}
      {templateOpen && (
        <Dialog
          title="排除公共代码"
          note="粘贴统一提供给学生的题目框架或示例代码，请勿粘贴完整参考答案。"
          onClose={() => setTemplateOpen(false)}
        >
          <form
            className="similarity-template-editor"
            onSubmit={(event) => {
              event.preventDefault();
              if (templateDraft !== template) {
                invalidate();
                setTemplate(templateDraft);
              }
              setTemplateOpen(false);
            }}
          >
            <label>
              公共代码
              <textarea
                rows={10}
                value={templateDraft}
                onChange={(event) => setTemplateDraft(event.target.value)}
                placeholder="例如：统一提供的函数、类或输入输出框架"
              />
            </label>
            <p>
              仅排除至少 8
              个连续原始词元一致的片段。保存修改后需重新检测；留空保存可移除已有设置。
            </p>
            <div className="dialog-form-actions">
              <button
                type="button"
                className="submission-action"
                onClick={() => setTemplateOpen(false)}
              >
                取消
              </button>
              <button type="submit" className="primary">
                保存设置
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {loading && (
        <section className="panel" role="status">
          正在提取代码特征并比对相似片段，请稍候…
        </section>
      )}
      {report && (
        <>
          <section className="panel similarity-summary">
            <div className="similarity-summary-heading">
              <span>
                <Icon name="check" />
                检测完成
              </span>
              <small>{date(report.generatedAt)}</small>
            </div>
            <div className="similarity-metrics">
              {[
                ["参与检测", report.sources.length, "份提交"],
                ["完成比对", report.comparedPairs, "组配对"],
                [
                  "发现相似片段",
                  report.pairs.filter((p) => p.matches.length).length,
                  "组待查看",
                ],
              ].map(([label, value, unit]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>
                    {value}
                    <small>{unit}</small>
                  </strong>
                </div>
              ))}
            </div>
            <div className="similarity-export">
              <button
                className="secondary"
                onClick={() => downloadSimilarityHTML(assignment.title, report)}
              >
                <Icon name="arrowDown" />
                下载报告 · HTML
              </button>
              <button
                className="secondary"
                onClick={() => printSimilarityReport(assignment.title, report)}
              >
                <Icon name="submissions" />
                打印 / 保存 PDF
              </button>
            </div>
            <p className="similarity-notice">
              <Icon name="alert" />
              相似片段是复核线索，不能据此确定抄袭或复制方向。
            </p>
            {report.sources.some((s) => s.tokenCount < report.minTokens) && (
              <p role="status">
                以下提交排除公共代码后有效内容不足 {report.minTokens}{" "}
                个词元，不能形成检测片段：
                {report.sources
                  .filter((s) => s.tokenCount < report.minTokens)
                  .map((s) => `${s.studentName}（#${s.id}）`)
                  .join("、")}
                。
              </p>
            )}
          </section>
          <section className="panel similarity-results">
            <div className="similarity-filters">
              <h3>
                <span className="similarity-step">02</span> 配对结果{" "}
                <small>{pairs.length} 组</small>
              </h3>
              <label>
                相似度筛选{" "}
                <select
                  value={threshold}
                  onChange={(e) => {
                    setThreshold(Number(e.target.value));
                    setPage(0);
                  }}
                >
                  {[0, 30, 50, 80].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? "全部相似度" : `${n}% 及以上`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={showEmpty}
                  onChange={(e) => {
                    setShowEmpty(e.target.checked);
                    setPage(0);
                  }}
                />
                显示未发现长片段的配对
              </label>
            </div>
            <p className="similarity-muted">
              按相似度降序排列。筛选仅影响页面，导出报告包含全部发现的片段。
            </p>
            <div className="similarity-band-guide" aria-label="相似度区间分类">
              {similarityBands.map((band) => (
                <div key={band.tone}>
                  <span className={`similarity-risk risk-${band.tone}`}>
                    {band.label}
                  </span>
                  <small>{band.range}</small>
                </div>
              ))}
              <p>{similarityBandNote}</p>
            </div>
            {pairs.length ? (
              <div className="similarity-table-scroll">
                <table className="assessment-table">
                  <thead>
                    <tr>
                      <th>提交 A</th>
                      <th>提交 B</th>
                      <th>相似度 ↓</th>
                      <th>A / B 覆盖率</th>
                      <th>片段数</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePairs.map((pair) => (
                      <tr
                        className={
                          selected === pair ? "similarity-selected" : ""
                        }
                        key={keyOf(pair)}
                      >
                        <td data-label="提交 A">
                          <b>{sourceMap.get(pair.a)?.studentName}</b>
                          <small>#{pair.a}</small>
                        </td>
                        <td data-label="提交 B">
                          <b>{sourceMap.get(pair.b)?.studentName}</b>
                          <small>#{pair.b}</small>
                        </td>
                        <td data-label="相似度">
                          <div className="similarity-score-label">
                            <b className="similarity-percentage">
                              {pair.similarity.toFixed(2)}
                              <small>%</small>
                            </b>
                            <RiskBadge score={pair.similarity} />
                          </div>
                          <span className="similarity-meter">
                            <i style={{ width: `${pair.similarity}%` }} />
                          </span>
                        </td>
                        <td data-label="A / B 覆盖率">
                          {pair.coverageA.toFixed(2)}% /{" "}
                          {pair.coverageB.toFixed(2)}%
                        </td>
                        <td data-label="片段数">{pair.matches.length}</td>
                        <td>
                          <button
                            className="text-action"
                            aria-haspopup="dialog"
                            onClick={() => {
                              setSelectedKey(keyOf(pair));
                            }}
                          >
                            查看代码证据
                            <Icon name="arrowRight" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                text={
                  report.pairs.some((p) => p.matches.length)
                    ? "当前筛选下没有配对，请降低阈值。"
                    : "未发现达到最小连续长度的相似片段；这不代表已证明没有抄袭。"
                }
              />
            )}
          </section>
          {pairs.length > 25 && (
            <nav className="similarity-pagination" aria-label="配对结果分页">
              <button
                className="secondary"
                disabled={currentPage === 0}
                onClick={() => {
                  setPage(currentPage - 1);
                }}
              >
                上一页
              </button>
              <span>
                第 {currentPage + 1} / {pageCount} 页 · 共 {pairs.length} 组
              </span>
              <button
                className="secondary"
                disabled={currentPage + 1 >= pageCount}
                onClick={() => {
                  setPage(currentPage + 1);
                }}
              >
                下一页
              </button>
            </nav>
          )}
          {selected && a && b && (
            <SimilarityEvidence
              key={keyOf(selected)}
              pair={selected}
              a={a}
              b={b}
              language={assignment.language}
              onClose={() => setSelectedKey("")}
            />
          )}
        </>
      )}
    </div>
  );
}
