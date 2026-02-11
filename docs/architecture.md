# Architecture fonctionnelle et technique

## Vue d'ensemble

L'application **Proxmox Game Deployer** permet de :

- Configurer la connexion à un cluster Proxmox (wizard initial).
- Créer des jobs de déploiement de serveurs de jeux (Minecraft en premier).
- Orchestrer la création de VMs, la configuration réseau (cloud-init), puis le provisioning du jeu via Ansible.
- Suivre l'état des déploiements et afficher les logs en temps réel dans l'UI.

## Pipeline de déploiement Minecraft

```text
UI (React) -> API Go (/api/deployments)
           -> Enqueue job (SQLite.jobs, SQLite.deployments)
           -> Worker Go (goroutine) :
               1) Client Proxmox (HTTP, token)
                  - NextID
                  - Clone VM depuis template cloud-init
                  - Config CPU/RAM/Disk/Network + ipconfig0
                  - Start VM + wait task
               2) Wait SSH (TCP 22 sur IP fixe)
               3) Provision Ansible (ansible-playbook provision_minecraft.yml)
                  - Install Java
                  - Créer user minecraft
                  - Télécharger jar serveur
                  - server.properties
                  - UFW ports
                  - Service systemd minecraft
               4) Mise à jour statut + result_json
               5) Logs append-only (deployment_logs)
```

## Modèle de données (SQLite)

- `settings` : configuration globale (Proxmox, etc), éventuellement chiffrée via `APP_ENC_KEY`.
- `users` : comptes admins (actuellement un seul suffit).
- `sessions` : sessions HTTP (cookie `session_id`).
- `deployments` : métadonnées des déploiements (type de jeu, JSON d'inputs/outputs, vmid, IP, statuts).
- `deployment_logs` : logs append-only.
- `jobs` : file interne des jobs asynchrones.

## Extensibilité multi-jeux

- Le package `internal/minecraft` définit une structure `Config` et une conversion en `map[string]any` pour Ansible.
- Pour ajouter un jeu :
  - Créer un package `internal/<jeu>` avec une struct de config similaire.
  - Créer un endpoint frontend + backend de création de déploiement.
  - Ajouter un handler de job dédié dans `internal/deploy`.
  - Créer un playbook Ansible spécialisé.

