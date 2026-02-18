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
	username := flag.String("user", "", "Nom d'utilisateur à promouvoir en propriétaire (recherche insensible à la casse)")
	userID := flag.Int64("id", 0, "ID de l'utilisateur à promouvoir (alternative à -user)")
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
		if len(users) == 0 {
			fmt.Println("\nAucun utilisateur. Vérifiez le chemin de la base (-db). L'app utilise peut-être un autre fichier (ex: /opt/proxmox-game-deployer/data/app.db).")
		}
		return
	}

	if *username == "" && *userID == 0 {
		fmt.Println("Usage:")
		fmt.Println("  Lister les utilisateurs:")
		fmt.Println("    ./set-owner -db /chemin/vers/app.db -list")
		fmt.Println("")
		fmt.Println("  Promouvoir par nom d'utilisateur (insensible à la casse):")
		fmt.Println("    ./set-owner -db /chemin/vers/app.db -user Magickblack")
		fmt.Println("")
		fmt.Println("  Promouvoir par ID (si -list affiche l'utilisateur):")
		fmt.Println("    ./set-owner -db /chemin/vers/app.db -id 1")
		os.Exit(1)
	}

	var targetID int64
	var displayName string

	if *userID != 0 {
		var role string
		err := database.QueryRowContext(ctx, `SELECT id, username, COALESCE(role,'user') FROM users WHERE id = ?`, *userID).Scan(&targetID, &displayName, &role)
		if err != nil {
			log.Fatalf("Utilisateur ID %d introuvable: %v", *userID, err)
		}
		if role == auth.RoleOwner {
			fmt.Printf("L'utilisateur '%s' (ID: %d) est déjà propriétaire.\n", displayName, targetID)
			return
		}
	} else {
		// Recherche par nom : insensible à la casse (SQLite LOWER)
		var role string
		err := database.QueryRowContext(ctx, `
			SELECT id, username, COALESCE(role,'user') FROM users WHERE LOWER(TRIM(username)) = LOWER(TRIM(?))
		`, *username).Scan(&targetID, &displayName, &role)
		if err != nil {
			log.Fatalf("Utilisateur '%s' introuvable. Lancez -list pour voir les noms exacts, ou utilisez -id N.", *username)
		}
		if role == auth.RoleOwner {
			fmt.Printf("L'utilisateur '%s' est déjà propriétaire.\n", displayName)
			return
		}
	}

	// Promouvoir en owner
	_, err = database.ExecContext(ctx, `UPDATE users SET role = ? WHERE id = ?`, auth.RoleOwner, targetID)
	if err != nil {
		log.Fatalf("Erreur promotion: %v", err)
	}

	fmt.Printf("✓ Utilisateur '%s' (ID: %d) promu en propriétaire.\n", displayName, targetID)
}
