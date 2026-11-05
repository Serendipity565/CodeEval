package evaluator

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"codeeval/server/internal/domain"
)

type aiSampleMemoryStore struct {
	mu    sync.Mutex
	banks map[string]domain.AISampleBank
	err   error
}

func (s *aiSampleMemoryStore) LoadAISampleBank(_ context.Context, id, fingerprint string) (*domain.AISampleBank, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return nil, s.err
	}
	bank, ok := s.banks[id+":"+fingerprint]
	if !ok {
		return nil, nil
	}
	return &bank, nil
}
func (s *aiSampleMemoryStore) SaveAISampleBank(_ context.Context, id string, bank domain.AISampleBank) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return s.err
	}
	if s.banks == nil {
		s.banks = map[string]domain.AISampleBank{}
	}
	s.banks[id+":"+bank.Fingerprint] = bank
	return nil
}

func generatedSampleResponse(input chatRequest) string {
	var material struct {
		Approach string `json:"approach"`
	}
	json.Unmarshal([]byte(input.Messages[1].Content), &material)
	codes := map[string]string{"直接实现": "print(1)", "模块化实现": "def solve():\n    print(1)\nsolve()", "不同实现策略": "value = 1\nprint(value)"}
	output, _ := json.Marshal(map[string]string{"code": codes[material.Approach]})
	return string(output)
}
func generatedSampleResponseForRequest(req *http.Request) string {
	var input chatRequest
	json.NewDecoder(req.Body).Decode(&input)
	return generatedSampleResponse(input)
}

func TestAISamplesGenerateOnceReuseBankAndInvalidateOnTaskOrModelChange(t *testing.T) {
	client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 1024)
	calls := 0
	client.httpClient.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		var input chatRequest
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(input.Messages[1].Content, "PRIVATE-ANSWER") || strings.Contains(input.Messages[1].Content, "STUDENT-SOURCE") {
			t.Fatal("sample generator received student or private answer")
		}
		return jsonResponse(generatedSampleResponse(input)), nil
	})
	service := &Service{deepseek: client, aiSampleStore: &aiSampleMemoryStore{}}
	a := domain.Assignment{ID: "2", Title: "输出", Language: "Python", Description: "输出1", ReferenceSolution: "PRIVATE-ANSWER"}
	first, n, err := service.loadOrGenerateAISamples(context.Background(), a)
	if err != nil || n != 3 || len(first.Samples) != 3 {
		t.Fatalf("generation failed: %+v %v", first, err)
	}
	second, n, err := service.loadOrGenerateAISamples(context.Background(), a)
	if err != nil || n != 0 || calls != 3 || !first.GeneratedAt.Equal(second.GeneratedAt) {
		t.Fatal("sample bank not reused")
	}
	a.ReferenceSolution = "updated archive"
	_, _, _ = service.loadOrGenerateAISamples(context.Background(), a)
	if calls != 3 {
		t.Fatal("archive-only answer invalidated sample bank")
	}
	a.Description = "输出2"
	_, _, err = service.loadOrGenerateAISamples(context.Background(), a)
	if err != nil || calls != 6 {
		t.Fatal("changed task reused stale samples")
	}
	client.model = "other-model"
	_, _, err = service.loadOrGenerateAISamples(context.Background(), a)
	if err != nil || calls != 9 {
		t.Fatal("changed model reused stale samples")
	}
	a.ID = "3"
	_, _, err = service.loadOrGenerateAISamples(context.Background(), a)
	if err != nil || calls != 12 {
		t.Fatal("another assignment reused the wrong bank")
	}
}

func TestAISampleConcurrentRequestsShareGenerationAndWaitersCanCancel(t *testing.T) {
	client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 1024)
	started, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	client.httpClient.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		once.Do(func() { close(started) })
		<-release
		return jsonResponse(generatedSampleResponseForRequest(req)), nil
	})
	s := &Service{deepseek: client, aiSampleStore: &aiSampleMemoryStore{}}
	a := domain.Assignment{ID: "2"}
	done := make(chan error, 1)
	go func() { _, _, err := s.loadOrGenerateAISamples(context.Background(), a); done <- err }()
	<-started
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := s.loadOrGenerateAISamples(ctx, a); !errors.Is(err, context.Canceled) {
		t.Fatalf("waiter did not cancel: %v", err)
	}
	other := make(chan error, 1)
	go func() { _, _, err := s.loadOrGenerateAISamples(context.Background(), a); other <- err }()
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if err := <-other; err != nil {
		t.Fatal(err)
	}
}

