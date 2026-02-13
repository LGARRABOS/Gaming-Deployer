package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/example/proxmox-game-deployer/internal/config"
	"github.com/example/proxmox-game-deployer/internal/deploy"
	"github.com/example/proxmox-game-deployer/internal/sshexec"
)

// handleListServers returns Minecraft deployments that completed successfully (server list).
func (s *Server) handleListServers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.DB.Sql().QueryContext(r.Context(), `
		SELECT id, request_json, result_json, vmid, ip_address, created_at
		FROM deployments
		WHERE game = ? AND status = ?
		ORDER BY created_at DESC
		LIMIT 100
	`, "minecraft", string(deploy.StatusSuccess))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type serverItem struct {
		ID        int64   `json:"id"`
		Name      string  `json:"name"`
		IP        string  `json:"ip"`
		Port      int     `json:"port"`
		VMID      *int64  `json:"vmid,omitempty"`
		CreatedAt string  `json:"created_at"`
	}
	var list []serverItem
	for rows.Next() {
		var id int64
		var reqJSON string
		var resultJSON sql.NullString
		var vmid sql.NullInt64
		var ip sql.NullString
		var createdAt time.Time
		if err := rows.Scan(&id, &reqJSON, &resultJSON, &vmid, &ip, &createdAt); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		item := serverItem{ID: id, CreatedAt: createdAt.Format(time.RFC3339)}
		if vmid.Valid {
			v := vmid.Int64
			item.VMID = &v
		}
		if ip.Valid {
			item.IP = ip.String
		}
		var req deploy.MinecraftDeploymentRequest
		if err := json.Unmarshal([]byte(reqJSON), &req); err == nil {
			item.Name = req.Name
			if item.Name == "" {
				item.Name = "Minecraft #" + strconv.FormatInt(id, 10)
			}
			item.Port = req.Minecraft.Port
			if item.Port == 0 {
				item.Port = 25565
			}
		}
		list = append(list, item)
	}
	writeJSON(w, http.StatusOK, list)
}

