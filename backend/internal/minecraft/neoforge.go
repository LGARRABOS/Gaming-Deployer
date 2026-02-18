package minecraft

import (
	"encoding/xml"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const neoForgeMetadataURL = "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml"

// neoForgeMetadata mirrors the relevant parts of maven-metadata.xml.
type neoForgeMetadata struct {
	Versioning struct {
		Versions struct {
			Versions []string `xml:"version"`
		} `xml:"versions"`
	} `xml:"versioning"`
}

// ResolveNeoForgeInstallerURL returns the NeoForge installer JAR URL and full NeoForge
// version for a given Minecraft version (e.g. "1.20.6" -> "20.6.XX").
// It chooses the highest stable NeoForge patch version for that MC version.
func ResolveNeoForgeInstallerURL(mcVersion string) (installerURL, fullVersion string, err error) {
	mcVersion = strings.TrimSpace(mcVersion)
	if mcVersion == "" {
		return "", "", fmt.Errorf("minecraft version is required for NeoForge")
	}
	parts := strings.Split(mcVersion, ".")
	if len(parts) < 3 || parts[0] != "1" {
		return "", "", fmt.Errorf("unsupported Minecraft version for NeoForge: %s", mcVersion)
	}
	// For 1.A.B we look for NeoForge versions starting with "A.B."
	prefix := parts[1] + "." + parts[2] + "."

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(neoForgeMetadataURL)
	if err != nil {
		return "", "", fmt.Errorf("fetch neoforge metadata: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("neoforge metadata returned %d", resp.StatusCode)
	}
	var meta neoForgeMetadata
	if err := xml.NewDecoder(resp.Body).Decode(&meta); err != nil {
		return "", "", fmt.Errorf("decode neoforge metadata: %w", err)
	}

	bestVersion := ""
	bestPatch := -1
	for _, v := range meta.Versioning.Versions.Versions {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		// Skip pre-releases / betas for now.
		if strings.Contains(v, "-") {
			continue
		}
		if !strings.HasPrefix(v, prefix) {
			continue
		}
		patchPart := strings.TrimPrefix(v, prefix)
		patch, err := strconv.Atoi(patchPart)
		if err != nil {
			continue
		}
		if patch > bestPatch {
			bestPatch = patch
			bestVersion = v
		}
	}
	if bestVersion == "" {
		return "", "", fmt.Errorf("no NeoForge build found for Minecraft %s", mcVersion)
	}

	base := "https://maven.neoforged.net/releases/net/neoforged/neoforge"
	installerURL = fmt.Sprintf("%s/%s/neoforge-%s-installer.jar", base, bestVersion, bestVersion)
	return installerURL, bestVersion, nil
}