func TestAISampleFailureStopsAnalysisUntilTheSharedBankIsReady(t *testing.T) {
	s := aiContextService(t, func(v aiVerification) { t.Fatal("analysis ran without a complete sample bank") })
	s.SetAISampleStore(&aiSampleMemoryStore{err: errors.New("database unavailable")})
	result, err := s.DetectAICode(context.Background(), domain.Assignment{ID: "2"}, "value = 1\nprint(value)")
	var sampleErr *AISampleError
	if !errors.As(err, &sampleErr) || result.ModelCalls != 0 || result.ScoringVersion != "" {
		t.Fatalf("sample preparation failure was hidden: %+v %v", result, err)
	}
}

func TestAIFiveDimensionServiceGeneratesBankOnceAndPersistsComparisonSnapshot(t *testing.T) {
	client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 1024)
	requests := 0
	client.httpClient.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests++
		var input chatRequest
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(input.Messages[1].Content, `"verification"`) {
			return jsonResponse(aiSampleAssessmentResult(43)), nil
		}
		return jsonResponse(generatedSampleResponse(input)), nil
	})
	s := &Service{deepseek: client, maxCodeBytes: 1000, aiSampleStore: &aiSampleMemoryStore{}}
	for i := 0; i < 2; i++ {
		result, err := s.DetectAICode(context.Background(), domain.Assignment{ID: "2", Language: "Python"}, "value = 1\nprint(value)")
		wantCalls := 1
		if i == 0 {
			wantCalls = 4
		}
		if err != nil || result.ModelCalls != wantCalls || result.ScoringVersion != aiScoringVersion || len(result.Dimensions) != 5 || result.SampleComparison == nil || len(result.SampleComparison.Samples) != 3 {
			t.Fatalf("five-dimension pipeline lost sample context: %+v %v", result, err)
		}
	}
	if requests != 5 {
		t.Fatalf("want three sample requests and two analyses, got %d requests", requests)
	}
}

func TestAISamplesKeepCompletedProgramsAndResumeAfterLaterFailure(t *testing.T) {
	client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 256)
	failThird := true
	requests := 0
	client.httpClient.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests++
		var input chatRequest
		json.NewDecoder(req.Body).Decode(&input)
		if input.MaxTokens < 8192 {
			t.Fatal("complete program is still sharing the grading token budget")
		}
		if failThird && strings.Contains(input.Messages[1].Content, `"approach":"不同实现策略"`) {
			return jsonResponse(`{"code":`), nil
		}
		return jsonResponse(generatedSampleResponse(input)), nil
	})
	s := &Service{deepseek: client, aiSampleStore: &aiSampleMemoryStore{}}
	a := domain.Assignment{ID: "2"}
	bank, _, err := s.loadOrGenerateAISamples(context.Background(), a)
	if err == nil || bank == nil || len(bank.Samples) != 2 {
		t.Fatalf("partial bank lost: %+v %v", bank, err)
	}
	persisted, readErr := s.ReadAISampleBank(context.Background(), a)
	if readErr != nil || len(persisted.Samples) != 2 {
		t.Fatal("completed programs were not saved before third request failed")
	}
	previousRequests := requests
	failThird = false
	bank, n, err := s.loadOrGenerateAISamples(context.Background(), a)
	if err != nil || len(bank.Samples) != 3 || n != 1 || requests != previousRequests+1 {
		t.Fatal("resume regenerated completed programs")
	}
	if client.maxTokens != 256 {
		t.Fatal("sample budget mutated the shared grading client")
	}
}

func TestAISampleFailureReportsTruncationAndNeverAcceptsIncompleteProgram(t *testing.T) {
	client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 256)
	client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		body := `{"choices":[{"finish_reason":"length","message":{"content":"{\"code\":\"print(1)\"}"}}]}`
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})
	s := &Service{deepseek: client, aiSampleStore: &aiSampleMemoryStore{}}
	bank, _, err := s.loadOrGenerateAISamples(context.Background(), domain.Assignment{ID: "2"})
	if !errors.Is(err, ErrAIOutputTruncated) || len(bank.Samples) != 0 || !strings.Contains(AISampleFailureMessage(err), "第1份样本生成失败：模型输出达到长度上限") {
		t.Fatalf("truncation was hidden: %+v %v", bank, err)
	}
}

func TestAISampleMatchingFindsActualCodeAndExcludesPublicFramework(t *testing.T) {
	code := "values = [1, 2, 3, 4]\ntotal = 0\nfor item in values:\n    total += item * item\nprint(total)"
	bank := &domain.AISampleBank{Fingerprint: "fingerprint", GeneratedAt: time.Now(), Samples: []domain.AISample{{ID: "ai-sample-1", Approach: "直接实现", Code: code}}}
	a := domain.Assignment{Language: "Python"}
	comparison := compareAISamples(context.Background(), a, code, bank)
	if comparison.Status != "compared" || len(comparison.Samples) != 1 || comparison.Samples[0].Pair.MatchedTokens < 20 || comparison.Samples[0].Pair.Similarity != 100 {
		t.Fatalf("real match missing: %+v", comparison)
	}
	a.StarterCode = code
	comparison = compareAISamples(context.Background(), a, code, bank)
	if comparison.Samples[0].Pair.MatchedTokens != 0 || comparison.Samples[0].Code != "" {
		t.Fatal("public framework became AI evidence")
	}
}

