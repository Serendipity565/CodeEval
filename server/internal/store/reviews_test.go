package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"codeeval/server/internal/domain"
	gormMySQL "gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func score(value int) *int { return &value }

func originalAssessment() *domain.Evaluation {
	return &domain.Evaluation{Total: 50, MaxTotal: 100, Provider: "deepseek-agent", Dimensions: []domain.DimensionScore{
		{Key: "correctness", Name: "功能", Score: 30, MaxScore: 60},
		{Key: "quality", Name: "质量", Score: 20, MaxScore: 40},
	}}
}

func TestValidateHumanScoresUsesOriginalRubricAndExplicitZero(t *testing.T) {
	input := []domain.HumanScoreInput{{Key: "quality", Score: score(0)}, {Key: "correctness", Score: score(55)}}
	dimensions, total, maxTotal, err := validateHumanScores(originalAssessment(), input)
	if err != nil {
		t.Fatal(err)
	}
	if total != 55 || maxTotal != 100 || dimensions[0].Key != "correctness" || dimensions[0].MaxScore != 60 || dimensions[1].Score != 0 {
		t.Fatalf("incorrect normalized assessment: %+v total=%d max=%d", dimensions, total, maxTotal)
	}
}

func TestValidateHumanScoresRejectsMalformedAssessments(t *testing.T) {
	cases := map[string][]domain.HumanScoreInput{
		"missing score":       {{Key: "correctness"}, {Key: "quality", Score: score(20)}},
		"missing dimension":   {{Key: "correctness", Score: score(30)}},
		"duplicate dimension": {{Key: "quality", Score: score(20)}, {Key: "quality", Score: score(30)}},
		"renamed dimension":   {{Key: "new-key", Score: score(30)}, {Key: "quality", Score: score(20)}},
		"over max":            {{Key: "correctness", Score: score(61)}, {Key: "quality", Score: score(20)}},
		"negative":            {{Key: "correctness", Score: score(-1)}, {Key: "quality", Score: score(20)}},
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) {
			if _, _, _, err := validateHumanScores(originalAssessment(), input); !errors.Is(err, ErrInvalidAssessment) {
				t.Fatalf("expected invalid assessment, got %v", err)
			}
		})
	}
	if _, _, _, err := validateHumanScores(nil, nil); !errors.Is(err, ErrInvalidAssessment) {
		t.Fatalf("missing original rubric accepted: %v", err)
	}
}

func TestNormalizeExpertIdentity(t *testing.T) {
	_, want, err := normalizeExpertName(" Alice Zhang ")
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []string{"alice zhang", "ＡＬＩＣＥ　ＺＨＡＮＧ", "ALICE\t\nZHANG"} {
		_, got, err := normalizeExpertName(input)
		if err != nil || got != want {
			t.Fatalf("same expert produced different identity for %q: %s %v", input, got, err)
		}
	}
	if _, _, err := normalizeExpertName(" \n\t"); !errors.Is(err, ErrInvalidAssessment) {
		t.Fatalf("empty expert accepted: %v", err)
	}
}

// A small database/sql script exercises the actual GORM transactions without a
// database service or extra testing dependencies. It also asserts ownership and
// row locking in the SQL sent by the production methods.
type assessmentStep struct {
	kind     string
	contains []string
	columns  []string
	rows     [][]driver.Value
	check    func([]driver.NamedValue)
	insertID int64
}
type assessmentScript struct {
	t        *testing.T
	steps    []assessmentStep
	position int
}
type assessmentDriver struct{}
type assessmentConn struct{ script *assessmentScript }
type assessmentRows struct {
	columns []string
	values  [][]driver.Value
	offset  int
}
type assessmentResult int64

var assessmentScripts sync.Map
var assessmentDriverOnce sync.Once

