// Package netpolicy decides whether the server may reach the Internet.
//
// An installation works without the Internet when TILECAST_OFFLINE is set on
// the server or when an Owner or Administrator turns on "Работать без
// интернета" in Studio. Outbound HTTP and SMTP then reach only addresses inside
// the local network: GitHub release checks, public Data Sources, NWS alerts and
// Internet mail or webhooks fail at once with ErrOffline instead of timing out.
package netpolicy

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync/atomic"
)

// ErrOffline is returned for a connection the offline mode does not allow.
var ErrOffline = errors.New("включена работа без интернета: обращения сервера в интернет отключены")

var (
	forced  atomic.Bool // TILECAST_OFFLINE on the server
	chosen  atomic.Bool // the Studio switch
	resolve = net.DefaultResolver.LookupIPAddr
)

// SetForced records the server-level TILECAST_OFFLINE flag.
func SetForced(value bool) { forced.Store(value) }

// SetChosen records the Studio switch.
func SetChosen(value bool) { chosen.Store(value) }

// Forced reports whether TILECAST_OFFLINE is set, which Studio cannot undo.
func Forced() bool { return forced.Load() }

// Chosen reports the Studio switch.
func Chosen() bool { return chosen.Load() }

// Offline reports whether Internet access is turned off for any reason.
func Offline() bool { return forced.Load() || chosen.Load() }

// Local reports whether every address in the list is inside the local network
// (private, loopback, link-local or carrier-grade NAT ranges).
func Local(addresses []net.IP) bool {
	if len(addresses) == 0 {
		return false
	}
	for _, ip := range addresses {
		if !localIP(ip) {
			return false
		}
	}
	return true
}

var carrierGradeNAT = &net.IPNet{IP: net.IPv4(100, 64, 0, 0), Mask: net.CIDRMask(10, 32)}

func localIP(ip net.IP) bool {
	return ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || carrierGradeNAT.Contains(ip)
}

// Allow returns ErrOffline when offline mode is on and host is not inside the
// local network. A host name is resolved; one that cannot be resolved counts
// as outside, because it cannot be shown to stay local.
func Allow(ctx context.Context, host string) error {
	if !Offline() {
		return nil
	}
	if ip := net.ParseIP(host); ip != nil {
		if localIP(ip) {
			return nil
		}
		return ErrOffline
	}
	found, err := resolve(ctx, host)
	if err != nil {
		return ErrOffline
	}
	addresses := make([]net.IP, 0, len(found))
	for _, address := range found {
		addresses = append(addresses, address.IP)
	}
	if Local(addresses) {
		return nil
	}
	return ErrOffline
}

type guard struct{ next http.RoundTripper }

// Guard wraps a transport so its requests obey offline mode.
func Guard(next http.RoundTripper) http.RoundTripper {
	if next == nil {
		next = http.DefaultTransport
	}
	if _, already := next.(guard); already {
		return next
	}
	return guard{next: next}
}

func (g guard) RoundTrip(request *http.Request) (*http.Response, error) {
	if err := Allow(request.Context(), request.URL.Hostname()); err != nil {
		return nil, err
	}
	return g.next.RoundTrip(request)
}
