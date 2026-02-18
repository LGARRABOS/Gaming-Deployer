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
	TypeVanilla  ServerType = "vanilla"
	TypePaper    ServerType = "paper"
	TypePurpur   ServerType = "purpur"
	TypeForge    ServerType = "forge"
	TypeFabric   ServerType = "fabric"
	TypeNeoForge ServerType = "neoforge"
)

// ModDescriptor describes a single mod to be installed.
type ModDescriptor struct {
	URL  string  `json:"url"`
	Hash *string `json:"hash,omitempty"`
}

// ModpackSpec describes a server modpack to install (e.g. CurseForge server pack).
type ModpackSpec struct {
	Provider  string `json:"provider"`   // e.g. "curseforge"
	ProjectID int    `json:"project_id"` // CurseForge project/mod ID
	FileID    int    `json:"file_id"`    // CurseForge file ID (server pack)
}

// Config describes the full configuration for a Minecraft server deployment.
type Config struct {
	Edition Edition        `json:"edition"`
	Version string         `json:"version"`
	Type    ServerType     `json:"type"`
	Modded  bool           `json:"modded"`
	Mods    []ModDescriptor `json:"mods,omitempty"`
	Modpack *ModpackSpec   `json:"modpack,omitempty"`
	// ModpackURL allows specifying a direct URL to a server pack archive (ZIP),
	// without going through the CurseForge API. If both Modpack and ModpackURL are
	// set, Modpack takes precedence.
	ModpackURL string       `json:"modpack_url,omitempty"`

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
	BackupFrequency string   `json:"backup_frequency"` // e.g. "daily"
	BackupRetention int      `json:"backup_retention"` // number of backups

	// RCON configuration for remote console commands. These fields are populated
	// server-side; the public API does not need to provide them.
	RCONEnabled  bool   `json:"rcon_enabled,omitempty"`
	RCONPort     int    `json:"rcon_port,omitempty"`
	RCONPassword string `json:"rcon_password,omitempty"`

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
	var modpack map[string]any
	if c.Modpack != nil {
		modpack = map[string]any{
			"provider":   c.Modpack.Provider,
			"project_id": c.Modpack.ProjectID,
			"file_id":    c.Modpack.FileID,
		}
	}

	return map[string]any{
		"mc_edition":          string(c.Edition),
		"mc_version":          c.Version,
		"mc_type":             string(c.Type),
		"mc_modded":           c.Modded,
		"mc_mods":             mods,
		"mc_modpack":          modpack,
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
		"mc_rcon_enabled":     c.RCONEnabled,
		"mc_rcon_port":        c.RCONPort,
		"mc_rcon_password":    c.RCONPassword,
	}
}

