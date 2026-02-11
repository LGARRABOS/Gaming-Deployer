package server

import (
	"context"
	"net/http"

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
			SELECT id, username, created_at
			FROM users
			WHERE id = ?
		`, session.UserID)
		var u auth.User
		if err := row.Scan(&u.ID, &u.Username, &u.CreatedAt); err != nil {
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

// getRequestID pulls the request ID for logging.
func getRequestID(r *http.Request) string {
	if id := r.Header.Get("X-Request-ID"); id != "" {
		return id
	}
	return middleware.GetReqID(r.Context())
}

