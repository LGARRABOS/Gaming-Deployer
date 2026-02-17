package deploy

import (
	"errors"
	"fmt"
	"net"
	"strings"
)

// ValidateMinecraftRequest performs basic validation on deployment inputs.
func ValidateMinecraftRequest(req MinecraftDeploymentRequest) error {
	if req.Name == "" {
		return errors.New("name is required")
	}
	if req.Cores <= 0 {
		return errors.New("cores must be > 0")
	}
	if req.Cores > 4 {
		return errors.New("cores must be <= 4")
	}
	// RAM: only predefined options (4, 8, 12, 16, 24, 32 GB).
	allowedRAM := map[int]bool{
		4096: true,  // 4 GB
		8192: true,  // 8 GB
		12288: true, // 12 GB
		16384: true, // 16 GB
		24576: true, // 24 GB
		32768: true, // 32 GB
	}
	if !allowedRAM[req.MemoryMB] {
		return errors.New("memory must be one of: 4096, 8192, 12288, 16384, 24576, 32768 MB (4, 8, 12, 16, 24, 32 GB)")
	}
	if req.DiskGB < 10 {
		return errors.New("disk must be at least 10 GB")
	}
	if req.DiskGB > 500 {
		return errors.New("disk must be <= 500 GB")
	}

	// Network: IP/gateway are optional now (auto-allocation).
	// If provided, validate; otherwise, they will be filled in server-side.
	if req.IPAddress != "" {
		if net.ParseIP(req.IPAddress) == nil {
			return fmt.Errorf("invalid ip_address: %s", req.IPAddress)
		}
		if req.CIDR < 8 || req.CIDR > 32 {
			return fmt.Errorf("invalid cidr: %d", req.CIDR)
		}
		if req.Gateway == "" || net.ParseIP(req.Gateway) == nil {
			return fmt.Errorf("invalid gateway: %s", req.Gateway)
		}
	}

	// Vanilla, Forge and Fabric: version is required (1.x.x release, e.g. 1.20.4).
	if req.Minecraft.Type == "vanilla" || req.Minecraft.Type == "forge" || req.Minecraft.Type == "fabric" {
		if strings.TrimSpace(req.Minecraft.Version) == "" {
			return errors.New("minecraft.version is required (e.g. 1.20.4)")
		}
	}
	// Ports: main port optional (auto from base), but if present must be valid.
	if req.Minecraft.Port != 0 {
		if req.Minecraft.Port <= 0 || req.Minecraft.Port > 65535 {
			return errors.New("minecraft.port must be between 1 and 65535")
		}
	}
	for _, p := range req.Minecraft.ExtraPorts {
		if p <= 0 || p > 65535 {
			return fmt.Errorf("extra port %d must be between 1 and 65535", p)
		}
	}
	if req.Minecraft.MaxPlayers <= 0 {
		return errors.New("max_players must be > 0")
	}
	return nil
}

