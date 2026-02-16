package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorcon/rcon"

	"github.com/example/proxmox-game-deployer/internal/config"
	"github.com/example/proxmox-game-deployer/internal/deploy"
	"github.com/example/proxmox-game-deployer/internal/proxmox"
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

// handleServerConsoleCommand sends a command to the Minecraft server via RCON.
func (s *Server) handleServerConsoleCommand(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var body struct {
		Command string `json:"command"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	cmd := strings.TrimSpace(body.Command)
	if cmd == "" {
		http.Error(w, "command is required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	ip, _, err := s.getServerSSHTarget(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	port, password, err := s.getServerRCONConfig(ctx, deploymentID)
	if err != nil {
		http.Error(w, "RCON not configured for this server", http.StatusBadRequest)
		return
	}
	addr := fmt.Sprintf("%s:%d", ip, port)
	client, err := rcon.Dial(addr, password)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	defer client.Close()

	resp, err := client.Execute(cmd)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "response": resp})
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
	flusher, _ := w.(http.Flusher)
	if flusher != nil {
		flusher.Flush()
	}

	var mu sync.Mutex
	writeSSE := func(data []byte) error {
		mu.Lock()
		defer mu.Unlock()
		if _, err := w.Write(data); err != nil {
			return err
		}
		if flusher != nil {
			flusher.Flush()
		}
		return nil
	}

	// Keepalive so proxies and clients don't close the connection when the server is idle
	go func() {
		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = writeSSE([]byte(": keepalive\n\n"))
			}
		}
	}()

	onLine := func(line string) error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		return writeSSE([]byte("data: " + line + "\n\n"))
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

// handleServerMetrics returns CPU, RAM and disk from the Proxmox API (same values as the Proxmox UI).
func (s *Server) handleServerMetrics(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	ctx := r.Context()
	node, vmid, _, err := s.getServerProxmoxTarget(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	cfg, err := config.LoadProxmoxConfig(ctx, s.DB)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	client, err := proxmox.NewClient(cfg.APIURL, cfg.APITokenID, cfg.APITokenSecret)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	status, err := client.GetVMStatusCurrent(ctx, node, int(vmid))
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	out := map[string]any{"ok": true}
	// CPU: Proxmox returns 0..1 (fraction) or sometimes 0..100; normalize to 0-100%
	cpuPct := status.CPU * 100
	if cpuPct > 100 {
		cpuPct = 100
	}
	out["cpu_usage_percent"] = cpuPct
	out["mem_used_bytes"] = status.Mem
	out["mem_total_bytes"] = status.MaxMem
	if status.MaxMem > 0 {
		out["mem_available_bytes"] = status.MaxMem - status.Mem
	}
	// Disk: Proxmox status/current often has maxdisk from config; used disk may be 0 without guest agent
	out["disk_used_bytes"] = status.Disk
	out["disk_total_bytes"] = status.MaxDisk
	if status.MaxDisk > 0 {
		out["disk_available_bytes"] = status.MaxDisk - status.Disk
	}
	// If disk usage not reported by Proxmox (0), fallback to SSH df for disk only
	if status.MaxDisk == 0 || status.Disk == 0 {
		ip, sshUser, err := s.getServerSSHTarget(ctx, deploymentID)
		if err == nil {
			keyPath := sshexec.KeyPath()
			stdout, _, _ := sshexec.RunCommand(ctx, ip, sshUser, keyPath, "df -B1 / | tail -1")
			fields := strings.Fields(stdout)
			if len(fields) >= 4 {
				total, _ := strconv.ParseInt(fields[1], 10, 64)
				used, _ := strconv.ParseInt(fields[2], 10, 64)
				avail, _ := strconv.ParseInt(fields[3], 10, 64)
				out["disk_total_bytes"] = total
				out["disk_used_bytes"] = used
				out["disk_available_bytes"] = avail
			}
		}
	}
	writeJSON(w, http.StatusOK, out)
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

// getServerRCONConfig extracts RCON port and password from deployment result_json.
func (s *Server) getServerRCONConfig(ctx context.Context, deploymentID int64) (port int, password string, err error) {
	row := s.DB.Sql().QueryRowContext(ctx, `
		SELECT result_json FROM deployments
		WHERE id = ? AND game = ? AND status = ?
	`, deploymentID, "minecraft", string(deploy.StatusSuccess))
	var resultJSON sql.NullString
	if err := row.Scan(&resultJSON); err != nil {
		return 0, "", err
	}
	if !resultJSON.Valid || resultJSON.String == "" {
		return 0, "", fmt.Errorf("result_json is empty")
	}
	var res map[string]any
	if err := json.Unmarshal([]byte(resultJSON.String), &res); err != nil {
		return 0, "", err
	}
	rawPort, okPort := res["rcon_port"]
	rawPass, okPass := res["rcon_password"]
	if !okPort || !okPass {
		return 0, "", fmt.Errorf("rcon not present in result_json")
	}
	switch v := rawPort.(type) {
	case float64:
		port = int(v)
	case int:
		port = v
	default:
		return 0, "", fmt.Errorf("invalid rcon_port type")
	}
	password, _ = rawPass.(string)
	if port <= 0 || password == "" {
		return 0, "", fmt.Errorf("invalid rcon config")
	}
	return port, password, nil
}

// getServerProxmoxTarget returns node, vmid and parsed request for a successful deployment (for Proxmox API calls).
func (s *Server) getServerProxmoxTarget(ctx context.Context, deploymentID int64) (node string, vmid int64, req deploy.MinecraftDeploymentRequest, err error) {
	row := s.DB.Sql().QueryRowContext(ctx, `
		SELECT request_json, vmid FROM deployments
		WHERE id = ? AND game = ? AND status = ?
	`, deploymentID, "minecraft", string(deploy.StatusSuccess))
	var reqJSON string
	var vmidNull sql.NullInt64
	if err := row.Scan(&reqJSON, &vmidNull); err != nil {
		return "", 0, req, err
	}
	if !vmidNull.Valid {
		return "", 0, req, fmt.Errorf("no vmid")
	}
	if err := json.Unmarshal([]byte(reqJSON), &req); err != nil {
		return "", 0, req, err
	}
	node = req.Node
	if node == "" {
		cfg, _ := config.LoadProxmoxConfig(ctx, s.DB)
		if cfg != nil {
			node = cfg.DefaultNode
		}
	}
	return node, vmidNull.Int64, req, nil
}

// handleGetServerSpecs returns current VM specs (cores, memory_mb, disk_gb) from deployment request.
func (s *Server) handleGetServerSpecs(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	ctx := r.Context()
	_, _, req, err := s.getServerProxmoxTarget(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	diskGB := req.DiskGB
	if diskGB <= 0 {
		diskGB = 50
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"cores":      req.Cores,
		"memory_mb":  req.MemoryMB,
		"disk_gb":   diskGB,
	})
}

// handleUpdateServerSpecs updates VM resources in Proxmox and in the deployment request_json.
func (s *Server) handleUpdateServerSpecs(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var body struct {
		Cores    int `json:"cores"`
		MemoryMB int `json:"memory_mb"`
		DiskGB   int `json:"disk_gb"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if body.Cores <= 0 || body.MemoryMB <= 0 || body.DiskGB <= 0 {
		http.Error(w, "cores, memory_mb and disk_gb must be positive", http.StatusBadRequest)
		return
	}
	ctx := r.Context()
	node, vmid, req, err := s.getServerProxmoxTarget(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	cfg, err := config.LoadProxmoxConfig(ctx, s.DB)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	client, err := proxmox.NewClient(cfg.APIURL, cfg.APITokenID, cfg.APITokenSecret)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	cpuOrRamChanged := body.Cores != req.Cores || body.MemoryMB != req.MemoryMB

	if err := client.UpdateVMConfig(ctx, node, int(vmid), body.Cores, body.MemoryMB); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "Proxmox config: " + err.Error()})
		return
	}
	if body.DiskGB != req.DiskGB {
		if body.DiskGB < req.DiskGB {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "Le rétrécissement du disque n'est pas supporté par Proxmox. Indiquez une taille supérieure ou égale à la taille actuelle."})
			return
		}
		upid, err := client.ResizeDisk(ctx, node, int(vmid), body.DiskGB)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "Resize disk: " + err.Error()})
			return
		}
		if upid != "" {
			if err := client.WaitForTask(ctx, node, upid, 30*time.Minute); err != nil {
				writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "Resize task: " + err.Error()})
				return
			}
		}
	}

	// Les changements de CPU/RAM ne sont pris en compte qu'après redémarrage de la VM.
	// Si la VM tourne, on l'arrête puis on la redémarre.
	var vmRestarted bool
	if cpuOrRamChanged {
		cur, errStatus := client.GetVMStatusCurrent(ctx, node, int(vmid))
		if errStatus == nil && cur != nil && cur.Status == "running" {
			upidStop, errStop := client.StopVM(ctx, node, int(vmid))
			if errStop != nil {
				writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "Arrêt de la VM pour appliquer CPU/RAM: " + errStop.Error()})
				return
			}
			if upidStop != "" {
				if err := client.WaitForTask(ctx, node, upidStop, 5*time.Minute); err != nil {
					writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "Attente arrêt VM: " + err.Error()})
					return
				}
			}
			upidStart, errStart := client.StartVM(ctx, node, int(vmid))
			if errStart != nil {
				writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "Redémarrage de la VM: " + errStart.Error()})
				return
			}
			if upidStart != "" {
				if err := client.WaitForTask(ctx, node, upidStart, 3*time.Minute); err != nil {
					writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "Attente démarrage VM: " + err.Error()})
					return
				}
			}
			vmRestarted = true
		}
	}

	req.Cores = body.Cores
	req.MemoryMB = body.MemoryMB
	req.DiskGB = body.DiskGB
	rawReq, _ := json.Marshal(req)
	_, _ = s.DB.Sql().ExecContext(ctx, `UPDATE deployments SET request_json = ?, updated_at = ? WHERE id = ?`, string(rawReq), time.Now().UTC(), deploymentID)

	resp := map[string]any{"ok": true}
	if vmRestarted {
		resp["vm_restarted"] = true
		resp["message"] = "Ressources mises à jour. La VM a été redémarrée pour appliquer les nouveaux CPU et RAM."
	} else if cpuOrRamChanged {
		resp["message"] = "Ressources mises à jour. La VM était arrêtée ; les nouveaux CPU/RAM seront appliqués au prochain démarrage."
	} else {
		resp["message"] = "Ressources mises à jour."
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleListBackups lists backup files in mc_dir/backups/ on the VM.
func (s *Server) handleListBackups(w http.ResponseWriter, r *http.Request) {
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
	// List .tar.gz in backups folder; use basename only for display
	cmd := fmt.Sprintf("ls -1 %s/backups/*.tar.gz 2>/dev/null | xargs -I {} basename {}", mcDir)
	stdout, _, err := sshexec.RunCommand(ctx, ip, sshUser, keyPath, "sudo "+cmd)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "files": []string{}})
		return
	}
	var files []string
	for _, line := range strings.Split(strings.TrimSpace(stdout), "\n") {
		name := strings.TrimSpace(line)
		if name != "" {
			files = append(files, name)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "files": files})
}

