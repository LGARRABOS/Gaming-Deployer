package server

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/example/proxmox-game-deployer/internal/auth"
	"github.com/example/proxmox-game-deployer/internal/deploy"
)

// handleValidateDeployment validates inputs without enqueueing a job.
func (s *Server) handleValidateDeployment(w http.ResponseWriter, r *http.Request) {
	var req deploy.MinecraftDeploymentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if err := deploy.ValidateMinecraftRequest(req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, genericOKResponse{OK: true})
}

// handleCreateDeployment validates and enqueues a deployment.
func (s *Server) handleCreateDeployment(w http.ResponseWriter, r *http.Request) {
	var req deploy.MinecraftDeploymentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if err := deploy.ValidateMinecraftRequest(req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	id, err := deploy.EnqueueMinecraftDeployment(r.Context(), s.DB, req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"deployment_id": id})
}

// handleListDeployments returns a list of deployments.
func (s *Server) handleListDeployments(w http.ResponseWriter, r *http.Request) {
	rows, err := s.DB.Sql().QueryContext(r.Context(), `
		SELECT id, game, type, status, vmid, ip_address, created_at, updated_at
		FROM deployments
		ORDER BY created_at DESC
		LIMIT 100
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type item struct {
		ID        int64   `json:"id"`
		Game      string  `json:"game"`
		Type      string  `json:"type"`
		Status    string  `json:"status"`
		VMID      *int64  `json:"vmid,omitempty"`
		IP        *string `json:"ip_address,omitempty"`
		CreatedAt string  `json:"created_at"`
		UpdatedAt string  `json:"updated_at"`
	}
	var out []item
	for rows.Next() {
		var it item
		var vmid sql.NullInt64
		var ip sql.NullString
		var created, updated time.Time
		if err := rows.Scan(&it.ID, &it.Game, &it.Type, &it.Status, &vmid, &ip, &created, &updated); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if vmid.Valid {
			v := vmid.Int64
			it.VMID = &v
		}
		if ip.Valid {
			str := ip.String
			it.IP = &str
		}
		it.CreatedAt = created.Format(time.RFC3339)
		it.UpdatedAt = updated.Format(time.RFC3339)
		out = append(out, it)
	}
	writeJSON(w, http.StatusOK, out)
}

// handleGetDeployment returns a single deployment record.
func (s *Server) handleGetDeployment(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	row := s.DB.Sql().QueryRowContext(r.Context(), `
		SELECT id, game, type, request_json, result_json, vmid, ip_address, status, error_message, created_at, updated_at
		FROM deployments
		WHERE id = ?
	`, id)
	var record struct {
		ID          int64   `json:"id"`
		Game        string  `json:"game"`
		Type        string  `json:"type"`
		RequestJSON string  `json:"request_json"`
		ResultJSON  *string `json:"result_json,omitempty"`
		VMID        *int64  `json:"vmid,omitempty"`
		IP          *string `json:"ip_address,omitempty"`
		Status      string  `json:"status"`
		Error       *string `json:"error_message,omitempty"`
		CreatedAt   string  `json:"created_at"`
		UpdatedAt   string  `json:"updated_at"`
	}
	var vmid sql.NullInt64
	var ip sql.NullString
	var result sql.NullString
	var errMsg sql.NullString
	var created, updated time.Time
	if err := row.Scan(
		&record.ID, &record.Game, &record.Type,
		&record.RequestJSON, &result,
		&vmid, &ip, &record.Status, &errMsg,
		&created, &updated,
	); err != nil {
		if err == sql.ErrNoRows {
			http.NotFound(w, r)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if vmid.Valid {
		v := vmid.Int64
		record.VMID = &v
	}
	if ip.Valid {
		str := ip.String
		record.IP = &str
	}
	if result.Valid {
		str := result.String
		record.ResultJSON = &str
	}
	if errMsg.Valid {
		str := errMsg.String
		record.Error = &str
	}
	record.CreatedAt = created.Format(time.RFC3339)
	record.UpdatedAt = updated.Format(time.RFC3339)
	writeJSON(w, http.StatusOK, record)
}

// handleGetDeploymentLogs returns logs for a deployment, optionally after a specific ID.
func (s *Server) handleGetDeploymentLogs(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	afterIDStr := r.URL.Query().Get("after_id")
	var rows *sql.Rows
	if afterIDStr != "" {
		afterID, err := strconv.ParseInt(afterIDStr, 10, 64)
		if err != nil {
			http.Error(w, "invalid after_id", http.StatusBadRequest)
			return
		}
		rows, err = s.DB.Sql().QueryContext(r.Context(), `
			SELECT id, ts, level, message
			FROM deployment_logs
			WHERE deployment_id = ? AND id > ?
			ORDER BY id ASC
		`, deploymentID, afterID)
	} else {
		rows, err = s.DB.Sql().QueryContext(r.Context(), `
			SELECT id, ts, level, message
			FROM deployment_logs
			WHERE deployment_id = ?
			ORDER BY id ASC
		`, deploymentID)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type logItem struct {
		ID      int64  `json:"id"`
		Time    string `json:"ts"`
		Level   string `json:"level"`
		Message string `json:"message"`
	}
	var out []logItem
	for rows.Next() {
		var it logItem
		var ts time.Time
		if err := rows.Scan(&it.ID, &ts, &it.Level, &it.Message); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		it.Time = ts.Format(time.RFC3339)
		out = append(out, it)
	}
	writeJSON(w, http.StatusOK, out)
}

// Helper to avoid unused import errors for auth in this file.
var _ = auth.User{}

