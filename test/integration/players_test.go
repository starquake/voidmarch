package integration_test

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

// registerPlayer registers name through the API and returns the token.
func registerPlayer(t *testing.T, baseURL, name string) string {
	t.Helper()

	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, baseURL+"/api/players",
		strings.NewReader(`{"name":"`+name+`"}`))
	if err != nil {
		t.Fatalf("http.NewRequestWithContext() error = %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /api/players error = %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if got, want := resp.StatusCode, http.StatusCreated; got != want {
		t.Fatalf("status = %d, want %d", got, want)
	}
	var res struct {
		Token string `json:"token"`
	}
	if err = json.NewDecoder(resp.Body).Decode(&res); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if res.Token == "" {
		t.Fatal("empty token")
	}

	return res.Token
}

func TestPlayers_Register(t *testing.T) {
	t.Parallel()

	baseURL := startServer(t, nil)
	registerPlayer(t, baseURL, "Sanne")
}

func TestPlayers_RegisterRejectsForms(t *testing.T) {
	t.Parallel()

	baseURL := startServer(t, nil)
	req, err := http.NewRequestWithContext(
		t.Context(),
		http.MethodPost,
		baseURL+"/api/players",
		strings.NewReader("name=Mo"),
	)
	if err != nil {
		t.Fatalf("http.NewRequestWithContext() error = %v", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST error = %v", err)
	}
	_ = resp.Body.Close()

	if got, want := resp.StatusCode, http.StatusUnsupportedMediaType; got != want {
		t.Errorf("status = %d, want %d", got, want)
	}
}

func TestPlayers_AFullServerOnOneNetwork(t *testing.T) {
	t.Parallel()

	// Sixteen friends on one Wi-Fi share an address; all of them get a name.
	baseURL := startServer(t, nil)
	for i := range 16 {
		registerPlayer(t, baseURL, "Friend "+strconv.Itoa(i+1))
	}
}
