package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/netpolicy"
)

type networkModeResponse struct {
	// Offline is the Studio switch; Forced is TILECAST_OFFLINE on the server.
	Offline   bool       `json:"offline"`
	Forced    bool       `json:"forced"`
	Effective bool       `json:"effective"`
	UpdatedAt *time.Time `json:"updatedAt,omitempty"`
}

// loadNetworkPolicy reads the Studio switch into netpolicy.
func (s *server) loadNetworkPolicy(ctx context.Context) (*time.Time, error) {
	var offline bool
	var updated time.Time
	err := s.db.QueryRow(ctx, `SELECT offline, updated_at FROM network_policy WHERE singleton`).Scan(&offline, &updated)
	if err != nil {
		return nil, err
	}
	netpolicy.SetChosen(offline)
	return &updated, nil
}

// runNetworkPolicyRefresh keeps the switch current after a restore or a
// change made directly in the database.
func (s *server) runNetworkPolicyRefresh() {
	if s.db == nil {
		return
	}
	ctx := context.Background()
	if _, err := s.loadNetworkPolicy(ctx); err != nil {
		s.logger.Warn("network policy could not be loaded", "error", err)
	}
	for range time.Tick(time.Minute) {
		_, _ = s.loadNetworkPolicy(ctx)
	}
}

func (s *server) networkModeBody(updated *time.Time) networkModeResponse {
	return networkModeResponse{
		Offline:   netpolicy.Chosen(),
		Forced:    netpolicy.Forced(),
		Effective: netpolicy.Offline(),
		UpdatedAt: updated,
	}
}

func (s *server) networkMode(w http.ResponseWriter, r *http.Request) {
	updated, err := s.loadNetworkPolicy(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": s.networkModeBody(updated)})
}

func (s *server) updateNetworkMode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Offline *bool `json:"offline"`
	}
	if err := decodeJSON(w, r, &body); err != nil || body.Offline == nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Укажите, включить ли работу без интернета.")
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	var updated time.Time
	if err := s.db.QueryRow(r.Context(),
		`UPDATE network_policy SET offline=$1, updated_by=$2, updated_at=now() WHERE singleton RETURNING updated_at`,
		*body.Offline, user.ID).Scan(&updated); err != nil {
		s.internalError(w, r, err)
		return
	}
	netpolicy.SetChosen(*body.Offline)
	action := "system.network_online"
	if *body.Offline {
		action = "system.network_offline"
	}
	_, _ = s.db.Exec(r.Context(),
		`INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id,metadata)VALUES($1,$2,$3,'system','network','{}'::jsonb)`,
		uuid.New(), user.ID, action)
	writeJSON(w, http.StatusOK, map[string]any{"data": s.networkModeBody(&updated)})
}
