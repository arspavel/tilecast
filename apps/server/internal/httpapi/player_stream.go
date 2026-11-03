package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// streamURLLifetime covers a long video played on a loop for a whole day; the
// player asks for a fresh URL well before it runs out.
const streamURLLifetime = 24 * time.Hour

// playerAssetStreamURL hands a device a signed URL for one media variant. The
// webOS player keeps downloads in browser memory, which on LG signage panels
// is capped far below the panel's own storage, so large videos are played
// from the server instead. A <video> element cannot send the device
// credential, hence the signature in the URL.
func (s *server) playerAssetStreamURL(w http.ResponseWriter, r *http.Request) {
	assetID, err := uuid.Parse(chi.URLParam(r, "assetId"))
	if err != nil {
		writeError(w, http.StatusNotFound, "media_variant_unavailable", "The requested media variant is unavailable.")
		return
	}
	variantID, err := uuid.Parse(chi.URLParam(r, "variantId"))
	if err != nil {
		writeError(w, http.StatusNotFound, "media_variant_unavailable", "The requested media variant is unavailable.")
		return
	}
	if _, err := s.media.Delivery(r.Context(), assetID, variantID); err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	expires := time.Now().Add(streamURLLifetime).Unix()
	query := url.Values{}
	query.Set("expires", strconv.FormatInt(expires, 10))
	query.Set("signature", s.streamSignature(assetID, variantID, expires))
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
		"path":      "/api/v1/player/stream/" + assetID.String() + "/" + variantID.String() + "?" + query.Encode(),
		"expiresAt": time.Unix(expires, 0).UTC(),
	}})
}

func (s *server) playerAssetStream(w http.ResponseWriter, r *http.Request) {
	assetID, err := uuid.Parse(chi.URLParam(r, "assetId"))
	if err != nil {
		writeError(w, http.StatusNotFound, "media_variant_unavailable", "The requested media variant is unavailable.")
		return
	}
	variantID, err := uuid.Parse(chi.URLParam(r, "variantId"))
	if err != nil {
		writeError(w, http.StatusNotFound, "media_variant_unavailable", "The requested media variant is unavailable.")
		return
	}
	expires, err := strconv.ParseInt(r.URL.Query().Get("expires"), 10, 64)
	if err != nil || time.Now().Unix() > expires {
		writeError(w, http.StatusForbidden, "stream_url_expired", "The media link has expired.")
		return
	}
	want := s.streamSignature(assetID, variantID, expires)
	if !hmac.Equal([]byte(want), []byte(r.URL.Query().Get("signature"))) {
		writeError(w, http.StatusForbidden, "stream_url_invalid", "The media link is not valid.")
		return
	}
	delivery, err := s.media.Delivery(r.Context(), assetID, variantID)
	if err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	serveDelivery(w, r, delivery)
}

func (s *server) streamSignature(assetID, variantID uuid.UUID, expires int64) string {
	mac := hmac.New(sha256.New, s.streamKey[:])
	mac.Write([]byte(assetID.String() + "/" + variantID.String() + "/" + strconv.FormatInt(expires, 10)))
	return hex.EncodeToString(mac.Sum(nil))
}
