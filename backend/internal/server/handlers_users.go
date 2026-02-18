package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/example/proxmox-game-deployer/internal/auth"
)

type createUserRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type updateUserRoleRequest struct {
	Role string `json:"role"` // admin | user
}

type userResponse struct {
	ID        int64  `json:"id"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at"`
}

// handleListUsers returns all users (admin or owner; utilisé pour la liste et pour l'assignation des serveurs).
func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	u := s.mustUser(r)
	if u == nil || (u.Role != auth.RoleOwner && u.Role != auth.RoleAdmin) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	list, err := auth.ListUsers(r.Context(), s.DB)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	out := make([]userResponse, len(list))
	for i := range list {
		out[i] = userResponse{
			ID:        list[i].ID,
			Username:  list[i].Username,
			Role:      list[i].Role,
			CreatedAt: list[i].CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// handleCreateUser creates a new user with role "user" (owner only).
func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	u := s.mustUser(r)
	if u == nil || u.Role != auth.RoleOwner {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	var req createUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if req.Username == "" || req.Password == "" {
		http.Error(w, "username and password required", http.StatusBadRequest)
		return
	}
	newUser, err := auth.CreateUser(r.Context(), s.DB, req.Username, req.Password, auth.RoleUser)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, userResponse{
		ID:        newUser.ID,
		Username:  newUser.Username,
		Role:      newUser.Role,
		CreatedAt: newUser.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	})
}

// handleUpdateUserRole sets a user's role to admin or user (owner only).
func (s *Server) handleUpdateUserRole(w http.ResponseWriter, r *http.Request) {
	u := s.mustUser(r)
	if u == nil || u.Role != auth.RoleOwner {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var req updateUserRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if err := auth.UpdateUserRole(r.Context(), s.DB, id, req.Role); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "user not found", http.StatusNotFound)
			return
		}
		if err.Error() == "invalid role" {
			http.Error(w, "invalid role", http.StatusBadRequest)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, genericOKResponse{OK: true})
}

// mustUser returns the current user from context or nil (caller must check).
func (s *Server) mustUser(r *http.Request) *auth.User {
	val := r.Context().Value(userContextKey)
	u, _ := val.(*auth.User)
	return u
}
