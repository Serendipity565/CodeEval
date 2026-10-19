import type { Evaluation, Submission } from "./types";

export function dimensionUnscored(
  evaluation: Evaluation,
  dimension: Evaluation["dimensions"][number],
) {
  if (typeof dimension.unscored === "boolean") return dimension.unscored;
  return (
    evaluation.provider === "rules" &&
    !(
      dimension.evidenceType === "execution" &&
      dimension.verified &&
      evaluation.execution &&
      evaluation.execution.totalWeight > 0
    )
  );
}

export function evaluationIncomplete(evaluation: Evaluation) {
  return Boolean(
    evaluation.incomplete ||
    evaluation.dimensions.length === 0 ||
    evaluation.dimensions.some((dimension) =>
      dimensionUnscored(evaluation, dimension),
    ),
  );
}

export function finalScore(submission: Submission): number | undefined {
  if (submission.status !== "graded" && submission.status !== "needs_review")
    return undefined;
  if (submission.review) return submission.review.total;
  if (!submission.evaluation || evaluationIncomplete(submission.evaluation))
    return undefined;
  return submission.evaluation.total;
}

export function finalMaxScore(submission: Submission) {
  return submission.review?.maxTotal ?? submission.evaluation?.maxTotal ?? 100;
}
