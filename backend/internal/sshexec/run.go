package sshexec

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
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

// StreamCommand runs a long-lived command and streams each line of stdout to the callback.
// It returns when the context is cancelled, the command exits, or the callback returns an error.
func StreamCommand(ctx context.Context, host, user, keyPath, command string, onLine func(line string) error) error {
	if keyPath == "" {
		keyPath = KeyPath()
	}
	args := []string{
		"-i", keyPath,
		"-o", "StrictHostKeyChecking=no",
		"-o", "UserKnownHostsFile=/dev/null",
		"-o", "ConnectTimeout=15",
		"-o", "ServerAliveInterval=15",
		fmt.Sprintf("%s@%s", user, host),
		command,
	}
	cmd := exec.CommandContext(ctx, "ssh", args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	defer func() { _ = cmd.Wait() }()
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := onLine(scanner.Text()); err != nil {
			return err
		}
	}
	if err := scanner.Err(); err != nil && err != io.EOF {
		return err
	}
	return nil
}
