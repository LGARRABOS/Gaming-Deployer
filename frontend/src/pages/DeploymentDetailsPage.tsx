import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiDelete, apiGet, apiPost } from "../api/client";
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

function getMinecraftPortFromRequest(requestJson: string): number {
  try {
    const req = JSON.parse(requestJson) as { minecraft?: { port?: number } };
    const port = req?.minecraft?.port;
    if (typeof port === "number" && port >= 1 && port <= 65535) return port;
  } catch {
    // ignore
  }
  return 25565;
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
  const [specs, setSpecs] = useState<{ cores: number; memory_mb: number; disk_gb: number } | null>(null);
  const [specsSaving, setSpecsSaving] = useState(false);
  const [specsMessage, setSpecsMessage] = useState<string | null>(null);
  const [confirmingSpecs, setConfirmingSpecs] = useState(false);
  const [activeTab, setActiveTab] = useState<"logs" | "ressources">("logs");
  const navigate = useNavigate();

  const fetchSpecs = useCallback(async () => {
    if (!deploymentId) return;
    try {
      const res = await apiGet<{ cores: number; memory_mb: number; disk_gb: number }>(
        `/api/servers/${deploymentId}/specs`
      );
      setSpecs(res);
    } catch {
      setSpecs(null);
    }
  }, [deploymentId]);

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

  useEffect(() => {
    if (deployment?.status === "success") fetchSpecs();
  }, [deployment?.status, fetchSpecs]);

  const onSaveSpecsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!specs) return;
    setSpecsMessage(null);
    setConfirmingSpecs(true);
  };

  const onConfirmSpecsApply = async () => {
    if (!specs) return;
    setSpecsSaving(true);
    setConfirmingSpecs(false);
    setSpecsMessage(null);
    try {
      const res = await apiPost<{ ok: boolean; error?: string; message?: string }>(
        `/api/servers/${deploymentId}/specs`,
        { cores: specs.cores, memory_mb: specs.memory_mb, disk_gb: specs.disk_gb },
        "PUT"
      );
      if (res?.ok) {
        setSpecsMessage(res?.message ?? "Ressources mises à jour.");
        fetchSpecs();
      } else {
        setSpecsMessage(res?.error ?? "Erreur");
      }
    } catch (e: unknown) {
      setSpecsMessage((e as Error).message ?? "Erreur");
    } finally {
      setSpecsSaving(false);
    }
  };

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

      <div className="card page-panel deployment-network-info">
        <h2 className="page-panel-title">Connexion au serveur Minecraft</h2>
        <p className="page-panel-desc">
          IP et port à ouvrir sur votre box / routeur pour permettre les connexions depuis Internet.
        </p>
        <dl className="deployment-network-dl">
          <dt>IP de la VM</dt>
          <dd>
            {deployment.ip_address ? (
              <>
                <code>{deployment.ip_address}</code>
                <button
                  type="button"
                  className="btn-copy"
                  onClick={() => navigator.clipboard.writeText(deployment.ip_address!)}
                  title="Copier l’IP"
                >
                  Copier
                </button>
              </>
            ) : (
              <span className="deployment-network-pending">
                {deployment.status === "running" || deployment.status === "queued"
                  ? "En attente (affichée à la fin du déploiement)"
                  : "—"}
              </span>
            )}
          </dd>
          <dt>Port du serveur Minecraft</dt>
          <dd>
            <code>{getMinecraftPortFromRequest(deployment.request_json)}</code>
          </dd>
        </dl>
      </div>

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

      <div className="deployment-detail-tabs">
        <button
          type="button"
          className={`deployment-detail-tab ${activeTab === "logs" ? "deployment-detail-tab--active" : ""}`}
          onClick={() => setActiveTab("logs")}
        >
          Logs
        </button>
        {deployment.status === "success" && (
          <button
            type="button"
            className={`deployment-detail-tab ${activeTab === "ressources" ? "deployment-detail-tab--active" : ""}`}
            onClick={() => setActiveTab("ressources")}
          >
            Ressources VM
          </button>
        )}
      </div>

      <div className="deployment-detail-tab-content">
        {activeTab === "logs" && (
          <section className="card page-panel">
            <h2 className="page-panel-title">Logs du déploiement</h2>
            <LogsViewer deploymentId={deploymentId} />
          </section>
        )}

        {activeTab === "ressources" && deployment.status === "success" && (
          <section className="card page-panel">
            <h2 className="page-panel-title">Ressources VM</h2>
            <p className="page-panel-desc">
              Modifier le CPU, la RAM et le disque de la VM. Les changements sont appliqués sur Proxmox. Proxmox ne permet pas de réduire la taille du disque (agrandissement uniquement).
            </p>
            <p className="page-panel-notice">
              Si vous modifiez le CPU ou la RAM et que la VM est en marche, elle sera <strong>redémarrée automatiquement</strong> pour que les nouveaux paramètres soient pris en compte (cela peut prendre une à deux minutes).
            </p>
            {specs && (
              <form onSubmit={onSaveSpecsSubmit} className="server-config-form">
                <div className="server-config-grid">
                  <label>
                    <span>CPU (cores)</span>
                    <input
                      type="number"
                      min={1}
                      max={32}
                      value={specs.cores}
                      onChange={(e) => setSpecs((s) => s ? { ...s, cores: Number(e.target.value) } : s)}
                    />
                  </label>
                  <label>
                    <span>RAM (Mo)</span>
                    <input
                      type="number"
                      min={1024}
                      step={1024}
                      value={specs.memory_mb}
                      onChange={(e) => setSpecs((s) => s ? { ...s, memory_mb: Number(e.target.value) } : s)}
                    />
                  </label>
                  <label>
                    <span>Disque (Go)</span>
                    <input
                      type="number"
                      min={10}
                      max={500}
                      value={specs.disk_gb}
                      onChange={(e) => setSpecs((s) => s ? { ...s, disk_gb: Number(e.target.value) } : s)}
                      title="Agrandissement uniquement (Proxmox ne supporte pas la réduction)"
                    />
                  </label>
                </div>
                <div className="server-config-actions">
                  {!confirmingSpecs ? (
                    <button type="submit" className="server-btn server-btn--primary" disabled={specsSaving}>
                      Appliquer
                    </button>
                  ) : (
                    <div className="specs-confirm-actions">
                      <p className="specs-confirm-message">
                        Les changements vont être enregistrés sur Proxmox. Si la VM est en marche, elle sera <strong>redémarrée automatiquement</strong> pour appliquer les nouveaux CPU/RAM (1 à 2 minutes). Confirmer ?
                      </p>
                      <div className="confirm-actions">
                        <button
                          type="button"
                          className="server-btn server-btn--secondary"
                          onClick={() => setConfirmingSpecs(false)}
                          disabled={specsSaving}
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          className="server-btn server-btn--primary"
                          onClick={onConfirmSpecsApply}
                          disabled={specsSaving}
                        >
                          {specsSaving ? "Application… (redémarrage en cours)" : "Confirmer et appliquer"}
                        </button>
                      </div>
                    </div>
                  )}
                  {specsMessage && (
                    <span className={specsMessage.includes("mises à jour") || specsMessage.includes("redémarrée") ? "success" : "error"}>
                      {specsMessage}
                    </span>
                  )}
                </div>
              </form>
            )}
            {!specs && <p className="page-panel-desc">Chargement des specs…</p>}
          </section>
        )}
      </div>

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
