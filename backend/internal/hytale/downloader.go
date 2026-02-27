package hytale

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/example/proxmox-game-deployer/internal/config"
)

const (
	downloaderClientID   = "hytale-downloader"
	downloaderScope      = "openid offline auth:downloader"
	downloaderBaseURL    = "https://downloader.hytale.com"
	accountDataBaseURL   = "https://account-data.hytale.com"
	defaultDownloaderDir = "/opt/proxmox-game-deployer/hytale-server-files"
)

// DefaultHytaleServerFilesDir returns the default cache directory for Hytale server files.
func DefaultHytaleServerFilesDir() string {
	return defaultDownloaderDir
}

// downloaderManifest matches the version manifest served by downloader.hytale.com.
type downloaderManifest struct {
	Version string `json:"version"`
	SHA256  string `json:"sha256"`
}

// downloaderSignedURL is the response from account-data.hytale.com/game-assets/{patchline}.
type downloaderSignedURL struct {
	URL string `json:"url"`
}

// EnsureServerFiles guarantees that Hytale server files (notably HytaleServer.jar)
// are present in cacheDir on the Proxmox Game Deployer host. It will:
//   - obtain/refresh OAuth credentials for the hytale-downloader client
//   - fetch the latest manifest + signed download URL
//   - download the game zip, validate its SHA256 and extract it into cacheDir.
//
// It stores the long‑lived refresh token in the settings table via config.SaveHytaleDownloader.
func EnsureServerFiles(ctx context.Context, db config.Store, cacheDir string) error {
	if cacheDir == "" {
		cacheDir = defaultDownloaderDir
	}
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return fmt.Errorf("ensure hytale cache dir: %w", err)
	}

	jarPath := filepath.Join(cacheDir, "HytaleServer.jar")
	if _, err := os.Stat(jarPath); err == nil {
		// Files already present.
		return nil
	}

	accessToken, newRefresh, err := getDownloaderAccessToken(ctx, db)
	if err != nil {
		return fmt.Errorf("hytale downloader auth: %w", err)
	}
	if newRefresh != "" {
		_ = config.SaveHytaleDownloader(ctx, db, config.HytaleDownloaderCredentials{
			RefreshToken: newRefresh,
		})
	}

	patchline := os.Getenv("HYTALE_PATCHLINE")
	if patchline == "" {
		patchline = "release"
	}

	manifest, err := fetchDownloaderManifest(ctx, patchline)
	if err != nil {
		return fmt.Errorf("hytale downloader manifest: %w", err)
	}
	signedURL, err := fetchSignedGameAssetsURL(ctx, accessToken, patchline)
	if err != nil {
		return fmt.Errorf("hytale downloader signed url: %w", err)
	}

	zipPath := filepath.Join(cacheDir, "hytale-server.zip")
	if err := downloadFile(ctx, signedURL, zipPath); err != nil {
		return fmt.Errorf("hytale downloader download: %w", err)
	}

	if manifest.SHA256 != "" {
		if err := verifySHA256(zipPath, manifest.SHA256); err != nil {
			return fmt.Errorf("hytale downloader checksum: %w", err)
		}
	}

	if err := unzipFile(zipPath, cacheDir); err != nil {
		return fmt.Errorf("hytale downloader unzip: %w", err)
	}

	if _, err := os.Stat(jarPath); err != nil {
		return fmt.Errorf("HytaleServer.jar not found in %s after download", cacheDir)
	}
	return nil
}

// getDownloaderAccessToken obtains an access token for the hytale-downloader client,
// using a stored refresh token when available, or performing a device code flow
// otherwise.
func getDownloaderAccessToken(ctx context.Context, db config.Store) (accessToken string, newRefresh string, err error) {
	creds, err := config.LoadHytaleDownloader(ctx, db)
	if err != nil {
		return "", "", err
	}
	if creds != nil && creds.RefreshToken != "" {
		return refreshDownloaderAccessToken(ctx, creds.RefreshToken)
	}

	// No stored token: perform a fresh device auth flow.
	dev, err := StartDownloaderDeviceAuth(ctx)
	if err != nil {
		return "", "", err
	}
	// Log instructions to the server logs; the operator can copy/paste the URL and code.
	log.Printf("Hytale downloader auth required. Visit: %s Code: %s", dev.VerificationURL, dev.UserCode)

	refreshToken, err := pollDownloaderToken(ctx, dev.DeviceCode)
	if err != nil {
		return "", "", err
	}
	// Persist refresh token immediately.
	if err := config.SaveHytaleDownloader(ctx, db, config.HytaleDownloaderCredentials{RefreshToken: refreshToken}); err != nil {
		return "", "", err
	}
	return refreshDownloaderAccessToken(ctx, refreshToken)
}

