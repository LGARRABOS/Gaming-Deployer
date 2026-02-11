package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/example/proxmox-game-deployer/internal/deploy"
	"github.com/example/proxmox-game-deployer/internal/server"
)

func main() {
	addr := getenv("APP_LISTEN_ADDR", ":5298")
	dbPath := getenv("APP_DB_PATH", "./data/app.db")

	if err := os.MkdirAll("./data", 0o700); err != nil {
		log.Fatalf("failed to create data dir: %v", err)
	}

	ctx := context.Background()
	srv, err := server.New(ctx, dbPath)
	if err != nil {
		log.Fatalf("failed to init server: %v", err)
	}
	defer srv.Close()

	// Start background worker for jobs.
	worker := deploy.NewWorker(srv.DB)
	worker.Start()
	defer worker.Stop()

	// Graceful shutdown handling.
	go func() {
		if err := srv.ListenAndServe(addr); err != nil {
			log.Fatalf("http server stopped: %v", err)
		}
	}()

	log.Printf("server started on %s", addr)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Printf("shutting down...")
	// allow background goroutines a bit of time to finish
	time.Sleep(2 * time.Second)
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

