package web

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"errors"
	"io"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func playerFS(appJS string) fstest.MapFS {
	return fstest.MapFS{
		"webos/index.html": {Data: []byte("<html></html>")},
		"webos/app.js":     {Data: []byte(appJS)},
		"webos/styles.css": {Data: []byte("body{}")},
		"webos/icon.png":   {Data: []byte{0x89, 'P', 'N', 'G'}},
	}
}

// arMembers reads a GNU ar archive into name -> data.
func arMembers(t *testing.T, archive []byte) (map[string][]byte, []string) {
	t.Helper()
	if !bytes.HasPrefix(archive, []byte("!<arch>\n")) {
		t.Fatal("missing ar magic")
	}
	members, order := map[string][]byte{}, []string{}
	rest := archive[8:]
	for len(rest) >= 60 {
		header := rest[:60]
		name := strings.TrimSuffix(strings.TrimSpace(string(header[:16])), "/")
		size, err := strconv.Atoi(strings.TrimSpace(string(header[48:58])))
		if err != nil || string(header[58:60]) != "`\n" {
			t.Fatalf("bad ar header %q", header)
		}
		members[name] = rest[60 : 60+size]
		order = append(order, name)
		rest = rest[60+size+size%2:]
	}
	return members, order
}

func tarNames(t *testing.T, compressed []byte) map[string][]byte {
	t.Helper()
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		t.Fatal(err)
	}
	archive := tar.NewReader(reader)
	out := map[string][]byte{}
	for {
		header, err := archive.Next()
		if err == io.EOF {
			return out
		}
		if err != nil {
			t.Fatal(err)
		}
		data, _ := io.ReadAll(archive)
		out[header.Name] = data
	}
}

func TestWebOSPackageHasTheSignageLayout(t *testing.T) {
	ipk, version, err := BuildWebOSPackage(playerFS(`var VERSION = "0.4.1";\nvar VERSION_CODE = 8;`), "webos", time.Unix(1_800_000_000, 0))
	if err != nil {
		t.Fatal(err)
	}
	if version != "9.9.18" {
		t.Fatalf("version = %s", version)
	}
	members, order := arMembers(t, ipk)
	if strings.Join(order, ",") != "debian-binary,control.tar.gz,data.tar.gz" {
		t.Fatalf("members = %v", order)
	}
	if string(members["debian-binary"]) != "2.0\n" {
		t.Fatal("debian-binary must be 2.0")
	}
	control := tarNames(t, members["control.tar.gz"])["control"]
	if !bytes.Contains(control, []byte("Package: com.lg.app.signage\nVersion: 9.9.18\n")) {
		t.Fatalf("control = %s", control)
	}
	data := tarNames(t, members["data.tar.gz"])
	for _, name := range []string{
		"usr/palm/applications/com.lg.app.signage/appinfo.json",
		"usr/palm/applications/com.lg.app.signage/app.js",
		"usr/palm/applications/com.lg.app.signage/index.html",
		"usr/palm/applications/com.lg.app.signage/styles.css",
		"usr/palm/applications/com.lg.app.signage/icon.png",
		"usr/palm/packages/com.lg.app.signage/packageinfo.json",
	} {
		if _, ok := data[name]; !ok {
			t.Errorf("missing %s", name)
		}
	}
	if !bytes.Contains(data["usr/palm/applications/com.lg.app.signage/appinfo.json"], []byte(`"version": "9.9.18"`)) {
		t.Error("appinfo.json must carry the package version")
	}
}

func TestWebOSPackageVersionRisesWithThePlayer(t *testing.T) {
	older, _ := WebOSPackageVersion([]byte("var VERSION_CODE = 8;"))
	newer, _ := WebOSPackageVersion([]byte("var VERSION_CODE = 9;"))
	if older != "9.9.18" || newer != "9.9.19" {
		t.Fatalf("versions %s %s", older, newer)
	}
}

func TestWebOSPackageWithoutThePlayer(t *testing.T) {
	if _, _, err := BuildWebOSPackage(fstest.MapFS{}, "webos", time.Now()); !errors.Is(err, ErrNoWebOSPlayer) {
		t.Fatalf("err = %v", err)
	}
}
