package players

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// limitWindow is the span a Limiter counts registrations over.
const limitWindow = time.Minute

// sweepSize is how many addresses a Limiter tracks before it forgets the ones
// whose window has passed.
const sweepSize = 1024

// Limiter caps registrations per address in each minute (#19), so nobody can
// fill the database by registering in a loop. It is safe for concurrent use.
type Limiter struct {
	perMinute int
	now       func() time.Time

	mu      sync.Mutex
	windows map[string]window
}

// window is one address's registrations since start.
type window struct {
	start time.Time
	count int
}

// NewLimiter returns a limiter allowing perMinute registrations a minute from
// each address; 0 means no limit.
func NewLimiter(perMinute int, opts ...LimiterOption) *Limiter {
	l := &Limiter{perMinute: perMinute, now: time.Now, windows: make(map[string]window)}
	for _, opt := range opts {
		opt(l)
	}

	return l
}

// LimiterOption configures a Limiter.
type LimiterOption func(*Limiter)

// WithLimiterClock sets the limiter's clock, for tests.
func WithLimiterClock(now func() time.Time) LimiterOption {
	return func(l *Limiter) { l.now = now }
}

// Allow counts a registration from r's address and reports whether it is
// within the limit.
func (l *Limiter) Allow(r *http.Request) bool {
	if l.perMinute <= 0 {
		return true
	}
	addr := r.RemoteAddr
	if host, _, err := net.SplitHostPort(addr); err == nil {
		addr = host
	}
	now := l.now()

	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.windows) >= sweepSize {
		for a, w := range l.windows {
			if now.Sub(w.start) >= limitWindow {
				delete(l.windows, a)
			}
		}
	}
	w := l.windows[addr]
	if now.Sub(w.start) >= limitWindow {
		w = window{start: now}
	}
	if w.count >= l.perMinute {
		return false
	}
	w.count++
	l.windows[addr] = w

	return true
}
