package store

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"codeeval/server/internal/domain"
	"golang.org/x/crypto/bcrypt"
)

func TestSeedMockDataReplaysActualResultsAndPreservesExistingData(t *testing.T) {
	snapshot, err := loadRecordedSeed()
	if err != nil {
		t.Fatal(err)
	}
	for _, existing := range []bool{false, true} {
		name := "first import"
		if existing {
			name = "repeated import"
		}
		t.Run(name, func(t *testing.T) {
			steps := []assessmentStep{{kind: "begin"}}
			for i, user := range snapshot.Users {
				user := user
				query := assessmentStep{kind: "query", contains: []string{"FROM `users`", "username = ?"}, columns: []string{"id", "role"}}
				if existing {
					query.rows = [][]driver.Value{{int64(100 + i), user.Role}}
				}
				steps = append(steps, query)
				if !existing {
					steps = append(steps, assessmentStep{kind: "exec", contains: []string{"INSERT INTO `users`"}, insertID: int64(100 + i), check: func(args []driver.NamedValue) {
						password, username := false, false
						for _, arg := range args {
							if value, ok := arg.Value.(string); ok {
								if value == user.Username {
									username = true
								}
								if strings.HasPrefix(value, "$2") && bcrypt.CompareHashAndPassword([]byte(value), []byte(mockPassword)) == nil {
									password = true
								}
							}
						}
						if !password || !username {
							t.Fatal("account mapping or password missing")
						}
					}})
				}
			}
			assignmentQuery := assessmentStep{kind: "query", contains: []string{"FROM `assignment_records`", "language = ?"}, columns: []string{"id"}}
			if existing {
				assignmentQuery.rows = [][]driver.Value{{int64(200)}}
			}
			steps = append(steps, assignmentQuery)
			if !existing {
				steps = append(steps, assessmentStep{kind: "exec", contains: []string{"INSERT INTO `assignment_records`"}, insertID: 200})
			}
			for i := range snapshot.Assignment.Tests {
				query := assessmentStep{kind: "query", contains: []string{"FROM `test_case_records`"}, columns: []string{"id"}}
				if existing {
					query.rows = [][]driver.Value{{int64(300 + i)}}
				}
				steps = append(steps, query)
				if !existing {
					steps = append(steps, assessmentStep{kind: "exec", contains: []string{"INSERT INTO `test_case_records`"}, insertID: int64(300 + i)})
				}
			}
			for i, source := range snapshot.Submissions {
				source := source
				query := assessmentStep{kind: "query", contains: []string{"FROM `submission_records`"}, columns: []string{"id", "code", "evaluation_json"}}
				if existing {
					query.rows = [][]driver.Value{{int64(400 + i), "existing student work", []byte(`{"total":71}`)}}
				}
				steps = append(steps, query)
				if !existing {
					steps = append(steps, assessmentStep{kind: "exec", contains: []string{"INSERT INTO `submission_records`"}, insertID: int64(400 + i), check: func(args []driver.NamedValue) {
						code, result, status := false, false, false
						for _, arg := range args {
							if text, ok := arg.Value.(string); ok {
								if text == source.Code {
									code = true
								}
								if text == "graded" {
									status = true
								}
							}
							if data, ok := arg.Value.([]byte); ok && string(data) == string(source.Evaluation) {
								result = true
							}
						}
						if !code || !result || !status {
							t.Fatal("recorded code or original assessment changed during import")
						}
					}})
				}
			}
			steps = append(steps, assessmentStep{kind: "commit"})
			if err := SeedMockData(assessmentTestStore(t, steps)); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRecordedCPPCodeMatchesCapturedExecution(t *testing.T) {
	compiler, err := exec.LookPath("clang++")
	if err != nil {
		compiler, err = exec.LookPath("g++")
	}
	if err != nil {
		t.Skip("C++ compiler unavailable")
	}
	snapshot, err := loadRecordedSeed()
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Users) != 7 || len(snapshot.Submissions) != 6 || len(snapshot.Assignment.Tests) != 6 {
		t.Fatal("incomplete captured cohort")
	}
	for _, sample := range snapshot.Submissions {
		t.Run(sample.Student, func(t *testing.T) {
			var e domain.Evaluation
			if err := json.Unmarshal(sample.Evaluation, &e); err != nil {
				t.Fatal(err)
			}
			dir := t.TempDir()
			source, binary := filepath.Join(dir, "main.cpp"), filepath.Join(dir, "main")
			if err := os.WriteFile(source, []byte(sample.Code), 0600); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			if output, err := exec.CommandContext(ctx, compiler, "-std=c++17", source, "-o", binary).CombinedOutput(); err != nil {
				t.Fatalf("compile: %v\n%s", err, output)
			}
			for i, c := range snapshot.Assignment.Tests {
				run := exec.CommandContext(ctx, binary)
				run.Stdin = strings.NewReader(c.Input)
				output, err := run.Output()
				if err != nil {
					t.Fatal(err)
				}
				passed := strings.Join(strings.Fields(string(output)), " ") == strings.Join(strings.Fields(c.Expected), " ")
				if passed != e.Execution.Results[i].Passed {
					t.Fatalf("%s disagrees with captured sandbox result: %q", c.Name, output)
				}
			}
		})
	}
}
