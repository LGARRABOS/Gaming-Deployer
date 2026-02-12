package main

import (
	"bufio"
	"context"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/example/proxmox-game-deployer/internal/deploy"
	"github.com/example/proxmox-game-deployer/internal/server"
)

func main() {
	// Charge un éventuel fichier .env local pour faciliter la config
	// (utile en dev et en production si le service ne définit pas toutes
	// les variables d'environnement).
	loadEnvFile(".env")

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

// loadEnvFile charge un fichier .env simple (KEY=VALUE, avec support des
// commentaires en fin de ligne) dans les variables d'environnement du
// processus. Les clés déjà présentes ne sont pas écrasées.
func loadEnvFile(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// Retire les commentaires inline (# ...) si présents.
		if i := strings.Index(line, "#"); i >= 0 {
			line = strings.TrimSpace(line[:i])
		}
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, val)
		}
	}
}

