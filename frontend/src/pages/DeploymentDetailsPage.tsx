import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiDelete, apiGet } from "../api/client";
import { LogsViewer } from "../components/LogsViewer";

interface DeploymentRecord {
  id: number;
  game: string;
  type: string;
  request_json: string;
  result_json?: string;
  vmid?: number;
  ip_address?: string;
  status: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

const statusLabel: Record<string, string> = {
  queued: "En attente",
  running: "En cours",
  success: "Succès",
  failed: "Échec",
};

export const DeploymentDetailsPage: React.FC = () => {
  const { id } = useParams();
  const deploymentId = Number(id);
  const [deployment, setDeployment] = useState<DeploymentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!deploymentId) return;
    let cancelled = false;

    const fetchDeployment = async () => {
      try {
        const data = await apiGet<DeploymentRecord>(`/api/deployments/${deploymentId}`);
        if (!cancelled) setDeployment(data);
      } catch (e: unknown) {
        if (!cancelled) setError((e as Error).message ?? "Erreur chargement déploiement");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchDeployment();
    const interval = setInterval(fetchDeployment, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [deploymentId]);

  if (!deploymentId) return <p className="error">ID invalide</p>;
  if (loading) return <div className="card page-card"><div className="page-loading">Chargement…</div></div>;
  if (error) return <div className="card page-card"><p className="error">{error}</p></div>;
  if (!deployment) return <div className="card page-card"><p className="error">Déploiement introuvable</p></div>;

  const onDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiDelete(`/api/deployments/${deploymentId}`);
      navigate("/deployments");
    } catch (e: unknown) {
      setDeleteError((e as Error).message ?? "Erreur lors de la suppression");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="page-wrap deployment-detail-page">
      <nav className="page-breadcrumb">
        <Link to="/deployments">Déploiements</Link>
        <span className="page-breadcrumb-sep">/</span>
        <span>#{deployment.id}</span>
      </nav>

      <header className="page-header deployment-detail-header">
        <div>
          <h1>Déploiement #{deployment.id}</h1>
          <p className="page-meta">
            {deployment.game} – {deployment.type}
          </p>
        </div>
        <span className={`deployment-status-badge deployment-status-badge--${deployment.status}`}>
          {statusLabel[deployment.status] ?? deployment.status}
        </span>
      </header>

      {deployment.error_message && (
        <div className="card page-panel page-panel--error">
          <p className="error">{deployment.error_message}</p>
        </div>
      )}

      {deployment.status === "success" && (
        <div className="card page-panel">
          <p className="page-panel-desc">
            Le serveur est déployé. Pour le gérer (démarrage, arrêt, configuration, SFTP) :{" "}
            <Link to={`/servers/${deployment.id}`} className="link-cta">
              Ouvrir le tableau de bord serveur →
            </Link>
          </p>
        </div>
      )}

      <section className="card page-panel">
        <h2 className="page-panel-title">Logs du déploiement</h2>
        <LogsViewer deploymentId={deploymentId} />
      </section>

      <section className="card page-panel page-panel--danger">
        <h2 className="page-panel-title">Supprimer le déploiement</h2>
        <p className="page-panel-desc">
          Supprimer ce déploiement et tenter de détruire la VM associée. Cette action est définitive.
        </p>
        {!confirmingDelete ? (
          <button
            type="button"
            className="btn btn--secondary btn--danger"
            onClick={() => setConfirmingDelete(true)}
            disabled={deleting}
          >
            Supprimer ce déploiement
          </button>
        ) : (
          <div className="confirm-actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={onDelete}
              disabled={deleting}
            >
              {deleting ? "Suppression…" : "Confirmer la suppression"}
            </button>
          </div>
        )}
        {deleteError && <p className="error confirm-error">{deleteError}</p>}
      </section>
    </div>
  );
};
