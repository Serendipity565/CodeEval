export type Rubric = {
  key: string;
  name: string;
  description: string;
  weight: number;
};
export type TestCase = {
  name: string;
  input: string;
  expected: string;
  hidden: boolean;
  weight: number;
  timeoutMs: number;
};
export type Assignment = {
  id: string;
  teacherId: string;
  teacherName: string;
  title: string;
  language: string;
  description: string;
  status: "open" | "closed";
  maxSubmissions: number;
  dueAt: string;
  rubric: Rubric[];
  llmEvaluationEnabled: boolean;
  hasReferenceMaterial: boolean;
  testCases: TestCase[];
  hasHiddenTests: boolean;
};
export type Evaluation = {
  total: number;
  maxTotal: number;
  summary: string;
  provider: string;
  strengths?: string[];
  issues?: string[];
  improvements?: string[];
  confidence: number;
  verified: boolean;
  evidenceType: string;
  promptVersion: string;
  evaluatorVersion: string;
  modelCalls: number;
  execution?: {
    language: string;
    compileOk: boolean;
    compileError?: string;
    passed: number;
    total: number;
    passedWeight: number;
    totalWeight: number;
    results: {
      name: string;
      passed: boolean;
      hidden: boolean;
      input?: string;
      expected?: string;
      actual?: string;
      exitCode: number;
      durationMs: number;
      error?: string;
    }[];
  };
  analysis?: {
    category: string;
    severity: string;
    location: string;
    evidence: string;
    explanation: string;
  }[];
  dimensions: {
    key: string;
    name: string;
    criterion?: string;
    score: number;
    maxScore: number;
    evidence: string;
    suggestion: string;
    confidence: number;
    verified: boolean;
    evidenceType: string;
  }[];
};
export type Submission = {
  id: string;
  assignmentId: string;
  studentName: string;
  submittedAt: string;
  status: "queued" | "evaluating" | "graded" | "needs_review" | "failed";
  progress: number;
  code: string;
  evaluation?: Evaluation;
};
export type User = {
  id: number;
  username: string;
  displayName: string;
  role: "teacher" | "student";
};
export type AuthState = { token: string; user: User };
export type View = "home" | "assignments" | "submissions" | "publish";
