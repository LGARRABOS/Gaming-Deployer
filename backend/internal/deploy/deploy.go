package deploy

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"math/big"
	"net"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/example/proxmox-game-deployer/internal/config"
	"github.com/example/proxmox-game-deployer/internal/curseforge"
	"github.com/example/proxmox-game-deployer/internal/minecraft"
	"github.com/example/proxmox-game-deployer/internal/proxmox"
)

// Store describes the DB operations required by the deploy package.
type Store interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	WithTx(ctx context.Context, fn func(tx *sql.Tx) error) error
}

// DeploymentStatus represents the current deployment state.
type DeploymentStatus string

const (
	StatusQueued  DeploymentStatus = "queued"
	StatusRunning DeploymentStatus = "running"
	StatusSuccess DeploymentStatus = "success"
	StatusFailed  DeploymentStatus = "failed"
	StatusCancelled DeploymentStatus = "cancelled"
)

// JobStatus represents job state in jobs table.
type JobStatus string

const (
	JobQueued  JobStatus = "queued"
	JobRunning JobStatus = "running"
	JobDone    JobStatus = "done"
	JobFailed  JobStatus = "failed"
	JobCancelled JobStatus = "cancelled"
)

// MinecraftDeploymentRequest is the API-level payload for a new deployment.
type MinecraftDeploymentRequest struct {
	Name        string              `json:"name"`
	Node        string              `json:"node"`
	TemplateVM  int                 `json:"template_vmid"`
	Cores       int                 `json:"cores"`
	MemoryMB    int                 `json:"memory_mb"`
	DiskGB      int                 `json:"disk_gb"`
	Storage     string              `json:"storage"`
	Bridge      string              `json:"bridge"`
	VLAN        *int                `json:"vlan,omitempty"`
	IPAddress   string              `json:"ip_address"`
	CIDR        int                 `json:"cidr"`
	Gateway     string              `json:"gateway"`
	DNS         string              `json:"dns"`
	Hostname    string              `json:"hostname"`
	Minecraft   minecraft.Config    `json:"minecraft"`
	BackupNotes string              `json:"backup_notes,omitempty"`
}

// Job represents an internal job in the queue.
type Job struct {
	ID           int64
	Type         string
	PayloadJSON  string
	Status       JobStatus
	DeploymentID *int64
	RunAfter     time.Time
	LastError    *string
	Attempts     int
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// EnqueueMinecraftDeployment inserts a deployment + job.
func EnqueueMinecraftDeployment(ctx context.Context, db Store, req MinecraftDeploymentRequest) (int64, error) {
	rawReq, err := json.Marshal(req)
	if err != nil {
		return 0, err
	}
	now := time.Now().UTC()
	var deploymentID int64
	err = db.WithTx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `
			INSERT INTO deployments (game, type, request_json, status, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`, "minecraft", "minecraft_java", string(rawReq), string(StatusQueued), now, now)
		if err != nil {
			return err
		}
		deploymentID, err = res.LastInsertId()
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO jobs (type, payload_json, status, deployment_id, run_after, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, "deploy_minecraft", string(rawReq), string(JobQueued), deploymentID, now, now, now)
		return err
	})
	if err != nil {
		return 0, err
	}
	return deploymentID, nil
}

// appendLog writes a log line for a deployment.
func appendLog(ctx context.Context, db Store, deploymentID int64, level, msg string) {
	_, _ = db.ExecContext(ctx, `
		INSERT INTO deployment_logs (deployment_id, ts, level, message)
		VALUES (?, ?, ?, ?)
	`, deploymentID, time.Now().UTC(), level, msg)
}

// updateDeploymentStatus updates the deployment status and optional fields.
func updateDeploymentStatus(ctx context.Context, db Store, deploymentID int64, status DeploymentStatus, vmid *int, ip *string, errMsg *string, resultJSON *string) {
	query := `
		UPDATE deployments
		SET status = ?, updated_at = ?, vmid = COALESCE(vmid, ?), ip_address = COALESCE(ip_address, ?), error_message = ?
		WHERE id = ?
	`
	_, _ = db.ExecContext(ctx, query, string(status), time.Now().UTC(), vmid, ip, errMsg, deploymentID)
	if resultJSON != nil {
		_, _ = db.ExecContext(ctx, `
			UPDATE deployments SET result_json = ? WHERE id = ?
		`, *resultJSON, deploymentID)
	}
}

