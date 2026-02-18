package db

import (
	"context"
	"database/sql"
	"errors"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// DB wraps the sql.DB and exposes higher level helpers.
type DB struct {
	sql *sql.DB
}

// Open opens (or creates) a SQLite database at the given path.
func Open(path string) (*DB, error) {
	sqlDB, err := sql.Open("sqlite3", path+"?_foreign_keys=on&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(1)
	return &DB{sql: sqlDB}, nil
}

// Close closes the underlying DB.
func (d *DB) Close() error {
	if d == nil || d.sql == nil {
		return nil
	}
	return d.sql.Close()
}

// WithTx runs fn inside a SQL transaction.
func (d *DB) WithTx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// ExecContext is a convenience wrapper around sql.DB.ExecContext.
func (d *DB) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return d.sql.ExecContext(ctx, query, args...)
}

// QueryRowContext wraps sql.DB.QueryRowContext.
func (d *DB) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return d.sql.QueryRowContext(ctx, query, args...)
}

// QueryContext wraps sql.DB.QueryContext.
func (d *DB) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return d.sql.QueryContext(ctx, query, args...)
}

// Sql exposes the underlying *sql.DB for advanced queries.
func (d *DB) Sql() *sql.DB {
	return d.sql
}

// Now returns current UTC time, centralised for easy stubbing in tests.
func Now() time.Time {
	return time.Now().UTC()
}

var (
	// ErrNotFound is returned when a row is not found.
	ErrNotFound = errors.New("not found")
)

