package proxmox

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"time"
)

// Client is a minimal HTTP client for the Proxmox API.
type Client struct {
	baseURL   *url.URL
	tokenID   string
	tokenSecret string
	http      *http.Client
}

// NewClient constructs a new Proxmox API client.
func NewClient(rawURL, tokenID, tokenSecret string) (*Client, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	if u.Scheme == "" {
		u.Scheme = "https"
	}
	// TLS config: par défaut on vérifie le certificat.
	// Si APP_PROXMOX_INSECURE_TLS=true, on ignore les erreurs TLS
	// (pratique pour un lab avec certificat auto-signé).
	insecure := os.Getenv("APP_PROXMOX_INSECURE_TLS") == "true"
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: insecure, //nolint:gosec
		},
	}

	return &Client{
		baseURL:   u,
		tokenID:   tokenID,
		tokenSecret: tokenSecret,
		http: &http.Client{
			Timeout:   30 * time.Second,
			Transport: tr,
		},
	}, nil
}

// do issues an HTTP request with Proxmox auth headers and decodes JSON.
func (c *Client) do(ctx context.Context, method, path string, query url.Values, out any) error {
	u := *c.baseURL
	u.Path = "/api2/json" + path
	if len(query) > 0 {
		u.RawQuery = query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", fmt.Sprintf("PVEAPIToken=%s=%s", c.tokenID, c.tokenSecret))
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("proxmox api error: %s", resp.Status)
	}
	if out == nil {
		return nil
	}
	var wrapper struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&wrapper); err != nil {
		return err
	}
	if len(wrapper.Data) == 0 || string(wrapper.Data) == "null" {
		return nil
	}
	return json.Unmarshal(wrapper.Data, out)
}

// TestConnection simply calls /nodes to ensure credentials are valid.
func (c *Client) TestConnection(ctx context.Context) error {
	var nodes []map[string]any
	return c.do(ctx, http.MethodGet, "/nodes", nil, &nodes)
}

// NextID returns the next VMID.
func (c *Client) NextID(ctx context.Context) (int, error) {
	var idStr string
	if err := c.do(ctx, http.MethodGet, "/cluster/nextid", nil, &idStr); err != nil {
		return 0, err
	}
	var id int
	if _, err := fmt.Sscanf(idStr, "%d", &id); err != nil {
		return 0, err
	}
	return id, nil
}

// CloneVM clones a VM from a template VMID on a given node.
func (c *Client) CloneVM(ctx context.Context, node string, templateVMID, newVMID int, name, storage string) (string, error) {
	// POST /nodes/{node}/qemu/{vmid}/clone
	path := fmt.Sprintf("/nodes/%s/qemu/%d/clone", node, templateVMID)
	q := url.Values{}
	q.Set("newid", fmt.Sprintf("%d", newVMID))
	q.Set("name", name)
	// NOTE: on ne force plus le storage ici pour éviter les combinaisons
	// invalides selon le type de template (linked/full clone). Proxmox
	// utilisera le même storage que le template par défaut.
	var taskID string
	if err := c.do(ctx, http.MethodPost, path, q, &taskID); err != nil {
		return "", err
	}
	return taskID, nil
}

// ConfigureVM sets CPU, memory and network including cloud-init ipconfig0.
func (c *Client) ConfigureVM(ctx context.Context, node string, vmid int, cores, memoryMB, diskGB int, bridge string, vlanTag *int, ipCIDR, gateway string) error {
	path := fmt.Sprintf("/nodes/%s/qemu/%d/config", node, vmid)
	q := url.Values{}
	if cores > 0 {
		q.Set("cores", fmt.Sprintf("%d", cores))
	}
	if memoryMB > 0 {
		q.Set("memory", fmt.Sprintf("%d", memoryMB))
	}
	net := fmt.Sprintf("virtio,bridge=%s", bridge)
	if vlanTag != nil {
		net = net + fmt.Sprintf(",tag=%d", *vlanTag)
	}
	q.Set("net0", net)
	if ipCIDR != "" && gateway != "" {
		q.Set("ipconfig0", fmt.Sprintf("ip=%s,gw=%s", ipCIDR, gateway))
	}
	// Tag VMs déployées par l'application pour les filtrer facilement.
	q.Set("tags", "Minecraft-Auto-Serveur")
	return c.do(ctx, http.MethodPost, path, q, nil)
}

