package httpapi

import "testing"

func TestActivityAuditContentOnly(t *testing.T) {
	contentOnly := map[string]bool{
		"owner":         false,
		"administrator": false,
		"editor":        true,
		"contributor":   true,
		"viewer":        false,
	}
	for role, want := range contentOnly {
		if got := activityAuditContentOnly(role); got != want {
			t.Errorf("activityAuditContentOnly(%q)=%v, want %v", role, got, want)
		}
	}
}
