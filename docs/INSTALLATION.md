## 📦 Installation & configuration détaillées

Ce document complète le `README.md` avec une procédure d’installation pas‑à‑pas et une FAQ des problèmes courants.

---

## 1. Architecture de déploiement

- **VM “App”** : héberge Proxmox Game Deployer (backend + frontend + SQLite + Ansible).
- **Cluster Proxmox** : héberge les VMs Minecraft créées à partir d’un **template Ubuntu cloud‑init**.
- **Flux principal** :
  1. L’UI crée un *déploiement* Minecraft.
  2. Le backend crée un job et appelle Proxmox (clone du template, config CPU/RAM/disk/network).
  3. Après démarrage de la VM, Ansible installe Java + Minecraft + service systemd.
  4. Le dashboard suit l’état du déploiement et du serveur (logs, monitoring).

---

## 2. Préparation côté Proxmox

### 2.1 Créer un token API dédié

1. Dans l’interface Proxmox : **Datacenter → Permissions → API Tokens**.
2. Crée un token sur un utilisateur (souvent `root@pam`) :
   - Token ID : `root@pam!game-deployer`
   - Autorisations : suffisant de donner les droits sur **le node** et **le storage** utilisés.
3. Garde précieusement :
   - **Token ID**
   - **Token Secret**

### 2.2 Créer un template Ubuntu cloud‑init

1. Télécharge une image cloud‑init (Ubuntu Server) et crée une VM template classique.
2. Active cloud‑init, configure :
   - utilisateur par défaut (ex. `ubuntu`),
   - disque principal sur le storage souhaité (ex. `local-lvm`),
   - réseau bridge (ex. `vmbr0`).
3. Convertis la VM en **template** et note son **VMID** (ex. `9000`).

Ce template sera cloné pour chaque serveur Minecraft.

---

## 3. Déploiement de l’application sur la VM Ubuntu

### 3.1 Prérequis OS

Sur la VM qui va héberger l’app :

```bash
sudo apt update
sudo apt install -y git golang nodejs npm ansible
```

### 3.2 Clonage & installation

```bash
sudo mkdir -p /opt/proxmox-game-deployer
sudo chown "$USER" /opt/proxmox-game-deployer
git clone https://github.com/<ton-user>/<ton-repo>.git /opt/proxmox-game-deployer
cd /opt/proxmox-game-deployer

# Installation automatique : binaire, services systemd, CLI pgdctl
sudo ./deploy/install.sh
```

Ce script :

- installe le binaire backend + frontend buildé,
- crée/active `game-deployer.service` (serveur HTTP),
- crée/active `game-deployer-update.service` + `game-deployer-update.timer`,
- installe `pgdctl` dans `/usr/local/bin`.

Vérifie :

```bash
pgdctl status
sudo systemctl status game-deployer
```

---

## 4. Assistant de configuration (setup)

Accède à l’application :

- soit via ton proxy (ex. `https://gamingcontrol.useless.ovh`),
- soit directement : `http://<IP_VM_APP>:5298`.

Si aucune config n’est en DB, tu es redirigé vers `/setup` :

1. **Config Proxmox**
   - API URL : `https://pve.example.com:8006`
   - Token ID : `root@pam!game-deployer`
   - Token Secret : valeur secrète du token.
   - Node par défaut : ex. `pve`.
   - Storage par défaut : ex. `local-lvm`.
   - Bridge par défaut : ex. `vmbr0`.
   - Template VMID : ex. `9000` (template cloud‑init).
2. **Config SSH**
   - Utilisateur SSH : ex. `ubuntu` (celui du template cloud‑init).
   - Clé publique SSH : clé utilisée par l’app pour se connecter aux VMs.
3. **Test Proxmox**
   - bouton “Tester la connexion” → doit valider l’API et le token.
4. **Création du propriétaire**
   - login + mot de passe (ce compte aura le rôle `owner`).

Après validation, tu es redirigé vers `/login`.

---

## 5. Réseau et reverse proxy

### 5.1 Recommandations générales

- Mettre l’app derrière un **reverse proxy** (Nginx / Nginx Proxy Manager / Traefik…).
- Toujours utiliser **HTTPS** côté public (Let’s Encrypt).
- Configurer le proxy pour :
  - transmettre `X-Forwarded-Proto: https`,
  - passer les en‑têtes `Host`, `X-Real-IP`, `X-Forwarded-For`.

### 5.2 Exemple Nginx (classique)

