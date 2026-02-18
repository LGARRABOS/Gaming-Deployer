import React, { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api/client";

interface UserItem {
  id: number;
  username: string;
  role: string;
  created_at: string;
}

export const UsersPage: React.FC = () => {
  const [list, setList] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    apiGet<UserItem[]>("/api/users")
      .then((data) => setList(Array.isArray(data) ? data : []))
      .catch((e: unknown) => setError((e as Error).message ?? "Erreur chargement"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword) {
      setCreateError("Nom d'utilisateur et mot de passe requis.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await apiPost("/api/users", { username: newUsername.trim(), password: newPassword });
      setNewUsername("");
      setNewPassword("");
      load();
    } catch (e: unknown) {
      setCreateError((e as Error).message ?? "Erreur création");
    } finally {
      setCreating(false);
    }
  };

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
        <h2 className="page-panel-title">Nouvel utilisateur</h2>
        <p className="page-panel-desc">Les nouveaux comptes ont le rôle « Utilisateur » (accès uniquement aux serveurs qui leur sont attribués).</p>
        <form onSubmit={handleCreate} className="form-grid form-grid--wide" style={{ maxWidth: "400px" }}>
          <label>
            <span>Nom d'utilisateur</span>
            <input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="login"
            />
          </label>
          <label>
            <span>Mot de passe</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>
          <div className="form-actions" style={{ gridColumn: "1 / -1" }}>
            <button type="submit" className="btn btn--primary" disabled={creating}>
              {creating ? "Création…" : "Créer l'utilisateur"}
            </button>
            {createError && <span className="error">{createError}</span>}
          </div>
        </form>
      </section>

      <section className="card page-panel">
        <h2 className="page-panel-title">Liste des comptes</h2>
        <p className="page-panel-desc">Propriétaire : créé au premier lancement, réinitialisable uniquement en ligne de commande sur la VM.</p>
        <table className="table">
          <thead>
            <tr>
              <th>Utilisateur</th>
              <th>Rôle</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
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
    </div>
  );
};
