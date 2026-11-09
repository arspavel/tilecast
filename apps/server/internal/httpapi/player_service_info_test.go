package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/tilecast/tilecast/apps/server/internal/devices"
)

func TestPlayerServiceInfoIsStoredPerScreenAndCapped(t *testing.T) {
	s := &server{}
	screenID := uuid.New()
	lines := make([]string, 0, serviceInfoMaxLines+5)
	lines = append(lines, "Накопитель панели: 1,2 ГБ", strings.Repeat("я", serviceInfoMaxLineRune+20))
	for len(lines) < serviceInfoMaxLines+5 {
		lines = append(lines, "Строка")
	}
	body, _ := json.Marshal(map[string]any{"lines": lines})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/player/service-info", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(context.WithValue(req.Context(), deviceContextKey, devices.DevicePrincipal{ScreenID: screenID}))
	rec := httptest.NewRecorder()
	s.playerServiceInfo(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("report status = %d: %s", rec.Code, rec.Body)
	}

	get := httptest.NewRequest(http.MethodGet, "/api/v1/screens/"+screenID.String()+"/service-info", nil)
	route := chi.NewRouteContext()
	route.URLParams.Add("id", screenID.String())
	get = get.WithContext(context.WithValue(get.Context(), chi.RouteCtxKey, route))
	rec = httptest.NewRecorder()
	s.screenServiceInfo(rec, get)
	var out struct {
		Data serviceInfoReport `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Data.Lines) != serviceInfoMaxLines {
		t.Fatalf("lines = %d, want %d", len(out.Data.Lines), serviceInfoMaxLines)
	}
	if out.Data.Lines[0] != "Накопитель панели: 1,2 ГБ" {
		t.Fatalf("first line = %q", out.Data.Lines[0])
	}
	if got := len([]rune(out.Data.Lines[1])); got != serviceInfoMaxLineRune {
		t.Fatalf("long line kept %d runes", got)
	}
	if out.Data.ReportedAt.IsZero() {
		t.Fatal("reportedAt missing")
	}

	other := uuid.New()
	route = chi.NewRouteContext()
	route.URLParams.Add("id", other.String())
	rec = httptest.NewRecorder()
	s.screenServiceInfo(rec, httptest.NewRequest(http.MethodGet, "/", nil).WithContext(context.WithValue(context.Background(), chi.RouteCtxKey, route)))
	if !strings.Contains(rec.Body.String(), `"lines":[]`) {
		t.Fatalf("unknown screen body = %s", rec.Body)
	}
}
