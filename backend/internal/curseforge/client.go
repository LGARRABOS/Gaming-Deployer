package curseforge

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const baseURL = "https://api.curseforge.com"

type Client struct {
	apiKey string
	http   *http.Client
}

func New(apiKey string) *Client {
	return &Client{
		apiKey: apiKey,
		http:   &http.Client{Timeout: 20 * time.Second},
	}
}

func (c *Client) doJSON(ctx context.Context, method, path string, query url.Values, out any) error {
	u := baseURL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if c.apiKey != "" {
		req.Header.Set("x-api-key", c.apiKey)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("curseforge %s %s returned %d", method, path, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// SearchModpacks searches Minecraft modpacks by name/author text.
// Uses gameId 432 (Minecraft) and classId 4471 (Modpacks).
func (c *Client) SearchModpacks(ctx context.Context, search string, pageSize int) ([]Modpack, error) {
	if pageSize <= 0 || pageSize > 50 {
		pageSize = 20
	}
	q := url.Values{}
	q.Set("gameId", "432")
	q.Set("classId", "4471")
	q.Set("searchFilter", search)
	q.Set("pageSize", strconv.Itoa(pageSize))

	var res struct {
		Data []Modpack `json:"data"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/v1/mods/search", q, &res); err != nil {
		return nil, err
	}
	return res.Data, nil
}

// ListFiles lists files for a given modpack project.
func (c *Client) ListFiles(ctx context.Context, modID int, pageSize int) ([]File, error) {
	if pageSize <= 0 || pageSize > 50 {
		pageSize = 50
	}
	q := url.Values{}
	q.Set("pageSize", strconv.Itoa(pageSize))
	var res struct {
		Data []File `json:"data"`
	}
	if err := c.doJSON(ctx, http.MethodGet, fmt.Sprintf("/v1/mods/%d/files", modID), q, &res); err != nil {
		return nil, err
	}
	return res.Data, nil
}

// GetFile returns file details.
func (c *Client) GetFile(ctx context.Context, modID, fileID int) (*File, error) {
	var res struct {
		Data File `json:"data"`
	}
	if err := c.doJSON(ctx, http.MethodGet, fmt.Sprintf("/v1/mods/%d/files/%d", modID, fileID), nil, &res); err != nil {
		return nil, err
	}
	return &res.Data, nil
}

// GetDownloadURL returns a direct download URL for a file when available.
// If the endpoint is not available, fallbackURL is the API download endpoint (may redirect).
func (c *Client) GetDownloadURL(ctx context.Context, modID, fileID int) (directURL string, fallbackURL string, err error) {
	var res struct {
		Data string `json:"data"`
	}
	// Newer API usually supports /download-url (returns direct edge URL).
	if err := c.doJSON(ctx, http.MethodGet, fmt.Sprintf("/v1/mods/%d/files/%d/download-url", modID, fileID), nil, &res); err == nil {
		if res.Data != "" {
			return res.Data, fmt.Sprintf("%s/v1/mods/%d/files/%d/download", baseURL, modID, fileID), nil
		}
	}
	// Fallback to /download endpoint (redirect).
	return "", fmt.Sprintf("%s/v1/mods/%d/files/%d/download", baseURL, modID, fileID), nil
}

