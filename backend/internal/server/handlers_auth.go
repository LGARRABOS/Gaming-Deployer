package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/example/proxmox-game-deployer/internal/auth"
	"github.com/example/proxmox-game-deployer/internal/config"
)

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type registerRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type meResponse struct {
	Username string `json:"username"`
	Role     string `json:"role"` // owner, admin, user
}

// handleLogin authenticates and sets a session cookie.
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	u, hash, err := auth.GetUserByUsername(r.Context(), s.DB, req.Username)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "Identifiants incorrects"})
		return
	}
	if err := auth.VerifyPassword(hash, req.Password); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "Identifiants incorrects"})
		return
	}
	sess, err := auth.CreateSession(r.Context(), s.DB, u.ID, 24*time.Hour)
	if err != nil {
		http.Error(w, "could not create session", http.StatusInternalServerError)
		return
	}
	setSessionCookie(w, sess.ID, sess.ExpiresAt)
	writeJSON(w, http.StatusOK, meResponse{Username: u.Username, Role: u.Role})
}

// handleLogout deletes the current session.
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	sess, err := s.getSessionFromRequest(r)
	if err == nil {
		_ = auth.DeleteSession(r.Context(), s.DB, sess.ID)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "session_id",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})
	w.WriteHeader(http.StatusNoContent)
}

// handleMe returns info about current user (including role).
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request, u *auth.User) {
	writeJSON(w, http.StatusOK, meResponse{Username: u.Username, Role: u.Role})
}

// handleRegister allows anyone to create a new account (role "user"). Only available once the app is initialized.
func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	initialized, err := config.IsInitialized(ctx, s.DB)
	if err != nil || !initialized {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Application non initialisée"})
		return
	}
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	username := strings.TrimSpace(req.Username)
	if username == "" || len(req.Password) < 6 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Nom d'utilisateur requis et mot de passe d'au moins 6 caractères"})
		return
	}
	_, err = auth.CreateUser(ctx, s.DB, username, req.Password, auth.RoleUser)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") || strings.Contains(err.Error(), "unique") {
			writeJSON(w, http.StatusConflict, map[string]any{"error": "Ce nom d'utilisateur est déjà pris"})
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "message": "Compte créé. Connectez-vous."})
}