// handleCreateBackup creates a compressed backup of the minecraft directory on the VM.
func (s *Server) handleCreateBackup(w http.ResponseWriter, r *http.Request) {
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
	mcDir, mcUser, err := s.getServerMinecraftPath(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	keyPath := sshexec.KeyPath()
	// Ensure backups dir exists, then tar the minecraft dir (as mc_user to preserve ownership in archive)
	// Parent and base for -C parent base
	parent := mcDir
	base := "minecraft"
	if idx := strings.LastIndex(mcDir, "/"); idx > 0 {
		parent = mcDir[:idx]
		base = mcDir[idx+1:]
	}
	ts := time.Now().Format("20060102-150405")
	backupName := fmt.Sprintf("mc-%s.tar.gz", ts)
	backupPath := mcDir + "/backups/" + backupName
	// Exclude backups/ so we don't pack previous .tar.gz into the new backup (no double compression).
	// Run as mcuser so backup dir and file are owned by mcuser (no permission issues)
	cmd := fmt.Sprintf("sudo -u %s sh -c 'mkdir -p %s/backups && tar czf %s -C %s --exclude=%s/backups %s'", mcUser, mcDir, backupPath, parent, base, base)
	stdout, stderr, err := sshexec.RunCommand(ctx, ip, sshUser, keyPath, cmd)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error(), "stderr": stderr, "stdout": stdout})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "file": backupName})
}