// handleGetServer returns a single server (deployment) with SFTP and config info.
func (s *Server) handleGetServer(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	row := s.DB.Sql().QueryRowContext(r.Context(), `
		SELECT id, request_json, result_json, vmid, ip_address, status, created_at
		FROM deployments
		WHERE id = ? AND game = ? AND status = ?
	`, id, "minecraft", string(deploy.StatusSuccess))
	var reqJSON, ip string
	var resultJSON sql.NullString
	var vmid sql.NullInt64
	var status string
	var createdAt time.Time
	if err := row.Scan(&id, &reqJSON, &resultJSON, &vmid, &ip, &status, &createdAt); err != nil {
		if err == sql.ErrNoRows {
			http.NotFound(w, r)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var req deploy.MinecraftDeploymentRequest
	if err := json.Unmarshal([]byte(reqJSON), &req); err != nil {
		http.Error(w, "invalid request_json", http.StatusInternalServerError)
		return
	}
	name := req.Name
	if name == "" {
		name = "Minecraft #" + strconv.FormatInt(id, 10)
	}
	port := req.Minecraft.Port
	if port == 0 {
		port = 25565
	}
	out := map[string]any{
		"id":          id,
		"name":        name,
		"ip":          ip,
		"port":        port,
		"status":      status,
		"created_at":  createdAt.Format(time.RFC3339),
		"vmid":        nil,
		"sftp_user":   nil,
		"sftp_password": nil,
	}
	if vmid.Valid {
		out["vmid"] = vmid.Int64
	}
	if resultJSON.Valid {
		var res map[string]any
		if json.Unmarshal([]byte(resultJSON.String), &res) == nil {
			if u, ok := res["sftp_user"]; ok {
				out["sftp_user"] = u
			}
			if p, ok := res["sftp_password"]; ok {
				out["sftp_password"] = p
			}
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// handleServerAction runs start/stop/restart on the minecraft systemd service.
func (s *Server) handleServerAction(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var body struct {
		Action string `json:"action"` // start, stop, restart
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	action := strings.TrimSpace(strings.ToLower(body.Action))
	switch action {
	case "start", "stop", "restart":
	default:
		http.Error(w, "action must be start, stop or restart", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	ip, sshUser, err := s.getServerSSHTarget(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	keyPath := sshexec.KeyPath()
	command := "sudo systemctl " + action + " minecraft"
	stdout, stderr, err := sshexec.RunCommand(ctx, ip, sshUser, keyPath, command)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error(), "stderr": stderr, "stdout": stdout})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "stdout": stdout})
}

// handleServerConsole streams the Minecraft service logs (journalctl -u minecraft -f) as SSE.
func (s *Server) handleServerConsole(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	ctx := r.Context()
	ip, sshUser, err := s.getServerSSHTarget(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	keyPath := sshexec.KeyPath()
	command := "sudo journalctl -u minecraft -f -n 300 --no-pager -o cat"

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}

	onLine := func(line string) error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		// SSE: "data: " + payload + "\n\n"
		if _, err := w.Write([]byte("data: " + line + "\n\n")); err != nil {
			return err
		}
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		return nil
	}
	_ = sshexec.StreamCommand(ctx, ip, sshUser, keyPath, command, onLine)
}

// handleServerStatus returns the systemd status of the minecraft service (active/inactive/failed).
func (s *Server) handleServerStatus(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	ctx := r.Context()
	ip, sshUser, err := s.getServerSSHTarget(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	keyPath := sshexec.KeyPath()
	stdout, _, err := sshexec.RunCommand(ctx, ip, sshUser, keyPath, "systemctl is-active minecraft")
	status := "unknown"
	if err == nil {
		status = strings.TrimSpace(stdout)
		if status == "" {
			status = "inactive"
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": status})
}

// handleGetServerConfig returns the server.properties file content from the VM.
func (s *Server) handleGetServerConfig(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	ctx := r.Context()
	ip, sshUser, err := s.getServerSSHTarget(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	mcDir, _, err := s.getServerMinecraftPath(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	keyPath := sshexec.KeyPath()
	stdout, stderr, err := sshexec.RunCommand(ctx, ip, sshUser, keyPath, "sudo cat "+mcDir+"/server.properties")
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error(), "stderr": stderr})
		return
	}
	// Optionally parse into key-value for the UI. We return raw and parsed.
	props := parseServerProperties(stdout)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "raw": stdout, "properties": props})
}

// handleUpdateServerConfig updates server.properties on the VM from JSON key-value.
func (s *Server) handleUpdateServerConfig(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var body struct {
		Properties map[string]string `json:"properties"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	ctx := r.Context()
	ip, sshUser, err := s.getServerSSHTarget(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	mcDir, mcUser, err := s.getServerMinecraftPath(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	keyPath := sshexec.KeyPath()
	current, _, _ := sshexec.RunCommand(ctx, ip, sshUser, keyPath, "sudo cat "+mcDir+"/server.properties")
	merged := mergeServerProperties(current, body.Properties)
	cmd := execCommandWithStdin(ctx, ip, sshUser, keyPath, "sudo tee "+mcDir+"/server.properties > /dev/null", merged)
	if err := cmd.Run(); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	_, _, _ = sshexec.RunCommand(ctx, ip, sshUser, keyPath, "sudo chown "+mcUser+":"+mcUser+" "+mcDir+"/server.properties")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// getServerSSHTarget returns ip and ssh_user for a successful Minecraft deployment.
func (s *Server) getServerSSHTarget(ctx context.Context, deploymentID int64) (ip, sshUser string, err error) {
	row := s.DB.Sql().QueryRowContext(ctx, `
		SELECT ip_address FROM deployments
		WHERE id = ? AND game = ? AND status = ?
	`, deploymentID, "minecraft", string(deploy.StatusSuccess))
	var ipAddr sql.NullString
	if err := row.Scan(&ipAddr); err != nil {
		return "", "", err
	}
	if !ipAddr.Valid || ipAddr.String == "" {
		return "", "", sql.ErrNoRows
	}
	cfg, err := config.LoadProxmoxConfig(ctx, s.DB)
	if err != nil {
		return "", "", err
	}
	user := cfg.SSHUser
	if user == "" {
		user = "ubuntu"
	}
	return ipAddr.String, user, nil
}

// getServerMinecraftPath returns mc_dir and mc_user from deployment result_json (for server.properties path and ownership).
func (s *Server) getServerMinecraftPath(ctx context.Context, deploymentID int64) (mcDir, mcUser string, err error) {
	row := s.DB.Sql().QueryRowContext(ctx, `
		SELECT result_json FROM deployments
		WHERE id = ? AND game = ? AND status = ?
	`, deploymentID, "minecraft", string(deploy.StatusSuccess))
	var resultJSON sql.NullString
	if err := row.Scan(&resultJSON); err != nil {
		return "", "", err
	}
	mcDir = "/opt/minecraft"
	mcUser = "minecraft"
	if resultJSON.Valid && resultJSON.String != "" {
		var res map[string]any
		if json.Unmarshal([]byte(resultJSON.String), &res) == nil {
			if d, ok := res["mc_dir"].(string); ok && d != "" {
				mcDir = d
			}
			if u, ok := res["mc_user"].(string); ok && u != "" {
				mcUser = u
			}
		}
	}
	return mcDir, mcUser, nil
}

func parseServerProperties(raw string) map[string]string {
	props := make(map[string]string)
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if i := strings.Index(line, "="); i > 0 {
			key := strings.TrimSpace(line[:i])
			val := strings.TrimSpace(line[i+1:])
			props[key] = val
		}
	}
	return props
}

func mergeServerProperties(current string, overrides map[string]string) string {
	props := parseServerProperties(current)
	for k, v := range overrides {
		props[k] = v
	}
	var sb strings.Builder
	// Emit in a consistent order for common keys
	order := []string{"server-port", "motd", "max-players", "online-mode", "white-list", "pvp", "difficulty", "level-name"}
	seen := make(map[string]bool)
	for _, k := range order {
		if v, ok := props[k]; ok {
			sb.WriteString(k + "=" + v + "\n")
			seen[k] = true
		}
	}
	for k, v := range props {
		if !seen[k] {
			sb.WriteString(k + "=" + v + "\n")
		}
	}
	return sb.String()
}

// execCommandWithStdin runs ssh with command and feeds stdin (for writing a file remotely).
func execCommandWithStdin(ctx context.Context, host, user, keyPath, command, stdinContent string) *exec.Cmd {
	// We need exec.Command with ssh ... and cmd.Stdin = reader. But RunCommand doesn't support stdin.
	// So we add a helper that runs ssh with Stdin.
	args := []string{
		"-i", keyPath,
		"-o", "StrictHostKeyChecking=no",
		"-o", "UserKnownHostsFile=/dev/null",
		"-o", "ConnectTimeout=15",
		user + "@" + host,
		command,
	}
	cmd := exec.CommandContext(ctx, "ssh", args...)
	cmd.Stdin = strings.NewReader(stdinContent)
	return cmd
}
