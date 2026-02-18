package server

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/example/proxmox-game-deployer/internal/auth"
)

type contextKey string

const userContextKey contextKey = "user"

// AuthMiddleware ensures the user is authenticated.
func (s *Server) AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session, err := s.getSessionFromRequest(r)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		row := s.DB.QueryRowContext(r.Context(), `
			SELECT id, username, COALESCE(role, 'user'), created_at
			FROM users
			WHERE id = ?
		`, session.UserID)
		var u auth.User
		if err := row.Scan(&u.ID, &u.Username, &u.Role, &u.CreatedAt); err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), userContextKey, &u)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// withAuth is a small helper for auth-required handlers in the same package.
func (s *Server) withAuth(fn func(w http.ResponseWriter, r *http.Request, u *auth.User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		val := r.Context().Value(userContextKey)
		u, ok := val.(*auth.User)
		if !ok || u == nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		fn(w, r, u)
	}
}

// requireOwner wraps a handler and returns 403 if the current user is not owner.
func (s *Server) requireOwner(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		val := r.Context().Value(userContextKey)
		u, ok := val.(*auth.User)
		if !ok || u == nil || u.Role != auth.RoleOwner {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// requireAdminOrOwner returns 403 if the current user is not admin or owner.
func (s *Server) requireAdminOrOwner(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		val := r.Context().Value(userContextKey)
		u, ok := val.(*auth.User)
		if !ok || u == nil || (u.Role != auth.RoleOwner && u.Role != auth.RoleAdmin) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// requireCanDeploy returns 403 if the user cannot deploy (only owner and admin can).
func (s *Server) requireCanDeploy(next http.Handler) http.Handler {
	return s.requireAdminOrOwner(next)
}

// serverAccessMiddleware ensures that a user with role "user" can only access servers assigned to them.
// Must be used on routes that have {id} (deployment id). Place after AuthMiddleware.
func (s *Server) serverAccessMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		val := r.Context().Value(userContextKey)
		u, ok := val.(*auth.User)
		if !ok || u == nil {
			next.ServeHTTP(w, r)
			return
		}
		if u.Role == auth.RoleOwner || u.Role == auth.RoleAdmin {
			next.ServeHTTP(w, r)
			return
		}
		idStr := chi.URLParam(r, "id")
		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}
		var assignedTo sql.NullInt64
		err = s.DB.QueryRowContext(r.Context(), `
			SELECT assigned_to_user_id FROM deployments WHERE id = ? AND game = ?
		`, id, "minecraft").Scan(&assignedTo)
		if err != nil || !assignedTo.Valid || assignedTo.Int64 != u.ID {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// getRequestID pulls the request ID for logging.
func getRequestID(r *http.Request) string {
	if id := r.Header.Get("X-Request-ID"); id != "" {
		return id
	}
	return middleware.GetReqID(r.Context())
}

