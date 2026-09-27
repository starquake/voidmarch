package players_test

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	. "github.com/starquake/voidmarch/internal/players"
)

func register(t *testing.T, store *Store, contentType, body string) *httptest.ResponseRecorder {
	t.Helper()

	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodPost,
		"/api/players",
		strings.NewReader(body),
	)
	req.Header.Set("Content-Type", contentType)
	HandleRegister(slog.New(slog.DiscardHandler), store).ServeHTTP(w, req)

	return w
}

func TestHandleRegister(t *testing.T) {
	t.Parallel()

	store := NewStore()
	w := register(t, store, "application/json", `{"name":"Sanne"}`)

	if got, want := w.Code, http.StatusCreated; got != want {
		t.Fatalf("status = %d, want %d", got, want)
	}
	var res struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Token string `json:"token"`
	}
	if err := json.NewDecoder(w.Body).Decode(&res); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got, want := res.Name, "Sanne"; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}

	player, ok := store.ByToken(res.Token)
	if !ok {
		t.Fatal("the returned token is not in the store")
	}
	if got, want := player.ID, res.ID; got != want {
		t.Errorf("stored id = %q, want %q", got, want)
	}
}

func TestHandleRegister_Errors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		contentType string
		body        string
		wantStatus  int
		wantError   string
	}{
		{
			name:        "bad name",
			contentType: "application/json",
			body:        `{"name":"Mo!"}`,
			wantStatus:  http.StatusBadRequest,
			wantError:   "a name is",
		},
		{
			name:        "empty",
			contentType: "application/json",
			body:        `{"name":""}`,
			wantStatus:  http.StatusBadRequest,
			wantError:   "a name is",
		},
		{
			name:        "broken json",
			contentType: "application/json",
			body:        `{`,
			wantStatus:  http.StatusBadRequest,
			wantError:   "json",
		},
		{
			name:        "form post",
			contentType: "text/plain",
			body:        `name=Mo`,
			wantStatus:  http.StatusUnsupportedMediaType,
			wantError:   "application/json",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			w := register(t, NewStore(), tc.contentType, tc.body)

			if got, want := w.Code, tc.wantStatus; got != want {
				t.Errorf("status = %d, want %d", got, want)
			}
			if got, want := w.Body.String(), tc.wantError; !strings.Contains(got, want) {
				t.Errorf("body = %q, should contain %q", got, want)
			}
		})
	}
}
