# 🕹 Proxmox Game Deployer

Déploiement automatisé de serveurs de jeux (Minecraft) sur Proxmox, avec backend Go, frontend React et provisioning Ansible.

---

## ✨ Vue d’ensemble

- **Cible** : cluster Proxmox VE avec template Ubuntu cloud‑init.
- **Jeu supporté** : Minecraft Java (vanilla, Forge, NeoForge, Fabric, modpacks).
- **Rôles** :
  - **Propriétaire** : configuration Proxmox, création/suppression d’utilisateurs, déploiements complets.
  - **Admin** : gestion des déploiements et des serveurs, consultation des utilisateurs et assignation de serveurs.
  - **Utilisateur** : accès uniquement aux serveurs qui lui sont attribués.
- **Stack** :
  - Go + SQLite pour l’API et l’orchestrateur.
  - React + Vite + TypeScript pour le dashboard.
  - Ansible pour provisionner la VM Minecraft.

---

## 🚀 Démarrage rapide

### 1. Prérequis

- Un cluster **Proxmox VE** fonctionnel.
- Une VM Ubuntu qui hébergera **Proxmox Game Deployer**.
- Un template **Ubuntu cloud‑init** sur Proxmox (utilisé comme base pour chaque serveur Minecraft).

### 2. Installation rapide sur la VM Ubuntu

```bash
sudo mkdir -p /opt/proxmox-game-deployer
sudo chown "$USER" /opt/proxmox-game-deployer
git clone <URL_DU_REPO> /opt/proxmox-game-deployer
cd /opt/proxmox-game-deployer

# Installation automatique (binaire + service + pgdctl)
sudo ./deploy/install.sh
```

Puis vérifie que tout est en place :

```bash
pgdctl status
```

### 3. Accès au dashboard

- Ouvre `https://<ton-domaine-ou-ip>` (ou `http://<IP_VM>:5298` si accès direct).
- Au premier lancement, un **assistant de configuration** te guide pour :
  - configurer l’accès Proxmox (URL, token, node, storage, bridge, template),
  - configurer l’accès SSH vers les VMs,
  - créer le compte **propriétaire**.

La configuration détaillée (variables, problèmes classiques, etc.) est décrite dans `docs/INSTALLATION.md`.

---

## 🧩 Fonctionnalités principales

- Création de serveurs Minecraft complets (VM + Java + service systemd).
- Formulaire de déploiement avancé (CPU/RAM/disk, IP fixe, port, type/version Minecraft, modpacks).
- Gestion des rôles (owner / admin / user) et assignation de serveurs aux utilisateurs.
- Monitoring basique (CPU/RAM/Disk) et console distante.
- Auto‑update via `pgdctl update` (pull Git + build + restart du service).

---

## 🛠 Développement local

```bash
# Backend
cd backend
go run ./cmd/server

# Frontend
cd frontend
npm install
npm run dev
```

- Backend : écoute par défaut sur `:5298`.
- Frontend : `http://localhost:5173` avec proxy `/api` vers le backend.

---

## 🔁 Mise à jour en production

Sur ta machine de développement :

```bash
git commit -am "feat/fix: ..."
git push origin main
```

Sur la VM Ubuntu qui héberge Proxmox Game Deployer :

```bash
pgdctl update
```

Cette commande :

- met à jour le dépôt Git sur `main`,
- rebuild le frontend + backend,
- redémarre le service systemd de l’application.

---

## 📚 Documentation détaillée

Pour une installation complète, la configuration avancée et la résolution des problèmes courants, consulte :

- `docs/INSTALLATION.md`

Ce README reste volontairement court pour te donner la **vue d’ensemble** et les **commandes essentielles**.

