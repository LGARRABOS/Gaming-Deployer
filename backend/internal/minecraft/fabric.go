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

const fabricMetaBase = "https://meta.fabricmc.net/v2"

var fabricGameVersionRegex = regexp.MustCompile(`^1\.\d+\.\d+$`) // only 1.x.y release

type fabricGameEntry struct {
	Version string `json:"version"`
	Stable  bool   `json:"stable"`
}

type fabricLoaderEntry struct {
	Loader struct {
		Version string `json:"version"`
		Stable  bool   `json:"stable"`
	} `json:"loader"`
}

type fabricInstallerEntry struct {
	URL     string `json:"url"`
	Version string `json:"version"`
	Stable  bool   `json:"stable"`
}

// FabricVersionEntry is one Fabric (game + loader) combo for the API/list.
type FabricVersionEntry struct {
	MCVersion    string `json:"mc_version"`
	LoaderVersion string `json:"loader_version"`
	FullVersion  string `json:"full_version"` // e.g. "1.21.1 (Fabric 0.18.4)"
}

// GetFabricReleaseVersions fetches Fabric meta and returns stable game versions
// with their latest stable loader (1.x.y only). Sorted newest first.
func GetFabricReleaseVersions() ([]FabricVersionEntry, error) {
	client := &http.Client{Timeout: 15 * time.Second}

	// Fetch game versions
	resp, err := client.Get(fabricMetaBase + "/versions/game")
	if err != nil {
		return nil, fmt.Errorf("fetch fabric game versions: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fabric game versions returned %d", resp.StatusCode)
	}
	var games []fabricGameEntry
	if err := json.NewDecoder(resp.Body).Decode(&games); err != nil {
		return nil, fmt.Errorf("decode fabric game versions: %w", err)
	}

	// Filter: stable, 1.x.y only
	var list []FabricVersionEntry
	for _, g := range games {
		if !g.Stable || !fabricGameVersionRegex.MatchString(g.Version) {
			continue
		}
		loaderVer, err := getLatestStableLoaderForGame(client, g.Version)
		if err != nil {
			continue
		}
		list = append(list, FabricVersionEntry{
			MCVersion:     g.Version,
			LoaderVersion: loaderVer,
			FullVersion:   g.Version + " (Fabric " + loaderVer + ")",
		})
	}

	// Sort by MC version descending (newest first)
	for i := 0; i < len(list); i++ {
		for j := i + 1; j < len(list); j++ {
			if fabricMCVersionGreater(list[j].MCVersion, list[i].MCVersion) {
				list[i], list[j] = list[j], list[i]
			}
		}
	}
	return list, nil
}

func getLatestStableLoaderForGame(client *http.Client, gameVersion string) (string, error) {
	url := fabricMetaBase + "/versions/loader/" + gameVersion
	resp, err := client.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("loader list %d", resp.StatusCode)
	}
	var loaders []fabricLoaderEntry
	if err := json.NewDecoder(resp.Body).Decode(&loaders); err != nil {
		return "", err
	}
	for _, l := range loaders {
		if l.Loader.Stable {
			return l.Loader.Version, nil
		}
	}
	if len(loaders) > 0 {
		return loaders[0].Loader.Version, nil
	}
	return "", fmt.Errorf("no loader for game %s", gameVersion)
}

// ResolveFabricInstallerParams returns installer jar URL and loader version for the given MC version.
func ResolveFabricInstallerParams(mcVersion string) (installerURL, loaderVersion string, err error) {
	mcVersion = strings.TrimSpace(mcVersion)
	if mcVersion == "" {
		return "", "", fmt.Errorf("minecraft version is required for Fabric")
	}
	client := &http.Client{Timeout: 15 * time.Second}
	loaderVersion, err = getLatestStableLoaderForGame(client, mcVersion)
	if err != nil {
		return "", "", fmt.Errorf("loader for %s: %w", mcVersion, err)
	}
	installerURL, err = getLatestStableInstallerURL(client)
	if err != nil {
		return "", "", fmt.Errorf("fabric installer: %w", err)
	}
	return installerURL, loaderVersion, nil
}

func getLatestStableInstallerURL(client *http.Client) (string, error) {
	resp, err := client.Get(fabricMetaBase + "/versions/installer")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("installer list %d", resp.StatusCode)
	}
	var installers []fabricInstallerEntry
	if err := json.NewDecoder(resp.Body).Decode(&installers); err != nil {
		return "", err
	}
	for _, i := range installers {
		if i.Stable && i.URL != "" {
			return i.URL, nil
		}
	}
	if len(installers) > 0 {
		return installers[0].URL, nil
	}
	return "", fmt.Errorf("no fabric installer found")
}

// mcVersionGreater is in forge.go; we reuse for Fabric sorting.
// Exported there, so we use the same function - but fabric.go can't call forge.go's private.
// So we need to either duplicate the small helper here or put it in a shared place.
func fabricMCVersionGreater(a, b string) bool {
	va := parseFabricMCVersion(a)
	vb := parseFabricMCVersion(b)
	if va == nil || vb == nil {
		return a > b
	}
	for i := 0; i < len(va) && i < len(vb); i++ {
		if va[i] != vb[i] {
			return va[i] > vb[i]
		}
	}
	return len(va) > len(vb)
}

func parseFabricMCVersion(s string) []int {
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
