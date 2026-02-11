package deploy

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"time"

	"github.com/example/proxmox-game-deployer/internal/config"
)

// Worker polls the jobs table and processes jobs.
type Worker struct {
	DB         Store
	PollInterval time.Duration
	StopCh     chan struct{}
}

// NewWorker constructs a worker with sane defaults.
func NewWorker(db Store) *Worker {
	return &Worker{
		DB:          db,
		PollInterval: 5 * time.Second,
		StopCh:      make(chan struct{}),
	}
}

// Start begins the worker loop in a separate goroutine.
func (w *Worker) Start() {
	go func() {
		for {
			select {
			case <-w.StopCh:
				return
			default:
			}
			if err := w.processNextJob(context.Background()); err != nil && !errors.Is(err, sql.ErrNoRows) {
				log.Printf("worker error: %v", err)
			}
			time.Sleep(w.PollInterval)
		}
	}()
}

// Stop signals the worker to stop.
func (w *Worker) Stop() {
	close(w.StopCh)
}

// processNextJob attempts to lock and execute a single queued job.
func (w *Worker) processNextJob(ctx context.Context) error {
	var job Job
	var deploymentID sql.NullInt64

	err := w.DB.WithTx(ctx, func(tx *sql.Tx) error {
		// SQLite ne supporte pas "FOR UPDATE". Comme le worker est
		// mono-processus dans ce projet, une simple sélection puis mise
		// à jour en transaction est suffisante pour éviter les collisions.
		row := tx.QueryRowContext(ctx, `
			SELECT id, type, payload_json, status, deployment_id, run_after, last_error, attempts, created_at, updated_at
			FROM jobs
			WHERE status = ? AND run_after <= ?
			ORDER BY id
			LIMIT 1
		`, string(JobQueued), time.Now().UTC())

		var lastErr sql.NullString
		if err := row.Scan(
			&job.ID,
			&job.Type,
			&job.PayloadJSON,
			&job.Status,
			&deploymentID,
			&job.RunAfter,
			&lastErr,
			&job.Attempts,
			&job.CreatedAt,
			&job.UpdatedAt,
		); err != nil {
			return err
		}
		if lastErr.Valid {
			msg := lastErr.String
			job.LastError = &msg
		}
		if deploymentID.Valid {
			id := deploymentID.Int64
			job.DeploymentID = &id
		}

		// Mark as running.
		job.Status = JobRunning
		job.Attempts++
		job.UpdatedAt = time.Now().UTC()
		_, err := tx.ExecContext(ctx, `
			UPDATE jobs
			SET status = ?, attempts = ?, updated_at = ?
			WHERE id = ?
		`, string(job.Status), job.Attempts, job.UpdatedAt, job.ID)
		return err
	})

	if err != nil {
		return err
	}

	// Load proxmox config.
	cfg, err := config.LoadProxmoxConfig(ctx, w.DB)
	if err != nil {
		return err
	}

	// ProcessJob can be long running; we run it outside of the transaction.
	err = ProcessJob(ctx, w.DB, &job, cfg)

	finalStatus := JobDone
	var lastError *string
	if err != nil {
		msg := err.Error()
		lastError = &msg
		finalStatus = JobFailed
	}

	// Update job final status.
	_, _ = w.DB.ExecContext(ctx, `
		UPDATE jobs SET status = ?, last_error = ?, updated_at = ?
		WHERE id = ?
	`, string(finalStatus), lastError, time.Now().UTC(), job.ID)

	return err
}

