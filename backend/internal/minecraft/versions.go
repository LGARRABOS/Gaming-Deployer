package minecraft

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const manifestURL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"

// VersionEntry represents a single version in the Mojang manifest.
type VersionEntry struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	URL         string `json:"url"`
	ReleaseTime string `json:"releaseTime"`
}

type versionManifest struct {
	Latest   map[string]string   `json:"latest"`
	Versions []VersionEntry      `json:"versions"`
}

type versionJSON struct {
	Downloads struct {
		Server struct {
			SHA1 string `json:"sha1"`
			Size int    `json:"size"`
			URL  string `json:"url"`
		} `json:"server"`
	} `json:"downloads"`
}

// releaseVersionRegex matches only release versions in form 1.x.x (no snapshot, no rc, no pre).
var releaseVersionRegex = regexp.MustCompile(`^1\.\d+\.\d+$`)

// ReleaseVersion holds a vanilla release version id (and optional json URL for resolution).
type ReleaseVersion struct {
	ID  string `json:"id"`
	URL string `json:"url,omitempty"`
}

// GetVanillaReleaseVersions fetches the Mojang manifest and returns only release versions
// in format 1.x.x (no snapshots, no betas, no release candidates).
func GetVanillaReleaseVersions() ([]ReleaseVersion, string, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(manifestURL)
	if err != nil {
		return nil, "", fmt.Errorf("fetch manifest: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("manifest returned %d", resp.StatusCode)
	}
	var m versionManifest
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		return nil, "", fmt.Errorf("decode manifest: %w", err)
	}
	var list []ReleaseVersion
	for _, v := range m.Versions {
		if v.Type != "release" {
			continue
		}
		if !releaseVersionRegex.MatchString(v.ID) {
			continue
		}
		list = append(list, ReleaseVersion{ID: v.ID, URL: v.URL})
	}
	latestRelease := ""
	if m.Latest != nil {
		latestRelease = m.Latest["release"]
	}
	return list, latestRelease, nil
}

// ResolveVanillaServerJarURL returns the download URL for the vanilla server jar of the given version.
// Version must be a release version id (e.g. "1.20.4"). Returns error if not found or no server download.
func ResolveVanillaServerJarURL(version string) (string, error) {
	list, _, err := GetVanillaReleaseVersions()
	if err != nil {
		return "", err
	}
	var versionJSONURL string
	for _, rv := range list {
		if rv.ID == version {
			versionJSONURL = rv.URL
			break
		}
	}
	if versionJSONURL == "" {
		return "", fmt.Errorf("version %q is not a valid vanilla release (use 1.x.x)", version)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(versionJSONURL)
	if err != nil {
		return "", fmt.Errorf("fetch version json: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("version json returned %d", resp.StatusCode)
	}
	var vj versionJSON
	if err := json.NewDecoder(resp.Body).Decode(&vj); err != nil {
		return "", fmt.Errorf("decode version json: %w", err)
	}
	url := strings.TrimSpace(vj.Downloads.Server.URL)
	if url == "" {
		return "", fmt.Errorf("version %s has no server download (old version?)", version)
	}
	return url, nil
}
