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
	if req.MemoryMB < 1024 {
		return errors.New("memory must be at least 1024 MB")
	}
	if req.DiskGB < 10 {
		return errors.New("disk must be at least 10 GB")
	}
	if req.IPAddress == "" {
		return errors.New("ip_address is required")
	}
	if net.ParseIP(req.IPAddress) == nil {
		return fmt.Errorf("invalid ip_address: %s", req.IPAddress)
	}
	if req.CIDR < 8 || req.CIDR > 32 {
		return fmt.Errorf("invalid cidr: %d", req.CIDR)
	}
	if req.Gateway == "" || net.ParseIP(req.Gateway) == nil {
		return fmt.Errorf("invalid gateway: %s", req.Gateway)
	}
	if req.Minecraft.Port <= 0 || req.Minecraft.Port > 65535 {
		return errors.New("minecraft.port must be between 1 and 65535")
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

