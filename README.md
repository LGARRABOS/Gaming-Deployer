# 🕹 Proxmox Game Deployer

Déploiement automatique de VMs Proxmox et de serveurs de jeux (Minecraft pour commencer), avec orchestration Go, provisioning Ansible et interface React.

- **Backend**: Go (HTTP API + worker + SQLite)
- **Frontend**: React + Vite + TypeScript
- **DB**: SQLite (config, users, déploiements, logs, jobs)
- **Provisioning**: Ansible (Ubuntu cloud‑init)
- **Déploiement**: systemd + script d’auto‑update + CLI `pgdctl`

---

## ✨ Fonctionnalités principales

- **Setup initial guidé**:
  - Configuration Proxmox (URL, token, node, storage, bridge, template cloud‑init).
  - Configuration SSH (user + clé publique).
  - Création de l’admin avec confirmation de mot de passe.
  - Test de connexion Proxmox intégré.
- **Auth & sessions**:
  - Login admin, session via cookie httpOnly.
  - Redirection auto vers `/login` si la session expire (401).
- **Serveurs Minecraft**:
  - Formulaire complet: ressources VM, IP fixe, réseau, type/version Minecraft, ports, options avancées (EULA, joueurs max, online‑mode, JVM, whitelist, ops…).
  - Support Forge/Fabric/Paper/Purpur (mod list prévue).
- **Orchestration Go + Proxmox**:
  - Clone de template cloud‑init, configuration CPU/RAM/disk/network.
  - IP statique via `ipconfig0`, démarrage VM, attente SSH.
  - Jobs en DB + worker goroutine pour exécution asynchrone.
- **Provisioning Ansible**:
  - Installation Java, user `minecraft`, `server.properties`, UFW, service systemd.
- **Suivi en temps réel**:
  - Liste des déploiements.
  - Page de détail avec logs temps réel (polling).
- **Auto‑update**:
  - Script d’update + service systemd + timer.
  - CLI `pgdctl` pour mettre à jour en **une seule commande** avec logs.

---

## 🚀 Démarrage rapide (développement)

### Prérequis

- Go 1.21+
- Node.js + npm
- Proxmox VE (pour les tests d’API)

### Lancer en dev

```bash
# Backend
cd backend
go run ./cmd/server

# Frontend (dans un autre terminal)
cd frontend
npm install
npm run dev
```

Le frontend se lance sur `http://localhost:5173` et proxy `/api` vers le backend (port 5298 par défaut côté binaire, 8080 en mode `make run`).

---

## 📦 Installation en production (VM Ubuntu)

### Prérequis

- VM Ubuntu (héberge **cette** application).
- Proxmox VE accessible depuis cette VM.
- Git, Go, Node.js, npm, Ansible:

```bash
sudo apt update
sudo apt install -y git golang nodejs npm ansible
```

### 1. Cloner le dépôt

```bash
sudo mkdir -p /opt/proxmox-game-deployer
sudo chown "$USER" /opt/proxmox-game-deployer
git clone <URL_DU_REPO> /opt/proxmox-game-deployer
cd /opt/proxmox-game-deployer
```

### 2. Configurer l’environnement

```bash
cp .env.example .env
edit .env   # ajuste DRY_RUN, APP_ENC_KEY, APP_PROXMOX_INSECURE_TLS, etc.
```

Variables importantes:

- `DRY_RUN=true` : simule les déploiements (aucun appel Proxmox / Ansible).
- `APP_ENC_KEY` : phrase de passe forte pour chiffrer la config Proxmox en DB.
- `APP_PROXMOX_INSECURE_TLS=true` : ignore TLS (certificat auto‑signé Proxmox) sur ton LAN.

### 3. Installation automatique

```bash
sudo ./deploy/install.sh
```

Ce script:

- Copie le projet dans `/opt/proxmox-game-deployer`.
- Crée l’utilisateur système `proxmox`.
- Installe le binaire `proxmox-game-deployer` dans `/usr/local/bin`.
- Installe/active:
  - `game-deployer.service` (serveur HTTP),
  - `game-deployer-update.service` (tâche d’auto‑update),
  - `game-deployer-update.timer` (planification).
- Installe le CLI `pgdctl` dans `/usr/local/bin`.
- Build le frontend + backend une première fois.

Tu peux vérifier:

```bash
pgdctl status
```

---

## 🔁 Mise à jour (pull + build + restart)

Workflow typique:

- Sur ta machine de dev:

```bash
git commit -am "fix: quelque chose"
git push origin main
```

- Sur la VM Ubuntu:

```bash
pgdctl update
```

Cette commande:

- déclenche `game-deployer-update.service`,
- fait `git fetch/reset` sur `main`,
- rebuild frontend + backend,
- redémarre `game-deployer.service`,
- affiche les logs de l’update en temps réel (`journalctl -f`).

Autres commandes utiles:

```bash
pgdctl status    # statut du service
pgdctl restart   # redémarrer le service
pgdctl logs      # logs en temps réel du service applicatif
```

---

## 🧩 Setup Wizard (première connexion)

