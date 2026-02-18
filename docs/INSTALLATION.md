## 📦 Detailed installation & configuration

This document complements `README.md` with a step‑by‑step installation guide and a FAQ of common issues.

---

## 1. Deployment architecture

- **“App” VM**: runs Proxmox Game Deployer (backend + frontend + SQLite + Ansible).
- **Proxmox cluster**: hosts Minecraft VMs created from an **Ubuntu cloud‑init template**.
- **Main flow**:
  1. The UI creates a Minecraft *deployment*.
  2. The backend enqueues a job and calls Proxmox (clone template, configure CPU/RAM/disk/network).
  3. After the VM boots, Ansible installs Java + Minecraft + a systemd service.
  4. The dashboard tracks deployment and server state (logs, monitoring).

---

## 2. Preparing Proxmox

### 2.1 Create a dedicated API token

1. In the Proxmox UI go to **Datacenter → Permissions → API Tokens**.
2. Create a token on a user (often `root@pam`):
   - Token ID: `root@pam!game-deployer`
   - Permissions: enough rights on the **node** and **storage** you plan to use.
3. Keep these safe:
   - **Token ID**
   - **Token Secret**

### 2.2 Create an Ubuntu cloud‑init template

1. Download an Ubuntu Server cloud‑init image and create a classic VM/template.
2. Enable cloud‑init and configure:
   - default user (e.g. `ubuntu`),
   - main disk on the chosen storage (e.g. `local-lvm`),
   - network bridge (e.g. `vmbr0`).
3. Convert the VM to a **template** and note its **VMID** (e.g. `9000`).

This template will be cloned for every Minecraft server.

---

## 3. Deploying the app on the Ubuntu VM

### 3.1 OS prerequisites

On the VM that will host the app:

```bash
sudo apt update
sudo apt install -y git golang nodejs npm ansible
```

### 3.2 Clone & install

```bash
sudo mkdir -p /opt/proxmox-game-deployer
sudo chown "$USER" /opt/proxmox-game-deployer
git clone https://github.com/<your-user>/<your-repo>.git /opt/proxmox-game-deployer
cd /opt/proxmox-game-deployer

# One-shot install: binary, systemd services, pgdctl CLI
sudo ./deploy/install.sh
```

This script:

- installs the built backend+frontend binary,
- creates/enables `game-deployer.service` (HTTP server),
- creates/enables `game-deployer-update.service` + `game-deployer-update.timer`,
- installs `pgdctl` into `/usr/local/bin`.

Verify:

```bash
pgdctl status
sudo systemctl status game-deployer
```

---

## 4. Setup wizard

Access the application:

- either through your proxy (e.g. `https://gamingcontrol.useless.ovh`),
- or directly: `http://<APP_VM_IP>:5298`.

If no config exists in the DB you’ll be redirected to `/setup`:

1. **Proxmox config**
   - API URL: `https://pve.example.com:8006`
   - Token ID: `root@pam!game-deployer`
   - Token Secret: the token’s secret value.
   - Default node: e.g. `pve`.
   - Default storage: e.g. `local-lvm`.
   - Default bridge: e.g. `vmbr0`.
   - Template VMID: e.g. `9000` (cloud‑init template).
2. **SSH config**
   - SSH user: e.g. `ubuntu` (from the template).
   - Public SSH key: key used by the app to connect to game VMs.
3. **Proxmox test**
   - click “Test connection” → must validate API URL and token.
4. **Owner creation**
   - choose login + password (this account gets the `owner` role).

After validation you are redirected to `/login`.

---

## 5. Network and reverse proxy

### 5.1 General recommendations

- Place the app behind a **reverse proxy** (Nginx / Nginx Proxy Manager / Traefik…).
- Expose it as **HTTPS** to the outside (Let’s Encrypt).
- Configure the proxy to:
  - forward `X-Forwarded-Proto: https`,
  - pass `Host`, `X-Real-IP`, `X-Forwarded-For`.

### 5.2 Nginx example

