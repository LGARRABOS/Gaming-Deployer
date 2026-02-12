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
      .catch((e: any) => {
        if (!cancelled) setError(e.message ?? "Erreur chargement déploiements");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p>Chargement des déploiements...</p>;
  if (error) return <p className="error">{error}</p>;

  const list = items ?? [];

  return (
    <div className="card">
      <h1>Déploiements</h1>
      <table className="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Jeu</th>
            <th>Type</th>
            <th>Statut</th>
            <th>VMID</th>
            <th>IP</th>
            <th>Créé</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {list.map((d) => (
            <tr key={d.id}>
              <td>{d.id}</td>
              <td>{d.game}</td>
              <td>{d.type}</td>
              <td>{d.status}</td>
              <td>{d.vmid ?? "-"}</td>
              <td>{d.ip_address ?? "-"}</td>
              <td>{new Date(d.created_at).toLocaleString()}</td>
              <td>
                <Link to={`/deployments/${d.id}`}>Détails</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

