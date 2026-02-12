package sshkeys

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// keyPathFromEnv returns the private key path for the app-managed SSH key.
// It prefers APP_SSH_KEY_PATH when set, otherwise falls back to a default
// location inside the working directory.
func keyPathFromEnv() string {
	if p := os.Getenv("APP_SSH_KEY_PATH"); strings.TrimSpace(p) != "" {
		return p
	}
	return "./ssh/id_ed25519"
}

// EnsureKeyPair makes sure the SSH key pair exists and returns the public key.
// If the key pair does not exist, it is generated using ssh-keygen.
func EnsureKeyPair() (string, error) {
	path := keyPathFromEnv()
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := generateKeyPair(path); err != nil {
			return "", err
		}
	}
	pub, err := os.ReadFile(path + ".pub")
	if err != nil {
		return "", fmt.Errorf("reading public key: %w", err)
	}
	return strings.TrimSpace(string(pub)), nil
}

// RegenerateKeyPair recreates the SSH key pair and returns the new public key.
func RegenerateKeyPair() (string, error) {
	path := keyPathFromEnv()
	_ = os.Remove(path)
	_ = os.Remove(path + ".pub")
	if err := generateKeyPair(path); err != nil {
		return "", err
	}
	pub, err := os.ReadFile(path + ".pub")
	if err != nil {
		return "", fmt.Errorf("reading public key: %w", err)
	}
	return strings.TrimSpace(string(pub)), nil
}

// generateKeyPair uses ssh-keygen to generate an ed25519 key pair at path.
func generateKeyPair(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("mkdir ssh dir: %w", err)
	}
	// ssh-keygen -t ed25519 -f <path> -N ""
	cmd := exec.Command("ssh-keygen", "-t", "ed25519", "-f", path, "-N", "")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ssh-keygen failed: %w", err)
	}
	return nil
}