func (assessmentDriver) Open(name string) (driver.Conn, error) {
	value, ok := assessmentScripts.Load(name)
	if !ok {
		return nil, errors.New("unknown assessment script")
	}
	return &assessmentConn{script: value.(*assessmentScript)}, nil
}
func (c *assessmentConn) step(kind, query string, args []driver.NamedValue) assessmentStep {
	c.script.t.Helper()
	if c.script.position >= len(c.script.steps) {
		c.script.t.Fatalf("unexpected %s: %s", kind, query)
	}
	step := c.script.steps[c.script.position]
	c.script.position++
	if step.kind != kind {
		c.script.t.Fatalf("step %d: expected %s, got %s: %s", c.script.position, step.kind, kind, query)
	}
	for _, part := range step.contains {
		if !strings.Contains(query, part) {
			c.script.t.Fatalf("SQL %q missing %q", query, part)
		}
	}
	if step.check != nil {
		step.check(args)
	}
	return step
}
func (c *assessmentConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepared statement")
}
func (c *assessmentConn) Close() error              { return nil }
func (c *assessmentConn) Begin() (driver.Tx, error) { c.step("begin", "", nil); return c, nil }
func (c *assessmentConn) Commit() error             { c.step("commit", "", nil); return nil }
func (c *assessmentConn) Rollback() error           { c.step("rollback", "", nil); return nil }
func (c *assessmentConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	step := c.step("query", query, args)
	return &assessmentRows{columns: step.columns, values: step.rows}, nil
}
func (c *assessmentConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	step := c.step("exec", query, args)
	return assessmentResult(step.insertID), nil
}
func (r *assessmentRows) Columns() []string { return r.columns }
func (r *assessmentRows) Close() error      { return nil }
func (r *assessmentRows) Next(values []driver.Value) error {
	if r.offset == len(r.values) {
		return io.EOF
	}
	copy(values, r.values[r.offset])
	r.offset++
	return nil
}
func (r assessmentResult) LastInsertId() (int64, error) { return int64(r), nil }
func (assessmentResult) RowsAffected() (int64, error)   { return 1, nil }

func assessmentTestStore(t *testing.T, steps []assessmentStep) *MySQLStore {
	t.Helper()
	assessmentDriverOnce.Do(func() { sql.Register("codeeval-assessment-test", assessmentDriver{}) })
	name := t.Name()
	script := &assessmentScript{t: t, steps: steps}
	assessmentScripts.Store(name, script)
	connection, err := sql.Open("codeeval-assessment-test", name)
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	db, err := gorm.Open(gormMySQL.New(gormMySQL.Config{Conn: connection, SkipInitializeWithVersion: true}), &gorm.Config{DisableAutomaticPing: true, Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = connection.Close()
		assessmentScripts.Delete(name)
		if script.position != len(script.steps) {
			t.Errorf("used %d of %d expected SQL steps", script.position, len(script.steps))
		}
	})
	return &MySQLStore{db: db}
}

func submissionLockStep(status string) assessmentStep {
	data, _ := json.Marshal(originalAssessment())
	return assessmentStep{kind: "query", contains: []string{"FROM `submission_records`", "assignment_id IN (SELECT `id` FROM `assignment_records` WHERE teacher_id = ?)", "FOR UPDATE"}, columns: []string{"id", "assignment_id", "student_id", "status", "evaluation_json"}, rows: [][]driver.Value{{int64(7), int64(2), int64(3), status, data}}}
}
func noPendingJobStep() assessmentStep {
	return assessmentStep{kind: "query", contains: []string{"count(*)", "submission_id = ? AND status IN"}, columns: []string{"count"}, rows: [][]driver.Value{{int64(0)}}}
}

