import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Assessment, Evaluation, Review, Submission } from "../../types";
import { dimensionUnscored } from "../../assessment";
import {
  getAssessment,
  saveExpertRating,
  saveReview,
} from "../../api/assessment";
import { ApiError } from "../../api/client";
import { Score } from "../ui";

const date = (value: string) => new Date(value).toLocaleString("zh-CN");

export function FinalReview({ review }: { review: Review }) {
  return (
    <section className="panel assessment-final" aria-label="教师复核结果">
      <div className="assessment-heading">
        <div>
          <span className="eyebrow">最终成绩</span>
          <h3>教师已复核</h3>
        </div>
        <Score n={review.total} max={review.maxTotal} />
      </div>
      <p>{review.comment}</p>
      <div className="assessment-dimension-chips">
        {review.dimensions.map((dimension) => (
          <span key={dimension.key}>
            {dimension.name}{" "}
            <b>
              {dimension.score}/{dimension.maxScore}
            </b>
          </span>
        ))}
      </div>
      <small>
        {review.reviewerName} · {date(review.createdAt)} ·
        原始自动评估保留在下方
      </small>
    </section>
  );
}

export default function TeacherAssessment({
  token,
  submission,
  onUpdated,
}: {
  token: string;
  submission: Submission;
  onUpdated: (value: Submission) => void;
}) {
  const [data, setData] = useState<Assessment>();
  const [mode, setMode] = useState<"review" | "expert">("review");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getAssessment(token, submission.id)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error ? failure.message : "评分记录加载失败",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, submission.id, revision]);
  if (
    !submission.evaluation ||
    !["graded", "needs_review"].includes(submission.status)
  )
    return null;
  const latestReview = data?.reviews[0] ?? submission.review;
  return (
    <section className="panel assessment-panel">
      <div className="assessment-heading">
        <div>
          <span className="eyebrow">教师工作区</span>
          <h3>复核与专家评分</h3>
        </div>
        <div className="tabs" role="group" aria-label="评分操作">
          <button
            className={mode === "review" ? "on" : ""}
            onClick={() => {
              setMode("review");
              setMessage("");
            }}
          >
            教师复核
          </button>
          <button
            className={mode === "expert" ? "on" : ""}
            onClick={() => {
              setMode("expert");
              setMessage("");
            }}
          >
            独立专家评分
          </button>
        </div>
      </div>
      <p className="assessment-note">
        {mode === "review"
          ? "逐项确认得分并说明理由。保存后成为学生的最终成绩，原始评估和历次复核仍保留。"
          : "可代录专家独立完成的评分。相同专家姓名再次保存会更新该专家记录；专家评分仅用于对照实验，不改变学生成绩。请先独立完成评分，再录入结果。"}
      </p>
      {message && (
        <p className="assessment-success" role="status">
          {message}
        </p>
      )}
      {loading ? (
        <p role="status">正在加载评分记录…</p>
      ) : error ? (
        <div className="assessment-error" role="alert">
          <p>{error}</p>
          <button
            className="secondary"
            onClick={() => setRevision((value) => value + 1)}
          >
            重新加载
          </button>
        </div>
      ) : (
        data && (
          <>
            <AssessmentForm
              key={`${mode}-${revision}-${latestReview?.id ?? "new"}`}
              mode={mode}
              evaluation={submission.evaluation}
              latestReview={latestReview}
              onReload={() => setRevision((value) => value + 1)}
              onSubmit={async (input) => {
                setMessage("");
                if (mode === "review") {
                  const updated = await saveReview(token, submission.id, {
                    dimensions: input.dimensions,
                    comment: input.comment,
                    expectedReviewId: latestReview?.id ?? "",
                  });
                  onUpdated(updated);
                  setData(
                    (current) =>
                      current && {
                        ...current,
                        reviews: updated.review
                          ? [updated.review, ...current.reviews]
                          : current.reviews,
                      },
                  );
                  setMessage("复核已保存，学生最终成绩已更新。");
                } else {
                  const rating = await saveExpertRating(
                    token,
                    submission.id,
                    input,
                  );
                  setData(
                    (current) =>
                      current && {
                        ...current,
                        expertRatings: [
                          rating,
                          ...current.expertRatings.filter(
                            (item) => item.id !== rating.id,
                          ),
                        ],
                      },
                  );
                  setMessage(
                    `${rating.expertName}的专家评分已保存，学生成绩未变更。`,
                  );
                }
              }}
            />
            {mode === "review" ? (
              <details className="assessment-history">
                <summary>复核历史（{data.reviews.length} 次）</summary>
                {data.reviews.length ? (
                  data.reviews.map((review) => (
                    <article key={review.id}>
                      <div>
                        <b>{review.reviewerName}</b>
                        <Score n={review.total} max={review.maxTotal} />
                        <time>{date(review.createdAt)}</time>
                      </div>
                      <p>{review.comment}</p>
                      <div className="assessment-dimension-chips">
                        {review.dimensions.map((item) => (
                          <span key={item.key}>
                            {item.name} {item.score}/{item.maxScore}
                          </span>
                        ))}
                      </div>
                    </article>
                  ))
                ) : (
                  <p>尚无教师复核记录。</p>
                )}
              </details>
            ) : (
              <details className="assessment-history">
                <summary>已录入专家（{data.expertRatings.length} 位）</summary>
                {data.expertRatings.length ? (
                  data.expertRatings.map((rating) => (
                    <article key={rating.id}>
                      <div>
                        <b>{rating.expertName}</b>
                        <Score n={rating.total} max={rating.maxTotal} />
                        <time>{date(rating.createdAt)}</time>
                      </div>
                      <p>
                        {rating.comment || "未填写备注"} ·{" "}
                        {rating.durationSeconds > 0
                          ? `评分耗时 ${rating.durationSeconds} 秒`
                          : "未记录耗时"}
                      </p>
                      <div className="assessment-dimension-chips">
                        {rating.dimensions.map((item) => (
                          <span key={item.key}>
                            {item.name} {item.score}/{item.maxScore}
                          </span>
                        ))}
                      </div>
                    </article>
                  ))
                ) : (
                  <p>尚无独立专家评分。</p>
                )}
              </details>
            )}
          </>
        )
      )}
    </section>
  );
}

