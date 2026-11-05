package evaluator

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"codeeval/server/internal/domain"
)

func localFixture() domain.LocalDetection {
	score := 0.8
	return domain.LocalDetection{
		Version: "droiddetect-binary-chunks-v1", Language: "python", AIScore: &score,
		TotalTokens: 10, CoveredTokens: 10, MaxSequenceTokens: 512, OverlapTokens: 64,
		EncoderRevision: "encoder-revision", CheckpointRevision: "checkpoint-revision", PreprocessingVersion: "raw-source-v1",
		Chunks: []domain.LocalDetectionChunk{{Index: 1, StartLine: 1, EndLine: 1, TokenCount: 10, WeightTokens: 10, AIScore: score}},
	}
}

func TestLocalDetectorBypassesExternalKeyAndSamples(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/detect" || r.Header.Get("Authorization") != "Bearer internal-test-token" {
			t.Errorf("unexpected detector request")
		}
		var payload map[string]string
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		if payload["language"] != "python" || payload["code"] != "print(1)" {
			t.Errorf("unexpected payload: %+v", payload)
		}
		json.NewEncoder(w).Encode(localFixture())
	}))
	defer upstream.Close()
	// No DeepSeek client, key, sample store or sandbox: a local request must be independent.
	s := &Service{maxCodeBytes: 100000}
	s.detection = newDetectionRouter("auto", NewLocalDetectorClient(upstream.URL, "internal-test-token", time.Second), s)
	result, err := s.DetectAICode(context.Background(), domain.Assignment{Language: "Python"}, "print(1)")
	if err != nil {
		t.Fatal(err)
	}
	if result.AIRate == nil || *result.AIRate != 80 || result.LocalDetection == nil || len(result.Dimensions) != 0 || len(result.Evidence) != 0 {
		t.Fatalf("unexpected local report: %+v", result)
	}
}

func TestLocalCoverageRejectsTruncationAndInconsistentWeights(t *testing.T) {
	valid := localFixture()
	if err := validateLocalDetection(valid, "python", "print(1)"); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*domain.LocalDetection){
		func(r *domain.LocalDetection) { r.Truncated = true },
		func(r *domain.LocalDetection) { r.CoveredTokens-- },
		func(r *domain.LocalDetection) { r.Language = "java" },
		func(r *domain.LocalDetection) { r.Chunks[0].WeightTokens-- },
		func(r *domain.LocalDetection) { r.Chunks[0].EndLine = 100 },
		func(r *domain.LocalDetection) { value := 0.2; r.AIScore = &value },
	} {
		r := localFixture()
		mutate(&r)
		if validateLocalDetection(r, "python", "print(1)") == nil {
			t.Fatalf("accepted inconsistent response: %+v", r)
		}
	}
}

func TestLocalWeightedChunksDoNotDoubleCountOverlap(t *testing.T) {
	r := localFixture()
	r.TotalTokens, r.CoveredTokens = 700, 700
	r.Chunks = []domain.LocalDetectionChunk{
		{Index: 1, StartLine: 1, EndLine: 1, TokenCount: 510, WeightTokens: 510, AIScore: 0.8},
		{Index: 2, StartLine: 1, EndLine: 1, TokenCount: 254, WeightTokens: 190, AIScore: 0.2},
	}
	score := (510*0.8 + 190*0.2) / 700
	r.AIScore = &score
	if err := validateLocalDetection(r, "python", "print(1)"); err != nil {
		t.Fatal(err)
	}
}

func TestAutoUsesLocalAnalysisForProjectLanguages(t *testing.T) {
	s := &Service{}
	s.detection = newDetectionRouter("auto", NewLocalDetectorClient("http://detector", "token", time.Second), s)
	for _, language := range []string{"Python", "Java", "C++", "cpp", "Go"} {
		options := s.DetectionOptions(domain.Assignment{Language: language})
		if options.Provider != "droiddetect" || options.RequiresSamples || options.RequiresContext || !options.Available {
			t.Fatalf("unexpected routing for %s: %+v", language, options)
		}
	}
}

func TestDSProviderSwitchRoutesPythonToContextualAnalysis(t *testing.T) {
	s := &Service{}
	s.detection = newDetectionRouter("ds", NewLocalDetectorClient("http://unused-local-detector", "token", time.Second), s)
	options := s.DetectionOptions(domain.Assignment{Language: "Python"})
	if options.Provider != "deepseek" || !options.RequiresContext || !options.RequiresSamples {
		t.Fatalf("DS switch did not select contextual provider: %+v", options)
	}
}

func TestRequestedCUDARejectsCPUReport(t *testing.T) {
	fixture := localFixture()
	fixture.Device = "cpu"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(fixture)
	}))
	defer upstream.Close()
	client := NewLocalDetectorClient(upstream.URL, "test-token", time.Second)
	client.requiredDevice = "cuda"
	if _, err := client.Detect(context.Background(), "Python", "print(1)"); err == nil {
		t.Fatal("expected CPU execution to be rejected when CUDA was requested")
	}
}

func TestDroidDetectCPPRequestUsesCanonicalLanguage(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]string
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		if payload["language"] != "cpp" {
			t.Errorf("unexpected language %q", payload["language"])
		}
		fixture := localFixture()
		fixture.Language = "cpp"
		json.NewEncoder(w).Encode(fixture)
	}))
	defer upstream.Close()
	client := NewLocalDetectorClient(upstream.URL, "test", time.Second)
	result, err := client.Detect(context.Background(), "C++", "int main() {}")
	if err != nil {
		t.Fatal(err)
	}
	if result.ScoringVersion != "droiddetect-binary-chunks-v1" || result.Model != "DroidDetect-Base-Binary/checkpoint-revision" {
		t.Fatalf("unexpected model metadata: %+v", result)
	}
}

func TestLocalOnlyProviderRejectsUnsupportedLanguage(t *testing.T) {
	s := &Service{}
	s.detection = newDetectionRouter("droiddetect", NewLocalDetectorClient("http://detector", "token", time.Second), s)
	options := s.DetectionOptions(domain.Assignment{Language: "Rust"})
	if options.Provider != "droiddetect" || options.Available {
		t.Fatalf("unexpected routing: %+v", options)
	}
}
