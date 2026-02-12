# Proxmox Game Deployer

Application web pour déployer automatiquement des VMs Proxmox et des serveurs de jeux, en commençant par Minecraft (Java).

Backend en **Go**, frontend en **React + Vite + TypeScript**, stockage en **SQLite**, provisioning via **Ansible**, exécution sous **systemd** avec script d'auto‑update.

---

## Schéma global

```text
          +--------------------------+
          |      Frontend React      |
          |  (Vite, TypeScript)      |
          +-------------+------------+
                        |
                        v
          +-------------+------------+
          |        API Go HTTP       |
          |  /api/* (auth, setup,    |
          |   deployments, logs)     |
          +-------------+------------+
                        |
                        v
          +-------------+------------+
          |     SQLite (db/app.db)   |
          | settings, users,         |
          | sessions, deployments,   |
          | deployment_logs, jobs    |
          +-------------+------------+
                        |
                        v
          +-------------+------------+
          |   Worker Go (goroutine)  |
          | - lit jobs en DB         |
          | - client Proxmox (API)   |
          | - attend SSH VM          |
          | - lance Ansible          |
          +-------------+------------+
                        |
                        v
          +-------------+------------+
          | Proxmox VE (API token)   |
          +-------------+------------+
                        |
                        v
          +-------------+------------+
          |   VM Ubuntu (cloud-init) |
          |   + Ansible = Minecraft  |
          +--------------------------+
```

---

## Arborescence

```text
backend/        # Go backend (API, worker, SQLite, Proxmox client)
  cmd/server/   # binaire principal
  internal/
    auth/       # users + sessions (bcrypt)
    config/     # settings + chiffrement optionnel
    db/         # SQLite + migrations
    deploy/     # jobs, pipeline, worker
    minecraft/  # provider Minecraft
    proxmox/    # client Proxmox REST
    server/     # HTTP, handlers, middlewares
  web/          # build frontend embarqué (Go embed)

frontend/       # React + Vite + TypeScript
ansible/        # playbook provision_minecraft.yml
deploy/systemd/ # unités systemd service + timer update
scripts/        # auto_update.sh
docs/           # architecture.md
Makefile
.env.example
```

---

## Pré‑requis Proxmox

- Proxmox VE accessible via HTTPS (ex: `https://pve.example.com:8006`).
- Un **API Token** avec les droits sur :
  - `VM.Audit`, `VM.Clone`, `VM.Config.Network`, `VM.Config.Disk`, `VM.Config.CDROM`, `VM.Start` sur le node cible.
  - `Sys.Modify` si nécessaire pour les opérations de clone/config.
- Un **template cloud‑init Ubuntu** (VMID ex: `9000`) avec :
  - Cloud‑init activé.
  - SSH autorisé.
  - Optionnel: user par défaut (`ubuntu`) prévu pour Ansible.

---

## Installation (VM Ubuntu)

1. **Cloner le repo**

```bash
sudo mkdir -p /opt/proxmox-game-deployer
sudo chown "$USER" /opt/proxmox-game-deployer
git clone <URL_DU_REPO> /opt/proxmox-game-deployer
cd /opt/proxmox-game-deployer
```

2. **Configurer l'environnement**

```bash
cp .env.example .env
edit .env   # ajuster APP_DB_PATH, DRY_RUN, APP_ENC_KEY, etc.
```

3. **Build backend + frontend (binaire unique)**

```bash
make build
```

Cela:
- build le frontend vers `backend/web/dist` (Vite),
- build le serveur Go qui embarque le frontend (Go embed).

4. **Installer le binaire**

```bash
sudo cp backend/server /usr/local/bin/proxmox-game-deployer
```

5. **Créer l'utilisateur système**

```bash
sudo useradd -r -d /opt/proxmox-game-deployer -s /usr/sbin/nologin proxmox || true
sudo chown -R proxmox:proxmox /opt/proxmox-game-deployer
```

6. **Installer les unités systemd**

```bash
sudo cp deploy/systemd/game-deployer.service /etc/systemd/system/
sudo cp deploy/systemd/game-deployer-update.service /etc/systemd/system/
sudo cp deploy/systemd/game-deployer-update.timer /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now game-deployer.service
sudo systemctl enable --now game-deployer-update.timer
```

7. **Ansible**

