package request_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	. "github.com/starquake/voidmarch/internal/request"
)

func TestParseTrustedProxyCIDRs(t *testing.T) {
	t.Parallel()

	cidrs, err := ParseTrustedProxyCIDRs(" 10.0.0.0/8, ,127.0.0.1/32,")
	if err != nil {
		t.Fatalf("ParseTrustedProxyCIDRs() error = %v", err)
	}
	if got, want := len(cidrs), 2; got != want {
		t.Errorf("len(cidrs) = %d, want %d", got, want)
	}
	if cidrs, err = ParseTrustedProxyCIDRs(""); err != nil || cidrs != nil {
		t.Errorf("ParseTrustedProxyCIDRs(\"\") = %v, %v, want nil, nil", cidrs, err)
	}
	if _, err = ParseTrustedProxyCIDRs("10.0.0.1"); err == nil {
		t.Error("ParseTrustedProxyCIDRs(an address without a mask) error = nil, want an error")
	}
}

func TestClientIP(t *testing.T) {
	t.Parallel()

	trusted, err := ParseTrustedProxyCIDRs("10.0.0.0/8")
	if err != nil {
		t.Fatalf("ParseTrustedProxyCIDRs() error = %v", err)
	}

	tests := []struct {
		name    string
		remote  string
		xff     []string
		trusted bool
		want    string
	}{
		{
			name:   "no proxy trusted",
			remote: "203.0.113.5:4000",
			xff:    []string{"198.51.100.1"},
			want:   "203.0.113.5",
		},
		{
			name:    "an untrusted peer's header is ignored",
			remote:  "203.0.113.5:4000",
			xff:     []string{"198.51.100.1"},
			trusted: true,
			want:    "203.0.113.5",
		},
		{
			name:    "the client behind a trusted proxy",
			remote:  "10.0.0.2:4000",
			xff:     []string{"198.51.100.1"},
			trusted: true,
			want:    "198.51.100.1",
		},
		{
			name:    "the rightmost untrusted hop, not a spoofed leftmost",
			remote:  "10.0.0.2:4000",
			xff:     []string{"192.0.2.9, 198.51.100.1, 10.0.0.3"},
			trusted: true,
			want:    "198.51.100.1",
		},
		{
			name:    "hops on separate header lines",
			remote:  "10.0.0.2:4000",
			xff:     []string{"198.51.100.1", "10.0.0.3"},
			trusted: true,
			want:    "198.51.100.1",
		},
		{
			name:    "only trusted hops",
			remote:  "10.0.0.2:4000",
			xff:     []string{"10.0.0.7"},
			trusted: true,
			want:    "10.0.0.2",
		},
		{
			name:    "a trusted proxy without the header",
			remote:  "10.0.0.2:4000",
			trusted: true,
			want:    "10.0.0.2",
		},
		{name: "an address without a port", remote: "203.0.113.5", want: "203.0.113.5"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/players", nil)
			r.RemoteAddr = tc.remote
			for _, v := range tc.xff {
				r.Header.Add("X-Forwarded-For", v)
			}
			cidrs := trusted
			if !tc.trusted {
				cidrs = nil
			}
			if got := ClientIP(r, cidrs); got != tc.want {
				t.Errorf("ClientIP() = %q, want %q", got, tc.want)
			}
		})
	}
}
