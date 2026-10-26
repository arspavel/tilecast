package httpapi

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/tilecast/tilecast/apps/server/internal/devices"
	"github.com/tilecast/tilecast/apps/server/internal/livestream"
)

const liveStreamBoundary = "tilecastframe"

func (s *server) startLiveStream(w http.ResponseWriter, r *http.Request) {
	screenID, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	session := s.liveStreams.Start(screenID)
	writeJSON(w, http.StatusCreated, map[string]any{"data": session})
}

func (s *server) renewLiveStream(w http.ResponseWriter, r *http.Request) {
	screenID, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	sessionID, ok := urlUUID(w, r, "sessionId")
	if !ok {
		return
	}
	session, err := s.liveStreams.Renew(screenID, sessionID)
	if err != nil {
		s.writeLiveStreamError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": session})
}

func (s *server) endLiveStream(w http.ResponseWriter, r *http.Request) {
	screenID, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	sessionID, ok := urlUUID(w, r, "sessionId")
	if !ok {
		return
	}
	if err := s.liveStreams.End(screenID, sessionID); err != nil {
		s.writeLiveStreamError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) playerLiveStreamSession(w http.ResponseWriter, r *http.Request) {
	principal := r.Context().Value(deviceContextKey).(devices.DevicePrincipal)
	writeJSON(w, http.StatusOK, map[string]any{"data": s.liveStreams.Current(principal.ScreenID)})
}

// uploadPlayerLiveStreamFrame accepts one binary TCLS frame over HTTP. Browser
// players such as webOS cannot send the Authorization header on a WebSocket,
// so they post frames with their device credential instead. The frame format,
// validation, and in-memory relay are identical to the socket path.
func (s *server) uploadPlayerLiveStreamFrame(w http.ResponseWriter, r *http.Request) {
	principal := r.Context().Value(deviceContextKey).(devices.DevicePrincipal)
	payload, err := io.ReadAll(http.MaxBytesReader(w, r.Body, livestream.MaxFrameBytes+1024))
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "live_stream_frame_too_large", "The live stream frame is too large.")
		return
	}
	sessionID, frame, err := livestream.ParseBinaryFrame(payload)
	if err != nil {
		s.writeLiveStreamError(w, r, err)
		return
	}
	if err = s.liveStreams.Publish(principal.ScreenID, sessionID, frame); err != nil {
		s.writeLiveStreamError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) watchLiveStream(w http.ResponseWriter, r *http.Request) {
	screenID, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	sessionID, ok := urlUUID(w, r, "sessionId")
	if !ok {
		return
	}
	frames, done, cancel, err := s.liveStreams.Subscribe(screenID, sessionID)
	if err != nil {
		s.writeLiveStreamError(w, r, err)
		return
	}
	defer cancel()

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming_unavailable", "This server cannot relay a live stream.")
		return
	}
	w.Header().Set("Cache-Control", "no-store, private")
	w.Header().Set("Content-Type", "multipart/x-mixed-replace; boundary="+liveStreamBoundary)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	expiryCheck := time.NewTicker(time.Second)
	defer expiryCheck.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-done:
			return
		case <-expiryCheck.C:
			current := s.liveStreams.Current(screenID)
			if !current.Active || current.ID != sessionID {
				return
			}
		case frame := <-frames:
			if _, err := fmt.Fprintf(w,
				"--%s\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\nX-Tilecast-Captured-At: %s\r\n\r\n",
				liveStreamBoundary, len(frame.JPEG), frame.CapturedAt.Format(time.RFC3339Nano)); err != nil {
				return
			}
			if _, err := w.Write(frame.JPEG); err != nil {
				return
			}
			if _, err := w.Write([]byte("\r\n")); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (s *server) writeLiveStreamError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, livestream.ErrNotFound):
		writeError(w, http.StatusNotFound, "live_stream_not_found", "That live stream is no longer active.")
	case errors.Is(err, livestream.ErrInvalidFrame):
		writeError(w, http.StatusUnprocessableEntity, "invalid_live_stream_frame", "The player sent an invalid live stream frame.")
	default:
		s.internalError(w, r, err)
	}
}
