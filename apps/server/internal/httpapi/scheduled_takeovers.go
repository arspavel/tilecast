package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
)

// A Takeover may be prepared at most this far ahead; anything longer belongs
// in a schedule.
const maxTakeoverScheduleAhead = 30 * 24 * time.Hour

// scheduledTakeoverTick is how late a scheduled Takeover may start.
const scheduledTakeoverTick = 15 * time.Second

type scheduledTakeover struct {
	ID           uuid.UUID   `json:"id"`
	Name         string      `json:"name"`
	PlaylistID   uuid.UUID   `json:"playlistId"`
	PlaylistName string      `json:"playlistName"`
	ScreenIDs    []uuid.UUID `json:"screenIds"`
	GroupIDs     []uuid.UUID `json:"groupIds"`
	StartsAt     time.Time   `json:"startsAt"`
	ExpiresAt    time.Time   `json:"expiresAt"`
	Status       string      `json:"status"`
	TakeoverID   *uuid.UUID  `json:"takeoverId,omitempty"`
	Failure      string      `json:"failure,omitempty"`
}

// runScheduledTakeoverWorker starts scheduled Takeovers when they are due,
// through the same path as an immediate Takeover.
func (s *server) runScheduledTakeoverWorker() {
	if s.db == nil || s.playlists == nil {
		return
	}
	ticker := time.NewTicker(scheduledTakeoverTick)
	defer ticker.Stop()
	for range ticker.C {
		s.startDueTakeovers(context.Background())
	}
}

func (s *server) startDueTakeovers(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	// Claim due rows first so two server processes never start the same one.
	rows, err := s.db.Query(ctx, `
		UPDATE scheduled_takeovers SET status='starting',updated_at=now()
		WHERE id IN (SELECT id FROM scheduled_takeovers WHERE status='scheduled' AND starts_at<=now()
		             ORDER BY starts_at FOR UPDATE SKIP LOCKED LIMIT 10)
		RETURNING id,organization_id,name,description,playlist_id,screen_ids,group_ids,expires_at,created_by`)
	if err != nil {
		s.logger.Warn("scheduled takeovers could not be claimed", "error", err)
		return
	}
	type due struct {
		id, org uuid.UUID
		input   takeoverInput
		actor   *uuid.UUID
	}
	var claimed []due
	for rows.Next() {
		var item due
		if err := rows.Scan(&item.id, &item.org, &item.input.Name, &item.input.Description, &item.input.PlaylistID,
			&item.input.ScreenIDs, &item.input.GroupIDs, &item.input.ExpiresAt, &item.actor); err != nil {
			rows.Close()
			s.logger.Warn("scheduled takeover could not be read", "error", err)
			return
		}
		claimed = append(claimed, item)
	}
	rows.Close()
	for _, item := range claimed {
		now := time.Now().UTC()
		failure := ""
		var takeoverID *uuid.UUID
		switch {
		case !item.input.ExpiresAt.After(now):
			failure = "Время показа закончилось раньше, чем он успел начаться."
		case s.playlists.ValidatePresentationNow(ctx, "playlist", item.input.PlaylistID, now) != nil:
			failure = "Плейлист не готов к показу: в нём нет доступного контента."
		default:
			id, _, problem := s.startTakeover(ctx, item.actor, item.org, item.input, now)
			if problem != nil {
				failure = problem.message
				if failure == "" {
					failure = "Временный показ не удалось запустить."
					s.logger.Warn("scheduled takeover failed to start", "error", problem.err, "scheduled_takeover_id", item.id)
				}
			} else {
				takeoverID = &id
			}
		}
		status := "activated"
		if failure != "" {
			status = "failed"
		}
		if _, err := s.db.Exec(ctx, `UPDATE scheduled_takeovers SET status=$2,takeover_id=$3,failure=$4,updated_at=now() WHERE id=$1`,
			item.id, status, takeoverID, failure); err != nil {
			s.logger.Warn("scheduled takeover state could not be saved", "error", err, "scheduled_takeover_id", item.id)
		}
	}
}

func (s *server) listScheduledTakeovers(w http.ResponseWriter, r *http.Request) {
	// Upcoming ones, plus those that failed in the last day so a missed
	// start is visible rather than silently gone.
	rows, err := s.db.Query(r.Context(), `
		SELECT st.id,st.name,st.playlist_id,COALESCE(p.name,''),st.screen_ids,st.group_ids,st.starts_at,st.expires_at,st.status,st.takeover_id,st.failure
		FROM scheduled_takeovers st LEFT JOIN playlists p ON p.id=st.playlist_id
		WHERE st.status IN ('scheduled','starting') OR (st.status='failed' AND st.updated_at>now()-interval '1 day')
		ORDER BY st.starts_at LIMIT 100`)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	defer rows.Close()
	items := []scheduledTakeover{}
	for rows.Next() {
		var item scheduledTakeover
		if err := rows.Scan(&item.ID, &item.Name, &item.PlaylistID, &item.PlaylistName, &item.ScreenIDs, &item.GroupIDs,
			&item.StartsAt, &item.ExpiresAt, &item.Status, &item.TakeoverID, &item.Failure); err != nil {
			s.internalError(w, r, err)
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"items": items, "total": len(items)}})
}

func (s *server) cancelScheduledTakeover(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	tag, err := s.db.Exec(r.Context(), `UPDATE scheduled_takeovers SET status='cancelled',cancelled_by=$2,updated_at=now() WHERE id=$1 AND status IN ('scheduled','failed')`, id, user.ID)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusConflict, "scheduled_takeover_not_pending", "Этот временный показ уже начался или отменён.")
		return
	}
	_, _ = s.db.Exec(r.Context(), `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id)VALUES($1,$2,'takeover.schedule_cancelled','scheduled_takeover',$3)`, uuid.New(), user.ID, strings.TrimSpace(id.String()))
	w.WriteHeader(http.StatusNoContent)
}