Installer Ansible sur la VM qui héberge l’app :

```bash
sudo apt-get update
sudo apt-get install -y ansible
```

---

## Setup Wizard (première connexion)

1. Ouvre `http://<ip_vm_app>:5298` dans ton navigateur.
2. Si la DB ne contient aucune config, tu es redirigé vers `/setup`.
3. Le wizard demande :
   - Endpoint Proxmox (ex: `https://pve.example.com:8006`),
   - Token ID + Secret,
   - Node par défaut, storage, bridge,
   - VMID du template cloud‑init,
   - User SSH, clé publique SSH,
   - Identifiants admin (username + mot de passe).
4. Bouton **“Tester connexion Proxmox”** :
   - appelle `/api/setup/test-proxmox`,
   - retourne `ok=true/false`.
5. Validation :
   - sauvegarde de la config Proxmox en DB (`settings`),
   - création de l’admin (`users`),
   - flag `app_initialized = true` dans `settings`.

Les secrets Proxmox sont stockés dans SQLite, potentiellement chiffrés si `APP_ENC_KEY` est défini (AES‑GCM).

---

## Authentification

- `POST /api/login` avec `username` / `password` crée une session :
  - mot de passe haché via **bcrypt**,
  - session stockée en DB (`sessions`) avec TTL (24h),
  - cookie `session_id` httpOnly, SameSite=Lax.
- `POST /api/logout` détruit la session.
- `GET /api/me` retourne l’utilisateur courant.

Les endpoints sensibles (déploiements) utilisent un middleware qui vérifie la session.

---

## API principale

- **Setup / Status**
  - `GET /api/status` → `{ initialized: bool }`
  - `GET /api/setup/status` → idem
  - `POST /api/setup/test-proxmox` → `{ ok: bool, error?: string }`
  - `POST /api/setup/initialize` → payload:

```json
{
  "proxmox": {
    "api_url": "https://pve.example.com:8006",
    "api_token_id": "root@pam!mytoken",
    "api_token_secret": "XXX",
    "default_node": "pve",
    "default_storage": "local-lvm",
    "default_bridge": "vmbr0",
    "template_vmid": 9000,
    "ssh_user": "ubuntu",
    "ssh_public_key": "ssh-ed25519 AAAA..."
  },
  "admin": {
    "username": "admin",
    "password": "motdepasse"
  }
}
```

- **Auth**
  - `POST /api/login`
  - `POST /api/logout`
  - `GET /api/me`

- **Déploiements Minecraft**
  - `POST /api/deployments/validate` → valide les inputs, ne crée rien.
  - `POST /api/deployments` → crée un déploiement Minecraft et enregistre un job.
  - `GET /api/deployments` → liste (statut, vmid, IP…).
  - `GET /api/deployments/{id}` → détail (inputs/outputs JSON, erreurs…).
  - `GET /api/deployments/{id}/logs[?after_id=...]` → logs temps réel.

### Exemple payload `POST /api/deployments`

```json
{
  "name": "mc-prod-01",
  "node": "pve",
  "template_vmid": 9000,
  "cores": 2,
  "memory_mb": 4096,
  "disk_gb": 30,
  "storage": "local-lvm",
  "bridge": "vmbr0",
  "vlan": 10,
  "ip_address": "192.168.10.50",
  "cidr": 24,
  "gateway": "192.168.10.1",
  "dns": "1.1.1.1",
  "hostname": "mc-prod-01",
  "minecraft": {
    "edition": "java",
    "version": "1.21.1",
    "type": "paper",
    "modded": false,
    "mods": [],
    "port": 25565,
    "extra_ports": [],
    "eula": true,
    "max_players": 20,
    "online_mode": true,
    "motd": "Bienvenue sur le serveur Minecraft",
    "whitelist": [],
    "operators": ["PlayerAdmin"],
    "jvm_heap": "2G",
    "jvm_flags": "",
    "backup_enabled": false,
    "backup_frequency": "daily",
    "backup_retention": 7
  }
}
```

---

## Orchestration backend

1. **Validation forte**
   - `ValidateMinecraftRequest` :
     - vérifie IP/CIDR/gateway/ports,
     - vérifie ressources minimal (RAM, disque…).
2. **Enqueue job**
   - insertion `deployments` (status `queued`) + `jobs` (type `deploy_minecraft`).
