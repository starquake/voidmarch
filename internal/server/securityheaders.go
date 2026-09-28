package server

import (
	"net/http"

	"github.com/starquake/voidmarch/internal/config"
)

// contentSecurityPolicy allows data: and blob: images because Phaser builds
// its default textures from data URIs, and 'wasm-unsafe-eval' because the
// rules run as WebAssembly (it allows compiling WebAssembly, not eval).
const contentSecurityPolicy = `default-src 'self'; ` +
	`script-src 'self' 'wasm-unsafe-eval'; ` +
	`style-src 'self'; ` +
	`img-src 'self' data: blob:; ` +
	`connect-src 'self'; ` +
	`worker-src 'self' blob:; ` +
	`object-src 'none'; ` +
	`base-uri 'none'; ` +
	`frame-ancestors 'none'`

const strictTransportSecurity = "max-age=31536000; includeSubDomains"

// securityHeaders sets the sitewide security headers. HSTS is sent only in
// production, so a development server on plain HTTP does not pin itself.
func securityHeaders(cfg *config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("Content-Security-Policy", contentSecurityPolicy)
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("Referrer-Policy", "no-referrer")
			h.Set("X-Frame-Options", "DENY")
			if cfg.IsProduction() {
				h.Set("Strict-Transport-Security", strictTransportSecurity)
			}
			next.ServeHTTP(w, r)
		})
	}
}
