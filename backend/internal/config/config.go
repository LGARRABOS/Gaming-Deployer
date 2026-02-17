package config

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"time"
)

// Store is the subset of DB operations we need.
type Store interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// AppConfigKey is the settings key storing whether the app is initialized.
const AppConfigKey = "app_initialized"

// ProxmoxConfigKey is the settings key for proxmox configuration.
const ProxmoxConfigKey = "proxmox_config"

// ProxmoxConfig holds the configuration required to talk to Proxmox and to provision VMs.
type ProxmoxConfig struct {
	APIURL          string   `json:"api_url"`
	APITokenID      string   `json:"api_token_id"`
	APITokenSecret  string   `json:"api_token_secret"`
	DefaultNode     string   `json:"default_node"`
	DefaultStorage  string   `json:"default_storage"`
	DefaultBridge   string   `json:"default_bridge"`
	TemplateVMID    int      `json:"template_vmid"`
	SSHUser         string   `json:"ssh_user"`
	SSHPublicKey    string   `json:"ssh_public_key"`
	AllowedNodes    []string `json:"allowed_nodes"`
	CloudInitConfig string   `json:"cloud_init_config,omitempty"`
	CreatedAt       string   `json:"created_at"`
}

// IsInitialized reports whether the application has completed the setup wizard.
func IsInitialized(ctx context.Context, db Store) (bool, error) {
	row := db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, AppConfigKey)
	var v string
	err := row.Scan(&v)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return v == "true", nil
}

// MarkInitialized writes the flag in settings.
func MarkInitialized(ctx context.Context, db Store) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, AppConfigKey, "true")
	return err
}

// SaveProxmoxConfig stores the Proxmox configuration in the settings table.
// If APP_ENC_KEY is set, the value will be encrypted; otherwise it will be stored as plain JSON.
func SaveProxmoxConfig(ctx context.Context, db Store, cfg ProxmoxConfig) error {
	cfg.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	raw, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	value := string(raw)
	if key := os.Getenv("APP_ENC_KEY"); key != "" {
		enc, err := encrypt(value, key)
		if err != nil {
			return err
		}
		value = "enc:" + enc
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, ProxmoxConfigKey, value)
	return err
}

// LoadProxmoxConfig loads and optionally decrypts the Proxmox configuration.
func LoadProxmoxConfig(ctx context.Context, db Store) (*ProxmoxConfig, error) {
	row := db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, ProxmoxConfigKey)
	var v string
	if err := row.Scan(&v); err != nil {
		return nil, err
	}
	if len(v) > 4 && v[:4] == "enc:" {
		key := os.Getenv("APP_ENC_KEY")
		if key != "" {
			dec, err := decrypt(v[4:], key)
			if err == nil {
				v = dec
			}
		}
	}
	var cfg ProxmoxConfig
	if err := json.Unmarshal([]byte(v), &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

