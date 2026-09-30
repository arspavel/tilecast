package devices

import "time"

func ComputeStatus(now time.Time, socketConnected, enabled, activeCredential bool, lastContact *time.Time) Status {
	if !enabled {
		return StatusDisabled
	}
	if !activeCredential {
		return StatusRevoked
	}
	if socketConnected {
		return StatusOnline
	}
	if lastContact == nil {
		return StatusOffline
	}
	age := now.Sub(*lastContact)
	// A player that contacted us within this window is treated as online even
	// without a live socket: HTTP-only players (webOS) heartbeat frequently and
	// would otherwise never leave "recent".
	if age <= OnlineThreshold {
		return StatusOnline
	}
	if age <= RecentThreshold {
		return StatusRecent
	}
	if age <= OfflineThreshold {
		return StatusStale
	}
	return StatusOffline
}

func latestContact(values ...*time.Time) *time.Time {
	var latest *time.Time
	for _, value := range values {
		if value != nil && (latest == nil || value.After(*latest)) {
			copy := *value
			latest = &copy
		}
	}
	return latest
}
