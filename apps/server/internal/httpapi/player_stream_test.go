package httpapi

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestStreamSignatureBindsAssetVariantAndExpiry(t *testing.T) {
	s := &server{}
	s.streamKey[0] = 7
	asset, variant := uuid.New(), uuid.New()
	expires := time.Now().Add(time.Hour).Unix()
	base := s.streamSignature(asset, variant, expires)
	if base != s.streamSignature(asset, variant, expires) {
		t.Fatal("signature is not deterministic")
	}
	if base == s.streamSignature(uuid.New(), variant, expires) ||
		base == s.streamSignature(asset, uuid.New(), expires) ||
		base == s.streamSignature(asset, variant, expires+1) {
		t.Fatal("signature does not cover asset, variant and expiry")
	}
	other := &server{}
	other.streamKey[0] = 8
	if base == other.streamSignature(asset, variant, expires) {
		t.Fatal("signature does not depend on the server key")
	}
}
