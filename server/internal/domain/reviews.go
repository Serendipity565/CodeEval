package domain

import "time"

// HumanScore records the rubric snapshot used for a human assessment.
type HumanScore struct {
	Key      string `json:"key"`
	Name     string `json:"name"`
	Score    int    `json:"score"`
	MaxScore int    `json:"maxScore"`
}

type Review struct {
	ID           string       `json:"id"`
	ReviewerName string       `json:"reviewerName"`
	Comment      string       `json:"comment"`
	Dimensions   []HumanScore `json:"dimensions"`
	Total        int          `json:"total"`
	MaxTotal     int          `json:"maxTotal"`
	CreatedAt    time.Time    `json:"createdAt"`
}

type ExpertRating struct {
	ID              string       `json:"id"`
	ExpertName      string       `json:"expertName"`
	Comment         string       `json:"comment"`
	Dimensions      []HumanScore `json:"dimensions"`
	Total           int          `json:"total"`
	MaxTotal        int          `json:"maxTotal"`
	DurationSeconds int          `json:"durationSeconds"`
	CreatedAt       time.Time    `json:"createdAt"`
}

// A pointer distinguishes a deliberate zero from a missing or null score.
type HumanScoreInput struct {
	Key   string `json:"key"`
	Score *int   `json:"score"`
}

type ReviewInput struct {
	Dimensions       []HumanScoreInput `json:"dimensions"`
	Comment          string            `json:"comment"`
	ExpectedReviewID *string           `json:"expectedReviewId"`
}

type ExpertRatingInput struct {
	ExpertName      string            `json:"expertName"`
	Dimensions      []HumanScoreInput `json:"dimensions"`
	Comment         string            `json:"comment"`
	DurationSeconds int               `json:"durationSeconds"`
}
