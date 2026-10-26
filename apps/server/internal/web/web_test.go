package web

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandlerDoesNotServeTheAppForMissingBuildFiles(t *testing.T) {
	handler := Handler()
	for path, want := range map[string]int{
		"/assets/index-missing.js.map": http.StatusNotFound,
		"/assets/missing.js":           http.StatusNotFound,
		"/app.js.map":                  http.StatusNotFound,
		"/screens/123":                 http.StatusOK,
		"/":                            http.StatusOK,
	} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != want {
			t.Errorf("%s: status %d, want %d", path, recorder.Code, want)
		}
	}
}