1. Accède à `http://<IP_VM_APP>:5298` (ou ton domaine).
2. Si aucune config n’est en DB, tu es redirigé vers `/setup`.
3. Remplis les champs Proxmox:
   - **API URL**: `https://pve.example.com:8006`
   - **Token ID**: ex. `root@pam!game-deployer`
   - **Token Secret**: valeur secrète générée dans Proxmox.
   - **Node par défaut**: nom du node (ex. `pve`).
   - **Storage par défaut**: ex. `local-lvm`.
   - **Bridge par défaut**: ex. `vmbr0`.
   - **Template VMID (cloud-init)**: VMID de ton template Ubuntu cloud‑init (ex. `9000`).
   - **Utilisateur SSH**: user cloud‑init (ex. `ubuntu`).
   - **Clé publique SSH**: clé publique de la VM app (celle utilisée par Ansible).
4. Clique sur **“Tester connexion Proxmox”**:
   - si tout est OK, tu vois une confirmation,
   - sinon, message d’erreur Proxmox/TLS.
5. Crée le compte admin:
   - username + mot de passe,
   - confirmation du mot de passe (détection d’erreur de frappe).
6. Valide → l’app enregistre la config + admin, puis te redirige vers `/login`.

---

## 🔐 Authentification & sécurité

- Admin stocké dans `users` (password **bcrypt**).
- Sessions dans `sessions` avec TTL (24h) + cookie `session_id` httpOnly, SameSite=Lax.
- Si une requête backend renvoie **401**, le frontend redirige automatiquement vers `/login`.
- Config Proxmox en DB:
  - si `APP_ENC_KEY` défini → chiffrée avec AES‑GCM (clé dérivée SHA‑256),
  - sinon → stockée en clair (recommandé: permissions strictes sur le fichier DB).

---

## ⚙️ Architecture technique

### Backend (`backend/`)

- `cmd/server/main.go` : point d’entrée, lecture config env, démarrage HTTP + worker jobs.
- `internal/db` : wrapper SQLite + migrations automatiques.
- `internal/auth` : users, sessions, bcrypt.
- `internal/config` : settings (Proxmox, flags), chiffrement optionnel.
- `internal/proxmox` : client HTTP (token API, TLS configurable).
- `internal/minecraft` : modèle de configuration Minecraft → variables Ansible.
- `internal/deploy` :
  - `EnqueueMinecraftDeployment` : création en DB (`deployments` + `jobs`),
  - `Worker` : goroutine qui poll la table `jobs`,
  - `ProcessJob` : pipeline Proxmox + Ansible,
  - `deployment_logs` : logs append‑only.
- `internal/server` : routes HTTP, middleware, handlers (setup, auth, déploiements).
- `web/` : build frontend embarqué via `embed.FS` (binaire unique).

### Frontend (`frontend/`)

- React + Vite + TypeScript.
- Pages:
  - `/setup` : wizard initial.
  - `/login` : connexion admin.
  - `/deployments` : liste des déploiements.
  - `/deployments/new/minecraft` : formulaire de déploiement Minecraft.
  - `/deployments/:id` : détail + logs temps réel.
- Client API:
  - `api/client.ts` gère les erreurs, redirige vers `/login` en cas de 401.

### Provisioning (`ansible/`)

- `provision_minecraft.yml` :
  - installe Java,
  - crée user `minecraft`,
  - déploie le `server.jar` (vanilla pour l’instant),
  - écrit `eula.txt`, `server.properties`,
  - ouvre les ports avec UFW (si activé),
  - crée et active le service systemd `minecraft.service`.

---

## 🗄 Modèle de données (SQLite)

- `settings` : configuration globale (Proxmox, flags, etc.).
- `users` : comptes admins.
- `sessions` : sessions HTTP.
- `deployments` : enregistre chaque déploiement (inputs/outputs JSON, VMID, IP, statut).
- `deployment_logs` : logs append‑only par déploiement.
- `jobs` : file interne de jobs à exécuter (worker Go).

---

## 🧪 Mode DRY_RUN

Pour tester le pipeline sans toucher Proxmox:

- Dans `.env`:

```bash
DRY_RUN=true
```

Dans ce mode:

- les jobs s’exécutent,
- les logs sont écrits en DB,
- mais il n’y a pas:
  - de clone/config/démarrage de VM,
  - ni d’appel Ansible réel.

Pratique pour tester l’UI, les jobs, et la partie logs sans risquer de polluer ton cluster Proxmox.

---

## 🛠 Développement local (rappel)

```bash
# Backend
cd backend
go run ./cmd/server

# Frontend
cd frontend
npm install
npm run dev
```

Le frontend est servi par Vite sur `http://localhost:5173`, avec proxy `/api` vers ton backend.

---

## 📌 Roadmap (idées d’extensions)

- Support complet des autres jeux via providers (`internal/<game>`).
- Multi‑tenancy / multi‑utilisateurs.
- Plus d’options réseau (VLAN par défaut, pools IP).
- Backups gérés (snapshots Proxmox / rsync / rclone).
- UI temps réel (WebSocket) pour les logs au lieu de polling.