```nginx
server {
  listen 80;
  server_name gamingcontrol.useless.ovh;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name gamingcontrol.useless.ovh;

  # Let's Encrypt certificates here…

  location / {
    proxy_pass http://192.168.x.x:5298;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

With `X-Forwarded-Proto: https` the app automatically marks the session cookie as `Secure`.

---

## 6. Minecraft deployment flow

1. In the UI: `Deployments → New Minecraft server`.
2. Fill in:
   - name, CPU, RAM, disk,
   - optional static IP and ports,
   - type/version (vanilla, Fabric, Forge, etc.),
   - advanced options (EULA, max players, online‑mode, JVM, whitelist, operators…).
3. Submit the form.
4. The deployment appears in the list with status:
   - `queued` → `running` → `success` or `failed`.
5. Click a deployment to see:
   - detailed logs (Proxmox + Ansible),
   - any error messages.

Once `success`, the server appears under **Minecraft Servers**:

- console access,
- start/stop/restart,
- monitoring (CPU/RAM/disk),
- backups,
- configuration.

---

## 7. Users and roles

- **Owner (`owner`)**
  - Full access.
  - Can create/delete users.
  - Can promote/demote `admin` ↔ `user`.
  - Can assign servers to users.
- **Admin (`admin`)**
  - Access to deployments and servers.
  - Can see the **Users** page but cannot change roles or delete users.
  - Can assign servers to users.
- **User (`user`)**
  - Only sees the **Minecraft Servers** section.
  - Only sees servers assigned to them.

When you delete a user:

- their sessions are invalidated,
- servers assigned to them are unassigned.

---

## 8. FAQ / Common problems

### 8.1 Login works but you always end up on the login page

**Symptoms**

- `POST /api/login` returns 200,
- but `GET /api/me` returns 401,
- the menu stays as if you were not logged in.

**Likely causes**

- Session cookie not sent (proxy strips headers or doesn’t send `X-Forwarded-Proto`).
- Old backend version (route `/api/me` not behind auth middleware).

**What to check**

- In browser DevTools (Network tab):
  - `POST /api/login` → response contains `Set-Cookie: session_id=...; Secure; SameSite=Lax`.
  - `GET /api/me` → status **200** with `{"username":"...","role":"..."}`.
- On the proxy:
  - add `proxy_set_header X-Forwarded-Proto https;`.

### 8.2 Owner does not see owner/admin menu entries

**Check**:

- `GET /api/me` after login must contain `role: "owner"`.
- Backend startup log must show the right SQLite DB path:
  `database: /opt/proxmox-game-deployer/data/app.db`.

If the owner user is stored in another DB (e.g. `/backend/data/app.db`), migrate that DB or fix `APP_DB_PATH`.

### 8.3 VM RAM resize vs Minecraft RAM

**Rule used by the app**:

- **Minecraft JVM heap = VM RAM – 1 GiB**, with a minimum of 1 GiB.

When you change VM RAM in the **Specs** tab:

- Proxmox config is updated,
- the VM is restarted if required,
- the Java heap (`-Xmx`) is recalculated and applied:
  - via `user_jvm_args.txt` (Forge / NeoForge),
  - or via the systemd unit (vanilla / Fabric / some modpacks).

### 8.4 Regular user sees a link to create a server

For `user` accounts:

- the **Minecraft Servers** page only shows an info message when no servers are assigned,
- there is no “New deployment” link.

### 8.5 TLS certificate issues with Proxmox

If Proxmox uses a self‑signed certificate:

- in the app `.env`, you can enable:

```bash
APP_PROXMOX_INSECURE_TLS=true
```

Use this only on a trusted LAN.

---

## 9. Updates and rollback

### 9.1 Standard update

On your development machine:

```bash
git commit -am "feat: ..."
git push origin main
```

On the Ubuntu VM:

```bash
pgdctl update
```

### 9.2 Quick rollback

If something breaks after an update:

```bash
cd /opt/proxmox-game-deployer
git log --oneline
git checkout <previous_commit>
sudo systemctl restart game-deployer
```

(Then later fix the issue and rebase/merge back onto `main`.)

---

## 10. Support & contributions

- Use GitHub issues for bugs and feature ideas.
- Pull requests are welcome for:
  - new games,
  - UI/UX improvements,
  - advanced monitoring integrations,
  - provisioning optimizations.

