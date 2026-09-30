// Package request reads what the standard library doesn't about a request:
// the address of the client behind a trusted reverse proxy.
package request

import (
	"fmt"
	"net"
	"net/http"
	"slices"
	"strings"
)

// ParseTrustedProxyCIDRs parses a comma-separated CIDR list, such as
// "10.0.0.0/8,127.0.0.1/32". Empty entries are skipped, and an empty list
// is nil: trust nothing.
func ParseTrustedProxyCIDRs(raw string) ([]*net.IPNet, error) {
	var out []*net.IPNet
	for part := range strings.SplitSeq(raw, ",") {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		_, cidr, err := net.ParseCIDR(trimmed)
		if err != nil {
			return nil, fmt.Errorf("error parsing CIDR %q: %w", trimmed, err)
		}
		out = append(out, cidr)
	}

	return out, nil
}

// ClientIP is the address to attribute r to. Only a request that comes
// straight from a trusted proxy has its X-Forwarded-For read: right to left,
// the first address outside the trusted list is the client. Anyone else could
// write that header, so otherwise it is the connection's own address.
func ClientIP(r *http.Request, trusted []*net.IPNet) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if !inCIDRs(host, trusted) {
		return host
	}
	// A proxy may add its hop as a header line of its own, so every line counts.
	for _, hop := range slices.Backward(splitXFF(strings.Join(r.Header.Values("X-Forwarded-For"), ","))) {
		if !inCIDRs(hop, trusted) {
			return hop
		}
	}

	// Only trusted hops: the leftmost could be spoofed, so the proxy it is.
	return host
}

// inCIDRs reports whether ip is an address inside one of cidrs; anything
// that isn't an address is not.
func inCIDRs(ip string, cidrs []*net.IPNet) bool {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}

	return slices.ContainsFunc(cidrs, func(c *net.IPNet) bool { return c.Contains(parsed) })
}

// splitXFF is an X-Forwarded-For value's entries, trimmed, without empty ones.
func splitXFF(raw string) []string {
	var out []string
	for part := range strings.SplitSeq(raw, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}

	return out
}
