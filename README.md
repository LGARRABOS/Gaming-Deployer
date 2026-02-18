# 🕹 Proxmox Game Deployer

Automated deployment of Minecraft servers on Proxmox, with a Go backend, React frontend, and Ansible provisioning.

---

## ✨ Overview

- **Target**: Proxmox VE cluster with an Ubuntu cloud‑init template.
- **Supported game**: Minecraft Java (vanilla, Forge, NeoForge, Fabric, modpacks).
- **Roles**:
  - **Owner**: Proxmox configuration, user creation/deletion, full deployment rights.
  - **Admin**: manages deployments and servers, can view users and assign servers.
  - **User**: can only access servers assigned to their account.
- **Stack**:
  - Go + SQLite for the API and orchestration.
  - React + Vite + TypeScript for the dashboard.
  - Ansible to provision the Minecraft VM.

---

## 🚀 Quick start

### 1. Requirements

- A working **Proxmox VE** cluster.
- An Ubuntu VM that will host **Proxmox Game Deployer**.
- An **Ubuntu cloud‑init template** in Proxmox (used as the base for each Minecraft server).

### 2. Fast install on the Ubuntu VM

```bash
sudo mkdir -p /opt/proxmox-game-deployer
sudo chown "$USER" /opt/proxmox-game-deployer
git clone <REPOSITORY_URL> /opt/proxmox-game-deployer
cd /opt/proxmox-game-deployer

# One-shot install (binary + systemd services + pgdctl)
sudo ./deploy/install.sh
```

Then check that everything is running:

```bash
pgdctl status
```

### 3. Accessing the dashboard

- Open `https://<your-domain>` (or `http://<APP_VM_IP>:5298` if you expose the port directly).
- On first run, a **setup wizard** will guide you through:
  - configuring Proxmox access (URL, token, node, storage, bridge, template),
  - configuring SSH access to the game VMs,
  - creating the **owner** account.

More detailed configuration (env vars, typical issues, troubleshooting) lives in `docs/INSTALLATION.md`.

---

## 🧩 Main features

- Full Minecraft server provisioning (VM + Java + systemd service).
- Advanced deployment form (CPU/RAM/disk, static IP, port, Minecraft type/version, modpacks).
- Role-based access (owner / admin / user) and server assignment to users.
- Basic monitoring (CPU/RAM/disk) and remote console.
- Auto‑update via `pgdctl update` (Git pull + build + service restart).

---

## 🛠 Local development

```bash
# Backend
cd backend
go run ./cmd/server

# Frontend
cd frontend
npm install
npm run dev
```

- Backend: listens on `:5298` by default.
- Frontend: `http://localhost:5173` with `/api` proxied to the backend.

---

## 🔁 Production updates

On your development machine:

```bash
git commit -am "feat/fix: ..."
git push origin main
```

On the Ubuntu VM running Proxmox Game Deployer:

```bash
pgdctl update
```

This command:

- updates the Git repository on `main`,
- rebuilds frontend + backend,
- restarts the application systemd service.

---

## 📚 Detailed documentation

For a complete installation guide, advanced configuration and troubleshooting, see:

- `docs/INSTALLATION.md`

This README stays short on purpose: it gives you the **big picture** and the **core commands** only.

