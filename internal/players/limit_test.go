package players_test

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	. "github.com/starquake/voidmarch/internal/players"
)

func requestFrom(t *testing.T, addr string) *http.Request {
	t.Helper()

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/players", nil)
	r.RemoteAddr = addr

	return r
}

func TestLimiter(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)
	limiter := NewLimiter(2, WithLimiterClock(func() time.Time { return now }))

	for i, want := range []bool{true, true, false} {
		if got := limiter.Allow(requestFrom(t, "10.0.0.1:5000")); got != want {
			t.Errorf("registration %d from one address: Allow() = %t, want %t", i+1, got, want)
		}
	}
	if !limiter.Allow(requestFrom(t, "10.0.0.2:5000")) {
		t.Error("another address was limited")
	}
	if limiter.Allow(requestFrom(t, "10.0.0.1:6000")) {
		t.Error("a new port on the limited address got through")
	}

	now = now.Add(time.Minute)
	if !limiter.Allow(requestFrom(t, "10.0.0.1:5000")) {
		t.Error("still limited a minute later")
	}
}

func TestLimiter_Zero(t *testing.T) {
	t.Parallel()

	limiter := NewLimiter(0)
	for range 100 {
		if !limiter.Allow(requestFrom(t, "10.0.0.1:5000")) {
			t.Fatal("NewLimiter(0) limited a registration")
		}
	}
}

func TestLimiter_ForgetsOldAddresses(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)
	limiter := NewLimiter(1, WithLimiterClock(func() time.Time { return now }))
	limiter.Allow(requestFrom(t, "10.0.0.1:5000"))
	now = now.Add(time.Minute)
	// Enough other addresses to make the limiter sweep.
	for i := range 1100 {
		limiter.Allow(requestFrom(t, "10.1."+strconv.Itoa(i/256)+"."+strconv.Itoa(i%256)+":5000"))
	}

	// The first address's window passed, so a sweep forgot it.
	if got, want := limiter.Tracked(), 1100; got != want {
		t.Errorf("tracked addresses = %d, want %d", got, want)
	}
}

func TestLimiter_BehindATrustedProxy(t *testing.T) {
	t.Parallel()

	_, proxy, err := net.ParseCIDR("10.0.0.2/32")
	if err != nil {
		t.Fatalf("ParseCIDR() error = %v", err)
	}
	limiter := NewLimiter(1, WithTrustedProxies([]*net.IPNet{proxy}))
	via := func(client string) *http.Request {
		r := requestFrom(t, "10.0.0.2:5000")
		r.Header.Set("X-Forwarded-For", client)

		return r
	}

	if !limiter.Allow(via("198.51.100.1")) || !limiter.Allow(via("198.51.100.2")) {
		t.Error("two clients behind one proxy shared a limit")
	}
	if limiter.Allow(via("198.51.100.1")) {
		t.Error("a client behind the proxy got past its limit")
	}
}