```nginx
server {
  listen 80;
  server_name gamingcontrol.useless.ovh;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name gamingcontrol.useless.ovh;

  # Certificats Let’s Encrypt …

  location / {
    proxy_pass http://192.168.x.x:5298;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

Grâce à `X-Forwarded-Proto: https`, l’app marque les cookies de session en `Secure` automatiquement.

---

## 6. Flux de déploiement Minecraft

1. Dans l’UI : `Déploiements → Nouveau serveur Minecraft`.
2. Remplis :
   - Nom, CPU, RAM, disque,
   - IP fixe (optionnel), ports,
   - type/version (vanilla, Fabric, Forge, etc.),
   - options avancées (EULA, joueurs max, online‑mode, JVM, whitelist, opérateurs…).
3. Soumets le formulaire.
4. Le déploiement apparaît dans la liste avec un statut :
   - `queued` → `running` → `success` ou `failed`.
5. Clique sur un déploiement pour voir :
   - les logs détaillés (Proxmox + Ansible),
   - les erreurs éventuelles.

Une fois `success`, le serveur apparaît dans **Serveurs Minecraft** :

- accès à la console,
- start/stop/restart,
- monitoring (CPU/RAM/disk),
- backups,
- configuration.

---

## 7. Gestion des utilisateurs & rôles

- **Propriétaire (`owner`)**
  - Accès à tout.
  - Peut créer/supprimer des utilisateurs.
  - Peut promouvoir/dégrader `admin` ↔ `user`.
  - Peut assigner des serveurs à des utilisateurs.
- **Admin (`admin`)**
  - Accès aux déploiements et serveurs.
  - Voit la page **Utilisateurs** mais ne peut pas modifier les rôles ni supprimer un compte.
  - Peut associer des serveurs à des utilisateurs (assignation).
- **Utilisateur (`user`)**
  - Ne voit que l’onglet **Serveurs Minecraft**.
  - Ne voit que les serveurs qui lui sont assignés.

Quand tu supprimes un utilisateur :

- ses sessions sont invalidées,
- les serveurs qui lui étaient assignés sont désassignés (plus de verrou).

---

## 8. FAQ / Problèmes courants

### 8.1 Connexion impossible / retour permanent sur la page de login

**Symptômes**

- `POST /api/login` renvoie 200,
- mais `GET /api/me` renvoie 401,
- le menu reste celui d’un utilisateur non connecté.

**Causes probables**

- Cookie de session non envoyé (proxy ne transmet pas les en‑têtes, pas de `X-Forwarded-Proto`).
- Ancienne version du backend (route `/api/me` non protégée par le middleware d’auth).

**À vérifier**

- Dans les DevTools navigateur (Onglet Réseau) :
  - `POST /api/login` → réponse contient bien `Set-Cookie: session_id=...; Secure; SameSite=Lax`.
  - `GET /api/me` → statut **200** avec `{"username":"...","role":"..."}`.
- Côté proxy :
  - ajouter `proxy_set_header X-Forwarded-Proto https;`.

### 8.2 L’owner ne voit pas le bon menu / les liens d’admin

**Vérifie** la réponse de :

- `GET /api/me` après login : doit contenir `role: "owner"`.
- Regarde aussi que le backend utilise bien la bonne base SQLite (log au démarrage : `database: /opt/proxmox-game-deployer/data/app.db`).

Si l’owner est dans une autre base (ex. `/backend/data/app.db`), mets à jour cette base ou configure correctement `APP_DB_PATH`.

### 8.3 Redimensionnement de la RAM VM vs RAM Minecraft

**Règle appliquée par l’app** :

- **RAM JVM Minecraft = RAM VM – 1 Go**, avec un minimum de 1 Go.

Quand tu modifies la RAM de la VM dans l’onglet **Specs** :

- la config Proxmox est mise à jour,
- la VM est redémarrée si nécessaire,
- la heap Java (`-Xmx`) est recalculée et appliquée :
  - via `user_jvm_args.txt` (Forge / NeoForge),
  - ou via le service systemd (vanilla / Fabric / certains modpacks).

### 8.4 Un simple utilisateur voit un lien pour créer un serveur

C’est corrigé : pour les comptes `user` :

- la page **Serveurs Minecraft** affiche uniquement un message expliquant qu’aucun serveur ne lui est encore associé,
- aucun lien vers “Nouveau déploiement” n’est proposé.

### 8.5 Problèmes de certificats TLS Proxmox

Si Proxmox utilise un certificat auto‑signé :

- dans `.env` de l’application, tu peux activer :

```bash
APP_PROXMOX_INSECURE_TLS=true
```

À utiliser uniquement sur un LAN de confiance.

---

## 9. Mise à jour et rollback

### 9.1 Mise à jour standard

Sur ta machine de développement :

```bash
git commit -am "feat: ..."
git push origin main
```

Sur la VM Ubuntu :

```bash
pgdctl update
```

### 9.2 Rollback rapide

En cas de problème après une mise à jour :

```bash
cd /opt/proxmox-game-deployer
git log --oneline
git checkout <commit_précédent>
sudo systemctl restart game-deployer
```

(Pense ensuite à corriger / rebaser pour revenir proprement sur `main`.)

---

## 10. Support & contributions

- Issues / idées : ouvre une issue sur le dépôt GitHub.
- PR bienvenues pour :
  - nouveaux jeux,
  - améliorations UI,
  - intégration de monitoring avancé,
  - optimisation du provisioning.

