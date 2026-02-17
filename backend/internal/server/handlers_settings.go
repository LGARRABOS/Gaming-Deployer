package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/example/proxmox-game-deployer/internal/config"
)

type curseForgeSettingsResponse struct {
	APIKeySet bool `json:"api_key_set"`
}

type curseForgeSettingsUpdateRequest struct {
	APIKey string `json:"api_key"`
}

// handleGetCurseForgeSettings reports whether a CurseForge API key is configured.
func (s *Server) handleGetCurseForgeSettings(w http.ResponseWriter, r *http.Request) {
	key, err := config.LoadCurseForgeAPIKey(r.Context(), s.DB)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, curseForgeSettingsResponse{APIKeySet: strings.TrimSpace(key) != ""})
}

// handleUpdateCurseForgeSettings stores/clears the CurseForge API key.
// If api_key is blank, the key is removed.
func (s *Server) handleUpdateCurseForgeSettings(w http.ResponseWriter, r *http.Request) {
	var req curseForgeSettingsUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if err := config.SaveCurseForgeAPIKey(r.Context(), s.DB, req.APIKey); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, genericOKResponse{OK: true})
}

