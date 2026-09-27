package handlers_test

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	. "github.com/starquake/voidmarch/internal/handlers"
)

func TestEncodeJSON(t *testing.T) {
	t.Parallel()

	w := httptest.NewRecorder()
	if err := EncodeJSON(w, http.StatusCreated, map[string]string{"status": "ok"}); err != nil {
		t.Fatalf("EncodeJSON() error = %v", err)
	}

	if got, want := w.Code, http.StatusCreated; got != want {
		t.Errorf("w.Code = %d, want %d", got, want)
	}
	if got, want := w.Header().Get("Content-Type"), "application/json"; got != want {
		t.Errorf("Content-Type = %q, want %q", got, want)
	}
	if got, want := w.Body.String(), `{"status":"ok"}`; !strings.Contains(got, want) {
		t.Errorf("body = %q, should contain %q", got, want)
	}
}

func TestEncodeJSON_Error(t *testing.T) {
	t.Parallel()

	err := EncodeJSON(httptest.NewRecorder(), http.StatusOK, math.Inf(1))

	if err == nil {
		t.Fatal("EncodeJSON() error = nil, want an error")
	}
	if got, want := err.Error(), "error encoding json"; !strings.Contains(got, want) {
		t.Errorf("err.Error() = %q, should contain %q", got, want)
	}
	if _, ok := errors.AsType[*json.UnsupportedValueError](err); !ok {
		t.Error("err is not a *json.UnsupportedValueError")
	}
}
