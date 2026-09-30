package devices

import (
	"bytes"
	"encoding/json"
	"testing"
)

// TestHeartbeatAcceptsRenderProgressFields guards the fix for the 400 the
// server returned on Linux/Windows heartbeats: the player sends render-progress
// fields and the API decodes with DisallowUnknownFields, so any missing field
// rejected the whole heartbeat.
func TestHeartbeatAcceptsRenderProgressFields(t *testing.T) {
	payload := `{
		"screenWidth": 1920,
		"screenHeight": 1080,
		"playerVersion": "0.32.1",
		"lastMeaningfulProgressAt": "2026-09-30T10:00:00Z",
		"stallStartedAt": "2026-09-30T10:00:05Z",
		"stallDurationMs": 4200,
		"stallReason": "renderer_idle",
		"expectedMotion": true,
		"rendererResponding": true,
		"currentItemStartedAt": "2026-09-30T09:59:00Z"
	}`
	dec := json.NewDecoder(bytes.NewReader([]byte(payload)))
	dec.DisallowUnknownFields()
	var hb Heartbeat
	if err := dec.Decode(&hb); err != nil {
		t.Fatalf("strict decode rejected render-progress fields: %v", err)
	}
	if hb.StallDurationMs == nil || *hb.StallDurationMs != 4200 {
		t.Errorf("stallDurationMs not decoded: %#v", hb.StallDurationMs)
	}
	if hb.RendererResponding == nil || !*hb.RendererResponding {
		t.Error("rendererResponding not decoded")
	}
	if hb.ExpectedMotion == nil || !*hb.ExpectedMotion {
		t.Error("expectedMotion not decoded")
	}
	if hb.StallReason != "renderer_idle" {
		t.Errorf("stallReason not decoded: %q", hb.StallReason)
	}
	if hb.LastMeaningfulProgressAt == nil || hb.StallStartedAt == nil || hb.CurrentItemStartedAt == nil {
		t.Error("render-progress timestamps not decoded")
	}
}
