package deploy

import (
	"errors"
	"fmt"
	"net"
)

// ValidateHytaleRequest performs basic validation on Hytale deployment inputs.
func ValidateHytaleRequest(req HytaleDeploymentRequest) error {
	if req.Name == "" {
		return errors.New("name is required")
	}
	if req.Cores <= 0 {
		return errors.New("cores must be > 0")
	}
	if req.Cores > 4 {
		return errors.New("cores must be <= 4")
	}
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

	if req.Hytale.Port != 0 {
		if req.Hytale.Port <= 0 || req.Hytale.Port > 65535 {
			return errors.New("hytale.port must be between 1 and 65535")
		}
	}
	if req.Hytale.MaxPlayers <= 0 {
		return errors.New("max_players must be > 0")
	}
	return nil
}
