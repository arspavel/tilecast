package auth

import "testing"

func TestPasswordRoundTrip(t *testing.T) {
	hash, err := HashPassword("a strong example password")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if !VerifyPassword(hash, "a strong example password") {
		t.Fatal("expected password to verify")
	}
	if VerifyPassword(hash, "a different password") {
		t.Fatal("expected different password to fail")
	}
}

func TestPasswordMinimumLength(t *testing.T) {
	if _, err := HashPassword("too-short"); err == nil {
		t.Fatal("expected a short password to fail")
	}
}

func TestMalformedPasswordHash(t *testing.T) {
	if VerifyPassword("not-a-password-hash", "anything") {
		t.Fatal("malformed hash must not verify")
	}
}

func TestValidatePasswordStrength(t *testing.T) {
	valid := []string{
		"a strong example password",
		"correct horse battery staple",
		"Tr0ub4dour&3xample",
	}
	for _, p := range valid {
		if err := ValidatePasswordStrength(p); err != nil {
			t.Errorf("expected %q to be accepted, got %v", p, err)
		}
	}

	invalid := []string{
		"            ", // twelve spaces
		"aaaaaaaaaaaa", // repeated single character
		"121212121212", // only two distinct characters
		"short",        // below minimum length
		"",             // empty
	}
	for _, p := range invalid {
		if err := ValidatePasswordStrength(p); err == nil {
			t.Errorf("expected %q to be rejected", p)
		}
	}
}
