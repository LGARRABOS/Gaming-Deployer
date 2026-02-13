import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";

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
  if (loading) return <p>Chargement...</p>;
  if (error && !server) return <p className="error">{error}</p>;
  if (!server) return <p className="error">Serveur introuvable</p>;

  return (
    <div className="card">
      <h1>{server.name}</h1>
      <p>
        <strong>IP:</strong> <code>{server.ip}</code> — <strong>Port:</strong>{" "}
        <code>{server.port}</code>
        {server.vmid != null && (
          <> — <strong>VMID:</strong> {server.vmid}</>
        )}
      </p>
      <p>
        <Link to={`/deployments/${serverId}`} className="hint">
          Voir les logs du déploiement
        </Link>
      </p>

      {/* Contrôle du service */}
      <section className="server-section">
        <h2>Contrôle du serveur</h2>
        <p className="hint">
          Statut du service Minecraft :{" "}
          <strong className={serviceStatus === "active" ? "success" : ""}>
            {serviceStatus === "active" ? "En marche" : serviceStatus === "inactive" ? "Arrêté" : serviceStatus}
          </strong>
        </p>
        <div className="server-actions">
          <button
            type="button"
            onClick={() => onAction("start")}
            disabled={actionLoading !== null || serviceStatus === "active"}
          >
            {actionLoading === "start" ? "..." : "Démarrer"}
          </button>
          <button
            type="button"
            onClick={() => onAction("stop")}
            disabled={actionLoading !== null || serviceStatus !== "active"}
          >
            {actionLoading === "stop" ? "..." : "Arrêter"}
          </button>
          <button
            type="button"
            onClick={() => onAction("restart")}
            disabled={actionLoading !== null}
          >
            {actionLoading === "restart" ? "..." : "Redémarrer"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      {/* Accès SFTP */}
      {server.sftp_user && server.sftp_password && (
        <section className="server-section">
          <h2>Accès SFTP (WinSCP, FileZilla…)</h2>
          <p className="hint">
            Utilise ces identifiants pour accéder aux fichiers du serveur (dossier{" "}
            <code>/opt/minecraft</code>).
          </p>
          <div className="sftp-info">
            <p><strong>Hôte:</strong> <code>{server.ip}</code></p>
            <p><strong>Port:</strong> <code>22</code></p>
            <p><strong>Utilisateur:</strong> <code>{server.sftp_user}</code></p>
            <p><strong>Mot de passe:</strong> <code>{server.sftp_password}</code></p>
          </div>
        </section>
      )}

      {/* Configuration server.properties */}
      <section className="server-section">
        <h2>Configuration (server.properties)</h2>
        <form onSubmit={onSaveConfig} className="form-grid">
          <label>
            MOTD
            <input
              value={configProps["motd"] ?? ""}
              onChange={(e) => setConfigProps((p) => ({ ...p, motd: e.target.value }))}
            />
          </label>
          <label>
            Nombre max de joueurs
            <input
              type="number"
              value={configProps["max-players"] ?? ""}
              onChange={(e) =>
                setConfigProps((p) => ({ ...p, "max-players": e.target.value }))
              }
            />
          </label>
          <label>
            Mode en ligne (true/false)
            <input
              value={configProps["online-mode"] ?? ""}
              onChange={(e) =>
                setConfigProps((p) => ({ ...p, "online-mode": e.target.value }))
              }
            />
          </label>
          <label>
            PVP (true/false)
            <input
              value={configProps["pvp"] ?? ""}
              onChange={(e) => setConfigProps((p) => ({ ...p, pvp: e.target.value }))}
            />
          </label>
          <label>
            Difficulté (peaceful, easy, normal, hard)
            <input
              value={configProps["difficulty"] ?? ""}
              onChange={(e) =>
                setConfigProps((p) => ({ ...p, difficulty: e.target.value }))
              }
            />
          </label>
          <div style={{ gridColumn: "1 / -1" }}>
            <button type="submit" disabled={configSaving}>
              {configSaving ? "Enregistrement..." : "Enregistrer la configuration"}
            </button>
            {configMessage && (
              <span className={configMessage.startsWith("Configuration") ? "success" : "error"}>
                {" "}{configMessage}
              </span>
            )}
          </div>
        </form>
      </section>
    </div>
  );
};