// StartDownloaderDeviceAuth starts the device authorization for the hytale-downloader client.
func StartDownloaderDeviceAuth(ctx context.Context) (*DeviceAuthResult, error) {
	form := url.Values{}
	form.Set("client_id", downloaderClientID)
	form.Set("scope", downloaderScope)

	req, err := http.NewRequestWithContext(ctx, "POST", oauthDeviceAuth, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("downloader device auth failed: %s", string(body))
	}

	var dev DeviceAuthResponse
	if err := json.Unmarshal(body, &dev); err != nil {
		return nil, err
	}

	verificationURL := dev.VerificationURIComplete
	if verificationURL == "" && dev.VerificationURI != "" && dev.UserCode != "" {
		verificationURL = dev.VerificationURI + "?user_code=" + dev.UserCode
	}
	if verificationURL == "" {
		verificationURL = dev.VerificationURI
	}
	interval := dev.Interval
	if interval <= 0 {
		interval = 5
	}
	return &DeviceAuthResult{
		VerificationURL: verificationURL,
		UserCode:        dev.UserCode,
		DeviceCode:      dev.DeviceCode,
		Interval:        interval,
	}, nil
}

// pollDownloaderToken mirrors PollForToken but uses the downloader client_id.
func pollDownloaderToken(ctx context.Context, deviceCode string) (refreshToken string, err error) {
	interval := 5
	for {
		tok, err := PollDownloaderTokenOnce(ctx, deviceCode)
		if err == nil {
			return tok, nil
		}
		if err != ErrAuthPending {
			return "", err
		}

		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(time.Duration(interval) * time.Second):
		}
	}
}

// PollDownloaderTokenOnce checks once for token after user authorizes (for HTTP polling).
func PollDownloaderTokenOnce(ctx context.Context, deviceCode string) (string, error) {
	form := url.Values{}
	form.Set("client_id", downloaderClientID)
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
	form.Set("device_code", deviceCode)

	req, err := http.NewRequestWithContext(ctx, "POST", oauthTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}

	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	var errResp struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(body, &errResp)

	if resp.StatusCode == http.StatusOK {
		var tok TokenResponse
		if err := json.Unmarshal(body, &tok); err != nil {
			return "", err
		}
		if tok.RefreshToken != "" {
			return tok.RefreshToken, nil
		}
	}

	switch errResp.Error {
	case "authorization_pending", "slow_down":
		return "", ErrAuthPending
	case "expired_token", "access_denied":
		return "", fmt.Errorf("downloader authorization failed: %s", errResp.Error)
	default:
		return "", fmt.Errorf("downloader token request failed: %s", string(body))
	}
}

// refreshDownloaderAccessToken exchanges a refresh token for an access token.
// It also returns a possibly rotated refresh token.
func refreshDownloaderAccessToken(ctx context.Context, refreshToken string) (accessToken string, newRefresh string, err error) {
	if refreshToken == "" {
		return "", "", fmt.Errorf("empty downloader refresh token")
	}

	form := url.Values{}
	form.Set("client_id", downloaderClientID)
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refreshToken)

	req, err := http.NewRequestWithContext(ctx, "POST", oauthTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("downloader token refresh failed: %s", string(body))
	}

	var tok TokenResponse
	if err := json.Unmarshal(body, &tok); err != nil {
		return "", "", err
	}
	if tok.AccessToken == "" {
		return "", "", fmt.Errorf("no access token in downloader refresh response")
	}

	newRefresh = refreshToken
	if tok.RefreshToken != "" {
		newRefresh = tok.RefreshToken
	}
	return tok.AccessToken, newRefresh, nil
}

func fetchDownloaderManifest(ctx context.Context, patchline string) (*downloaderManifest, error) {
	url := fmt.Sprintf("%s/version/%s.json", downloaderBaseURL, patchline)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("manifest request failed: %s: %s", resp.Status, string(body))
	}
	var m downloaderManifest
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		return nil, err
	}
	return &m, nil
}

func fetchSignedGameAssetsURL(ctx context.Context, accessToken, patchline string) (string, error) {
	url := fmt.Sprintf("%s/game-assets/%s", accountDataBaseURL, patchline)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	if accessToken != "" {
		req.Header.Set("Authorization", "Bearer "+accessToken)
	}
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("signed URL request failed: %s: %s", resp.Status, string(body))
	}
	var out downloaderSignedURL
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if out.URL == "" {
		return "", fmt.Errorf("empty signed URL in response")
	}
	return out.URL, nil
}

func downloadFile(ctx context.Context, url, destPath string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 0} // large files; rely on ctx for cancellation
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("download failed: %s: %s", resp.Status, string(body))
	}

	tmpPath := destPath + ".tmp"
	f, err := os.Create(tmpPath)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		_ = os.Remove(tmpPath)
		return err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return os.Rename(tmpPath, destPath)
}

func verifySHA256(path, expected string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	sum := h.Sum(nil)
	got := hex.EncodeToString(sum)
	if !strings.EqualFold(got, expected) {
		return fmt.Errorf("checksum mismatch: expected %s, got %s", expected, got)
	}
	return nil
}

func unzipFile(zipPath, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		targetPath := filepath.Join(destDir, f.Name)
		// Prevent directory traversal attacks.
		if !strings.HasPrefix(targetPath, filepath.Clean(destDir)+string(os.PathSeparator)) {
			return fmt.Errorf("illegal file path in zip: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(targetPath, f.Mode()); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			rc.Close()
			return err
		}
		if _, err := io.Copy(out, rc); err != nil {
			rc.Close()
			out.Close()
			return err
		}
		rc.Close()
		if err := out.Close(); err != nil {
			return err
		}
	}
	return nil
}

