package httpapi

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"
)

func mustPrefixes(cidrs ...string) []netip.Prefix {
	out := make([]netip.Prefix, 0, len(cidrs))
	for _, c := range cidrs {
		out = append(out, netip.MustParsePrefix(c))
	}
	return out
}

func TestClientIPBehindTrustedProxy(t *testing.T) {
	s := &server{trustedProxies: mustPrefixes("127.0.0.0/8", "172.16.0.0/12")}

	// A direct connection from an untrusted address is used as-is and its
	// forged X-Forwarded-For is ignored.
	direct := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	direct.RemoteAddr = "203.0.113.5:443"
	direct.Header.Set("X-Forwarded-For", "198.51.100.9")
	if got := s.clientIP(direct); got != "203.0.113.5" {
		t.Fatalf("direct client: got %q, want 203.0.113.5", got)
	}

	// Behind a trusted proxy the real client is taken from X-Forwarded-For,
	// skipping trailing trusted-proxy hops.
	proxied := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	proxied.RemoteAddr = "172.17.0.1:52344"
	proxied.Header.Set("X-Forwarded-For", "203.0.113.7, 172.17.0.1")
	if got := s.clientIP(proxied); got != "203.0.113.7" {
		t.Fatalf("proxied client: got %q, want 203.0.113.7", got)
	}
}

func TestAuthRateLimitCountsOnlyFailures(t *testing.T) {
	s := &server{authLimiter: newRateLimiter(1, time.Minute)}

	success := s.authRateLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	for i := 0; i < 3; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
		req.RemoteAddr = "203.0.113.5:1000"
		success.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("successful attempt %d was limited: %d", i, rec.Code)
		}
	}

	failure := s.authRateLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	first := httptest.NewRecorder()
	firstReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	firstReq.RemoteAddr = "203.0.113.5:1000"
	failure.ServeHTTP(first, firstReq)
	if first.Code != http.StatusUnauthorized {
		t.Fatalf("first failure should pass through: %d", first.Code)
	}

	second := httptest.NewRecorder()
	secondReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	secondReq.RemoteAddr = "203.0.113.5:1000"
	failure.ServeHTTP(second, secondReq)
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second failure should be rate limited: %d", second.Code)
	}
}
