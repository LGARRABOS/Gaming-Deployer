package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/example/proxmox-game-deployer/internal/auth"
	"github.com/example/proxmox-game-deployer/internal/config"
	"github.com/example/proxmox-game-deployer/internal/proxmox"
)

type statusResponse struct {
	Initialized bool `json:"initialized"`
}

// handleStatus returns basic app status.
func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	init, err := s.IsInitialized(ctx)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, statusResponse{Initialized: init})
}

// handleSetupStatus indicates whether the wizard must be run.
func (s *Server) handleSetupStatus(w http.ResponseWriter, r *http.Request) {
	s.handleStatus(w, r)
}

type testProxmoxRequest struct {
	APIURL         string   `json:"api_url"`
	APITokenID     string   `json:"api_token_id"`
	APITokenSecret string   `json:"api_token_secret"`
}

type genericOKResponse struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// handleTestProxmox tests Proxmox credentials.
func (s *Server) handleTestProxmox(w http.ResponseWriter, r *http.Request) {
	var req testProxmoxRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	cl, err := proxmox.NewClient(req.APIURL, req.APITokenID, req.APITokenSecret)
	if err != nil {
		writeJSON(w, http.StatusOK, genericOKResponse{OK: false, Error: err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if err := cl.TestConnection(ctx); err != nil {
		writeJSON(w, http.StatusOK, genericOKResponse{OK: false, Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, genericOKResponse{OK: true})
}

// initializeRequest contains wizard payload.
type initializeRequest struct {
	Proxmox config.ProxmoxConfig `json:"proxmox"`
	Admin   struct {
		Username string `json:"username"`
		Password string `json:"password"`
	} `json:"admin"`
}

// handleInitialize stores config & creates admin user.
func (s *Server) handleInitialize(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	initialized, err := s.IsInitialized(ctx)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if initialized {
		http.Error(w, "already initialized", http.StatusBadRequest)
		return
	}

	var req initializeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	if req.Admin.Username == "" || req.Admin.Password == "" {
		http.Error(w, "admin username/password required", http.StatusBadRequest)
		return
	}

	err = s.DB.WithTx(ctx, func(tx *sql.Tx) error {
		if err := config.SaveProxmoxConfig(ctx, tx, req.Proxmox); err != nil {
			return err
		}
		// Create admin user inside the same transaction.
		pwHash, err := auth.HashPassword(req.Admin.Password)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO users (username, password_hash, created_at)
			VALUES (?, ?, ?)
		`, req.Admin.Username, pwHash, time.Now().UTC()); err != nil {
			return err
		}
		if err := config.MarkInitialized(ctx, tx); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, genericOKResponse{OK: true})
}

// handleGetProxmoxConfig retourne la configuration actuelle stockée dans la DB.
// Nécessite une authentification (configurée dans http.go).
func (s *Server) handleGetProxmoxConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cfg, err := config.LoadProxmoxConfig(ctx, s.DB)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// On ne masque pas ici le secret, mais le frontend ne l'affiche pas
	// tant que l'utilisateur ne le modifie pas.
	writeJSON(w, http.StatusOK, cfg)
}

// updateConfigRequest contient la charge utile pour la mise à jour de
// la configuration Proxmox existante.
type updateConfigRequest struct {
	Proxmox config.ProxmoxConfig `json:"proxmox"`
}

// handleUpdateProxmoxConfig permet de mettre à jour la configuration
// Proxmox/SSH après le setup initial. Si le token secret est vide,
// l'ancien secret est conservé.
func (s *Server) handleUpdateProxmoxConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req updateConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	// Charger la config existante pour conserver le secret si non fourni.
	existing, err := config.LoadProxmoxConfig(ctx, s.DB)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if req.Proxmox.APITokenSecret == "" && existing != nil {
		req.Proxmox.APITokenSecret = existing.APITokenSecret
	}

	if err := config.SaveProxmoxConfig(ctx, s.DB, req.Proxmox); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, genericOKResponse{OK: true})
}

