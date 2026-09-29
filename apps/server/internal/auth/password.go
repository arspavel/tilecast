package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	argonMemory  = 64 * 1024
	argonTime    = 3
	argonThreads = 2
	argonKeyLen  = 32
	saltLen      = 16
)

const (
	// MinPasswordLength is the minimum accepted account password length.
	MinPasswordLength = 12
	// MaxPasswordLength bounds password length to keep hashing cost predictable.
	MaxPasswordLength = 1024
	// minPasswordUniqueChars rejects trivial passwords such as repeated or
	// whitespace-only strings (e.g. twelve spaces) that satisfy the length rule.
	minPasswordUniqueChars = 5
)

// ValidatePasswordStrength enforces the account password policy: length bounds,
// a non-blank value, and a minimum number of distinct characters. It is the
// single source of truth for password acceptance across setup and user
// management.
func ValidatePasswordStrength(password string) error {
	if len(password) < MinPasswordLength || len(password) > MaxPasswordLength {
		return fmt.Errorf("password must be between %d and %d characters", MinPasswordLength, MaxPasswordLength)
	}
	if strings.TrimSpace(password) == "" {
		return errors.New("password must not consist only of whitespace")
	}
	unique := make(map[rune]struct{})
	for _, r := range password {
		unique[r] = struct{}{}
	}
	if len(unique) < minPasswordUniqueChars {
		return fmt.Errorf("password must contain at least %d different characters", minPasswordUniqueChars)
	}
	return nil
}

func HashPassword(password string) (string, error) {
	if len(password) < 12 {
		return "", errors.New("password must be at least 12 characters")
	}
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate password salt: %w", err)
	}
	hash := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s", argonMemory, argonTime, argonThreads, base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(hash)), nil
}

func VerifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false
	}
	var memory uint32
	var iterations uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &threads); err != nil {
		return false
	}
	if memory > argonMemory*2 || iterations > 10 || threads > 8 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) < 8 {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) == 0 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, iterations, memory, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}