// ProcessJob runs the deployment pipeline for a single job.
func ProcessJob(ctx context.Context, db Store, j *Job, cfg *config.ProxmoxConfig) error {
	dryRun := os.Getenv("DRY_RUN") == "true"

	var req MinecraftDeploymentRequest
	if err := json.Unmarshal([]byte(j.PayloadJSON), &req); err != nil {
		return err
	}

	// Resolve some defaults from global config if not provided.
	if req.Node == "" {
		req.Node = cfg.DefaultNode
	}
	if req.Storage == "" {
		req.Storage = cfg.DefaultStorage
	}
	if req.Bridge == "" {
		req.Bridge = cfg.DefaultBridge
	}
	if req.TemplateVM == 0 {
		req.TemplateVM = cfg.TemplateVMID
	}

	// Auto-fill network settings if not provided.
	if req.IPAddress == "" {
		ip, cidr, gw, dns, hostname, err := autoNetwork(ctx, db)
		if err != nil {
			return err
		}
		req.IPAddress = ip
		req.CIDR = cidr
		req.Gateway = gw
		req.DNS = dns
		if req.Hostname == "" {
			req.Hostname = hostname
		}
	}

	// Auto JVM heap if not set: VM memory - 2GB, minimum 1G.
	if req.Minecraft.JVMHeap == "" {
		heapMB := req.MemoryMB - 2048
		if heapMB < 1024 {
			heapMB = 1024
		}
		req.Minecraft.JVMHeap = fmt.Sprintf("%dM", heapMB)
	}

	// Default disk 50 GB if not set.
	if req.DiskGB <= 0 {
		req.DiskGB = 50
	}

	// Auto port: if 0, base on deployment id (25565 + id).
	if req.Minecraft.Port == 0 && j.DeploymentID != nil {
		base := 25565
		port := base + int(*j.DeploymentID)
		if port > 65535 {
			port = base + (int(*j.DeploymentID) % 1000)
		}
		req.Minecraft.Port = port
	}

	// Auto backups every 24h with 2 days retention if not set.
	if !req.Minecraft.BackupEnabled {
		req.Minecraft.BackupEnabled = true
		if req.Minecraft.BackupFrequency == "" {
			req.Minecraft.BackupFrequency = "24h"
		}
		if req.Minecraft.BackupRetention == 0 {
			req.Minecraft.BackupRetention = 2
		}
	}

	// Ensure RCON is enabled so that the UI can send commands to the Minecraft
	// console remotely. Each VM has its own IP so we can use the default RCON
	// port safely.
	if !req.Minecraft.RCONEnabled {
		req.Minecraft.RCONEnabled = true
	}
	if req.Minecraft.RCONPort == 0 {
		req.Minecraft.RCONPort = 25575
	}
	if strings.TrimSpace(req.Minecraft.RCONPassword) == "" {
		req.Minecraft.RCONPassword = generatePassword(24)
	}

	// Génère un utilisateur/admin SFTP dédié pour ce serveur si non défini.
	if req.Minecraft.AdminUser == "" {
		req.Minecraft.AdminUser = "mcadmin"
	}
	if req.Minecraft.AdminPassword == "" {
		req.Minecraft.AdminPassword = generatePassword(20)
	}

	c, err := proxmox.NewClient(cfg.APIURL, cfg.APITokenID, cfg.APITokenSecret)
	if err != nil {
		return err
	}

	deploymentID := j.DeploymentID
	if deploymentID == nil {
		return fmt.Errorf("job has no deployment_id")
	}

	appendLog(ctx, db, *deploymentID, "info", "Starting deployment pipeline")

	var vmid int
	ipCIDR := fmt.Sprintf("%s/%d", req.IPAddress, req.CIDR)
	ip := req.IPAddress

	if dryRun {
		appendLog(ctx, db, *deploymentID, "info", "DRY_RUN is enabled, simulating steps without touching Proxmox or the VM")
		time.Sleep(1 * time.Second)
	} else {
		appendLog(ctx, db, *deploymentID, "info", "Requesting next VMID from Proxmox")
		vmid, err = c.NextID(ctx)
		if err != nil {
			appendLog(ctx, db, *deploymentID, "error", fmt.Sprintf("Failed to get next VMID: %v", err))
			return err
		}

		appendLog(ctx, db, *deploymentID, "info", fmt.Sprintf("Cloning VM from template %d to new VMID %d", req.TemplateVM, vmid))
		upid, err := c.CloneVM(ctx, req.Node, req.TemplateVM, vmid, req.Name, req.Storage)
		if err != nil {
			appendLog(ctx, db, *deploymentID, "error", fmt.Sprintf("Clone failed: %v", err))
			return err
		}
		appendLog(ctx, db, *deploymentID, "info", fmt.Sprintf("Waiting for clone task %s", upid))
		if err := c.WaitForTask(ctx, req.Node, upid, 30*time.Minute); err != nil {
			appendLog(ctx, db, *deploymentID, "error", fmt.Sprintf("Clone task failed: %v", err))
			return err
		}

		// À ce stade, la VM existe : on enregistre immédiatement le VMID et l'IP
		// dans la DB afin que les suppressions/cancellations puissent la cibler
		// même si des erreurs surviennent plus tard dans le pipeline.
		updateDeploymentStatus(ctx, db, *deploymentID, StatusRunning, &vmid, &ip, nil, nil)

		appendLog(ctx, db, *deploymentID, "info", "Configuring VM resources and cloud-init networking")
		if err := c.ConfigureVM(ctx, req.Node, vmid, req.Cores, req.MemoryMB, req.DiskGB, req.Bridge, req.VLAN, ipCIDR, req.Gateway); err != nil {
			appendLog(ctx, db, *deploymentID, "error", fmt.Sprintf("Configure VM failed: %v", err))
			return err
		}

		// Ajuste la taille du disque principal (scsi0) uniquement si la taille demandée
		// est supérieure à celle du template (Proxmox ne permet pas de réduire un disque).
		if req.DiskGB > 0 {
			currentGB, errCur := c.GetScsi0SizeGB(ctx, req.Node, vmid)
			if errCur != nil {
				appendLog(ctx, db, *deploymentID, "info", fmt.Sprintf("Could not read current disk size: %v, skipping resize", errCur))
			} else if req.DiskGB <= currentGB {
				appendLog(ctx, db, *deploymentID, "info", fmt.Sprintf("Disk already %dG (template), requested %dG — no resize (Proxmox does not support shrinking)", currentGB, req.DiskGB))
			} else {
				appendLog(ctx, db, *deploymentID, "info", fmt.Sprintf("Resizing VM disk from %dG to %dG", currentGB, req.DiskGB))
				if upid, err := c.ResizeDisk(ctx, req.Node, vmid, req.DiskGB); err != nil {
					appendLog(ctx, db, *deploymentID, "error", fmt.Sprintf("Resize disk failed: %v", err))
					return err
				} else if upid != "" {
					if err := c.WaitForTask(ctx, req.Node, upid, 30*time.Minute); err != nil {
						appendLog(ctx, db, *deploymentID, "error", fmt.Sprintf("Resize disk task failed: %v", err))
						return err
					}
				}
			}
		}

		appendLog(ctx, db, *deploymentID, "info", "Starting VM")
		upid, err = c.StartVM(ctx, req.Node, vmid)
		if err != nil {
			appendLog(ctx, db, *deploymentID, "error", fmt.Sprintf("Start VM failed: %v", err))
			return err
		}
		if err := c.WaitForTask(ctx, req.Node, upid, 10*time.Minute); err != nil {
			appendLog(ctx, db, *deploymentID, "error", fmt.Sprintf("Start task failed: %v", err))
			return err
		}

		appendLog(ctx, db, *deploymentID, "info", "Waiting for SSH to become available on VM")
		if err := c.WaitForSSH(ctx, ip, 22, 15*time.Minute); err != nil {
			appendLog(ctx, db, *deploymentID, "error", fmt.Sprintf("SSH did not become available: %v", err))
			return err
		}
	}

	appendLog(ctx, db, *deploymentID, "info", "Running Ansible playbook to provision Minecraft server")

	if dryRun {
		appendLog(ctx, db, *deploymentID, "info", "DRY_RUN enabled: skipping actual ansible-playbook invocation")
	} else {
		cfKey, _ := config.LoadCurseForgeAPIKey(ctx, db)
		if err := runAnsibleMinecraft(ctx, req, ip, cfg.SSHUser, cfKey); err != nil {
			appendLog(ctx, db, *deploymentID, "error", fmt.Sprintf("Ansible provisioning failed: %v", err))
			return err
		}
	}

	mcDir := "/opt/minecraft"
	mcUser := "minecraft"
	if u := req.Minecraft.AdminUser; u != "" {
		mcDir = "/home/" + u + "/minecraft"
		mcUser = u
	}
	result := map[string]any{
		"vmid":          vmid,
		"ip":            ip,
		"job":           j.ID,
		"run":           uuid.NewString(),
		"mc_dir":        mcDir,
		"mc_user":       mcUser,
		"sftp_user":     req.Minecraft.AdminUser,
		"sftp_password": req.Minecraft.AdminPassword,
		"rcon_port":     req.Minecraft.RCONPort,
		"rcon_password": req.Minecraft.RCONPassword,
	}
	rawResult, _ := json.Marshal(result)
	resStr := string(rawResult)
	updateDeploymentStatus(ctx, db, *deploymentID, StatusSuccess, &vmid, &ip, nil, &resStr)
	appendLog(ctx, db, *deploymentID, "info", "Deployment completed successfully")
	return nil
}

