package testcases

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestCreateEvaluationRunSendsClientRequestID(t *testing.T) {
	t.Parallel()

	const clientRequestID = "7295515a-4c6c-40a3-8436-75edc691369c"
	var requestPayload map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&requestPayload); err != nil {
			http.Error(writer, err.Error(), http.StatusBadRequest)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(writer).Encode(dashboardEvaluationRun{
			ID:              clientRequestID,
			ClientRequestID: clientRequestID,
			Status:          "pending",
		})
	}))
	defer server.Close()

	run, err := createEvaluationRun(
		context.Background(), server.Client(), server.URL, "token", clientRequestID, "baseline", 41, "",
	)
	if err != nil {
		t.Fatalf("create evaluation run: %v", err)
	}
	if got := requestPayload["client_request_id"]; got != clientRequestID {
		t.Fatalf("client_request_id = %v, want %s", got, clientRequestID)
	}
	if run.ID != clientRequestID || run.ClientRequestID != clientRequestID {
		t.Fatalf("created run identity = %q/%q, want %q", run.ID, run.ClientRequestID, clientRequestID)
	}
}

func TestNewEvaluationClientRequestIDIsCanonicalAndCollisionSafe(t *testing.T) {
	t.Parallel()

	const generatedIDs = 128
	seen := make(map[string]struct{}, generatedIDs)
	for index := 0; index < generatedIDs; index++ {
		requestID := newEvaluationClientRequestID()
		parsed, err := uuid.Parse(requestID)
		if err != nil || parsed.String() != requestID || parsed.Version() != uuid.Version(4) {
			t.Fatalf("generated client_request_id %q is not a canonical UUIDv4", requestID)
		}
		if _, duplicate := seen[requestID]; duplicate {
			t.Fatalf("generated duplicate client_request_id %q", requestID)
		}
		seen[requestID] = struct{}{}
	}
}
