import React, { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api/client";

interface UserItem {
  id: number;
  username: string;
  role: string;
  created_at: string;
}

interface ServerItem {
  id: number;
  name: string;
  ip: string;
  port: number;
  vmid?: number;
  assigned_to_user_id?: number;
  created_at: string;
}

export const UsersPage: React.FC = () => {
  const [list, setList] = useState<UserItem[]>([]);
  const [servers, setServers] = useState<ServerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [assignServerId, setAssignServerId] = useState<number | "">("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      apiGet<UserItem[]>("/api/users"),
      apiGet<ServerItem[]>("/api/servers"),
    ])
      .then(([usersData, serversData]) => {
        setList(Array.isArray(usersData) ? usersData : []);
        setServers(Array.isArray(serversData) ? serversData : []);
      })
      .catch((e: unknown) => setError((e as Error).message ?? "Erreur chargement"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const setRole = async (userId: number, role: "admin" | "user") => {
    setUpdatingId(userId);
    try {
      await apiPost(`/api/users/${userId}/role`, { role }, "PUT");
      load();
    } catch {
      // ignore
    } finally {
      setUpdatingId(null);
    }
  };

  const selectedUser = selectedUserId ? list.find((u) => u.id === selectedUserId) ?? null : null;

  const filteredUsers = list.filter((u) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return u.username.toLowerCase().includes(q) || u.role.toLowerCase().includes(q) || String(u.id).includes(q);
  });

  const assignedServers = selectedUser
    ? servers.filter((s) => (s.assigned_to_user_id ?? null) === selectedUser.id)
    : [];

  const availableServers = selectedUser
    ? servers.filter((s) => !s.assigned_to_user_id)
    : [];

  const assignServer = async () => {
    if (!selectedUser || assignServerId === "") return;
    setAssigning(true);
    setAssignError(null);
    try {
      await apiPost(`/api/deployments/${assignServerId}/assign`, { user_id: selectedUser.id }, "PUT");
      setAssignServerId("");
      load();
    } catch (e: unknown) {
      setAssignError((e as Error).message ?? "Erreur assignation");
    } finally {
      setAssigning(false);
    }
  };

  const unassignServer = async (deploymentId: number) => {
    if (!selectedUser) return;
    setAssigning(true);
    setAssignError(null);
    try {
      await apiPost(`/api/deployments/${deploymentId}/assign`, { user_id: null }, "PUT");
      load();
    } catch (e: unknown) {
      setAssignError((e as Error).message ?? "Erreur désassignation");
    } finally {
      setAssigning(false);
    }
  };

  if (loading) {
    return (
      <div className="card page-card">
        <div className="page-loading">Chargement des utilisateurs…</div>
      </div>
    );
  }

  return (
    <div className="page-wrap">
      <header className="page-header">
        <h1>Utilisateurs</h1>
        <p className="page-subtitle">
          Créer des comptes et promouvoir des utilisateurs en administrateur. Seul le propriétaire peut gérer cette page.
        </p>
      </header>

      {error && (
        <div className="card page-panel page-panel--error">
          <p className="error">{error}</p>
        </div>
      )}

      <section className="card page-panel">
        <h2 className="page-panel-title">Liste des comptes</h2>
        <p className="page-panel-desc">
          Recherche un utilisateur, clique dessus pour voir ses serveurs associés et lui en attribuer.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span className="hint">Recherche</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nom, rôle, ID…"
              style={{ minWidth: "240px" }}
            />
          </label>
          {selectedUser && (
            <button type="button" className="btn btn--secondary btn--small" onClick={() => setSelectedUserId(null)}>
              Fermer le détail
            </button>
          )}
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Utilisateur</th>
              <th>Rôle</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((u) => (
              <tr
                key={u.id}
                style={selectedUserId === u.id ? { outline: "2px solid rgba(255,255,255,0.12)" } : undefined}
              >
                <td>
                  <button
                    type="button"
                    className="btn btn--secondary btn--small"
                    onClick={() => setSelectedUserId(u.id)}
                    style={{ padding: "0.25rem 0.5rem" }}
                  >
                    {u.username}
                  </button>
                </td>
                <td>
                  <span className={`deployment-card-status deployment-card-status--${u.role === "owner" ? "success" : u.role === "admin" ? "running" : "queued"}`}>
                    {u.role === "owner" ? "Propriétaire" : u.role === "admin" ? "Admin" : "Utilisateur"}
                  </span>
                </td>
                <td>
                  {u.role === "owner" && <span className="hint">—</span>}
                  {u.role === "admin" && (
                    <button
                      type="button"
                      className="btn btn--secondary btn--small"
                      disabled={updatingId === u.id}
                      onClick={() => setRole(u.id, "user")}
                    >
                      {updatingId === u.id ? "…" : "Rétrograder en utilisateur"}
                    </button>
                  )}
                  {u.role === "user" && (
                    <button
                      type="button"
                      className="btn btn--primary btn--small"
                      disabled={updatingId === u.id}
                      onClick={() => setRole(u.id, "admin")}
                    >
                      {updatingId === u.id ? "…" : "Promouvoir en admin"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {selectedUser && (
        <section className="card page-panel">
          <h2 className="page-panel-title">Serveurs associés à {selectedUser.username}</h2>
          <p className="page-panel-desc">
            {assignedServers.length} serveur{assignedServers.length > 1 ? "s" : ""} associé{assignedServers.length > 1 ? "s" : ""}.
          </p>

          <div style={{ display: "flex", gap: "0.75rem", alignItems: "end", flexWrap: "wrap", marginBottom: "0.75rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span className="hint">Associer un serveur</span>
              <select
                value={assignServerId}
                onChange={(e) => setAssignServerId(e.target.value ? Number(e.target.value) : "")}
                style={{ minWidth: "320px" }}
              >
                <option value="">— Choisir un serveur non assigné —</option>
                {availableServers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (#{s.id})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn--primary"
              disabled={assigning || assignServerId === "" || availableServers.length === 0}
              onClick={assignServer}
            >
              {assigning ? "…" : "Associer"}
            </button>
            {assignError && <span className="error">{assignError}</span>}
          </div>

          {assignedServers.length === 0 ? (
            <p className="hint">Aucun serveur n’est associé à cet utilisateur.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Serveur</th>
                  <th>ID</th>
                  <th>Port</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {assignedServers.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>#{s.id}</td>
                    <td>{s.port}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--secondary btn--small"
                        disabled={assigning}
                        onClick={() => unassignServer(s.id)}
                      >
                        {assigning ? "…" : "Désassocier"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
};