type FormInput = {
  dimensions: { key: string; score: number }[];
  comment: string;
  expertName: string;
  durationSeconds: number;
};
function AssessmentForm({
  mode,
  evaluation,
  latestReview,
  onSubmit,
  onReload,
}: {
  mode: "review" | "expert";
  evaluation: Evaluation;
  latestReview?: Review;
  onSubmit: (input: FormInput) => Promise<void>;
  onReload: () => void;
}) {
  const [scores, setScores] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      evaluation.dimensions.map((dimension) => {
        const reviewed = latestReview?.dimensions.find(
          (item) => item.key === dimension.key,
        );
        return [
          dimension.key,
          mode === "expert"
            ? ""
            : reviewed
              ? String(reviewed.score)
              : dimensionUnscored(evaluation, dimension)
                ? ""
                : String(dimension.score),
        ];
      }),
    ),
  );
  const [comment, setComment] = useState("");
  const [expertName, setExpertName] = useState("");
  const [duration, setDuration] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const total = evaluation.dimensions.reduce(
    (sum, item) => sum + Number(scores[item.key] || 0),
    0,
  );
  const complete = evaluation.dimensions.every(
    (item) =>
      scores[item.key]?.trim() !== "" &&
      Number.isInteger(Number(scores[item.key])) &&
      Number(scores[item.key]) >= 0 &&
      Number(scores[item.key]) <= item.maxScore,
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!complete) {
      setError("请为每个维度填写范围内的整数得分。");
      return;
    }
    if (mode === "review" && !comment.trim()) {
      setError("请填写复核理由。");
      return;
    }
    setSaving(true);
    setError("");
    setConflict(false);
    try {
      await onSubmit({
        dimensions: evaluation.dimensions.map((item) => ({
          key: item.key,
          score: Number(scores[item.key]),
        })),
        comment: comment.trim(),
        expertName: expertName.trim(),
        durationSeconds: Number(duration || 0),
      });
      if (mode === "expert") {
        setScores(
          Object.fromEntries(
            evaluation.dimensions.map((item) => [item.key, ""]),
          ),
        );
        setExpertName("");
        setComment("");
        setDuration("");
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "保存失败，请重试。",
      );
      setConflict(failure instanceof ApiError && failure.status === 409);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="assessment-form" onSubmit={submit}>
      <fieldset disabled={saving || conflict}>
        {mode === "expert" && (
          <div className="assessment-expert-fields">
            <label>
              专家姓名
              <input
                required
                maxLength={80}
                value={expertName}
                onChange={(event) => setExpertName(event.target.value)}
                placeholder="使用一致的姓名识别同一专家"
              />
            </label>
            <label>
              评分耗时（秒，可选）
              <input
                type="number"
                min={0}
                max={86400}
                step={1}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                placeholder="未记录可留空"
              />
            </label>
          </div>
        )}
        <div className="assessment-score-fields">
          {evaluation.dimensions.map((dimension) => (
            <label key={dimension.key}>
              <span>
                {dimension.name}
                <small>满分 {dimension.maxScore}</small>
              </span>
              <input
                aria-label={`${dimension.name}得分`}
                required
                type="number"
                min={0}
                max={dimension.maxScore}
                step={1}
                inputMode="numeric"
                value={scores[dimension.key] ?? ""}
                onChange={(event) =>
                  setScores((current) => ({
                    ...current,
                    [dimension.key]: event.target.value,
                  }))
                }
                placeholder="未评分"
              />
              {dimension.criterion && <small>{dimension.criterion}</small>}
            </label>
          ))}
        </div>
        <label>
          {mode === "review" ? "复核理由（必填）" : "专家评语（可选）"}
          <textarea
            required={mode === "review"}
            maxLength={4000}
            rows={3}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={
              mode === "review"
                ? "说明评分依据、调整原因或确认意见"
                : "记录专家独立评分的依据"
            }
          />
        </label>
        <div className="assessment-form-footer">
          <span>
            {complete
              ? `合计 ${total} / ${evaluation.maxTotal}`
              : "填写所有维度后生成总分"}
          </span>
          <button className="primary" type="submit" disabled={saving}>
            {saving
              ? "正在保存…"
              : mode === "review"
                ? "保存复核结果"
                : "保存专家评分"}
          </button>
        </div>
      </fieldset>
      {error && (
        <div className="assessment-error" role="alert">
          <p>{error}</p>
          {conflict && (
            <button type="button" className="secondary" onClick={onReload}>
              加载最新复核后重新填写
            </button>
          )}
        </div>
      )}
    </form>
  );
}
