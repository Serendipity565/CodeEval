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
export type Course = {
  id: string;
  teacherId: string;
  teacherName: string;
  title: string;
  description: string;
  studentCount: number;
  assignmentCount: number;
  enrolled: boolean;
};
export type CourseStudent = {
  id: string;
  name: string;
  username: string;
  enrolledAt: string;
};
export type AssignmentStudent = {
  id: string;
  name: string;
  submissionId?: string;
  submittedAt?: string;
};
export type Assignment = {
  courseId: string;
  courseTitle: string;
  expectedStudents: number;
  submittedStudents: number;
  submissionRate: number | null;
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
  referenceSolution?: string;
  knowledgeBase?: string;
};
export type Evaluation = {
  incomplete?: boolean;
  durationMs?: number;
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
  contextSources?: string[];
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
    unscored?: boolean;
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
  studentId: string;
  studentName: string;
  submittedAt: string;
  status: "queued" | "evaluating" | "graded" | "needs_review" | "failed";
  progress: number;
  code: string;
  evaluation?: Evaluation;
  review?: Review;
};
export type AssessmentDimension = {
  key: string;
  name: string;
  score: number;
  maxScore: number;
};
export type Review = {
  id: string;
  reviewerName: string;
  comment: string;
  dimensions: AssessmentDimension[];
  total: number;
  maxTotal: number;
  createdAt: string;
};
export type Assessment = { reviews: Review[] };
export type User = {
  id: number;
  username: string;
  displayName: string;
  role: "teacher" | "student";
};
export type AuthState = { token: string; user: User };
export type View =
  | "courses"
  | "home"
  | "assignments"
  | "submissions"
  | "publish"
  | "edit"
  | "similarity";

export type SimilarityRange = { startLine: number; endLine: number };
export type SimilarityMatch = {
  a: SimilarityRange;
  b: SimilarityRange;
  tokens: number;
  kind: "exact" | "renamed";
};
export type SimilaritySource = {
  id: string;
  studentId: string;
  studentName: string;
  submittedAt: string;
  code: string;
  tokenCount: number;
  excludedTokens: number;
};
export type SimilarityPair = {
  a: string;
  b: string;
  similarity: number;
  coverageA: number;
  coverageB: number;
  matchedTokens: number;
  matches: SimilarityMatch[];
};
export type SimilarityReport = {
  assignmentId: string;
  language: string;
  selection: "latest_per_student" | "selected_pair";
  generatedAt: string;
  version: string;
  minTokens: number;
  template: string;
  comparedPairs: number;
  sources: SimilaritySource[];
  pairs: SimilarityPair[];
};
