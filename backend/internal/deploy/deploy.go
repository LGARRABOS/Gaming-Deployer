package deploy

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"time"

	"github.com/google/uuid"

	"github.com/example/proxmox-game-deployer/internal/config"
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
)

// JobStatus represents job state in jobs table.
type JobStatus string

const (
	JobQueued  JobStatus = "queued"
	JobRunning JobStatus = "running"
	JobDone    JobStatus = "done"
	JobFailed  JobStatus = "failed"
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

		appendLog(ctx, db, *deploymentID, "info", "Configuring VM resources and cloud-init networking")
		if err := c.ConfigureVM(ctx, req.Node, vmid, req.Cores, req.MemoryMB, req.DiskGB, req.Bridge, req.VLAN, ipCIDR, req.Gateway); err != nil {
			appendLog(ctx, db, *deploymentID, "error", fmt.Sprintf("Configure VM failed: %v", err))
			return err
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
		if err := runAnsibleMinecraft(ctx, req, ip); err != nil {
			appendLog(ctx, db, *deploymentID, "error", fmt.Sprintf("Ansible provisioning failed: %v", err))
			return err
		}
	}

	result := map[string]any{
		"vmid": vmid,
		"ip":   ip,
		"job":  j.ID,
		"run":  uuid.NewString(),
	}
	rawResult, _ := json.Marshal(result)
	resStr := string(rawResult)
	updateDeploymentStatus(ctx, db, *deploymentID, StatusSuccess, &vmid, &ip, nil, &resStr)
	appendLog(ctx, db, *deploymentID, "info", "Deployment completed successfully")
	return nil
}

// runAnsibleMinecraft spawns ansible-playbook with the relevant variables.
func runAnsibleMinecraft(ctx context.Context, req MinecraftDeploymentRequest, hostIP string) error {
	playbook := "./ansible/provision_minecraft.yml"
	if v := os.Getenv("ANSIBLE_PLAYBOOK_PATH"); v != "" {
		playbook = v
	}

	extraVars := req.Minecraft.ToAnsibleVars()
	extraVars["target_host"] = hostIP
	extraVars["target_user"] = "minecraft"

	extraJSON, err := json.Marshal(extraVars)
	if err != nil {
		return err
	}

	cmd := exec.CommandContext(ctx, "ansible-playbook", playbook, "-i", fmt.Sprintf("%s,", hostIP), "--extra-vars", string(extraJSON))
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