// UpdateVMConfig updates CPU and memory of an existing VM (partial config update).
func (c *Client) UpdateVMConfig(ctx context.Context, node string, vmid, cores, memoryMB int) error {
	path := fmt.Sprintf("/nodes/%s/qemu/%d/config", node, vmid)
	q := url.Values{}
	if cores > 0 {
		q.Set("cores", fmt.Sprintf("%d", cores))
	}
	if memoryMB > 0 {
		q.Set("memory", fmt.Sprintf("%d", memoryMB))
	}
	return c.do(ctx, http.MethodPost, path, q, nil)
}

// ResizeDisk adjusts the size of a VM disk using the Proxmox resize endpoint.
// For simplicity we resize scsi0 to an absolute size in gigabytes, similar to:
//   qm resize <vmid> scsi0 100G
func (c *Client) ResizeDisk(ctx context.Context, node string, vmid, diskGB int) (string, error) {
	if diskGB <= 0 {
		return "", nil
	}
	path := fmt.Sprintf("/nodes/%s/qemu/%d/resize", node, vmid)
	q := url.Values{}
	q.Set("disk", "scsi0")
	q.Set("size", fmt.Sprintf("%dG", diskGB))
	var taskID string
	// L'API Proxmox attend une requête PUT sur /resize (équivalent à qm resize).
	if err := c.do(ctx, http.MethodPut, path, q, &taskID); err != nil {
		return "", err
	}
	return taskID, nil
}

// StartVM starts the VM.
func (c *Client) StartVM(ctx context.Context, node string, vmid int) (string, error) {
	path := fmt.Sprintf("/nodes/%s/qemu/%d/status/start", node, vmid)
	var taskID string
	if err := c.do(ctx, http.MethodPost, path, nil, &taskID); err != nil {
		return "", err
	}
	return taskID, nil
}

// StopVM stops the VM.
func (c *Client) StopVM(ctx context.Context, node string, vmid int) (string, error) {
	path := fmt.Sprintf("/nodes/%s/qemu/%d/status/stop", node, vmid)
	var taskID string
	if err := c.do(ctx, http.MethodPost, path, nil, &taskID); err != nil {
		return "", err
	}
	return taskID, nil
}

// DeleteVM removes the VM from Proxmox.
func (c *Client) DeleteVM(ctx context.Context, node string, vmid int) (string, error) {
	path := fmt.Sprintf("/nodes/%s/qemu/%d", node, vmid)
	var taskID string
	if err := c.do(ctx, http.MethodDelete, path, nil, &taskID); err != nil {
		return "", err
	}
	return taskID, nil
}

// WaitForTask waits for a Proxmox task to complete.
func (c *Client) WaitForTask(ctx context.Context, node, upid string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		if time.Now().After(deadline) {
			return fmt.Errorf("timeout waiting for proxmox task %s", upid)
		}
		var task struct {
			Status string `json:"status"`
		}
		// Important: Proxmox attend l'UPID brut dans l'URL (avec les ':'),
		// et n'aime pas forcément la version échappée. On utilise donc
		// directement la chaîne telle que renvoyée par l'API.
		path := fmt.Sprintf("/nodes/%s/tasks/%s/status", node, upid)
		if err := c.do(ctx, http.MethodGet, path, nil, &task); err != nil {
			return err
		}
		if task.Status == "stopped" || task.Status == "OK" {
			return nil
		}
		time.Sleep(3 * time.Second)
	}
}

// WaitForSSH waits until the given host:port is accessible via TCP.
func (c *Client) WaitForSSH(ctx context.Context, host string, port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	addr := fmt.Sprintf("%s:%d", host, port)
	for {
		if time.Now().After(deadline) {
			return fmt.Errorf("timeout waiting for ssh on %s", addr)
		}
		d := net.Dialer{Timeout: 5 * time.Second}
		conn, err := d.DialContext(ctx, "tcp", addr)
		if err == nil {
			_ = conn.Close()
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
}

