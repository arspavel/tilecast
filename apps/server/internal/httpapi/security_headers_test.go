package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSecurityHeaders(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	headersFor := func(s *server, path string) http.Header {
		recorder := httptest.NewRecorder()
		s.securityHeaders(ok).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		return recorder.Header()
	}

	studio := headersFor(&server{}, "/screens")
	csp := studio.Get("Content-Security-Policy")
	if strings.Contains(csp, "unsafe-inline") || strings.Contains(csp, "unsafe-eval") || !strings.Contains(csp, "frame-ancestors 'none'") {
		t.Fatalf("Studio CSP = %q", csp)
	}
	for _, name := range []string{"Permissions-Policy", "Feature-Policy", "Referrer-Policy", "X-Content-Type-Options", "X-Frame-Options", "X-XSS-Protection"} {
		if studio.Get(name) == "" {
			t.Errorf("missing %s", name)
		}
	}
	if studio.Get("Strict-Transport-Security") != "" {
		t.Error("HSTS must not be sent by a plain-HTTP installation")
	}

	webos := headersFor(&server{}, "/webos/app.js").Get("Content-Security-Policy")
	if !strings.Contains(webos, "media-src 'self' blob:") || !strings.Contains(webos, "frame-src http: https:") || strings.Contains(webos, "unsafe-") {
		t.Fatalf("webOS CSP = %q", webos)
	}

	if headersFor(&server{secureCookies: true}, "/").Get("Strict-Transport-Security") != "max-age=31536000; includeSubDomains; preload" {
		t.Error("HTTPS installation is missing HSTS")
	}
}