// handleDownloadBackup streams a backup file from the VM. Query param: file=basename.
func (s *Server) handleDownloadBackup(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	file := r.URL.Query().Get("file")
	if file == "" || strings.Contains(file, "/") || strings.Contains(file, "..") {
		http.Error(w, "invalid file parameter", http.StatusBadRequest)
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
	fullPath := mcDir + "/backups/" + file
	cmd := "sudo cat " + fullPath
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", file))
	if err := sshexec.RunCommandStream(ctx, ip, sshUser, keyPath, cmd, w); err != nil {
		http.Error(w, "download failed: "+err.Error(), http.StatusInternalServerError)
	}
}

// handleDeleteBackup deletes a backup file from the VM. Query param: file=basename.
func (s *Server) handleDeleteBackup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	file := r.URL.Query().Get("file")
	if file == "" || strings.Contains(file, "/") || strings.Contains(file, "..") {
		http.Error(w, "invalid file parameter", http.StatusBadRequest)
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
	fullPath := mcDir + "/backups/" + file
	cmd := "sudo rm -f " + fullPath
	if _, _, err := sshexec.RunCommand(ctx, ip, sshUser, keyPath, cmd); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// resolveFilesPath validates path (relative to mc_dir) and returns full path on VM. Path must stay under mc_dir.
func resolveFilesPath(mcDir, queryPath string) (fullPath string, err error) {
	rel := path.Clean("/" + strings.TrimPrefix(queryPath, "/"))
	rel = strings.TrimPrefix(rel, "/")
	if strings.Contains(rel, "..") {
		return "", fmt.Errorf("invalid path")
	}
	fullPath = path.Join(mcDir, rel)
	norm := path.Clean(fullPath)
	base := path.Clean(mcDir)
	if norm != base && !strings.HasPrefix(norm, base+"/") {
		return "", fmt.Errorf("invalid path")
	}
	return fullPath, nil
}

// handleListFiles lists directory contents under mc_dir. Query: path= (relative to mc_dir).
func (s *Server) handleListFiles(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	ctx := r.Context()
	mcDir, mcUser, err := s.getServerMinecraftPath(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	fullPath, err := resolveFilesPath(mcDir, r.URL.Query().Get("path"))
	if err != nil {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	ip, sshUser, err := s.getServerSSHTarget(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	keyPath := sshexec.KeyPath()
	// GNU find: name|size|mtime|type(d/f). Fallback: ls -1A then stat per line (slower).
	cmd := fmt.Sprintf("sudo -u %s find %s -maxdepth 1 -mindepth 1 -printf '%%f|%%s|%%T@|%%y\n' 2>/dev/null || ( cd %s && for f in $(ls -1A); do stat -c '%%n|%%s|%%Y|%%F' \"$f\" 2>/dev/null | sed 's|.*/||; s|regular file|f|; s|directory|d|'; done )", mcUser, fullPath, fullPath)
	stdout, _, err := sshexec.RunCommand(ctx, ip, sshUser, keyPath, cmd)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "entries": []any{}})
		return
	}
	var entries []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(stdout), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "|", 4)
		if len(parts) < 4 {
			continue
		}
		name := parts[0]
		if name == "" || name == "." || name == ".." {
			continue
		}
		size, _ := strconv.ParseInt(parts[1], 10, 64)
		mtime, _ := strconv.ParseInt(parts[2], 10, 64)
		typ := "f"
		if strings.HasPrefix(parts[3], "d") || parts[3] == "directory" {
			typ = "d"
		}
		entries = append(entries, map[string]any{"name": name, "size": size, "mtime": mtime, "dir": typ == "d"})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "entries": entries})
}

