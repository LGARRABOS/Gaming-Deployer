package hytale

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	oauthTokenURL     = "https://oauth.accounts.hytale.com/oauth2/token"
	oauthDeviceAuth   = "https://oauth.accounts.hytale.com/oauth2/device/auth"
	accountProfiles   = "https://account-data.hytale.com/my-account/get-profiles"
	gameSessionNew    = "https://sessions.hytale.com/game-session/new"
	oauthClientID     = "hytale-server"
	oauthScope        = "openid offline auth:server"
)

// DeviceAuthResponse is the response from the device authorization endpoint.
type DeviceAuthResponse struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	ExpiresIn       int    `json:"expires_in"`
	Interval        int    `json:"interval"`
}

// TokenResponse is the OAuth token response.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
}

// ProfilesResponse is the response from get-profiles.
type ProfilesResponse struct {
	Profiles []struct {
		UUID     string `json:"uuid"`
		Username string `json:"username"`
	} `json:"profiles"`
}

// SessionResponse is the response from game-session/new.
type SessionResponse struct {
	SessionToken  string `json:"sessionToken"`
	IdentityToken string `json:"identityToken"`
	ExpiresAt     string `json:"expiresAt"`
}

// SessionTokens holds the tokens needed to start a Hytale server.
type SessionTokens struct {
	SessionToken  string
	IdentityToken string
}

// DeviceAuthResult holds the result of StartDeviceAuth for the client to display and poll.
type DeviceAuthResult struct {
	VerificationURL string
	UserCode       string
	DeviceCode     string // used by PollForToken
}

// StartDeviceAuth initiates the OAuth device code flow.
func StartDeviceAuth(ctx context.Context) (*DeviceAuthResult, error) {
	form := url.Values{}
	form.Set("client_id", oauthClientID)
	form.Set("scope", oauthScope)

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
		return nil, fmt.Errorf("device auth failed: %s", string(body))
	}

	var dev DeviceAuthResponse
	if err := json.Unmarshal(body, &dev); err != nil {
		return nil, err
	}

	verificationURL := dev.VerificationURI
	if dev.VerificationURI != "" && dev.UserCode != "" {
		verificationURL = dev.VerificationURI + "?user_code=" + dev.UserCode
	}
	return &DeviceAuthResult{
		VerificationURL: verificationURL,
		UserCode:        dev.UserCode,
		DeviceCode:      dev.DeviceCode,
	}, nil
}

// ErrAuthPending is returned when the user has not yet completed authorization.
var ErrAuthPending = fmt.Errorf("authorization pending")

// PollForTokenOnce does a single poll of the token endpoint.
// Returns refreshToken on success, ErrAuthPending if user hasn't authorized yet, or an error.
func PollForTokenOnce(ctx context.Context, deviceCode string) (refreshToken string, err error) {
	form := url.Values{}
	form.Set("client_id", oauthClientID)
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
		return "", fmt.Errorf("authorization failed: %s", errResp.Error)
	default:
		return "", fmt.Errorf("token request failed: %s", string(body))
	}
}

// PollForToken polls the token endpoint until the user completes authorization.
// Returns the refresh_token. Caller should store it via config.SaveHytaleOAuth.
func PollForToken(ctx context.Context, deviceCode string) (refreshToken string, err error) {
	interval := 5
	for {
		tok, err := PollForTokenOnce(ctx, deviceCode)
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
			// continue
		}
	}
}

// RefreshAndCreateSession uses a refresh token to obtain session tokens for the server.
// The refreshToken and profileUUID should be loaded from config by the caller.
func RefreshAndCreateSession(ctx context.Context, refreshToken, profileUUID string) (*SessionTokens, error) {
	if refreshToken == "" {
		return nil, fmt.Errorf("Hytale OAuth not configured: authenticate at /hytale/auth first")
	}

	// Refresh access token
	form := url.Values{}
	form.Set("client_id", oauthClientID)
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refreshToken)

	req, err := http.NewRequestWithContext(ctx, "POST", oauthTokenURL, strings.NewReader(form.Encode()))
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
		return nil, fmt.Errorf("token refresh failed: %s", string(body))
	}

	var tok TokenResponse
	if err := json.Unmarshal(body, &tok); err != nil {
		return nil, err
	}
	if tok.AccessToken == "" {
		return nil, fmt.Errorf("no access token in refresh response")
	}

	// Get profiles if profileUUID not specified
	uuid := profileUUID
	if uuid == "" {
		profiles, err := getProfiles(ctx, tok.AccessToken)
		if err != nil {
			return nil, err
		}
		if len(profiles) == 0 {
			return nil, fmt.Errorf("no Hytale profiles found")
		}
		uuid = profiles[0].UUID
	}

	// Create game session
	session, err := createGameSession(ctx, tok.AccessToken, uuid)
	if err != nil {
		return nil, err
	}

	return &SessionTokens{
		SessionToken:  session.SessionToken,
		IdentityToken: session.IdentityToken,
	}, nil
}

func getProfiles(ctx context.Context, accessToken string) ([]struct{ UUID, Username string }, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", accountProfiles, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("get profiles failed: %s", string(body))
	}

	var pr ProfilesResponse
	if err := json.Unmarshal(body, &pr); err != nil {
		return nil, err
	}

	result := make([]struct{ UUID, Username string }, len(pr.Profiles))
	for i, p := range pr.Profiles {
		result[i] = struct{ UUID, Username string }{UUID: p.UUID, Username: p.Username}
	}
	return result, nil
}

func createGameSession(ctx context.Context, accessToken, profileUUID string) (*SessionResponse, error) {
	payload := map[string]string{"uuid": profileUUID}
	jsonBody, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, "POST", gameSessionNew, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("create session failed: %s", string(body))
	}

	var sess SessionResponse
	if err := json.Unmarshal(body, &sess); err != nil {
		return nil, err
	}
	return &sess, nil
}
