package sshexec

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// KeyPath returns the SSH private key path (APP_SSH_KEY_PATH or default).
func KeyPath() string {
	if p := os.Getenv("APP_SSH_KEY_PATH"); strings.TrimSpace(p) != "" {
		return p
	}
	return "./ssh/id_ed25519"
}

// RunCommand runs a single command on host as user via SSH, using the app's key.
// Returns stdout, stderr, and error.
func RunCommand(ctx context.Context, host, user, keyPath, command string) (stdout, stderr string, err error) {
	if keyPath == "" {
		keyPath = KeyPath()
	}
	args := []string{
		"-i", keyPath,
		"-o", "StrictHostKeyChecking=no",
		"-o", "UserKnownHostsFile=/dev/null",
		"-o", "ConnectTimeout=15",
		fmt.Sprintf("%s@%s", user, host),
		command,
	}
	cmd := exec.CommandContext(ctx, "ssh", args...)
	var outBuf, errBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &errBuf
	if runErr := cmd.Run(); runErr != nil {
		return outBuf.String(), errBuf.String(), runErr
	}
	return outBuf.String(), errBuf.String(), nil
}
