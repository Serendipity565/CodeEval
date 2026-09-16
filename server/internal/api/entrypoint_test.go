package api

import "testing"

func TestValidateProgramEntrypoint(t *testing.T) {
	cases := []struct {
		language, code string
		wantError      bool
	}{
		{"Go", "package main\nfunc main() {}", false},
		{"Go", "package solution\nfunc twoSum() {}", true},
		{"Java", "public class Main { public static void main(String[] args) {} }", false},
		{"Java", "class Solution { int solve() { return 1; } }", true},
		{"C++", "int main() { return 0; }", false},
		{"C++", "int solve() { return 0; }", true},
		{"Python", "print(input())", false},
	}
	for _, test := range cases {
		err := validateProgramEntrypoint(test.language, test.code)
		if (err != nil) != test.wantError {
			t.Fatalf("%s validation error=%v, wantError=%v", test.language, err, test.wantError)
		}
	}
}
