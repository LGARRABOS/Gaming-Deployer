package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

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

// handleTestCurseForgeAPIKey tests the currently stored CurseForge API key by issuing a small search.
func (s *Server) handleTestCurseForgeAPIKey(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	cf, err := s.curseForgeClientFromSettings(r)
	if err != nil {
		var ue userError
		if errors.As(err, &ue) {
			writeJSON(w, http.StatusOK, genericOKResponse{OK: false, Error: ue.Error()})
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}
	if _, err := cf.SearchModpacks(ctx, "all", 1); err != nil {
		writeJSON(w, http.StatusOK, genericOKResponse{OK: false, Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, genericOKResponse{OK: true})
}

