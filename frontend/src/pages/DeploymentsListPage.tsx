import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";

interface DeploymentListItem {
  id: number;
  game: string;
  type: string;
  status: string;
  vmid?: number;
  ip_address?: string;
  created_at: string;
  updated_at: string;
}

const statusLabel: Record<string, string> = {
  queued: "En attente",
  running: "En cours",
  success: "Succès",
  failed: "Échec",
};

export const DeploymentsListPage: React.FC = () => {
  const [items, setItems] = useState<DeploymentListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<DeploymentListItem[] | null>("/api/deployments")
      .then((data) => {
        if (!cancelled) {
          setItems(Array.isArray(data) ? data : []);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error).message ?? "Erreur chargement déploiements");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="card page-card">
        <div className="page-loading">Chargement des déploiements…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="card page-card">
        <p className="error">{error}</p>
      </div>
    );
  }

  const list = items ?? [];

  return (
    <div className="page-wrap">
      <header className="page-header">
        <h1>Déploiements</h1>
        <p className="page-subtitle">
          Historique des déploiements de serveurs. Clique sur un déploiement pour voir les logs et le statut.
        </p>
      </header>

      {list.length === 0 ? (
        <div className="card page-empty">
          <div className="page-empty-icon">📋</div>
          <h2>Aucun déploiement</h2>
          <p>
            Créez un serveur depuis{" "}
            <Link to="/deployments/new/minecraft">Nouveau déploiement → Minecraft</Link>.
          </p>
        </div>
      ) : (
        <ul className="deployments-grid">
          {list.map((d) => (
            <li key={d.id} className="deployment-card-wrapper">
              <Link to={`/deployments/${d.id}`} className="card deployment-card">
                <span className="deployment-card-id">#{d.id}</span>
                <span className="deployment-card-title">
                  {d.game} – {d.type}
                </span>
                <span
                  className={`deployment-card-status deployment-card-status--${d.status}`}
                >
                  {statusLabel[d.status] ?? d.status}
                </span>
                <span className="deployment-card-date">
                  {new Date(d.created_at).toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="deployment-card-cta">Voir les détails →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