// handleGetFileContent returns file content. Query: path=
func (s *Server) handleGetFileContent(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	ctx := r.Context()
	mcDir, _, err := s.getServerMinecraftPath(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	fullPath, err := resolveFilesPath(mcDir, r.URL.Query().Get("path"))
	if err != nil {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	ip, sshUser, err := s.getServerSSHTarget(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	keyPath := sshexec.KeyPath()
	cmd := "sudo cat " + fullPath
	// Return as base64 so we can safely send binary in JSON for the editor; or stream for download
	asAttachment := r.URL.Query().Get("download") == "1"
	if asAttachment {
		w.Header().Set("Content-Disposition", "attachment; filename=\""+path.Base(fullPath)+"\"")
		_ = sshexec.RunCommandStream(ctx, ip, sshUser, keyPath, cmd, w)
		return
	}
	var buf bytes.Buffer
	if err := sshexec.RunCommandStream(ctx, ip, sshUser, keyPath, cmd, &buf); err != nil {
		http.Error(w, "download failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	// JSON response with base64 content for in-app editor
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "content": base64.StdEncoding.EncodeToString(buf.Bytes())})
}

// handlePutFileContent writes file content. Body = raw bytes. Query: path=
func (s *Server) handlePutFileContent(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	ctx := r.Context()
	mcDir, mcUser, err := s.getServerMinecraftPath(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	fullPath, err := resolveFilesPath(mcDir, r.URL.Query().Get("path"))
	if err != nil {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	ip, sshUser, err := s.getServerSSHTarget(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	keyPath := sshexec.KeyPath()
	// Ensure parent dir exists and write as mc_user: sudo -u mcuser tee path
	parent := path.Dir(fullPath)
	cmd := fmt.Sprintf("sudo mkdir -p %s && sudo -u %s tee %s > /dev/null", parent, mcUser, fullPath)
	if err := sshexec.RunCommandWithStdin(ctx, ip, sshUser, keyPath, cmd, r.Body); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleDeleteFile deletes a file or directory. Query: path=
func (s *Server) handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	ctx := r.Context()
	mcDir, _, err := s.getServerMinecraftPath(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	fullPath, err := resolveFilesPath(mcDir, r.URL.Query().Get("path"))
	if err != nil {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	ip, sshUser, err := s.getServerSSHTarget(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	keyPath := sshexec.KeyPath()
	cmd := "sudo rm -rf " + fullPath
	if _, _, err := sshexec.RunCommand(ctx, ip, sshUser, keyPath, cmd); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleUploadFile and handleMkdir: multipart upload or mkdir. POST body: path= (dir) + file, or path= & mkdir=name
func (s *Server) handleUploadFile(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		// Allow url-encoded for mkdir-only
		_ = r.ParseForm()
	}
	idStr := chi.URLParam(r, "id")
	deploymentID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	ctx := r.Context()
	mcDir, mcUser, err := s.getServerMinecraftPath(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	dirPath := r.URL.Query().Get("path")
	if dirPath == "" {
		dirPath = r.FormValue("path")
	}
	if dirPath != "" {
		if _, err := resolveFilesPath(mcDir, dirPath); err != nil {
			http.Error(w, "invalid path", http.StatusBadRequest)
			return
		}
	}
	mkdirName := r.FormValue("mkdir")
	if mkdirName != "" {
		if strings.Contains(mkdirName, "/") || strings.Contains(mkdirName, "..") {
			http.Error(w, "invalid name", http.StatusBadRequest)
			return
		}
		fullPath, _ := resolveFilesPath(mcDir, path.Join(dirPath, mkdirName))
		ip, sshUser, err := s.getServerSSHTarget(ctx, deploymentID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		cmd := fmt.Sprintf("sudo -u %s mkdir -p %s", mcUser, fullPath)
		if _, _, err := sshexec.RunCommand(ctx, ip, sshUser, sshexec.KeyPath(), cmd); err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "missing file"})
		return
	}
	defer file.Close()
	fileName := header.Filename
	if fileName == "" || strings.Contains(fileName, "/") || strings.Contains(fileName, "..") {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "invalid filename"})
		return
	}
	fullPath, err := resolveFilesPath(mcDir, path.Join(dirPath, fileName))
	if err != nil {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	ip, sshUser, err := s.getServerSSHTarget(ctx, deploymentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	parent := path.Dir(fullPath)
	cmd := fmt.Sprintf("sudo mkdir -p %s && sudo -u %s tee %s > /dev/null", parent, mcUser, fullPath)
	if err := sshexec.RunCommandWithStdin(ctx, ip, sshUser, sshexec.KeyPath(), cmd, file); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
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
