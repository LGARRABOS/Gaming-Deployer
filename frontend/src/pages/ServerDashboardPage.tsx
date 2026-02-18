import React, { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiDelete, apiGet, apiPost } from "../api/client";
import { ServerConsole } from "../components/ServerConsole";
import { ServerFileBrowser } from "../components/ServerFileBrowser";
import { ServerMetrics } from "../components/ServerMetrics";
import { useServerMonitoringData } from "../hooks/useServerMonitoringData";

const ServerMonitoringCharts = lazy(() =>
  import("../components/ServerMonitoringCharts").then((m) => ({ default: m.ServerMonitoringCharts }))
);

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
type TabId = "console" | "config" | "backups" | "players" | "monitoring" | "logs" | "migration" | "sftp";

/** Valeurs par défaut server.properties (Minecraft) pour affichage et préremplissage */
const CONFIG_DEFAULTS: Record<string, string> = {
  "server-port": "25565",
  motd: "A Minecraft Server",
  "max-players": "20",
  "level-name": "world",
  "level-seed": "",
  "level-type": "default",
  "online-mode": "true",
  "white-list": "false",
  "enforce-whitelist": "false",
  gamemode: "survival",
  difficulty: "easy",
  pvp: "true",
  hardcore: "false",
  "allow-flight": "false",
  "view-distance": "10",
  "simulation-distance": "10",
  "spawn-protection": "16",
  "allow-nether": "true",
  "spawn-monsters": "true",
  "spawn-animals": "true",
  "generate-structures": "true",
  "max-world-size": "29999984",
  "enable-command-block": "false",
  "max-tick-time": "60000",
};