// runAnsibleMinecraft spawns ansible-playbook with the relevant variables.
func runAnsibleMinecraft(ctx context.Context, req MinecraftDeploymentRequest, hostIP, sshUser, curseForgeAPIKey string) error {
	playbook := "./ansible/provision_minecraft.yml"
	if req.Minecraft.Modpack != nil {
		playbook = "./ansible/provision_minecraft_modpack.yml"
		if v := os.Getenv("ANSIBLE_MODPACK_PLAYBOOK_PATH"); v != "" {
			playbook = v
		}
	} else if v := os.Getenv("ANSIBLE_PLAYBOOK_PATH"); v != "" {
		playbook = v
	}

	extraVars := req.Minecraft.ToAnsibleVars()
	extraVars["target_host"] = hostIP

	if req.Minecraft.Modpack != nil {
		mp := req.Minecraft.Modpack
		if strings.TrimSpace(curseForgeAPIKey) == "" {
			return fmt.Errorf("clé API CurseForge non configurée (Paramètres → CurseForge)")
		}
		if mp.Provider != "curseforge" {
			return fmt.Errorf("provider modpack non supporté: %s", mp.Provider)
		}
		directURL, fallbackURL, err := curseforge.New(curseForgeAPIKey).GetDownloadURL(ctx, mp.ProjectID, mp.FileID)
		if err != nil {
			return fmt.Errorf("résolution URL modpack CurseForge: %w", err)
		}
		downloadURL := directURL
		if strings.TrimSpace(downloadURL) == "" {
			downloadURL = fallbackURL
		}
		extraVars["mc_modpack_url"] = downloadURL
		extraVars["mc_modpack_provider"] = mp.Provider
		extraVars["mc_modpack_project_id"] = mp.ProjectID
		extraVars["mc_modpack_file_id"] = mp.FileID

		// Many server packs cannot bundle Mojang's server.jar. Provide it so Fabric/Forge launchers can work.
		mcVer := strings.TrimSpace(req.Minecraft.Version)
		if mcVer != "" {
			jarURL, err := minecraft.ResolveVanillaServerJarURL(mcVer)
			if err != nil {
				return fmt.Errorf("résolution JAR vanilla pour modpack: %w", err)
			}
			extraVars["mc_server_jar_url"] = jarURL
		}
	} else {
		// For vanilla, resolve version to server jar URL so Ansible can download the correct jar.
		if req.Minecraft.Type == minecraft.TypeVanilla && strings.TrimSpace(req.Minecraft.Version) != "" {
			jarURL, err := minecraft.ResolveVanillaServerJarURL(strings.TrimSpace(req.Minecraft.Version))
			if err != nil {
				return fmt.Errorf("résolution version vanilla: %w", err)
			}
			extraVars["mc_server_jar_url"] = jarURL
		}
		// For Forge, resolve to recommended installer URL; Ansible will run the installer (--installServer).
		if req.Minecraft.Type == minecraft.TypeForge && strings.TrimSpace(req.Minecraft.Version) != "" {
			installerURL, fullVersion, err := minecraft.ResolveForgeInstallerURL(strings.TrimSpace(req.Minecraft.Version))
			if err != nil {
				return fmt.Errorf("résolution version Forge: %w", err)
			}
			extraVars["mc_forge_installer_url"] = installerURL
			extraVars["mc_forge_full_version"] = fullVersion
		}
		// For Fabric, resolve installer URL and loader version; Ansible will run the installer (server mode).
		// Fabric's launcher also needs the vanilla server JAR at server.jar — we pass its URL for Ansible to download.
		if req.Minecraft.Type == minecraft.TypeFabric && strings.TrimSpace(req.Minecraft.Version) != "" {
			mcVer := strings.TrimSpace(req.Minecraft.Version)
			installerURL, loaderVersion, err := minecraft.ResolveFabricInstallerParams(mcVer)
			if err != nil {
				return fmt.Errorf("résolution version Fabric: %w", err)
			}
			jarURL, err := minecraft.ResolveVanillaServerJarURL(mcVer)
			if err != nil {
				return fmt.Errorf("résolution JAR vanilla pour Fabric: %w", err)
			}
			extraVars["mc_fabric_installer_url"] = installerURL
			extraVars["mc_fabric_mc_version"] = mcVer
			extraVars["mc_fabric_loader_version"] = loaderVersion
			extraVars["mc_server_jar_url"] = jarURL
		}
	}

	extraJSON, err := json.Marshal(extraVars)
	if err != nil {
		return err
	}

	args := []string{
		playbook,
		"-i", fmt.Sprintf("%s,", hostIP),
	}
	if sshUser != "" {
		args = append(args, "-u", sshUser)
	}
	args = append(args, "--extra-vars", string(extraJSON))

	cmd := exec.CommandContext(ctx, "ansible-playbook", args...)
	env := append(os.Environ(), "ANSIBLE_HOST_KEY_CHECKING=False")
	// Permet de préciser explicitement la clé privée SSH à utiliser pour
	// Ansible. Si APP_SSH_KEY_PATH n'est pas défini, on retombe sur le chemin
	// par défaut utilisé par le module sshkeys (./ssh/id_ed25519) afin que la
	// clé générée via l'UI soit automatiquement réutilisée.
	keyPath := os.Getenv("APP_SSH_KEY_PATH")
	if keyPath == "" {
		keyPath = "./ssh/id_ed25519"
	}
	if keyPath != "" {
		env = append(env, "ANSIBLE_PRIVATE_KEY_FILE="+keyPath)
	}
	cmd.Env = env
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		out := strings.TrimSpace(stdout.String() + "\n" + stderr.String())
		if out != "" {
			return fmt.Errorf("%w\n\nSortie Ansible:\n%s", err, out)
		}
		return err
	}
	return nil
}

