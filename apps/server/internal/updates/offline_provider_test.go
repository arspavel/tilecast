package updates

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestOfflineProviderFailsImmediately(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	var provider Provider = OfflineProvider{}
	started := time.Now()
	if _, err := provider.Releases(ctx, ""); !errors.Is(err, ErrOffline) {
		t.Fatalf("Releases error = %v", err)
	}
	if _, err := provider.Download(ctx, "https://example.com/a", 1); !errors.Is(err, ErrOffline) {
		t.Fatalf("Download error = %v", err)
	}
	if response, err := provider.Open(ctx, "https://example.com/a"); response != nil || !errors.Is(err, ErrOffline) {
		t.Fatalf("Open = %v, %v", response, err)
	}
	if time.Since(started) > 100*time.Millisecond {
		t.Fatal("offline provider waited for the network")
	}
}
