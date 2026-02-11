package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"time"

	"database/sql"

	"golang.org/x/crypto/bcrypt"
)

// User represents an authenticated user.
type User struct {
	ID        int64
	Username  string
	CreatedAt time.Time
}

// Store is the subset of DB operations used by the auth package.
type Store interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	WithTx(ctx context.Context, fn func(tx *sql.Tx) error) error
}

var (
	// ErrInvalidCredentials is returned when login fails.
	ErrInvalidCredentials = errors.New("invalid credentials")
)

// HashPassword hashes a plaintext password.
func HashPassword(plaintext string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(plaintext), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// VerifyPassword verifies a password against its hash.
func VerifyPassword(hash, plaintext string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plaintext))
}

// CreateUser creates a new user with the given username and password.
func CreateUser(ctx context.Context, db Store, username, password string) (*User, error) {
	pwHash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}

	var id int64
	now := time.Now().UTC()
	err = db.WithTx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `
			INSERT INTO users (username, password_hash, created_at)
			VALUES (?, ?, ?)
		`, username, pwHash, now)
		if err != nil {
			return err
		}
		id, err = res.LastInsertId()
		return err
	})
	if err != nil {
		return nil, err
	}
	return &User{ID: id, Username: username, CreatedAt: now}, nil
}

// GetUserByUsername fetches a user by username.
func GetUserByUsername(ctx context.Context, db Store, username string) (*User, string, error) {
	row := db.QueryRowContext(ctx, `
		SELECT id, username, password_hash, created_at
		FROM users
		WHERE username = ?
	`, username)

	var u User
	var hash string
	if err := row.Scan(&u.ID, &u.Username, &hash, &u.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, "", ErrInvalidCredentials
		}
		return nil, "", err
	}
	return &u, hash, nil
}

// Session represents an authenticated session stored in DB.
type Session struct {
	ID        string
	UserID    int64
	ExpiresAt time.Time
	CreatedAt time.Time
}

// NewSessionID generates a random session ID.
func NewSessionID() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

// CreateSession creates a new session for the user.
func CreateSession(ctx context.Context, db Store, userID int64, ttl time.Duration) (*Session, error) {
	id, err := NewSessionID()
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	expires := now.Add(ttl)
	if _, err := db.ExecContext(ctx, `
		INSERT INTO sessions (id, user_id, expires_at, created_at)
		VALUES (?, ?, ?, ?)
	`, id, userID, expires, now); err != nil {
		return nil, err
	}
	return &Session{ID: id, UserID: userID, ExpiresAt: expires, CreatedAt: now}, nil
}

// GetSession loads a session by ID if it exists and is not expired.
func GetSession(ctx context.Context, db Store, id string) (*Session, error) {
	row := db.QueryRowContext(ctx, `
		SELECT id, user_id, expires_at, created_at
		FROM sessions
		WHERE id = ?
	`, id)
	var s Session
	if err := row.Scan(&s.ID, &s.UserID, &s.ExpiresAt, &s.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}
	if time.Now().After(s.ExpiresAt) {
		return nil, ErrInvalidCredentials
	}
	return &s, nil
}

// DeleteSession deletes a session by ID.
func DeleteSession(ctx context.Context, db Store, id string) error {
	_, err := db.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, id)
	return err
}

