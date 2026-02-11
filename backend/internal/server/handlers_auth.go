package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/example/proxmox-game-deployer/internal/auth"
)

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type meResponse struct {
	Username string `json:"username"`
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
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	if err := auth.VerifyPassword(hash, req.Password); err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	sess, err := auth.CreateSession(r.Context(), s.DB, u.ID, 24*time.Hour)
	if err != nil {
		http.Error(w, "could not create session", http.StatusInternalServerError)
		return
	}
	setSessionCookie(w, sess.ID, sess.ExpiresAt)
	writeJSON(w, http.StatusOK, meResponse{Username: u.Username})
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

// handleMe returns info about current user.
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request, u *auth.User) {
	writeJSON(w, http.StatusOK, meResponse{Username: u.Username})
}

