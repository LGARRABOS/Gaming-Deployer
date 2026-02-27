package server

import (
	"net/http"

	"github.com/example/proxmox-game-deployer/internal/config"
	"github.com/example/proxmox-game-deployer/internal/hytale"
)

// handleHytaleAuthDevice starts the OAuth device code flow.
func (s *Server) handleHytaleAuthDevice(w http.ResponseWriter, r *http.Request) {
	u := s.mustUser(r)
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if u.Role != "owner" && u.Role != "admin" {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	result, err := hytale.StartDeviceAuth(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"verification_url": result.VerificationURL,
		"user_code":        result.UserCode,
		"device_code":      result.DeviceCode,
	})
}

// handleHytaleAuthPoll polls for the token after user authorizes.
func (s *Server) handleHytaleAuthPoll(w http.ResponseWriter, r *http.Request) {
	u := s.mustUser(r)
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if u.Role != "owner" && u.Role != "admin" {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	deviceCode := r.URL.Query().Get("device_code")
	if deviceCode == "" {
		http.Error(w, "device_code required", http.StatusBadRequest)
		return
	}

	refreshToken, err := hytale.PollForTokenOnce(r.Context(), deviceCode)
	if err != nil {
		if err == hytale.ErrAuthPending {
			writeJSON(w, http.StatusAccepted, map[string]any{"status": "pending"})
			return
		}
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Get profile UUID (optional - can be empty, we'll pick first at deploy time)
	tokens, err := hytale.RefreshAndCreateSession(r.Context(), refreshToken, "")
	if err != nil {
		http.Error(w, "failed to create session: "+err.Error(), http.StatusInternalServerError)
		return
	}
	_ = tokens // we have valid auth

	creds := config.HytaleOAuthCredentials{
		RefreshToken: refreshToken,
		ProfileUUID:  "", // will be auto-selected at deploy
	}
	if err := config.SaveHytaleOAuth(r.Context(), s.DB, creds); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleHytaleAuthStatus returns whether Hytale OAuth is configured.
func (s *Server) handleHytaleAuthStatus(w http.ResponseWriter, r *http.Request) {
	u := s.mustUser(r)
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	creds, err := config.LoadHytaleOAuth(r.Context(), s.DB)
	configured := err == nil && creds != nil && creds.RefreshToken != ""
	writeJSON(w, http.StatusOK, map[string]any{"configured": configured})
}

// handleHytaleAuthDelete removes stored Hytale OAuth credentials.
func (s *Server) handleHytaleAuthDelete(w http.ResponseWriter, r *http.Request) {
	u := s.mustUser(r)
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if u.Role != "owner" && u.Role != "admin" {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	if err := config.DeleteHytaleOAuth(r.Context(), s.DB); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
