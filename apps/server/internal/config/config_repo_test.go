package config

import "testing"

func TestValidateGitHubRepository(t *testing.T) {
	valid := [][2]string{
		{"arspavel", "tilecast"},
		{"gbyo", "tilecast"},
		{"My-Org", "player.updates_2"},
	}
	for _, c := range valid {
		if err := validateGitHubRepository(c[0], c[1]); err != nil {
			t.Errorf("expected %s/%s to be valid, got %v", c[0], c[1], err)
		}
	}
	invalid := [][2]string{
		{"..", "tilecast"},
		{"arspavel", ".."},
		{"arspavel", "."},
		{"has/slash", "tilecast"},
		{"arspavel", "with?query"},
		{"arspavel", "with space"},
		{"-leading", "tilecast"},
		{"", "tilecast"},
		{"arspavel", ""},
	}
	for _, c := range invalid {
		if err := validateGitHubRepository(c[0], c[1]); err == nil {
			t.Errorf("expected %q/%q to be rejected", c[0], c[1])
		}
	}
}