func TestCreateReviewPreservesAutomaticAssessment(t *testing.T) {
	lock := submissionLockStep("needs_review")
	lock.check = func(args []driver.NamedValue) {
		if len(args) < 2 || args[0].Value != int64(7) || args[1].Value != int64(9) {
			t.Fatalf("owner filter arguments: %+v", args)
		}
	}
	store := assessmentTestStore(t, []assessmentStep{
		{kind: "begin"}, lock, noPendingJobStep(),
		{kind: "query", contains: []string{"FROM `review_records`", "ORDER BY id desc"}, columns: []string{"id"}},
		{kind: "exec", contains: []string{"INSERT INTO `review_records`"}, insertID: 42},
		{kind: "exec", contains: []string{"UPDATE `submission_records` SET `progress`=?,`status`=? WHERE id = ?"}},
		{kind: "query", contains: []string{"FROM `users`"}, columns: []string{"id", "display_name"}, rows: [][]driver.Value{{int64(3), "学生"}}},
		{kind: "commit"},
	})
	expected := ""
	result, err := store.CreateReview(7, 9, "教师", domain.ReviewInput{Comment: "已核对执行证据", ExpectedReviewID: &expected, Dimensions: []domain.HumanScoreInput{{Key: "correctness", Score: score(60)}, {Key: "quality", Score: score(30)}}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Review == nil || result.Review.ID != "42" || result.Review.Total != 90 || result.Evaluation.Total != 50 || result.Status != "graded" || result.StudentID != "3" {
		t.Fatalf("review overwrote original or returned incorrect result: %+v", result)
	}
}

func TestCreateReviewRejectsStaleRevisionAndPendingWork(t *testing.T) {
	t.Run("stale", func(t *testing.T) {
		store := assessmentTestStore(t, []assessmentStep{{kind: "begin"}, submissionLockStep("graded"), noPendingJobStep(), {kind: "query", contains: []string{"FROM `review_records`"}, columns: []string{"id"}, rows: [][]driver.Value{{int64(12)}}}, {kind: "rollback"}})
		expected := "11"
		_, err := store.CreateReview(7, 9, "教师", domain.ReviewInput{Comment: "复核", ExpectedReviewID: &expected, Dimensions: []domain.HumanScoreInput{{Key: "correctness", Score: score(50)}, {Key: "quality", Score: score(30)}}})
		if !errors.Is(err, ErrReviewConflict) {
			t.Fatalf("expected conflict, got %v", err)
		}
	})
	t.Run("pending status", func(t *testing.T) {
		store := assessmentTestStore(t, []assessmentStep{{kind: "begin"}, submissionLockStep("evaluating"), {kind: "rollback"}})
		expected := ""
		_, err := store.CreateReview(7, 9, "教师", domain.ReviewInput{Comment: "复核", ExpectedReviewID: &expected})
		if !errors.Is(err, ErrAssessmentPending) {
			t.Fatalf("pending work accepted: %v", err)
		}
	})
	t.Run("running job with terminal submission", func(t *testing.T) {
		job := noPendingJobStep()
		job.rows = [][]driver.Value{{int64(1)}}
		store := assessmentTestStore(t, []assessmentStep{{kind: "begin"}, submissionLockStep("graded"), job, {kind: "rollback"}})
		_, err := store.SaveExpertRating(7, 9, domain.ExpertRatingInput{ExpertName: "专家"})
		if !errors.Is(err, ErrAssessmentPending) {
			t.Fatalf("running job accepted: %v", err)
		}
	})
}

func TestExpertUpsertKeepsIDAndDoesNotWriteSubmission(t *testing.T) {
	createdAt := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	store := assessmentTestStore(t, []assessmentStep{
		{kind: "begin"}, submissionLockStep("graded"), noPendingJobStep(),
		{kind: "query", contains: []string{"FROM `expert_rating_records`", "expert_key = ?"}, columns: []string{"id", "created_at"}, rows: [][]driver.Value{{int64(88), createdAt}}},
		{kind: "exec", contains: []string{"UPDATE `expert_rating_records`", "WHERE `id` = ?"}},
		{kind: "commit"},
	})
	result, err := store.SaveExpertRating(7, 9, domain.ExpertRatingInput{ExpertName: " 专家 ", DurationSeconds: 0, Dimensions: []domain.HumanScoreInput{{Key: "correctness", Score: score(40)}, {Key: "quality", Score: score(20)}}})
	if err != nil {
		t.Fatal(err)
	}
	if result.ID != "88" || !result.CreatedAt.Equal(createdAt) || result.Total != 60 || result.ExpertName != "专家" {
		t.Fatalf("unexpected updated rating: %+v", result)
	}
}

func TestAssessmentOwnershipRejectsBeforeReadingPrivateRecords(t *testing.T) {
	store := assessmentTestStore(t, []assessmentStep{{kind: "query", contains: []string{"assignment_id IN (SELECT `id` FROM `assignment_records` WHERE teacher_id = ?)"}, columns: []string{"id"}}})
	_, err := store.SubmissionAssessment(7, 99)
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("unauthorized read: %v", err)
	}
}

func TestReviewRequiresVersionBeforeDatabase(t *testing.T) {
	_, err := (&MySQLStore{}).CreateReview(1, 1, "教师", domain.ReviewInput{Comment: "复核"})
	if !errors.Is(err, ErrInvalidAssessment) {
		t.Fatal(fmt.Sprintf("expected missing-version error, got %v", err))
	}
}
