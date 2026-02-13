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
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Erreur chargement déploiement");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchDeployment();
    const id = setInterval(fetchDeployment, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [deploymentId]);

  if (!deploymentId) return <p className="error">ID invalide</p>;
  if (loading) return <p>Chargement...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!deployment) return <p className="error">Déploiement introuvable</p>;

  const onDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiDelete(`/api/deployments/${deploymentId}`);
      navigate("/deployments");
    } catch (e: any) {
      setDeleteError(e.message ?? "Erreur lors de la suppression du déploiement");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="card">
      <h1>Détails déploiement #{deployment.id}</h1>
      <p>
        Statut: <strong>{deployment.status}</strong>
      </p>
      <p>VMID: {deployment.vmid ?? "-"}</p>
      <p>IP: {deployment.ip_address ?? "-"}</p>
      {deployment.error_message && <p className="error">{deployment.error_message}</p>}
      {deployment.status === "success" && (
        <p className="hint">
          Gestion du serveur (démarrage, arrêt, config, SFTP) :{" "}
          <Link to={`/servers/${deployment.id}`}>Tableau de bord serveur</Link>.
        </p>
      )}

      {!confirmingDelete && (
        <button onClick={() => setConfirmingDelete(true)} disabled={deleting}>
          Annuler / supprimer ce déploiement
        </button>
      )}

      {confirmingDelete && (
        <div className="confirm-delete">
          <p>
            Supprimer ce déploiement et tenter de détruire la VM associée ?
            Cette action est définitive.
          </p>
          <div className="confirm-actions">
            <button type="button" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
              Annuler
            </button>
            <button type="button" onClick={onDelete} disabled={deleting}>
              {deleting ? "Suppression..." : "Confirmer la suppression"}
            </button>
          </div>
        </div>
      )}

      {deleteError && <p className="error">{deleteError}</p>}

      <h2>Logs</h2>
      <LogsViewer deploymentId={deploymentId} />
    </div>
  );
};

