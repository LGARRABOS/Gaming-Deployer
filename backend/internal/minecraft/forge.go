package minecraft

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const forgePromotionsURL = "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json"

// Forge promotion file structure.
type forgePromotions struct {
	Promos map[string]string `json:"promos"`
}

// releaseRecommendedRegex matches keys like "1.20.4-recommended" (MC 1.x.x recommended).
var releaseRecommendedRegex = regexp.MustCompile(`^(1\.\d+\.\d+)-recommended$`)

// parseMCVersion parses "1.21.11" into [1, 21, 11]. Returns nil if invalid.
func parseMCVersion(s string) []int {
	parts := strings.Split(s, ".")
	if len(parts) < 2 {
		return nil
	}
	var out []int
	for _, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			return nil
		}
		out = append(out, n)
	}
	return out
}

// mcVersionGreater returns true if a is a newer Minecraft version than b (e.g. 1.21.11 > 1.21.3).
func mcVersionGreater(a, b string) bool {
	va := parseMCVersion(a)
	vb := parseMCVersion(b)
	if va == nil || vb == nil {
		return a > b // fallback lexicographic
	}
	for i := 0; i < len(va) && i < len(vb); i++ {
		if va[i] != vb[i] {
			return va[i] > vb[i]
		}
	}
	return len(va) > len(vb)
}

// ForgeVersionEntry is one stable (recommended) Forge version for a Minecraft release.
type ForgeVersionEntry struct {
	MCVersion    string `json:"mc_version"`    // e.g. "1.20.4"
	ForgeBuild   string `json:"forge_build"`   // e.g. "49.2.0"
	FullVersion  string `json:"full_version"`  // e.g. "1.20.4-49.2.0"
	InstallerURL string `json:"installer_url"`  // full URL to installer jar
}

// GetForgeReleaseVersions fetches Forge promotions and returns one recommended (stable) Forge
// version per Minecraft 1.x.x release. Only entries with "-recommended" are returned.
func GetForgeReleaseVersions() ([]ForgeVersionEntry, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(forgePromotionsURL)
	if err != nil {
		return nil, fmt.Errorf("fetch forge promotions: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("forge promotions returned %d", resp.StatusCode)
	}
	var promos forgePromotions
	if err := json.NewDecoder(resp.Body).Decode(&promos); err != nil {
		return nil, fmt.Errorf("decode forge promotions: %w", err)
	}
	baseURL := "https://maven.minecraftforge.net/net/minecraftforge/forge"
	var list []ForgeVersionEntry
	for key, build := range promos.Promos {
		build = strings.TrimSpace(build)
		if build == "" {
			continue
		}
		m := releaseRecommendedRegex.FindStringSubmatch(key)
		if m == nil {
			continue
		}
		mcVer := m[1]
		full := mcVer + "-" + build
		installerURL := fmt.Sprintf("%s/%s/forge-%s-installer.jar", baseURL, full, full)
		list = append(list, ForgeVersionEntry{
			MCVersion:    mcVer,
			ForgeBuild:   build,
			FullVersion:  full,
			InstallerURL: installerURL,
		})
	}
	// Sort by MC version descending (newest first: 1.21.11, 1.21.10, ..., 1.7.2)
	for i := 0; i < len(list); i++ {
		for j := i + 1; j < len(list); j++ {
			if mcVersionGreater(list[j].MCVersion, list[i].MCVersion) {
				list[i], list[j] = list[j], list[i]
			}
		}
	}
	return list, nil
}

// ResolveForgeInstallerURL returns the installer jar URL and full version (mc-forgeBuild) for the
// given Minecraft version. Uses the recommended (stable) Forge build for that MC version.
func ResolveForgeInstallerURL(mcVersion string) (installerURL, fullVersion string, err error) {
	mcVersion = strings.TrimSpace(mcVersion)
	if mcVersion == "" {
		return "", "", fmt.Errorf("minecraft version is required for Forge")
	}
	list, err := GetForgeReleaseVersions()
	if err != nil {
		return "", "", err
	}
	for _, e := range list {
		if e.MCVersion == mcVersion {
			return e.InstallerURL, e.FullVersion, nil
		}
	}
	return "", "", fmt.Errorf("no recommended Forge build for Minecraft %s", mcVersion)
}
