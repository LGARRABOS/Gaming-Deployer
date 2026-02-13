import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { ServerConsole } from "../components/ServerConsole";
import { ServerMetrics } from "../components/ServerMetrics";

interface ServerInfo {
  id: number;
  name: string;
  ip: string;
  port: number;
  vmid?: number;
  status: string;
  created_at: string;
  sftp_user?: string;
  sftp_password?: string;
}

type ServiceStatus = "active" | "inactive" | "failed" | "unknown";
type TabId = "console" | "config" | "sftp";

export const ServerDashboardPage: React.FC = () => {
  const { id } = useParams();
  const serverId = Number(id);
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>("unknown");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [configProps, setConfigProps] = useState<Record<string, string>>({});
  const [configSaving, setConfigSaving] = useState(false);
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("console");

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopyFeedback(label);
        setTimeout(() => setCopyFeedback(null), 2000);
      },
      () => setCopyFeedback("Erreur copie")
    );
  }, []);

  const fetchServer = useCallback(async () => {
    if (!serverId) return;
    try {
      const data = await apiGet<ServerInfo>(`/api/servers/${serverId}`);
      setServer(data);
    } catch (e: unknown) {
      setError((e as Error).message ?? "Erreur chargement serveur");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  const fetchStatus = useCallback(async () => {
    if (!serverId) return;
    try {
      const res = await apiGet<{ status: string }>(`/api/servers/${serverId}/status`);
      setServiceStatus((res?.status as ServiceStatus) ?? "unknown");
    } catch {
      setServiceStatus("unknown");
    }
  }, [serverId]);

  const fetchConfig = useCallback(async () => {
    if (!serverId) return;
    try {
      const res = await apiGet<{ ok: boolean; properties?: Record<string, string> }>(
        `/api/servers/${serverId}/config`
      );
      if (res?.ok && res.properties) setConfigProps(res.properties);
    } catch {
      // ignore
    }
  }, [serverId]);

  useEffect(() => {
    fetchServer();
  }, [fetchServer]);

  useEffect(() => {
    if (!server) return;
    fetchStatus();
    fetchConfig();
    const t = setInterval(() => fetchStatus(), 10000);
    return () => clearInterval(t);
  }, [server, fetchStatus, fetchConfig]);

  const onAction = async (action: "start" | "stop" | "restart") => {
    setActionLoading(action);
    setError(null);
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>(
        `/api/servers/${serverId}/action`,
        { action }
      );
      if (!res?.ok) {
        setError(res?.error ?? "Échec de l'action");
      } else {
        setTimeout(fetchStatus, 1500);
      }
    } catch (e: unknown) {
      setError((e as Error).message ?? "Erreur");
    } finally {
      setActionLoading(null);
    }
  };

  const onSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfigSaving(true);
    setConfigMessage(null);
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>(
        `/api/servers/${serverId}/config`,
        { properties: configProps },
        "PUT"
      );
      if (res?.ok) {
        setConfigMessage("Configuration enregistrée.");
      } else {
        setConfigMessage(res?.error ?? "Erreur");
      }
    } catch (e: unknown) {
      setConfigMessage((e as Error).message ?? "Erreur");
    } finally {
      setConfigSaving(false);
    }
  };

  if (!serverId) return <p className="error">ID invalide</p>;
  if (loading) return <div className="card servers-page"><div className="servers-loading">Chargement…</div></div>;
  if (error && !server) return <div className="card"><p className="error">{error}</p></div>;
  if (!server) return <div className="card"><p className="error">Serveur introuvable</p></div>;

  const sftpBlock =
    server.sftp_user && server.sftp_password
      ? `Hôte: ${server.ip}\nPort: 22\nUtilisateur: ${server.sftp_user}\nMot de passe: ${server.sftp_password}`
      : "";

  const statusLabel =
    serviceStatus === "active" ? "En marche" :
    serviceStatus === "inactive" ? "Arrêté" : String(serviceStatus);

  const tabs: { id: TabId; label: string }[] = [
    { id: "console", label: "Console & performances" },
    { id: "config", label: "Configuration" },
    { id: "sftp", label: "Connexion SFTP" },
  ];

  return (
    <div className="servers-page servers-dashboard">
      <nav className="servers-breadcrumb">
        <Link to="/servers">Serveurs Minecraft</Link>
        <span className="servers-breadcrumb-sep">/</span>
        <span>{server.name}</span>
      </nav>

      <header className="servers-dashboard-header">
        <h1>{server.name}</h1>
        <div className="servers-dashboard-header-actions">
          <span
            className={`server-status-badge server-status-badge--${serviceStatus === "active" ? "on" : "off"}`}
            aria-label={`Statut : ${statusLabel}`}
          >
            {statusLabel}
          </span>
          <Link to={`/deployments/${serverId}`} className="servers-link-secondary">
            Voir les logs du déploiement
          </Link>
        </div>
      </header>

      <div className="server-dashboard-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`server-dashboard-tab ${activeTab === tab.id ? "server-dashboard-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {copyFeedback && (
        <p className="copy-feedback success" role="status">{copyFeedback}</p>
      )}

      <div className="servers-dashboard-content">
        {activeTab === "console" && (
          <>
            <div className="server-dashboard-console-top">
              <section className="card server-panel">
                <h2 className="server-panel-title">Contrôle du serveur</h2>
                <p className="server-panel-desc">
                  Démarrer, arrêter ou redémarrer le service Minecraft.
                </p>
                <div className="server-actions">
                  <button
                    type="button"
                    className="server-btn server-btn--start"
                    onClick={() => onAction("start")}
                    disabled={actionLoading !== null || serviceStatus === "active"}
                  >
                    {actionLoading === "start" ? "…" : "Démarrer"}
                  </button>
                  <button
                    type="button"
                    className="server-btn server-btn--stop"
                    onClick={() => onAction("stop")}
                    disabled={actionLoading !== null || serviceStatus !== "active"}
                  >
                    {actionLoading === "stop" ? "…" : "Arrêter"}
                  </button>
                  <button
                    type="button"
                    className="server-btn server-btn--restart"
                    onClick={() => onAction("restart")}
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "restart" ? "…" : "Redémarrer"}
                  </button>
                </div>
                {error && <p className="error server-panel-error">{error}</p>}
              </section>
              <ServerMetrics serverId={serverId} />
            </div>
            <ServerConsole serverId={serverId} />
          </>
        )}

        {activeTab === "config" && (
          <section className="card server-panel server-panel--wide">
            <h2 className="server-panel-title">Configuration (server.properties)</h2>
            <form onSubmit={onSaveConfig} className="server-config-form">
              <div className="server-config-grid">
                <label>
                  <span>MOTD</span>
                  <input
                    value={configProps["motd"] ?? ""}
                    onChange={(e) => setConfigProps((p) => ({ ...p, motd: e.target.value }))}
                  />
                </label>
                <label>
                  <span>Nombre max de joueurs</span>
                  <input
                    type="number"
                    value={configProps["max-players"] ?? ""}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "max-players": e.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Mode en ligne</span>
                  <input
                    value={configProps["online-mode"] ?? ""}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "online-mode": e.target.value }))
                    }
                    placeholder="true / false"
                  />
                </label>
                <label>
                  <span>PVP</span>
                  <input
                    value={configProps["pvp"] ?? ""}
                    onChange={(e) => setConfigProps((p) => ({ ...p, pvp: e.target.value }))}
                    placeholder="true / false"
                  />
                </label>
                <label>
                  <span>Difficulté</span>
                  <input
                    value={configProps["difficulty"] ?? ""}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, difficulty: e.target.value }))
                    }
                    placeholder="peaceful, easy, normal, hard"
                  />
                </label>
              </div>
              <div className="server-config-actions">
                <button type="submit" className="server-btn server-btn--primary" disabled={configSaving}>
                  {configSaving ? "Enregistrement…" : "Enregistrer"}
                </button>
                {configMessage && (
                  <span className={configMessage.startsWith("Configuration") ? "success" : "error"}>
                    {configMessage}
                  </span>
                )}
              </div>
            </form>
          </section>
        )}

        {activeTab === "sftp" && (
          <section className="card server-panel server-panel--wide">
            <h2 className="server-panel-title">Connexion SFTP</h2>
            <p className="server-panel-desc">
              Utilise ces identifiants dans WinSCP, FileZilla, etc. Le dossier <code>minecraft</code> contient les fichiers du serveur.
            </p>
            {server.sftp_user && server.sftp_password ? (
              <>
                <div className="sftp-fields">
                  <div className="sftp-field">
                    <span className="sftp-field-label">Hôte</span>
                    <div className="sftp-field-row">
                      <code>{server.ip}</code>
                      <button type="button" className="btn-copy" onClick={() => copyToClipboard(server.ip, "Hôte copié")}>Copier</button>
                    </div>
                  </div>
                  <div className="sftp-field">
                    <span className="sftp-field-label">Port</span>
                    <div className="sftp-field-row">
                      <code>22</code>
                      <button type="button" className="btn-copy" onClick={() => copyToClipboard("22", "Port copié")}>Copier</button>
                    </div>
                  </div>
                  <div className="sftp-field">
                    <span className="sftp-field-label">Utilisateur</span>
                    <div className="sftp-field-row">
                      <code>{server.sftp_user}</code>
                      <button type="button" className="btn-copy" onClick={() => copyToClipboard(server.sftp_user!, "Utilisateur copié")}>Copier</button>
                    </div>
                  </div>
                  <div className="sftp-field">
                    <span className="sftp-field-label">Mot de passe</span>
                    <div className="sftp-field-row">
                      <code>{server.sftp_password}</code>
                      <button type="button" className="btn-copy" onClick={() => copyToClipboard(server.sftp_password!, "Mot de passe copié")}>Copier</button>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-copy-all"
                  onClick={() => copyToClipboard(sftpBlock, "Infos SFTP copiées")}
                >
                  Copier toutes les infos d'accès SFTP
                </button>
              </>
            ) : (
              <p className="server-panel-desc">Aucun accès SFTP configuré pour ce serveur.</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
};
