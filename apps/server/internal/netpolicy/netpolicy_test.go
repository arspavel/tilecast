package netpolicy

import (
	"context"
	"errors"
	"net"
	"net/http"
	"testing"
)

type stub struct{ called bool }

func (s *stub) RoundTrip(*http.Request) (*http.Response, error) {
	s.called = true
	return &http.Response{StatusCode: http.StatusOK, Body: http.NoBody}, nil
}

func reset(t *testing.T) {
	t.Cleanup(func() {
		SetForced(false)
		SetChosen(false)
		resolve = net.DefaultResolver.LookupIPAddr
	})
}

func TestOnlineAllowsEverything(t *testing.T) {
	reset(t)
	if err := Allow(context.Background(), "api.github.com"); err != nil {
		t.Fatalf("online mode blocked a request: %v", err)
	}
}

func TestOfflineBlocksPublicAndKeepsLocal(t *testing.T) {
	reset(t)
	SetChosen(true)
	resolve = func(_ context.Context, host string) ([]net.IPAddr, error) {
		switch host {
		case "intranet.lsr":
			return []net.IPAddr{{IP: net.ParseIP("10.1.2.3")}}, nil
		case "mixed.example":
			return []net.IPAddr{{IP: net.ParseIP("10.1.2.3")}, {IP: net.ParseIP("140.82.112.3")}}, nil
		}
		return []net.IPAddr{{IP: net.ParseIP("140.82.112.3")}}, nil
	}
	for host, allowed := range map[string]bool{
		"api.github.com": false,
		"8.8.8.8":        false,
		"mixed.example":  false,
		"intranet.lsr":   true,
		"192.168.1.20":   true,
		"127.0.0.1":      true,
		"100.64.0.10":    true,
	} {
		err := Allow(context.Background(), host)
		if allowed && err != nil {
			t.Errorf("%s: local host blocked: %v", host, err)
		}
		if !allowed && !errors.Is(err, ErrOffline) {
			t.Errorf("%s: public host was allowed", host)
		}
	}
}

func TestForcedModeCannotBeUndoneFromStudio(t *testing.T) {
	reset(t)
	SetForced(true)
	SetChosen(false)
	if !Offline() {
		t.Fatal("TILECAST_OFFLINE must keep the installation offline")
	}
}

func TestGuardStopsTheRequestBeforeTheNetwork(t *testing.T) {
	reset(t)
	SetChosen(true)
	resolve = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("140.82.112.3")}}, nil
	}
	next := &stub{}
	request, _ := http.NewRequest(http.MethodGet, "https://api.github.com/repos", nil)
	if _, err := Guard(next).RoundTrip(request); !errors.Is(err, ErrOffline) {
		t.Fatalf("err = %v", err)
	}
	if next.called {
		t.Fatal("the request reached the network")
	}
}
