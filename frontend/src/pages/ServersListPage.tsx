import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";

interface ServerItem {
  id: number;
  name: string;
  ip: string;
  port: number;
  vmid?: number;
  created_at: string;
}

export const ServersListPage: React.FC = () => {
  const [servers, setServers] = useState<ServerItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await apiGet<ServerItem[]>("/api/servers");
        if (!cancelled) setServers(data ?? []);
      } catch (e: unknown) {
        if (!cancelled) setError((e as Error).message ?? "Erreur chargement serveurs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p>Chargement...</p>;
  if (error) return <p className="error">{error}</p>;

  const list = servers ?? [];

  return (
    <div className="card">
      <h1>Serveurs Minecraft</h1>
      <p className="hint">
        Gestion des serveurs déployés : démarrage, arrêt, configuration et accès SFTP.
      </p>
      {list.length === 0 ? (
        <p>Aucun serveur Minecraft déployé. Créez-en un depuis Déploiements.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Port</th>
              <th>Créé le</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.port}</td>
                <td>{new Date(s.created_at).toLocaleString()}</td>
                <td>
                  <Link to={`/servers/${s.id}`} className="sidebar-link">
                    Tableau de bord
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
