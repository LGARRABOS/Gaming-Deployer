package minecraft

// Package minecraft contains types and helpers to describe a Minecraft server
// deployment request in a provider-agnostic way. The deploy pipeline will use
// these values to drive the provisioning (via Ansible).

// Edition represents the Minecraft edition.
type Edition string

const (
	EditionJava Edition = "java"
)

// ServerType represents the distribution.
type ServerType string

const (
	TypeVanilla ServerType = "vanilla"
	TypePaper   ServerType = "paper"
	TypePurpur  ServerType = "purpur"
	TypeForge   ServerType = "forge"
	TypeFabric  ServerType = "fabric"
)

// ModDescriptor describes a single mod to be installed.
type ModDescriptor struct {
	URL  string  `json:"url"`
	Hash *string `json:"hash,omitempty"`
}

// Config describes the full configuration for a Minecraft server deployment.
type Config struct {
	Edition  Edition        `json:"edition"`
	Version  string         `json:"version"`
	Type     ServerType     `json:"type"`
	Modded   bool           `json:"modded"`
	Mods     []ModDescriptor `json:"mods,omitempty"`

	Port            int      `json:"port"`
	ExtraPorts      []int    `json:"extra_ports,omitempty"`
	EULA            bool     `json:"eula"`
	MaxPlayers      int      `json:"max_players"`
	OnlineMode      bool     `json:"online_mode"`
	MOTD            string   `json:"motd"`
	Whitelist       []string `json:"whitelist,omitempty"`
	Operators       []string `json:"operators,omitempty"`
	JVMHeap         string   `json:"jvm_heap"`          // e.g. "2G"
	JVMFlags        string   `json:"jvm_flags"`         // extra flags
	BackupEnabled   bool     `json:"backup_enabled"`
	BackupFrequency string   `json:"backup_frequency"`  // e.g. "daily"
	BackupRetention int      `json:"backup_retention"`  // number of backups

	// AdminUser/AdminPassword are populated server-side to create an SFTP/admin
	// user on the VM for managing the Minecraft files. They are not expected
	// from the public API payload.
	AdminUser     string `json:"admin_user,omitempty"`
	AdminPassword string `json:"admin_password,omitempty"`
}

// ToAnsibleVars flattens the config into a map usable as --extra-vars for ansible-playbook.
func (c Config) ToAnsibleVars() map[string]any {
	mods := make([]map[string]any, 0, len(c.Mods))
	for _, mod := range c.Mods {
		entry := map[string]any{"url": mod.URL}
		if mod.Hash != nil {
			entry["hash"] = *mod.Hash
		}
		mods = append(mods, entry)
	}

	return map[string]any{
		"mc_edition":          string(c.Edition),
		"mc_version":          c.Version,
		"mc_type":             string(c.Type),
		"mc_modded":           c.Modded,
		"mc_mods":             mods,
		"mc_port":             c.Port,
		"mc_extra_ports":      c.ExtraPorts,
		"mc_eula":             c.EULA,
		"mc_max_players":      c.MaxPlayers,
		"mc_online_mode":      c.OnlineMode,
		"mc_motd":             c.MOTD,
		"mc_whitelist":        c.Whitelist,
		"mc_operators":        c.Operators,
		"mc_jvm_heap":         c.JVMHeap,
		"mc_jvm_flags":        c.JVMFlags,
		"mc_backup_enabled":   c.BackupEnabled,
		"mc_backup_frequency": c.BackupFrequency,
		"mc_backup_retention": c.BackupRetention,
		"mc_admin_user":       c.AdminUser,
		"mc_admin_password":   c.AdminPassword,
	}
}

