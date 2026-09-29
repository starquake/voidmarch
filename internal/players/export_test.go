package players

// Tracked is how many addresses the limiter remembers.
func (l *Limiter) Tracked() int {
	l.mu.Lock()
	defer l.mu.Unlock()

	return len(l.windows)
}
