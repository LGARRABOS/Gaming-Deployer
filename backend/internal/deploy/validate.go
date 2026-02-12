package deploy

import (
	"errors"
	"fmt"
	"net"
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
	if req.MemoryMB < 1024 {
		return errors.New("memory must be at least 1024 MB")
	}
	if req.MemoryMB > 32768 {
		return errors.New("memory must be <= 32768 MB (32 GB)")
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