// generatePassword crée un mot de passe aléatoire simple (a-zA-Z0-9).
func generatePassword(length int) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	if length <= 0 {
		length = 16
	}
	var b strings.Builder
	for i := 0; i < length; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			// Fallback très improbable en cas d'erreur RNG.
			b.WriteByte('x')
			continue
		}
		b.WriteByte(alphabet[n.Int64()])
	}
	return b.String()
}

// autoNetwork allocates a fixed IP and related settings from an internal pool.
// It uses environment variables:
//  - APP_NET_CIDR (e.g. 192.168.1.0/24)
//  - APP_NET_GATEWAY
//  - APP_NET_DNS
//  - APP_HOSTNAME_PREFIX (optional, default "mc-")
// This is a simple allocator based on IPs already stored in the deployments table.
func autoNetwork(ctx context.Context, db Store) (string, int, string, string, string, error) {
	baseCIDR := os.Getenv("APP_NET_CIDR")
	if baseCIDR == "" {
		return "", 0, "", "", "", fmt.Errorf("APP_NET_CIDR is not set")
	}
	gw := os.Getenv("APP_NET_GATEWAY")
	if gw == "" {
		return "", 0, "", "", "", fmt.Errorf("APP_NET_GATEWAY is not set")
	}
	dns := os.Getenv("APP_NET_DNS")
	if dns == "" {
		dns = gw
	}
	prefix := os.Getenv("APP_HOSTNAME_PREFIX")
	if prefix == "" {
		prefix = "mc-"
	}

	ip, ipNet, err := net.ParseCIDR(baseCIDR)
	if err != nil {
		return "", 0, "", "", "", fmt.Errorf("invalid APP_NET_CIDR: %w", err)
	}

	// Collect used IPs from deployments.
	row := db.QueryRowContext(ctx, `
		SELECT GROUP_CONCAT(ip_address, ',') FROM deployments WHERE ip_address IS NOT NULL
	`)
	var usedConcat sql.NullString
	_ = row.Scan(&usedConcat)

	used := map[string]struct{}{}
	if usedConcat.Valid {
		for _, s := range strings.Split(usedConcat.String, ",") {
			s = strings.TrimSpace(s)
			if s != "" {
				used[s] = struct{}{}
			}
		}
	}

	// Start scanning from base+10 up to end of subnet.
	ip = ip.To4()
	if ip == nil {
		return "", 0, "", "", "", fmt.Errorf("APP_NET_CIDR must be IPv4")
	}

	start := ip.Mask(ipNet.Mask)
	start[3] += 10

	for i := 10; i < 250; i++ {
		addr := net.IPv4(start[0], start[1], start[2], byte(i))
		if !ipNet.Contains(addr) {
			break
		}
		s := addr.String()
		if _, ok := used[s]; !ok {
			hostname := prefix + strings.ReplaceAll(s, ".", "-")
			_, bits := ipNet.Mask.Size()
			return s, bits, gw, dns, hostname, nil
		}
	}

	return "", 0, "", "", "", fmt.Errorf("no free IP found in %s", baseCIDR)
}