func TestAIComparisonEvidenceRejectsMissingOrInventedReferenceAndOmittedHistory(t *testing.T) {
	code := "values = [1, 2, 3, 4]\ntotal = 0\nfor item in values:\n    total += item * item\nprint(total)"
	bank := &domain.AISampleBank{Samples: []domain.AISample{{ID: "ai-sample-1", Code: code}}}
	v := buildAIVerification(context.Background(), domain.Assignment{Language: "Python"}, code, domain.AIDetectionContext{SampleBank: bank, History: []domain.Submission{{ID: "6", Code: "total = 0"}, {ID: "5", Code: strings.Repeat("x", 20001)}}})
	for _, key := range []string{"sample_match", "history"} {
		e := domain.AIEvidence{StartLine: 2, EndLine: 2, Quote: "total = 0", Explanation: "对照事实", SourceID: "6", SourceStartLine: 1, SourceEndLine: 1, SourceQuote: "total = 0"}
		if key == "sample_match" {
			e.SourceID = "ai-sample-1"
			e.SourceStartLine = 2
			e.SourceEndLine = 2
		}
		if err := validateAIComparisonEvidence(key, &e, v); err != nil {
			t.Fatalf("valid %s comparison rejected: %v", key, err)
		}
		original := e
		e.SourceQuote = "invented()"
		if err := validateAIComparisonEvidence(key, &e, v); err == nil {
			t.Fatal("invented reference accepted")
		}
		e = original
		e.SourceID = "future-or-other-student"
		if err := validateAIComparisonEvidence(key, &e, v); err == nil {
			t.Fatal("unprovided source accepted")
		}
		e = original
		e.SourceID = "5"
		if err := validateAIComparisonEvidence(key, &e, v); err == nil {
			t.Fatal("omitted history used as source")
		}
	}
}

func TestAIFiveDimensionsValidateAndContributeWithRealComparisonMaterial(t *testing.T) {
	code := "value = 1\nprint(value)\n# generated explanation\nvalues = [1, 2, 3, 4]\ntotal = 0\nfor item in values:\n    total += item * item\nprint(total)\nprint(total + 1)"
	d := aiDimensionFixture(t)
	for i := range d {
		score := 3
		d[i].Status, d[i].Score, d[i].Strength, d[i].Reason, d[i].Alternative = "assessed", &score, "strong", "合成测试事实", "人工解释亦可能成立"
	}
	d[2].Evidence = []domain.AIEvidence{{StartLine: 3, EndLine: 3, Quote: "# generated explanation", Explanation: "合成注释依据"}}
	d[3].Evidence = []domain.AIEvidence{{StartLine: 4, EndLine: 8, Quote: strings.Join(strings.Split(code, "\n")[3:8], "\n"), Explanation: "本地匹配对照", SourceID: "ai-sample-1", SourceStartLine: 4, SourceEndLine: 8, SourceQuote: strings.Join(strings.Split(code, "\n")[3:8], "\n")}}
	d[4].Evidence = []domain.AIEvidence{{StartLine: 9, EndLine: 9, Quote: "print(total + 1)", Explanation: "历史具体对照", SourceID: "6", SourceStartLine: 1, SourceEndLine: 1, SourceQuote: "print(total)"}}
	material := domain.AIDetectionContext{SampleBank: &domain.AISampleBank{Samples: []domain.AISample{{ID: "ai-sample-1", Code: code}}}, History: []domain.Submission{{ID: "6", Code: "print(total)"}}}
	v := buildAIVerification(context.Background(), domain.Assignment{Language: "Python"}, code, material)
	if err := validateAIDimensions(d, strings.Split(code, "\n"), v); err != nil {
		t.Fatal(err)
	}
	result := aggregateAIDimensions(d, "")
	if result.Coverage != 1 || result.AIRate == nil || *result.AIRate != 3 || len(result.Dimensions) != 5 {
		t.Fatalf("all five dimensions did not contribute: %+v", result)
	}
	for _, key := range []int{3, 4} {
		broken := append([]domain.AIDimension{}, d...)
		broken[key].Evidence = append([]domain.AIEvidence{}, d[key].Evidence...)
		broken[key].Evidence[0].SourceID = "invented-source"
		if err := validateAIDimensions(broken, strings.Split(code, "\n"), v); err == nil {
			t.Fatal("invented fifth-dimension evidence passed validation")
		}
	}
}
