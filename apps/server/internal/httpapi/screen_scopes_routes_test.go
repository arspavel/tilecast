package httpapi

import (
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
)

// TestScreenScopeRoutesRegistered guards against the routes being dropped
// again: the handlers existed but were never mounted, so the dashboard's
// screen-scope calls returned 404. This checks the route tree directly.
func TestScreenScopeRoutesRegistered(t *testing.T) {
	router, ok := (&server{}).routes().(chi.Routes)
	if !ok {
		t.Fatal("router does not expose chi.Routes")
	}
	const route = "/api/v1/users/{id}/screen-scopes"
	seen := map[string]bool{http.MethodGet: false, http.MethodPut: false}
	if err := chi.Walk(router, func(method, walked string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if walked == route {
			if _, tracked := seen[method]; tracked {
				seen[method] = true
			}
		}
		return nil
	}); err != nil {
		t.Fatalf("walk routes: %v", err)
	}
	for method, ok := range seen {
		if !ok {
			t.Errorf("%s %s is not registered", method, route)
		}
	}
}
