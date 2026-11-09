package httpapi

import (
	"net/http"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/tilecast/tilecast/apps/server/internal/devices"
)

const (
	serviceInfoMaxLines    = 40
	serviceInfoMaxLineRune = 300
)

// serviceInfoReport is what a player shows on its own service overlay (the
// remote's Up button), so Studio can show the same thing without someone
// standing at the panel. It is live state: kept in memory only and replaced
// with every report.
type serviceInfoReport struct {
	Lines      []string  `json:"lines"`
	ReportedAt time.Time `json:"reportedAt"`
}

type serviceInfoStore struct {
	mu      sync.Mutex
	reports map[uuid.UUID]serviceInfoReport
}

func (st *serviceInfoStore) put(screenID uuid.UUID, report serviceInfoReport) {
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.reports == nil {
		st.reports = map[uuid.UUID]serviceInfoReport{}
	}
	st.reports[screenID] = report
}

func (st *serviceInfoStore) get(screenID uuid.UUID) (serviceInfoReport, bool) {
	st.mu.Lock()
	defer st.mu.Unlock()
	report, ok := st.reports[screenID]
	return report, ok
}

func (s *server) playerServiceInfo(w http.ResponseWriter, r *http.Request) {
	principal := r.Context().Value(deviceContextKey).(devices.DevicePrincipal)
	var body struct {
		Lines []string `json:"lines"`
	}
	if err := decodeJSONLimit(w, r, &body, 64<<10); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if len(body.Lines) > serviceInfoMaxLines {
		body.Lines = body.Lines[:serviceInfoMaxLines]
	}
	lines := make([]string, 0, len(body.Lines))
	for _, line := range body.Lines {
		if !utf8.ValidString(line) {
			continue
		}
		if utf8.RuneCountInString(line) > serviceInfoMaxLineRune {
			line = string([]rune(line)[:serviceInfoMaxLineRune])
		}
		lines = append(lines, line)
	}
	s.serviceInfo.put(principal.ScreenID, serviceInfoReport{Lines: lines, ReportedAt: time.Now().UTC()})
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) screenServiceInfo(w http.ResponseWriter, r *http.Request) {
	screenID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "The screen was not found.")
		return
	}
	report, ok := s.serviceInfo.get(screenID)
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"lines": []string{}, "reportedAt": nil}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": report})
}
