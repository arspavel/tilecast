package playlists

import (
	"reflect"
	"strings"
	"testing"
)

// One unexpected value used to refuse the whole status, freezing the screen's
// playback state in Studio while the player went on playing.
func TestNormalizePlayerStatusKeepsTheRestOfTheStatus(t *testing.T) {
	negative := int64(-1)
	status := PlayerStatus{
		PlaybackState:     "playing",
		SelectionSource:   "quick_present",
		WidgetProvider:    "weather",
		LastPlaybackError: strings.Repeat("ошибка ", 100),
		CacheUsedBytes:    &negative,
	}
	adjusted := NormalizePlayerStatus(&status)

	want := []string{"cacheUsedBytes", "lastPlaybackError", "selectionSource", "widgetProvider"}
	if !reflect.DeepEqual(adjusted, want) {
		t.Fatalf("adjusted = %v, want %v", adjusted, want)
	}
	if status.PlaybackState != "playing" {
		t.Fatalf("playback state = %q, want it kept", status.PlaybackState)
	}
	if status.SelectionSource != "" || status.WidgetProvider != "" || status.CacheUsedBytes != nil {
		t.Fatalf("out-of-range fields were not cleared: %+v", status)
	}
	if got := len([]rune(status.LastPlaybackError)); got != 500 {
		t.Fatalf("error kept %d characters, want 500", got)
	}
	if !strings.HasPrefix(status.LastPlaybackError, "ошибка") {
		t.Fatalf("trim broke the Cyrillic text: %q", status.LastPlaybackError[:20])
	}
}

func TestNormalizePlayerStatusLeavesAValidStatusAlone(t *testing.T) {
	status := PlayerStatus{PlaybackState: "playing", SelectionSource: "schedule", WidgetProvider: "clock"}
	if adjusted := NormalizePlayerStatus(&status); len(adjusted) != 0 {
		t.Fatalf("adjusted = %v, want none", adjusted)
	}
}
