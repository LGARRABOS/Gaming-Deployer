import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useCurrentUser } from "../hooks/useCurrentUser";

interface ServerItem {
  id: number;
  name: string;
  ip: string;
  port: number;
  vmid?: number;
  created_at: string;
}

interface ServersListPageProps {
  game?: "minecraft" | "hytale";
}

export const ServersListPage: React.FC<ServersListPageProps> = ({ game = "minecraft" }) => {
  const { user } = useCurrentUser();
  const [servers, setServers] = useState<ServerItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const url = game ? `/api/servers?game=${game}` : "/api/servers";
        const data = await apiGet<ServerItem[]>(url);
        if (!cancelled) setServers(data ?? []);
      } catch (e: unknown) {
        if (!cancelled) setError((e as Error).message ?? "Erreur chargement serveurs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [game]);

  if (loading) {
    return (
      <div className="card servers-page">
        <div className="servers-loading">Chargement des serveurs…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="card servers-page">
        <p className="error">{error}</p>
      </div>
    );
  }

  const list = servers ?? [];

  const isHytale = game === "hytale";
  const gameLabel = isHytale ? "Hytale" : "Minecraft";
  const newServerPath = isHytale ? "/deployments/new/hytale" : "/deployments/new/minecraft";

  return (
    <div className="servers-page">
      <header className="servers-header">
        <h1>Serveurs {gameLabel}</h1>
        <p className="servers-subtitle">
          Gestion des serveurs déployés : démarrage, arrêt, configuration et accès SFTP.
        </p>
      </header>

      {list.length === 0 ? (
        <div className="card servers-empty">
          <div className="servers-empty-icon">🖥️</div>
          <h2>Aucun serveur</h2>
          {user?.role === "owner" || user?.role === "admin" ? (
            <p>
              Créez un serveur {gameLabel} depuis la page{" "}
              <Link to={newServerPath}>Nouveau déploiement</Link>.
            </p>
          ) : (
            <p className="hint">
              Aucun serveur n’est encore associé à votre compte. Un administrateur ou le propriétaire peut vous attribuer
              un serveur existant.
            </p>
          )}
        </div>
      ) : (
        <ul className="servers-grid">
          {list.map((s) => (
            <li key={s.id} className="server-card-wrapper">
              <Link to={isHytale ? `/hytale/servers/${s.id}` : `/servers/${s.id}`} className="server-card">
                <span className="server-card-name">{s.name}</span>
                <span className="server-card-meta">Port {s.port}</span>
                <span className="server-card-date">
                  {new Date(s.created_at).toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <span className="server-card-cta">Ouvrir le tableau de bord →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
