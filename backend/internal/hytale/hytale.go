package hytale

// Package hytale contains types and helpers to describe a Hytale server
// deployment request. The deploy pipeline uses these values for Ansible provisioning.

// Config describes the configuration for a Hytale server deployment.
type Config struct {
	Port            int    `json:"port"`              // default 5520 (UDP)
	MaxPlayers      int    `json:"max_players"`
	JVMHeap         string `json:"jvm_heap"`          // e.g. "2G"
	JVMFlags        string `json:"jvm_flags"`         // extra JVM flags
	BackupEnabled   bool   `json:"backup_enabled"`
	BackupFrequency string `json:"backup_frequency"`  // e.g. "24h"
	BackupRetention int    `json:"backup_retention"`  // number of backups

	// AdminUser/AdminPassword are populated server-side for SFTP access.
	AdminUser     string `json:"admin_user,omitempty"`
	AdminPassword string `json:"admin_password,omitempty"`
}

// ToAnsibleVars flattens the config into a map usable as --extra-vars for ansible-playbook.
func (c Config) ToAnsibleVars() map[string]any {
	return map[string]any{
		"hytale_port":             c.Port,
		"hytale_max_players":      c.MaxPlayers,
		"hytale_jvm_heap":         c.JVMHeap,
		"hytale_jvm_flags":        c.JVMFlags,
		"hytale_backup_enabled":   c.BackupEnabled,
		"hytale_backup_frequency": c.BackupFrequency,
		"hytale_backup_retention": c.BackupRetention,
		"hytale_admin_user":       c.AdminUser,
		"hytale_admin_password":  c.AdminPassword,
	}
}
