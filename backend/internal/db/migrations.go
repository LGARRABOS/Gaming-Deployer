package db

import (
	"context"
	"fmt"
)

// Migrate applies all required schema objects. It is idempotent.
func (d *DB) Migrate(ctx context.Context) error {
	stmts := []string{
		// settings: generic key/value configuration store
		`CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);`,
		// users: admin accounts (for l’instant, un seul admin suffira)
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			created_at DATETIME NOT NULL
		);`,
		// sessions: cookie-based sessions
		`CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			expires_at DATETIME NOT NULL,
			created_at DATETIME NOT NULL,
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,
		// deployments: high-level deployment records
		`CREATE TABLE IF NOT EXISTS deployments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			game TEXT NOT NULL,
			type TEXT NOT NULL,
			request_json TEXT NOT NULL,
			result_json TEXT,
			vmid INTEGER,
			ip_address TEXT,
			status TEXT NOT NULL,
			error_message TEXT,
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL
		);`,
		// deployment_logs: append-only logs for each deployment
		`CREATE TABLE IF NOT EXISTS deployment_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			deployment_id INTEGER NOT NULL,
			ts DATETIME NOT NULL,
			level TEXT NOT NULL,
			message TEXT NOT NULL,
			FOREIGN KEY(deployment_id) REFERENCES deployments(id) ON DELETE CASCADE
		);`,
		// jobs: internal queue
		`CREATE TABLE IF NOT EXISTS jobs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			type TEXT NOT NULL,
			payload_json TEXT NOT NULL,
			status TEXT NOT NULL,
			deployment_id INTEGER,
			run_after DATETIME NOT NULL,
			last_error TEXT,
			attempts INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL,
			FOREIGN KEY(deployment_id) REFERENCES deployments(id) ON DELETE SET NULL
		);`,
		// monitoring_samples: 1 point/min per server, 12h retention (collector runs on server)
		`CREATE TABLE IF NOT EXISTS monitoring_samples (
			deployment_id INTEGER NOT NULL,
			ts INTEGER NOT NULL,
			cpu REAL NOT NULL,
			ram_pct REAL NOT NULL,
			disk_pct REAL NOT NULL,
			tps REAL,
			players INTEGER,
			PRIMARY KEY (deployment_id, ts),
			FOREIGN KEY(deployment_id) REFERENCES deployments(id) ON DELETE CASCADE
		);`,
		`CREATE INDEX IF NOT EXISTS idx_monitoring_samples_deployment_ts ON monitoring_samples(deployment_id, ts);`,
	}

	for i, stmt := range stmts {
		if _, err := d.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("migration %d failed: %w", i, err)
		}
	}
	return nil
}