export const ServerDashboardPage: React.FC = () => {
  const { id } = useParams();
  const serverId = Number(id);
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>("unknown");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [configProps, setConfigProps] = useState<Record<string, string>>({ ...CONFIG_DEFAULTS });
  const [configSaving, setConfigSaving] = useState(false);
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("console");
  const [backupFiles, setBackupFiles] = useState<string[]>([]);
  const [backupCreating, setBackupCreating] = useState(false);
  const [backupDeleting, setBackupDeleting] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [minecraftInfo, setMinecraftInfo] = useState<{
    online: number;
    max: number;
    players: string[];
    tps?: { "1m"?: string; "5m"?: string; "15m"?: string; current?: string };
  } | null>(null);
  const [minecraftInfoLoading, setMinecraftInfoLoading] = useState(false);
  const [playerActionLoading, setPlayerActionLoading] = useState<string | null>(null);
  const [playerActionMessage, setPlayerActionMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [actionLogs, setActionLogs] = useState<{ id: number; ts: string; action: string; details?: string; success: boolean; message?: string }[]>([]);
  const [actionLogsLoading, setActionLogsLoading] = useState(false);
  const [migrateVersions, setMigrateVersions] = useState<string[]>([]);
  const [migrateVersionsLoading, setMigrateVersionsLoading] = useState(false);
  const [migrateTarget, setMigrateTarget] = useState<string>("");
  const [migrateLoading, setMigrateLoading] = useState(false);
  const [migrateMessage, setMigrateMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const { data: monitoringData, loading: monitoringLoading } = useServerMonitoringData(serverId || null);

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
      if (res?.ok && res.properties) setConfigProps({ ...CONFIG_DEFAULTS, ...res.properties });
    } catch {
      // ignore
    }
  }, [serverId]);

  const fetchBackups = useCallback(async () => {
    if (!serverId) return;
    try {
      const res = await apiGet<{ ok: boolean; files?: string[] }>(`/api/servers/${serverId}/backups`);
      setBackupFiles(res?.files ?? []);
    } catch {
      setBackupFiles([]);
    }
  }, [serverId]);

  const fetchActionLogs = useCallback(async () => {
    if (!serverId) return;
    setActionLogsLoading(true);
    try {
      const res = await apiGet<{ ok: boolean; logs?: { id: number; ts: string; action: string; details?: string; success: boolean; message?: string }[] }>(
        `/api/servers/${serverId}/action-logs`
      );
      setActionLogs(res?.logs ?? []);
    } catch {
      setActionLogs([]);
    } finally {
      setActionLogsLoading(false);
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

  useEffect(() => {
    if (activeTab === "backups" && serverId) fetchBackups();
  }, [activeTab, serverId, fetchBackups]);

  useEffect(() => {
    if (activeTab === "logs" && serverId) fetchActionLogs();
  }, [activeTab, serverId, fetchActionLogs]);

  const fetchMigrateVersions = useCallback(async () => {
    setMigrateVersionsLoading(true);
    try {
      const res = await apiGet<{ versions: string[]; latest: string }>("/api/minecraft/versions");
      if (res?.versions?.length) {
        setMigrateVersions(res.versions);
        setMigrateTarget((v) => v || res.latest || res.versions[0]);
      }
    } catch {
      setMigrateVersions([]);
    } finally {
      setMigrateVersionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "migration") fetchMigrateVersions();
  }, [activeTab, fetchMigrateVersions]);

  const onMigrate = useCallback(async () => {
    if (!serverId || !migrateTarget || migrateLoading) return;
    setMigrateLoading(true);
    setMigrateMessage(null);
    try {
      const res = await apiPost<{ ok: boolean; error?: string; message?: string }>(
        `/api/servers/${serverId}/migrate`,
        { version: migrateTarget }
      );
      if (res?.ok) {
        setMigrateMessage({ type: "ok", text: res.message ?? "Migration effectuée." });
        fetchStatus();
        fetchActionLogs();
      } else {
        setMigrateMessage({ type: "error", text: res?.error ?? "Erreur lors de la migration." });
      }
    } catch (e: unknown) {
      setMigrateMessage({ type: "error", text: (e as Error).message ?? "Erreur lors de la migration." });
    } finally {
      setMigrateLoading(false);
    }
  }, [serverId, migrateTarget, migrateLoading, fetchStatus, fetchActionLogs]);

  const fetchMinecraftInfo = useCallback(async () => {
    if (!serverId) return;
    setMinecraftInfoLoading(true);
    try {
      const res = await apiGet<{
        ok: boolean;
        online?: number;
        max?: number;
        players?: string[];
        tps?: { "1m"?: string; "5m"?: string; "15m"?: string; current?: string };
      }>(`/api/servers/${serverId}/minecraft-info`);
      if (res?.ok && res.online !== undefined) {
        setMinecraftInfo({
          online: res.online,
          max: res.max ?? 0,
          players: res.players ?? [],
          tps: res.tps,
        });
      } else {
        setMinecraftInfo({ online: 0, max: 0, players: [], tps: undefined });
      }
    } catch {
      setMinecraftInfo({ online: 0, max: 0, players: [], tps: undefined });
    } finally {
      setMinecraftInfoLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    if (activeTab === "players" && serverId) {
      fetchMinecraftInfo();
      const t = setInterval(fetchMinecraftInfo, 10000);
      return () => clearInterval(t);
    }
  }, [activeTab, serverId, fetchMinecraftInfo]);

  const onPlayerCommand = useCallback(
    async (command: string, playerName: string, confirmMessage?: string) => {
      if (confirmMessage && !window.confirm(confirmMessage)) return;
      setPlayerActionLoading(playerName);
      setPlayerActionMessage(null);
      try {
        const res = await apiPost<{ ok: boolean; error?: string; response?: string }>(
          `/api/servers/${serverId}/console/command`,
          { command }
        );
        if (res?.ok) {
          setPlayerActionMessage({ type: "ok", text: "Commande exécutée." });
          fetchMinecraftInfo();
          fetchActionLogs();
        } else {
          setPlayerActionMessage({ type: "error", text: res?.error ?? res?.response ?? "Erreur" });
        }
      } catch (e: unknown) {
        setPlayerActionMessage({ type: "error", text: (e as Error).message ?? "Erreur" });
      } finally {
        setPlayerActionLoading(null);
      }
    },
    [serverId, fetchMinecraftInfo]
  );

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
        fetchActionLogs();
      }
    } catch (e: unknown) {
      setError((e as Error).message ?? "Erreur");
    } finally {
      setActionLoading(null);
    }
  };

  const onCreateBackup = async () => {
    setBackupCreating(true);
    try {
      const res = await apiPost<{ ok: boolean; error?: string; file?: string }>(
        `/api/servers/${serverId}/backup`,
        {}
      );
      if (res?.ok) {
        fetchBackups();
        fetchActionLogs();
      }
    } finally {
      setBackupCreating(false);
    }
  };

  const onDeleteBackup = async (file: string) => {
    setBackupDeleting(file);
    setBackupError(null);
    try {
      await apiDelete(`/api/servers/${serverId}/backup?file=${encodeURIComponent(file)}`);
      fetchBackups();
      fetchActionLogs();
    } catch (e: unknown) {
      setBackupError((e as Error).message ?? "Erreur lors de la suppression");
    } finally {
      setBackupDeleting(null);
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
        fetchActionLogs();
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

  const winscpUrl =
    server.sftp_user && server.sftp_password && server.ip
      ? `winscp://${encodeURIComponent(server.sftp_user)}:${encodeURIComponent(
          server.sftp_password,
        )}@${server.ip}:22/`
      : "";

  const statusLabel =
    serviceStatus === "active" ? "En marche" :
    serviceStatus === "inactive" ? "Arrêté" : String(serviceStatus);

  const tabs: { id: TabId; label: string }[] = [
    { id: "console", label: "Console & performances" },
    { id: "config", label: "Configuration" },
    { id: "backups", label: "Sauvegardes" },
    { id: "players", label: "Joueurs" },
    { id: "monitoring", label: "Monitoring" },
    { id: "logs", label: "Logs" },
    { id: "migration", label: "Migration" },
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
              <h3 className="server-config-section">Réseau et général</h3>
              <div className="server-config-grid">
                <label>
                  <span>MOTD (message d’accueil)</span>
                  <input
                    value={configProps["motd"] ?? CONFIG_DEFAULTS.motd}
                    onChange={(e) => setConfigProps((p) => ({ ...p, motd: e.target.value }))}
                  />
                </label>
                <label>
                  <span>Nombre max de joueurs</span>
                  <input
                    type="number"
                    min={1}
                    value={configProps["max-players"] ?? CONFIG_DEFAULTS["max-players"]}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "max-players": e.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Nom du monde</span>
                  <input
                    value={configProps["level-name"] ?? CONFIG_DEFAULTS["level-name"]}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "level-name": e.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Type de monde</span>
                  <select
                    value={configProps["level-type"] ?? CONFIG_DEFAULTS["level-type"]}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "level-type": e.target.value }))
                    }
                  >
                    <option value="default">Default</option>
                    <option value="flat">Flat</option>
                    <option value="largeBiomes">Large Biomes</option>
                    <option value="amplified">Amplified</option>
                  </select>
                </label>
              </div>

              <h3 className="server-config-section">Connexion et sécurité</h3>
              <div className="server-config-grid">
                <label>
                  <span>Mode en ligne (authentification Mojang)</span>
                  <select
                    value={configProps["online-mode"] ?? CONFIG_DEFAULTS["online-mode"]}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "online-mode": e.target.value }))
                    }
                  >
                    <option value="true">Oui</option>
                    <option value="false">Non (cracked)</option>
                  </select>
                </label>
                <label>
                  <span>Liste blanche (whitelist)</span>
                  <select
                    value={configProps["white-list"] ?? CONFIG_DEFAULTS["white-list"]}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "white-list": e.target.value }))
                    }
                  >
                    <option value="true">Activée</option>
                    <option value="false">Désactivée</option>
                  </select>
                </label>
                <label>
                  <span>Exclure les non-whitelist (enforce-whitelist)</span>
                  <select
                    value={configProps["enforce-whitelist"] ?? CONFIG_DEFAULTS["enforce-whitelist"]}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "enforce-whitelist": e.target.value }))
                    }
                  >
                    <option value="true">Oui</option>
                    <option value="false">Non</option>
                  </select>
                </label>
              </div>

              <h3 className="server-config-section">Règles de jeu</h3>
              <div className="server-config-grid">
                <label>
                  <span>Mode de jeu par défaut</span>
                  <select
                    value={configProps["gamemode"] ?? CONFIG_DEFAULTS.gamemode}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, gamemode: e.target.value }))
                    }
                  >
                    <option value="survival">Survival</option>
                    <option value="creative">Creative</option>
                    <option value="adventure">Adventure</option>
                    <option value="spectator">Spectator</option>
                  </select>
                </label>
                <label>
                  <span>Difficulté</span>
                  <select
                    value={configProps["difficulty"] ?? CONFIG_DEFAULTS.difficulty}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, difficulty: e.target.value }))
                    }
                  >
                    <option value="peaceful">Peaceful</option>
                    <option value="easy">Easy</option>
                    <option value="normal">Normal</option>
                    <option value="hard">Hard</option>
                  </select>
                </label>
                <label>
                  <span>PVP</span>
                  <select
                    value={configProps["pvp"] ?? CONFIG_DEFAULTS.pvp}
                    onChange={(e) => setConfigProps((p) => ({ ...p, pvp: e.target.value }))}
                  >
                    <option value="true">Activé</option>
                    <option value="false">Désactivé</option>
                  </select>
                </label>
                <label>
                  <span>Mode hardcore</span>
                  <select
                    value={configProps["hardcore"] ?? CONFIG_DEFAULTS.hardcore}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, hardcore: e.target.value }))
                    }
                  >
                    <option value="true">Oui</option>
                    <option value="false">Non</option>
                  </select>
                </label>
                <label>
                  <span>Vol autorisé (allow-flight)</span>
                  <select
                    value={configProps["allow-flight"] ?? CONFIG_DEFAULTS["allow-flight"]}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "allow-flight": e.target.value }))
                    }
                  >
                    <option value="true">Oui</option>
                    <option value="false">Non</option>
                  </select>
                </label>
              </div>

              <h3 className="server-config-section">Monde et performances</h3>
              <div className="server-config-grid">
                <label>
                  <span>Distance de vue (chunks)</span>
                  <input
                    type="number"
                    min={2}
                    max={32}
                    value={configProps["view-distance"] ?? CONFIG_DEFAULTS["view-distance"]}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "view-distance": e.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Distance de simulation (chunks)</span>
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={configProps["simulation-distance"] ?? CONFIG_DEFAULTS["simulation-distance"]}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "simulation-distance": e.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Protection du spawn (rayon, 0 = désactivé)</span>
                  <input
                    type="number"
                    min={0}
                    max={256}
                    value={configProps["spawn-protection"] ?? CONFIG_DEFAULTS["spawn-protection"]}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "spawn-protection": e.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Nether autorisé</span>
                  <select
                    value={configProps["allow-nether"] ?? CONFIG_DEFAULTS["allow-nether"]}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "allow-nether": e.target.value }))
                    }
                  >
                    <option value="true">Oui</option>
                    <option value="false">Non</option>
                  </select>
                </label>
                <label>
                  <span>Apparition des monstres</span>
                  <select
                    value={configProps["spawn-monsters"] ?? CONFIG_DEFAULTS["spawn-monsters"]}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "spawn-monsters": e.target.value }))
                    }
                  >
                    <option value="true">Oui</option>
                    <option value="false">Non</option>
                  </select>
                </label>
                <label>
                  <span>Apparition des animaux</span>
                  <select
                    value={configProps["spawn-animals"] ?? CONFIG_DEFAULTS["spawn-animals"]}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "spawn-animals": e.target.value }))
                    }
                  >
                    <option value="true">Oui</option>
                    <option value="false">Non</option>
                  </select>
                </label>
                <label>
                  <span>Génération des structures</span>
                  <select
                    value={configProps["generate-structures"] ?? CONFIG_DEFAULTS["generate-structures"]}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "generate-structures": e.target.value }))
                    }
                  >
                    <option value="true">Oui</option>
                    <option value="false">Non</option>
                  </select>
                </label>
                <label>
                  <span>Taille max monde (bordure)</span>
                  <input
                    type="number"
                    min={1}
                    max={29999984}
                    value={configProps["max-world-size"] ?? CONFIG_DEFAULTS["max-world-size"]}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "max-world-size": e.target.value }))
                    }
                  />
                </label>
              </div>

              <h3 className="server-config-section">Admin et technique</h3>
              <div className="server-config-grid">
                <label>
                  <span>Bloc de commande (command blocks)</span>
                  <select
                    value={configProps["enable-command-block"] ?? CONFIG_DEFAULTS["enable-command-block"]}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "enable-command-block": e.target.value }))
                    }
                  >
                    <option value="true">Activé</option>
                    <option value="false">Désactivé</option>
                  </select>
                </label>
                <label>
                  <span>Max tick time (ms, -1 = désactiver watchdog)</span>
                  <input
                    type="number"
                    min={-1}
                    value={configProps["max-tick-time"] ?? CONFIG_DEFAULTS["max-tick-time"]}
                    onChange={(e) =>
                      setConfigProps((p) => ({ ...p, "max-tick-time": e.target.value }))
                    }
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

        {activeTab === "players" && (() => {
          const info = minecraftInfo ?? { online: 0, max: 0, players: [] as string[], tps: undefined };
          return (
            <section className="card server-panel server-panel--wide">
              <h2 className="server-panel-title">Joueurs connectés</h2>
              <div className="server-players-actions">
                <button
                  type="button"
                  className="server-btn server-btn--primary"
                  onClick={fetchMinecraftInfo}
                  disabled={minecraftInfoLoading}
                >
                  {minecraftInfoLoading ? "Actualisation…" : "Actualiser"}
                </button>
              </div>
              <div className="server-players-stats">
                <p className="server-players-count">
                  <strong>{info.online}</strong> / <strong>{info.max}</strong> joueur{info.online !== 1 ? "s" : ""} connecté{info.online !== 1 ? "s" : ""}
                </p>
                {info.tps && (info.tps["1m"] != null || info.tps["5m"] != null || info.tps["15m"] != null) && (
                  <p className="server-players-tps">
                    TPS (1m, 5m, 15m) : {[info.tps["1m"], info.tps["5m"], info.tps["15m"]].filter(Boolean).join(", ") || "—"}
                  </p>
                )}
                {info.tps?.current != null && info.tps["1m"] == null && (
                  <p className="server-players-tps">TPS : {info.tps.current}</p>
                )}
                <div className="server-players-box">
                  <h3 className="server-players-box-title">Joueurs en ligne</h3>
                  {info.players.length > 0 ? (
                    <ul className="server-players-list server-players-list--actions">
                      {info.players.map((name) => (
                        <li key={name} className="server-players-list-item server-players-list-item--row">
                          <span className="server-players-pseudo">{name}</span>
                          <div className="server-players-item-actions">
                            <button
                              type="button"
                              className="server-btn server-btn--small"
                              onClick={() => onPlayerCommand(`op ${name}`, name)}
                              disabled={playerActionLoading !== null}
                              title="Passer opérateur"
                            >
                              Op
                            </button>
                            <button
                              type="button"
                              className="server-btn server-btn--small"
                              onClick={() => onPlayerCommand(`whitelist add ${name}`, name)}
                              disabled={playerActionLoading !== null}
                              title="Ajouter à la whitelist"
                            >
                              Whitelist
                            </button>
                            <button
                              type="button"
                              className="server-btn server-btn--small server-btn--danger"
                              onClick={() => {
                                const reason = window.prompt("Raison du kick (optionnel)");
                                onPlayerCommand(reason ? `kick ${name} ${reason}` : `kick ${name}`, name);
                              }}
                              disabled={playerActionLoading !== null}
                              title="Expulser"
                            >
                              Kick
                            </button>
                            <button
                              type="button"
                              className="server-btn server-btn--small server-btn--danger"
                              onClick={() => {
                                if (!window.confirm(`Bannir ${name} ?`)) return;
                                const reason = window.prompt("Raison du bannissement (optionnel)");
                                onPlayerCommand(reason ? `ban ${name} ${reason}` : `ban ${name}`, name);
                              }}
                              disabled={playerActionLoading !== null}
                              title="Bannir"
                            >
                              Ban
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="server-panel-desc">Aucun joueur connecté.</p>
                  )}
                </div>
                {playerActionMessage && (
                  <p className={playerActionMessage.type === "ok" ? "success server-panel-error" : "error server-panel-error"}>
                    {playerActionMessage.text}
                  </p>
                )}
              </div>
            </section>
          );
        })()}

        {activeTab === "monitoring" && (
          <Suspense
            fallback={
              <section className="card server-panel server-panel--wide">
                <p className="server-panel-desc">Chargement des graphiques…</p>
              </section>
            }
          >
            <ServerMonitoringCharts data={monitoringData} loading={monitoringLoading} />
          </Suspense>
        )}

        {activeTab === "logs" && (
          <section className="card server-panel server-panel--wide">
            <h2 className="server-panel-title">Logs des actions</h2>
            <div className="server-logs-actions">
              <button
                type="button"
                className="server-btn server-btn--primary"
                onClick={() => fetchActionLogs()}
                disabled={actionLogsLoading}
              >
                {actionLogsLoading ? "Chargement…" : "Actualiser"}
              </button>
            </div>
            {actionLogsLoading && actionLogs.length === 0 ? (
              <p className="server-panel-desc">Chargement des logs…</p>
            ) : actionLogs.length === 0 ? (
              <p className="server-panel-desc">Aucune action enregistrée pour le moment.</p>
            ) : (
              <div className="server-logs-list-wrap">
                <table className="server-logs-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Action</th>
                      <th>Détails</th>
                      <th>Résultat</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actionLogs.map((log) => {
                      const actionLabels: Record<string, string> = {
                        service_start: "Démarrage du serveur",
                        service_stop: "Arrêt du serveur",
                        service_restart: "Redémarrage du serveur",
                        console_command: "Commande console",
                        config_update: "Modification configuration",
                        backup_create: "Création sauvegarde",
                        backup_delete: "Suppression sauvegarde",
                        migrate: "Migration de version",
                      };
                      const label = actionLabels[log.action] ?? log.action;
                      const date = (() => {
                        try {
                          const d = new Date(log.ts);
                          return Number.isNaN(d.getTime()) ? log.ts : d.toLocaleString("fr-FR");
                        } catch {
                          return log.ts;
                        }
                      })();
                      return (
                        <tr key={log.id} className={log.success ? "" : "server-logs-row--error"}>
                          <td className="server-logs-ts">{date}</td>
                          <td className="server-logs-action">{label}</td>
                          <td className="server-logs-details">{log.details ?? "—"}</td>
                          <td>
                            <span className={log.success ? "success" : "error"}>
                              {log.success ? "Succès" : "Échec"}
                            </span>
                          </td>
                          <td className="server-logs-message">{log.message ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {activeTab === "migration" && (
          <section className="card server-panel server-panel--wide">
            <h2 className="server-panel-title">Migration de version</h2>
            {migrateVersionsLoading ? (
              <p className="server-panel-desc">Chargement des versions…</p>
            ) : migrateVersions.length === 0 ? (
              <p className="server-panel-desc">Impossible de charger la liste des versions.</p>
            ) : (
              <>
                <div className="server-migration-form">
                  <label>
                    <span>Version cible (vanilla)</span>
                    <select
                      value={migrateTarget || migrateVersions[0]}
                      onChange={(e) => setMigrateTarget(e.target.value)}
                      disabled={migrateLoading}
                    >
                      {migrateVersions.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="server-btn server-btn--primary"
                    onClick={onMigrate}
                    disabled={migrateLoading || !migrateTarget}
                  >
                    {migrateLoading ? "Migration en cours…" : "Migrer vers cette version"}
                  </button>
                </div>
                {migrateMessage && (
                  <p className={migrateMessage.type === "ok" ? "success server-panel-error" : "error server-panel-error"}>
                    {migrateMessage.text}
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {activeTab === "backups" && (
          <section className="card server-panel server-panel--wide">
            <h2 className="server-panel-title">Sauvegardes</h2>
            <div className="server-backups-actions">
              <button
                type="button"
                className="server-btn server-btn--primary"
                onClick={onCreateBackup}
                disabled={backupCreating}
              >
                {backupCreating ? "Création…" : "Créer une sauvegarde"}
              </button>
            </div>
            {backupError && <p className="error server-panel-error">{backupError}</p>}
            <div className="server-backups-list">
              {backupFiles.length === 0 ? (
                <p className="server-panel-desc">Aucune sauvegarde pour le moment.</p>
              ) : (
                <ul>
                  {backupFiles.map((file) => (
                    <li key={file}>
                      <span className="server-backup-filename">{file}</span>
                      <a
                        href={`/api/servers/${serverId}/backup/download?file=${encodeURIComponent(file)}`}
                        className="server-btn server-btn--primary"
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Télécharger
                      </a>
                      <button
                        type="button"
                        className="server-btn server-btn--danger"
                        onClick={() => onDeleteBackup(file)}
                        disabled={backupDeleting === file}
                        title="Supprimer cette sauvegarde"
                      >
                        {backupDeleting === file ? "…" : "Supprimer"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {activeTab === "sftp" && (
          <section className="card server-panel server-panel--wide">
            <h2 className="server-panel-title">Connexion SFTP</h2>
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
                {winscpUrl && (
                  <button
                    type="button"
                    className="btn btn--primary"
                    style={{ marginTop: "0.75rem" }}
                    onClick={() => {
                      window.location.href = winscpUrl;
                    }}
                  >
                    Ouvrir directement dans WinSCP
                  </button>
                )}
                <hr className="server-files-divider" />
                <ServerFileBrowser serverId={serverId} />
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
