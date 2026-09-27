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

func TestDecodeJSON(t *testing.T) {
	t.Parallel()

	type payload struct {
		Name string `json:"name"`
	}

	tests := []struct {
		name        string
		contentType string
		body        string
		want        string
		wantErr     error
		wantErrText string
	}{
		{name: "valid", contentType: "application/json", body: `{"name":"Mo"}`, want: "Mo"},
		{
			name:        "charset",
			contentType: "application/json; charset=utf-8",
			body:        `{"name":"Mo"}`,
			want:        "Mo",
		},
		{
			name:        "form",
			contentType: "application/x-www-form-urlencoded",
			body:        `name=Mo`,
			wantErr:     ErrNotJSON,
		},
		{name: "no type", contentType: "", body: `{"name":"Mo"}`, wantErr: ErrNotJSON},
		{
			name:        "unknown field",
			contentType: "application/json",
			body:        `{"nom":"Mo"}`,
			wantErrText: "unknown field",
		},
		{
			name:        "trailing",
			contentType: "application/json",
			body:        `{"name":"Mo"}{}`,
			wantErr:     ErrTrailingJSONData,
		},
		{
			name:        "broken",
			contentType: "application/json",
			body:        `{"name":`,
			wantErrText: "error decoding json",
		},
		{
			name:        "too large",
			contentType: "application/json",
			body:        `{"name":"` + strings.Repeat("x", 70*1024) + `"}`,
			wantErrText: "too large",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequestWithContext(
				t.Context(),
				http.MethodPost,
				"/",
				strings.NewReader(tc.body),
			)
			req.Header.Set("Content-Type", tc.contentType)
			got, err := DecodeJSON[payload](httptest.NewRecorder(), req)

			switch {
			case tc.wantErr != nil:
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("DecodeJSON() error = %v, want %v", err, tc.wantErr)
				}
			case tc.wantErrText != "":
				if err == nil || !strings.Contains(err.Error(), tc.wantErrText) {
					t.Errorf("DecodeJSON() error = %v, should contain %q", err, tc.wantErrText)
				}
			default:
				if err != nil {
					t.Fatalf("DecodeJSON() error = %v", err)
				}
				if got.Name != tc.want {
					t.Errorf("DecodeJSON().Name = %q, want %q", got.Name, tc.want)
				}
			}
		})
	}
}
