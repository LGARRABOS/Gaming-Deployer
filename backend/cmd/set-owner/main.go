package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/example/proxmox-game-deployer/internal/auth"
	"github.com/example/proxmox-game-deployer/internal/db"
)

func main() {
	dbPath := flag.String("db", "./data/app.db", "Chemin vers la base de données SQLite")
	username := flag.String("user", "", "Nom d'utilisateur à promouvoir en propriétaire")
	listUsers := flag.Bool("list", false, "Lister tous les utilisateurs")
	flag.Parse()

	if *dbPath == "" {
		log.Fatal("--db requis")
	}

	database, err := db.Open(*dbPath)
	if err != nil {
		log.Fatalf("Erreur ouverture DB: %v", err)
	}
	defer database.Close()

	ctx := context.Background()

	// Exécuter les migrations (ajout colonne role, etc.) si nécessaire
	if err := database.Migrate(ctx); err != nil {
		log.Fatalf("Erreur migrations: %v", err)
	}

	if *listUsers {
		users, err := auth.ListUsers(ctx, database)
		if err != nil {
			log.Fatalf("Erreur liste utilisateurs: %v", err)
		}
		fmt.Println("\nUtilisateurs:")
		fmt.Println("ID\tUsername\tRôle")
		fmt.Println("--\t--------\t----")
		for _, u := range users {
			fmt.Printf("%d\t%s\t\t%s\n", u.ID, u.Username, u.Role)
		}
		return
	}

	if *username == "" {
		fmt.Println("Usage:")
		fmt.Println("  Lister les utilisateurs:")
		fmt.Println("    go run cmd/set-owner/main.go -db ./data/app.db -list")
		fmt.Println("")
		fmt.Println("  Promouvoir un utilisateur en propriétaire:")
		fmt.Println("    go run cmd/set-owner/main.go -db ./data/app.db -user nom_utilisateur")
		fmt.Println("")
		fmt.Println("  Ou avec le binaire compilé:")
		fmt.Println("    ./set-owner -db ./data/app.db -user nom_utilisateur")
		os.Exit(1)
	}

	// Vérifier que l'utilisateur existe
	u, _, err := auth.GetUserByUsername(ctx, database, *username)
	if err != nil {
		log.Fatalf("Utilisateur '%s' introuvable: %v", *username, err)
	}

	if u.Role == auth.RoleOwner {
		fmt.Printf("L'utilisateur '%s' est déjà propriétaire.\n", *username)
		return
	}

	// Promouvoir en owner
	_, err = database.ExecContext(ctx, `UPDATE users SET role = ? WHERE id = ?`, auth.RoleOwner, u.ID)
	if err != nil {
		log.Fatalf("Erreur promotion: %v", err)
	}

	fmt.Printf("✓ Utilisateur '%s' (ID: %d) promu en propriétaire.\n", *username, u.ID)
}