3. **Worker Go**
   - goroutine qui poll régulièrement la table `jobs`.
   - pour chaque job `queued` :
     - charge la config Proxmox (`settings`),
     - exécute `ProcessJob` :
       - `NextID` → nouveau VMID,
       - `CloneVM` depuis template cloud‑init,
       - `ConfigureVM` (CPU/RAM/disk/net + `ipconfig0`),
       - `StartVM` + `WaitForTask`,
       - `WaitForSSH` sur port 22 (IP fixe),
       - `runAnsibleMinecraft` → `ansible-playbook provision_minecraft.yml`.
     - écrit les logs dans `deployment_logs`.
     - met à jour `deployments.status` (`running`/`success`/`failed`).
4. **DRY_RUN**
   - si `DRY_RUN=true` :
     - le pipeline simule les étapes en écrivant les logs,
     - ne touche pas à Proxmox ni à Ansible.

Idempotence : relancer un job sur une VM déjà provisionnée ne re‑clonera pas la VM (car le job est lié à un `deployment_id` unique). On peut étendre plus tard pour détecter un service déjà présent côté VM via Ansible.

---

## Frontend (React + Vite + TypeScript)

Pages principales :

- `/setup` : wizard initial (Proxmox + admin).
- `/login` : authentification.
- `/deployments/new/minecraft` : formulaire détaillé de création de serveur Minecraft.
- `/deployments` : liste des déploiements.
- `/deployments/:id` : détails + logs temps réel (polling).

Le build front (`npm run build`) sort dans `backend/web/dist`, et le serveur Go embarque ce répertoire via `embed.FS` → **un seul binaire** à déployer.

---

## Sécurité

- Mots de passe admins hachés avec **bcrypt**.
- Sessions via cookie httpOnly, SameSite=Lax, option `APP_SECURE_COOKIE` pour forcer Secure en prod HTTPS.
- Config Proxmox stockée en DB :
  - si `APP_ENC_KEY` défini, chiffrement AES‑GCM via clé dérivée SHA‑256.
  - sinon, stockage texte + recommandation permissions strictes (`chmod 600` sur la DB).
- Validation forte :
  - adresses IP (IPv4), CIDR, ports (1–65535), ressources.
- Protection CSRF :
  - API uniquement accessible depuis même origine,
  - cookie SameSite=Lax + absence de CORS large limite les risques.  
  - Un jeton CSRF explicite peut être ajouté plus tard si besoin.

---

## Auto‑update (systemd + scripts)

- Script `scripts/auto_update.sh` :
  - `git fetch/reset` sur `main`,
  - `npm install && npm run build` (frontend),
  - `go build -o /usr/local/bin/proxmox-game-deployer ./cmd/server` (backend),
  - `systemctl restart game-deployer.service`,
  - logs dans `/var/log/proxmox-game-deployer-update.log`.
- Script CLI `scripts/pgdctl` :
  - `sudo ./scripts/pgdctl update` → déclenche une mise à jour (`game-deployer-update.service`) et affiche les logs.
  - `sudo ./scripts/pgdctl status` → statut du service.
  - `sudo ./scripts/pgdctl restart` → redémarre le service.
  - `sudo ./scripts/pgdctl logs` → logs en temps réel.
- Unités :
  - `game-deployer.service` : l’application elle‑même.
  - `game-deployer-update.service` : lance le script.
  - `game-deployer-update.timer` : déclenche périodiquement (toutes les heures).

---

## Développement local

1. **Backend**

```bash
cd backend
go run ./cmd/server
```

2. **Frontend**

```bash
cd frontend
npm install
npm run dev
```

Le `vite.config.ts` proxe `/api` vers `http://localhost:5298`, tu peux donc développer le frontend en hot‑reload.

3. **Build global**

```bash
make build
```

---

## Extensibilité vers d'autres jeux

- Ajouter un nouveau provider dans `internal/<jeu>` avec une struct de config et une méthode `ToAnsibleVars`.
- Créer un playbook Ansible dédié dans `ansible/`.
- Ajouter un type de job dans `internal/deploy` et ses handlers.
- Ajouter les écrans dans `frontend/src/pages`.

L’architecture actuelle (jobs en DB, worker Go, provisioning Ansible) est conçue pour accueillir ces extensions sans remettre en cause le cœur du système.

