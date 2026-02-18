# Architecture overview

## Functional overview

The **Proxmox Game Deployer** application allows you to:

- Configure connection to a Proxmox cluster (initial setup wizard).
- Create game deployment jobs (Minecraft first).
- Orchestrate VM creation, cloud‑init network configuration, then game provisioning through Ansible.
- Track deployment status and show real‑time logs in the UI.

## Minecraft deployment pipeline

```text
UI (React) -> Go API (/api/deployments)
           -> enqueue job (SQLite.jobs, SQLite.deployments)
           -> Go worker (goroutine):
               1) Proxmox client (HTTP, API token)
                  - NextID
                  - Clone VM from cloud‑init template
                  - Configure CPU/RAM/disk/network + ipconfig0
                  - Start VM + wait for task
               2) Wait for SSH (TCP 22 on fixed IP)
               3) Run Ansible (ansible-playbook provision_minecraft.yml)
                  - Install Java
                  - Create minecraft user
                  - Download server jar
                  - Write server.properties
                  - Open UFW ports
                  - Create and enable systemd service `minecraft`
               4) Update status + result_json
               5) Append-only logs (deployment_logs)
```

## Data model (SQLite)

- `settings`: global configuration (Proxmox, flags, etc.), optionally encrypted via `APP_ENC_KEY`.
- `users`: admin / owner / user accounts.
- `sessions`: HTTP sessions (cookie `session_id`).
- `deployments`: deployment metadata (game type, input/output JSON, VMID, IP, status).
- `deployment_logs`: append‑only log entries per deployment.
- `jobs`: internal queue of asynchronous jobs.

## Extensibility to multiple games

- The `internal/minecraft` package defines a `Config` structure and a conversion to `map[string]any` for Ansible variables.
- To add a new game:
  - Create `internal/<game>` with a similar config struct.
  - Add frontend + backend endpoints to create deployments for that game.
  - Add a dedicated job handler in `internal/deploy`.
  - Create a dedicated Ansible playbook.

