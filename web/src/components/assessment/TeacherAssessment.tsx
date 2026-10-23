import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Assessment, Evaluation, Review, Submission } from "../../types";
import { dimensionUnscored } from "../../assessment";
import { getAssessment, saveReview } from "../../api/assessment";
import { ApiError } from "../../api/client";
import { Icon, Score } from "../ui";
import Dialog from "../ui/Dialog";

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

export default function TeacherAssessment(props: {
  token: string;
  submission: Submission;
  onUpdated: (value: Submission) => void;
}) {
  const [open, setOpen] = useState(false);
  if (
    !props.submission.evaluation ||
    !["graded", "needs_review"].includes(props.submission.status)
  )
    return null;
  return (
    <>
      <button
        type="button"
        className="submission-action review-action"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon name="check" />
        {props.submission.review ? "修改复核" : "教师复核"}
      </button>
      {open && (
        <Dialog
          title="教师复核"
          note={`${props.submission.studentName} · 提交评分`}
          onClose={() => setOpen(false)}
        >
          <section className="assessment-panel">
            <ReviewEditor {...props} />
          </section>
        </Dialog>
      )}
    </>
  );
}

function ReviewEditor({
  token,
  submission,
  onUpdated,
}: {
  token: string;
  submission: Submission;
  onUpdated: (value: Submission) => void;
}) {
  const [data, setData] = useState<Assessment>();
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
            failure instanceof Error ? failure.message : "复核记录加载失败",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, submission.id, revision]);
  const latestReview = data?.reviews[0] ?? submission.review;
  return (
    <>
      <p className="assessment-note">
        逐项确认得分并说明理由。保存后成为学生的最终成绩，原始评估和历次复核仍保留。
      </p>
      {message && (
        <p className="assessment-success" role="status">
          {message}
        </p>
      )}
      {loading ? (
        <p role="status">正在加载复核记录…</p>
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
      ) : data && submission.evaluation ? (
        <>
          <AssessmentForm
            key={`${revision}-${latestReview?.id ?? "new"}`}
            evaluation={submission.evaluation}
            latestReview={latestReview}
            onReload={() => setRevision((value) => value + 1)}
            onSubmit={async (input) => {
              setMessage("");
              const updated = await saveReview(token, submission.id, {
                ...input,
                expectedReviewId: latestReview?.id ?? "",
              });
              onUpdated(updated);
              setData(
                (current) =>
                  current && {
                    reviews: updated.review
                      ? [updated.review, ...current.reviews]
                      : current.reviews,
                  },
              );
              setMessage("复核已保存，学生最终成绩已更新。");
            }}
          />
          <section className="assessment-history" aria-label="复核历史">
            <h3>
              复核历史 <small>{data.reviews.length} 次</small>
            </h3>
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
          </section>
        </>
      ) : null}
    </>
  );
}

type FormInput = {
  dimensions: { key: string; score: number }[];
  comment: string;
};
function AssessmentForm({
  evaluation,
  latestReview,
  onSubmit,
  onReload,
}: {
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
          reviewed
            ? String(reviewed.score)
            : dimensionUnscored(evaluation, dimension)
              ? ""
              : String(dimension.score),
        ];
      }),
    ),
  );
  const [comment, setComment] = useState("");
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
    if (!comment.trim()) {
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
      });
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
          复核理由（必填）
          <textarea
            required
            maxLength={4000}
            rows={3}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="说明评分依据、调整原因或确认意见"
          />
        </label>
        <div className="assessment-form-footer">
          <span>
            {complete
              ? `合计 ${total} / ${evaluation.maxTotal}`
              : "填写所有维度后生成总分"}
          </span>
          <button className="primary" type="submit" disabled={saving}>
            {saving ? "正在保存…" : "保存复核结果"}
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
