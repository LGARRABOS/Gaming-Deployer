package server

import (
	"context"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/example/proxmox-game-deployer/internal/auth"
	"github.com/example/proxmox-game-deployer/internal/config"
	"github.com/example/proxmox-game-deployer/internal/deploy"
	"github.com/example/proxmox-game-deployer/internal/db"
	"github.com/example/proxmox-game-deployer/web"
)

// Server bundles all dependencies.
type Server struct {
	DB     *db.DB
	Router *chi.Mux
}

// New constructs a Server, applies migrations and routes.
func New(ctx context.Context, dbPath string) (*Server, error) {
	database, err := db.Open(dbPath)
	if err != nil {
		return nil, err
	}
	if err := database.Migrate(ctx); err != nil {
		return nil, err
	}

	s := &Server{DB: database}
	go s.RunMonitoringCollector()
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	// Timeout 60s for most routes; exclude long-lived SSE (console stream)
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if req.Method == http.MethodGet && strings.Contains(req.URL.Path, "/servers/") && strings.HasSuffix(req.URL.Path, "/console") {
				next.ServeHTTP(w, req)
				return
			}
			middleware.Timeout(60 * time.Second)(next).ServeHTTP(w, req)
		})
	})

	// Public endpoints (used before initialization).
	r.Route("/api", func(r chi.Router) {
		r.Get("/status", s.handleStatus)
		r.Get("/setup/status", s.handleSetupStatus)
		r.Post("/setup/test-proxmox", s.handleTestProxmox)
		r.Post("/setup/initialize", s.handleInitialize)
		r.Post("/login", s.handleLogin)
		r.Post("/logout", s.handleLogout)
		r.Get("/me", s.withAuth(s.handleMe))

		r.Group(func(r chi.Router) {
			r.Use(s.AuthMiddleware)
			r.Get("/setup/config", s.handleGetProxmoxConfig)
			r.Post("/setup/config", s.handleUpdateProxmoxConfig)
			r.Post("/setup/test-proxmox-current", s.handleTestProxmoxCurrent)
			r.Get("/setup/ssh-key", s.handleGetSSHKey)
			r.Post("/setup/ssh-key/regenerate", s.handleRegenerateSSHKey)
			r.Get("/settings/curseforge", s.handleGetCurseForgeSettings)
			r.Post("/settings/curseforge", s.handleUpdateCurseForgeSettings)
			r.Post("/settings/curseforge/test", s.handleTestCurseForgeAPIKey)
			r.Get("/curseforge/modpacks/search", s.handleCurseForgeSearchModpacks)
			r.Get("/curseforge/modpacks/{id}/server-packs", s.handleCurseForgeListServerPacks)
			r.Get("/minecraft/versions", s.handleMinecraftVersions)
			r.Post("/deployments/validate", s.handleValidateDeployment)
			r.Post("/deployments", s.handleCreateDeployment)
			r.Get("/deployments", s.handleListDeployments)
			r.Get("/deployments/{id}", s.handleGetDeployment)
			r.Get("/deployments/{id}/logs", s.handleGetDeploymentLogs)
			r.Delete("/deployments/{id}", s.handleDeleteDeployment)
			// Serveurs Minecraft (dashboard gestion : start/stop, config, SFTP)
			r.Get("/servers", s.handleListServers)
			r.Get("/servers/{id}", s.handleGetServer)
			r.Post("/servers/{id}/action", s.handleServerAction)
			r.Get("/servers/{id}/status", s.handleServerStatus)
			r.Get("/servers/{id}/minecraft-info", s.handleMinecraftInfo)
			r.Get("/servers/{id}/metrics", s.handleServerMetrics)
			r.Get("/servers/{id}/monitoring-history", s.handleMonitoringHistory)
			r.Get("/servers/{id}/config", s.handleGetServerConfig)
			r.Put("/servers/{id}/config", s.handleUpdateServerConfig)
			r.Get("/servers/{id}/specs", s.handleGetServerSpecs)
			r.Put("/servers/{id}/specs", s.handleUpdateServerSpecs)
			r.Get("/servers/{id}/console", s.handleServerConsole)
			r.Post("/servers/{id}/console/command", s.handleServerConsoleCommand)
			r.Get("/servers/{id}/backups", s.handleListBackups)
			r.Post("/servers/{id}/backup", s.handleCreateBackup)
			r.Delete("/servers/{id}/backup", s.handleDeleteBackup)
			r.Get("/servers/{id}/backup/download", s.handleDownloadBackup)
			r.Get("/servers/{id}/action-logs", s.handleServerActionLogs)
			r.Post("/servers/{id}/migrate", s.handleServerMigrate)
			r.Get("/servers/{id}/files", s.handleListFiles)
			r.Get("/servers/{id}/files/content", s.handleGetFileContent)
			r.Put("/servers/{id}/files/content", s.handlePutFileContent)
			r.Delete("/servers/{id}/files", s.handleDeleteFile)
			r.Post("/servers/{id}/files", s.handleUploadFile)
		})
	})

	// Static frontend: serve embedded build (backend/web/dist) with SPA fallback.
	sub, err := fs.Sub(web.Dist, "dist")
	if err != nil {
		log.Fatalf("failed to load embedded frontend: %v", err)
	}
	r.Handle("/*", spaFileServer(sub))

	s.Router = r
	return s, nil
}

// ListenAndServe starts the HTTP server.
func (s *Server) ListenAndServe(addr string) error {
	log.Printf("listening on %s", addr)
	return http.ListenAndServe(addr, s.Router)
}

// IsInitialized is a helper to check initialization status.
func (s *Server) IsInitialized(ctx context.Context) (bool, error) {
	return config.IsInitialized(ctx, s.DB)
}

// Close closes underlying resources.
func (s *Server) Close() error {
	return s.DB.Close()
}

// store implements the subset of the DB.Store interfaces we need.
func (s *Server) store() deploy.Store {
	return s.DB
}

// getSessionFromRequest extracts a session from cookie if any.
func (s *Server) getSessionFromRequest(r *http.Request) (*auth.Session, error) {
	c, err := r.Cookie("session_id")
	if err != nil {
		return nil, err
	}
	return auth.GetSession(r.Context(), s.DB, c.Value)
}

// setSessionCookie writes the session cookie.
func setSessionCookie(w http.ResponseWriter, sessionID string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     "session_id",
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   os.Getenv("APP_SECURE_COOKIE") == "true",
		Expires:  expires,
	})
}

// spaFileServer serves static files and falls back to index.html for unknown paths
// so that React Router can handle client-side routes like /login, /deployments, etc.
func spaFileServer(content fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(content))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Let the API and other non-GET methods through untouched.
		if strings.HasPrefix(r.URL.Path, "/api/") || r.Method != http.MethodGet {
			fileServer.ServeHTTP(w, r)
			return
		}

		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}

		// Try to open the requested asset; if it fails, fall back to index.html.
		if f, err := content.Open(path); err == nil {
			_ = f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		index, err := fs.ReadFile(content, "index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(index)
	})
}

