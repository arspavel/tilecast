package httpapi

import (
	"bytes"
	"errors"
	"net/http"
	"time"

	"github.com/tilecast/tilecast/apps/server/internal/web"
)

// webOSPackage serves the webOS player as an .ipk for LG SI Server. The
// version follows the player's VERSION_CODE, so after a server update the same
// address offers a newer package that panels accept as an update.
func (s *server) webOSPackage(w http.ResponseWriter, r *http.Request) {
	data, version, err := web.WebOSPackage()
	if errors.Is(err, web.ErrNoWebOSPlayer) {
		writeError(w, http.StatusNotFound, "webos_player_missing", "В эту сборку сервера не входит webOS-плеер.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "application/vnd.debian.binary-package")
	w.Header().Set("Content-Disposition", `attachment; filename="`+web.WebOSAppID+`.ipk"`)
	w.Header().Set("X-LSR-Package-Version", version)
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, web.WebOSAppID+".ipk", time.Time{}, bytes.NewReader(data))
}
