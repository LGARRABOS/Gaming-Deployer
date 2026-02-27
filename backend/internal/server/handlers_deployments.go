package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/example/proxmox-game-deployer/internal/auth"
	"github.com/example/proxmox-game-deployer/internal/config"
	"github.com/example/proxmox-game-deployer/internal/deploy"
	"github.com/example/proxmox-game-deployer/internal/proxmox"
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
		WHERE status != ?
		ORDER BY created_at DESC
		LIMIT 100
	`, string(deploy.StatusDeleting))
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
		SELECT id, game, type, request_json, result_json, vmid, ip_address, status, error_message, assigned_to_user_id, created_at, updated_at
		FROM deployments
		WHERE id = ?
	`, id)
	var record struct {
		ID               int64   `json:"id"`
		Game             string  `json:"game"`
		Type             string  `json:"type"`
		RequestJSON      string  `json:"request_json"`
		ResultJSON       *string `json:"result_json,omitempty"`
		VMID             *int64  `json:"vmid,omitempty"`
		IP               *string `json:"ip_address,omitempty"`
		Status           string  `json:"status"`
		Error            *string `json:"error_message,omitempty"`
		AssignedToUserID *int64  `json:"assigned_to_user_id,omitempty"`
		CreatedAt        string  `json:"created_at"`
		UpdatedAt        string  `json:"updated_at"`
	}
	var vmid sql.NullInt64
	var ip sql.NullString
	var result sql.NullString
	var errMsg sql.NullString
	var assignedTo sql.NullInt64
	var created, updated time.Time
	if err := row.Scan(
		&record.ID, &record.Game, &record.Type,
		&record.RequestJSON, &result,
		&vmid, &ip, &record.Status, &errMsg,
		&assignedTo, &created, &updated,
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
	if assignedTo.Valid {
		v := assignedTo.Int64
		record.AssignedToUserID = &v
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

// handleDeleteDeployment cancels a deployment and attempts to destroy its VM.
// If a VM exists, deletion runs asynchronously (returns 202). Otherwise returns 204.
// The deployment is always removed from the DB eventually, even if Proxmox fails.
func (s *Server) handleDeleteDeployment(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	ctx := r.Context()

	// Load deployment.
	row := s.DB.Sql().QueryRowContext(ctx, `
		SELECT id, status, vmid, request_json
		FROM deployments
		WHERE id = ?
	`, deploymentID)

	var id int64
	var status string
	var vmid sql.NullInt64
	var reqJSON string
	if err := row.Scan(&id, &status, &vmid, &reqJSON); err != nil {
		if err == sql.ErrNoRows {
			http.NotFound(w, r)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	now := time.Now().UTC()

	// Mark jobs as cancelled.
	_, _ = s.DB.Sql().ExecContext(ctx, `
		UPDATE jobs
		SET status = ?, updated_at = ?
		WHERE deployment_id = ? AND status IN ('queued', 'running')
	`, string(deploy.JobCancelled), now, deploymentID)

	if vmid.Valid {
		// VM exists: mark as deleting and run destruction in background.
		_, _ = s.DB.Sql().ExecContext(ctx, `
			UPDATE deployments SET status = ?, updated_at = ? WHERE id = ?
		`, string(deploy.StatusDeleting), now, deploymentID)

		// Run VM destruction in background; always delete from DB when done.
		go func(depID int64, vmID int64, reqJSON string) {
			s.deleteVMAndDeployment(context.Background(), depID, vmID, reqJSON)
		}(deploymentID, vmid.Int64, reqJSON)

		w.WriteHeader(http.StatusAccepted)
		return
	}

	// No VM: delete from DB immediately.
	_, _ = s.DB.Sql().ExecContext(ctx, `DELETE FROM deployments WHERE id = ?`, deploymentID)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteVMAndDeployment(ctx context.Context, deploymentID int64, vmid int64, reqJSON string) {
	cfg, err := config.LoadProxmoxConfig(ctx, s.DB)
	if err != nil {
		_, _ = s.DB.Sql().ExecContext(ctx, `DELETE FROM deployments WHERE id = ?`, deploymentID)
		return
	}
	cl, err := proxmox.NewClient(cfg.APIURL, cfg.APITokenID, cfg.APITokenSecret)
	if err != nil {
		_, _ = s.DB.Sql().ExecContext(ctx, `DELETE FROM deployments WHERE id = ?`, deploymentID)
		return
	}
	var req deploy.MinecraftDeploymentRequest
	_ = json.Unmarshal([]byte(reqJSON), &req)
	node := req.Node
	if node == "" {
		node = cfg.DefaultNode
	}
	_, _ = cl.StopVM(ctx, node, int(vmid))
	_, _ = cl.DeleteVM(ctx, node, int(vmid))
	_, _ = s.DB.Sql().ExecContext(ctx, `DELETE FROM deployments WHERE id = ?`, deploymentID)
}

type assignDeploymentRequest struct {
	UserID *int64 `json:"user_id"` // nil = désassigner
}

// handleAssignDeployment assigns a deployment (server) to a user so they can manage it (admin/owner only).
func (s *Server) handleAssignDeployment(w http.ResponseWriter, r *http.Request) {
	u := s.mustUser(r)
	if u == nil || (u.Role != auth.RoleOwner && u.Role != auth.RoleAdmin) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var req assignDeploymentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	var res sql.Result
	if req.UserID == nil {
		res, err = s.DB.Sql().ExecContext(r.Context(), `
			UPDATE deployments SET assigned_to_user_id = NULL WHERE id = ? AND game = ?
		`, deploymentID, "minecraft")
	} else {
		res, err = s.DB.Sql().ExecContext(r.Context(), `
			UPDATE deployments SET assigned_to_user_id = ? WHERE id = ? AND game = ?
		`, *req.UserID, deploymentID, "minecraft")
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, http.StatusOK, genericOKResponse{OK: true})
}

