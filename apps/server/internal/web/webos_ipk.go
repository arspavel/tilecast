package web

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"io/fs"
	"regexp"
	"strconv"
	"sync"
	"time"
)

// WebOSAppID is the application id LG Signage panels install from SI Server.
const WebOSAppID = "com.lg.app.signage"

// ErrNoWebOSPlayer means this build does not embed the webOS player (only the
// Docker image copies it into static/webos).
var ErrNoWebOSPlayer = errors.New("webOS player is not embedded in this build")

var webOSFiles = []string{"index.html", "app.js", "styles.css", "icon.png"}

var versionCodePattern = regexp.MustCompile(`var VERSION_CODE = (\d+);`)

// WebOSPackageVersion turns the player's VERSION_CODE into the package
// version. Panels installed from SI Server only take a higher version, and the
// hand-built packages reached 9.9.12, so codes map to 9.9.(10+code).
func WebOSPackageVersion(appJS []byte) (string, error) {
	match := versionCodePattern.FindSubmatch(appJS)
	if match == nil {
		return "", errors.New("VERSION_CODE not found in app.js")
	}
	code, err := strconv.Atoi(string(match[1]))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("9.9.%d", 10+code), nil
}

// BuildWebOSPackage packs the webOS player in dir of fsys into an .ipk in the
// layout LG Signage accepts: an ar archive of debian-binary, control.tar.gz
// and data.tar.gz with usr/palm/applications/<id> and usr/palm/packages/<id>.
func BuildWebOSPackage(fsys fs.FS, dir string, modified time.Time) ([]byte, string, error) {
	contents := map[string][]byte{}
	for _, name := range webOSFiles {
		data, err := fs.ReadFile(fsys, dir+"/"+name)
		if err != nil {
			return nil, "", ErrNoWebOSPlayer
		}
		contents[name] = data
	}
	version, err := WebOSPackageVersion(contents["app.js"])
	if err != nil {
		return nil, "", err
	}
	contents["appinfo.json"] = []byte(fmt.Sprintf(`{
  "id": %q,
  "version": %q,
  "vendor": "LSR signage",
  "type": "web",
  "main": "index.html",
  "title": "LSR signage Player",
  "icon": "icon.png",
  "largeIcon": "icon.png",
  "backgroundColor": "#0e141b",
  "transparent": false,
  "fullscreen": true,
  "resolution": "1920x1080",
  "disableBackHistoryAPI": true,
  "allowCrossDomain": true,
  "requiredACG": []
}
`, WebOSAppID, version))
	packageInfo := []byte(fmt.Sprintf("{\n  \"id\": %q,\n  \"version\": %q,\n  \"app\": %q\n}\n", WebOSAppID, version, WebOSAppID))

	appDir := "usr/palm/applications/" + WebOSAppID + "/"
	packageDir := "usr/palm/packages/" + WebOSAppID + "/"
	entries := []tarEntry{
		{name: "usr/"}, {name: "usr/palm/"}, {name: "usr/palm/applications/"}, {name: appDir},
	}
	installed := 0
	for _, name := range append([]string{"appinfo.json"}, webOSFiles...) {
		entries = append(entries, tarEntry{name: appDir + name, data: contents[name]})
		installed += len(contents[name])
	}
	entries = append(entries,
		tarEntry{name: "usr/palm/packages/"}, tarEntry{name: packageDir},
		tarEntry{name: packageDir + "packageinfo.json", data: packageInfo})
	installed += len(packageInfo)
	data, err := gzipTar(entries, modified)
	if err != nil {
		return nil, "", err
	}
	control := fmt.Sprintf("Package: %s\nVersion: %s\nSection: misc\nPriority: optional\nArchitecture: all\nInstalled-Size: %d\nMaintainer: LSR signage <nobody@example.com>\nDescription: LSR signage Player for LG webOS Signage.\nwebOS-Package-Format-Version: 2\nwebOS-Packager-Version: x.y.x\n", WebOSAppID, version, installed)
	controlArchive, err := gzipTar([]tarEntry{{name: "control", data: []byte(control)}}, modified)
	if err != nil {
		return nil, "", err
	}

	var out bytes.Buffer
	out.WriteString("!<arch>\n")
	for _, member := range []struct {
		name string
		data []byte
	}{
		{"debian-binary", []byte("2.0\n")},
		{"control.tar.gz", controlArchive},
		{"data.tar.gz", data},
	} {
		// GNU ar member header: name/ (16), mtime (12), uid (6), gid (6),
		// mode (8), size (10), "`\n"; data padded to an even length.
		fmt.Fprintf(&out, "%-16s%-12d%-6d%-6d%-8s%-10d`\n", member.name+"/", modified.Unix(), 0, 0, "100644", len(member.data))
		out.Write(member.data)
		if len(member.data)%2 == 1 {
			out.WriteByte('\n')
		}
	}
	return out.Bytes(), version, nil
}

type tarEntry struct {
	name string
	data []byte
}

func gzipTar(entries []tarEntry, modified time.Time) ([]byte, error) {
	var buffer bytes.Buffer
	compressed := gzip.NewWriter(&buffer)
	archive := tar.NewWriter(compressed)
	for _, entry := range entries {
		header := &tar.Header{Name: entry.name, ModTime: modified, Format: tar.FormatUSTAR, Uname: "root", Gname: "root"}
		if entry.name[len(entry.name)-1] == '/' {
			header.Typeflag, header.Mode = tar.TypeDir, 0o755
		} else {
			header.Typeflag, header.Mode, header.Size = tar.TypeReg, 0o644, int64(len(entry.data))
		}
		if err := archive.WriteHeader(header); err != nil {
			return nil, err
		}
		if _, err := archive.Write(entry.data); err != nil {
			return nil, err
		}
	}
	if err := archive.Close(); err != nil {
		return nil, err
	}
	if err := compressed.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

var embeddedPackage struct {
	once    sync.Once
	data    []byte
	version string
	err     error
}

// WebOSPackage returns the .ipk of the webOS player embedded in this build,
// built once: the embedded files never change while the server runs.
func WebOSPackage() ([]byte, string, error) {
	embeddedPackage.once.Do(func() {
		static, err := fs.Sub(files, "static")
		if err != nil {
			embeddedPackage.err = err
			return
		}
		embeddedPackage.data, embeddedPackage.version, embeddedPackage.err =
			BuildWebOSPackage(static, "webos", time.Now().UTC())
	})
	return embeddedPackage.data, embeddedPackage.version, embeddedPackage.err
}
