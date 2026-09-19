package api

import "testing"

func TestValidateRegistration(t *testing.T) {
	tests := []struct {
		name      string
		input     registrationInput
		wantError bool
	}{
		{"student", registrationInput{" Alice_01 ", " 王同学 ", "password123", "student"}, false},
		{"teacher", registrationInput{"teacher-02", "李老师", "CodeEval123!", "teacher"}, false},
		{"short username", registrationInput{"ab", "王同学", "password123", "student"}, true},
		{"invalid username", registrationInput{"alice@example", "王同学", "password123", "student"}, true},
		{"short name", registrationInput{"alice01", "王", "password123", "student"}, true},
		{"short password", registrationInput{"alice01", "王同学", "1234567", "student"}, true},
		{"invalid role", registrationInput{"alice01", "王同学", "password123", "admin"}, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			message := validateRegistration(&test.input)
			if (message != "") != test.wantError {
				t.Fatalf("validation message=%q, wantError=%v", message, test.wantError)
			}
			if !test.wantError && test.input.Username != "alice_01" && test.name == "student" {
				t.Fatalf("username was not normalized: %q", test.input.Username)
			}
		})
	}
}
