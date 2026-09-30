package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

// TestWritePlaylistErrorForeignKey guards that a foreign-key violation (a
// referenced asset or Layout that no longer exists) is reported as a 422 rather
// than a 500.
func TestWritePlaylistErrorForeignKey(t *testing.T) {
	s := &server{}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/playlists/p/items", nil)
	fk := &pgconn.PgError{
		Code:    "23503",
		Message: `insert or update on table "playlist_draft_items" violates foreign key constraint`,
	}
	s.writePlaylistError(rec, req, fk)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for a foreign-key violation, got %d", rec.Code)
	}
}
