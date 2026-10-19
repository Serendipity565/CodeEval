import { useEffect, useState } from "react";
import type {
  Assignment,
  AssignmentComparison as ComparisonData,
} from "../../types";
import { getComparison } from "../../api/assessment";
import { Empty, Icon, Title } from "../ui";

const fixed = (value: number) => value.toFixed(2);
const signed = (value: number) => `${value > 0 ? "+" : ""}${fixed(value)}`;
const seconds = (value: number | null) =>
  value == null ? "未记录" : `${fixed(value)} 秒`;
export default function AssignmentComparison({
  assignment,
  token,
  back,
  openSubmission,
  openSubmissions,
}: {
  assignment: Assignment;
  token: string;
  back: () => void;
  openSubmission: (id: string) => void;
  openSubmissions: () => void;
}) {
  const [data, setData] = useState<ComparisonData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getComparison(token, assignment.id)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error ? failure.message : "对照数据加载失败",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, assignment.id, revision]);
  const metrics = data?.metrics;
  return (
    <div className="comparison-page">
      <button className="back" onClick={back}>
        <Icon name="chevronLeft" />
        返回作业
      </button>
      <Title
        title={`${assignment.title} · 评分对照`}
        note="比较原始自动评分与独立专家评分，教师复核不参与本实验。"
      >
        <button
          className="secondary"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          {loading ? "正在加载…" : "刷新数据"}
        </button>
      </Title>
      <section className="panel comparison-method">
        <h3>样本口径</h3>
        <p>
          每位学生仅取最新一次提交；该次提交同时具有完整 DeepSeek
          模型评分和专家评分时才纳入。多位专家先在同一份提交内取均值，再对提交等权统计。新增提交可能使旧样本暂时退出配对。
        </p>
        {data && (
          <div className="comparison-coverage">
            <span>
              最新提交 <b>{data.latestSubmissionCount}</b>
            </span>
            <span>
              已配对 <b>{data.pairedCount}</b>
            </span>
            <span>
              未纳入 <b>{data.excludedCount}</b>
            </span>
          </div>
        )}
        <small>
          分数差 = 自动评分 − 专家均分。未纳入样本可能缺少完整 DeepSeek
          模型评分或专家记录；评分接近不代表已证明教学效果。
        </small>
      </section>
      {loading ? (
        <section className="panel" role="status">
          正在读取对照统计…
        </section>
      ) : error ? (
        <section className="panel assessment-error" role="alert">
          <p>{error}</p>
          <button
            className="secondary"
            onClick={() => setRevision((value) => value + 1)}
          >
            重新加载
          </button>
        </section>
      ) : !metrics ? (
        <section className="panel">
          <Empty
            text="尚无可配对样本。请为学生最新一次、DeepSeek 模型评分完整的提交录入独立专家评分。"
            action={
              <button className="primary" onClick={openSubmissions}>
                前往提交列表
              </button>
            }
          />
        </section>
      ) : (
        <>
          <section className="comparison-metrics" aria-label="评分对照统计">
            {[
              [
                "平均绝对误差",
                `${fixed(metrics.meanAbsoluteError)} 分`,
                "逐份绝对分差的平均值，越小越接近",
              ],
              [
                "均方根误差",
                `${fixed(metrics.rootMeanSquaredError)} 分`,
                "对较大的逐份评分差异更敏感",
              ],
              [
                "平均偏差",
                `${signed(metrics.meanBias)} 分`,
                "正值表示自动评分整体偏高",
              ],
              [
                "误差不超过 5 分",
                `${(metrics.withinFivePointsRate * 100).toFixed(1)}%`,
                `基于 ${data!.pairedCount} 份配对提交`,
              ],
            ].map(([label, value, note]) => (
              <article className="panel" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{note}</small>
              </article>
            ))}
          </section>
          <section className="panel">
            <h3>总体评分与耗时</h3>
            <div
              className="assessment-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="总体评分与耗时对照表"
            >
              <table className="assessment-table comparison-summary-table">
                <thead>
                  <tr>
                    <th>指标</th>
                    <th>原始自动评分</th>
                    <th>专家评分</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>平均分</th>
                    <td>{fixed(metrics.aiMean)}</td>
                    <td>{fixed(metrics.expertMean)}</td>
                  </tr>
                  <tr>
                    <th>标准差</th>
                    <td>{fixed(metrics.aiStdDev)}</td>
                    <td>{fixed(metrics.expertStdDev)}</td>
                  </tr>
                  <tr>
                    <th>平均评分耗时</th>
                    <td>{seconds(metrics.aiMeanDurationSeconds)}</td>
                    <td>{seconds(metrics.expertMeanDurationSeconds)}</td>
                  </tr>
                  <tr>
                    <th>有耗时记录的配对样本</th>
                    <td>{metrics.aiTimedCount}</td>
                    <td>{metrics.expertTimedCount}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="assessment-note">
              自动耗时与专家耗时仅统计已记录的样本。专家耗时为每份提交内专家记录的平均值；不同记录范围下不直接推断节省比例。
            </p>
          </section>
          <section className="panel">
            <h3>配对提交明细</h3>
            <p className="assessment-note">
              展开查看各维度差异，也可打开原提交检查代码和评分依据。
            </p>
            <div className="comparison-pairs">
              {data!.pairs.map((pair) => (
                <details key={pair.submissionId}>
                  <summary>
                    <span>
                      <b>{pair.studentName}</b>
                      <small>
                        提交 #{pair.submissionId} · {pair.expertCount} 位专家
                      </small>
                    </span>
                    <span>
                      自动 <b>{fixed(pair.aiTotal)}</b>
                    </span>
                    <span>
                      专家 <b>{fixed(pair.expertMean)}</b>
                    </span>
                    <span
                      className={
                        Math.abs(pair.difference) > 5
                          ? "comparison-large-difference"
                          : ""
                      }
                    >
                      分差 <b>{signed(pair.difference)}</b>
                    </span>
                  </summary>
                  <div
                    className="assessment-table-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label={`${pair.studentName}的维度对照`}
                  >
                    <table className="assessment-table">
                      <thead>
                        <tr>
                          <th>维度</th>
                          <th>满分</th>
                          <th>自动</th>
                          <th>专家均分</th>
                          <th>分差</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pair.dimensions.map((dimension) => (
                          <tr key={dimension.key}>
                            <th>{dimension.name}</th>
                            <td>{dimension.maxScore}</td>
                            <td>{fixed(dimension.aiScore)}</td>
                            <td>{fixed(dimension.expertMean)}</td>
                            <td>{signed(dimension.difference)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="comparison-pair-footer">
                    <small>
                      自动耗时 {seconds(pair.aiDurationSeconds)} · 专家耗时{" "}
                      {seconds(pair.expertDurationSeconds)}
                    </small>
                    <button
                      className="text-action"
                      onClick={() => openSubmission(pair.submissionId)}
                    >
                      查看提交与评分记录 ›
                    </button>
                  </div>
                </details>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
