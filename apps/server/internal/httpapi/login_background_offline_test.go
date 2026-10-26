package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDefaultLoginBackgroundStaysLocalWhenOffline(t *testing.T) {
	offline := httptest.NewRecorder()
	(&server{offline: true}).defaultLoginBackground(offline, httptest.NewRequest(http.MethodGet, "/api/v1/auth/background", nil))
	if offline.Code != http.StatusOK || offline.Header().Get("Content-Type") != "image/svg+xml" || !strings.Contains(offline.Body.String(), "<svg") {
		t.Fatalf("offline background = %d %q", offline.Code, offline.Header().Get("Content-Type"))
	}

	online := httptest.NewRecorder()
	(&server{}).defaultLoginBackground(online, httptest.NewRequest(http.MethodGet, "/api/v1/auth/background", nil))
	if online.Code != http.StatusTemporaryRedirect || online.Header().Get("Location") != defaultLoginBackgroundURL {
		t.Fatalf("online background = %d %q", online.Code, online.Header().Get("Location"))
	}
}
