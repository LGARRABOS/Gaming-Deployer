import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";

interface HytaleConfig {
  port: number;
  max_players: number;
  jvm_heap: string;
  jvm_flags: string;
  backup_enabled: boolean;
  backup_frequency: string;
  backup_retention: number;
  admin_user: string;
  admin_password: string;
}

interface FormState {
  name: string;
  cores: number;
  memory_mb: number;
  disk_gb: number;
  hytale: HytaleConfig;
}

export const CreateHytaleServerPage: React.FC = () => {
  const navigate = useNavigate();
  const [hytaleAuthConfigured, setHytaleAuthConfigured] = useState<boolean | null>(null);
  const [form, setForm] = useState<FormState>({
    name: "",
    cores: 2,
    memory_mb: 4096,
    disk_gb: 50,
    hytale: {
      port: 5520,
      max_players: 20,
      jvm_heap: "2G",
      jvm_flags: "",
      backup_enabled: false,
      backup_frequency: "24h",
      backup_retention: 7,
      admin_user: "hytaleadmin",
      admin_password: "",
    },
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ configured: boolean }>("/api/hytale/auth/status")
      .then((res) => setHytaleAuthConfigured(res.configured))
      .catch(() => setHytaleAuthConfigured(false));
  }, []);

  const update = (field: keyof FormState, value: unknown) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const updateHytale = (field: keyof HytaleConfig, value: unknown) => {
    setForm((f) => ({ ...f, hytale: { ...f.hytale, [field]: value } }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hytaleAuthConfigured) {
      setError("Authentification Hytale requise. Configure-la d'abord.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiPost("/api/deployments/hytale/validate", form);
      const res = await apiPost<{ deployment_id: number }>("/api/deployments/hytale", form);
      navigate(`/deployments/${res.deployment_id}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? "Erreur lors de la création du déploiement");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-wrap create-server-page">
      <header className="page-header">
        <h1>Créer un serveur Hytale</h1>
        <p className="page-subtitle">
          Configure la VM et les options Hytale, puis lance le déploiement.
        </p>
      </header>

      {hytaleAuthConfigured === false && (
        <div className="card page-panel page-panel--error">
          <p>
            L&apos;authentification Hytale n&apos;est pas configurée.{" "}
            <Link to="/hytale/auth">Configurer l&apos;authentification Hytale</Link> avant de créer un serveur.
          </p>
        </div>
      )}

      <form onSubmit={onSubmit} className="create-server-form">
        <section className="card page-panel">
          <h2 className="page-panel-title">VM</h2>
          <p className="page-panel-desc">Ressources et nom de la machine virtuelle.</p>
          <div className="form-grid form-grid--wide">
            <label>
              <span>Nom de la VM</span>
              <input value={form.name} onChange={(e) => update("name", e.target.value)} required />
            </label>
            <label>
              <span>CPU (cores)</span>
              <input
                type="number"
                value={form.cores}
                onChange={(e) => update("cores", Number(e.target.value))}
                min={1}
                max={4}
              />
            </label>
            <label>
              <span>RAM</span>
              <select
                value={form.memory_mb}
                onChange={(e) => update("memory_mb", Number(e.target.value))}
              >
                <option value={4096}>4 GB</option>
                <option value={8192}>8 GB</option>
                <option value={12288}>12 GB</option>
                <option value={16384}>16 GB</option>
                <option value={24576}>24 GB</option>
                <option value={32768}>32 GB</option>
              </select>
            </label>
            <label>
              <span>Stockage (Go)</span>
              <input
                type="number"
                value={form.disk_gb}
                onChange={(e) => update("disk_gb", Number(e.target.value))}
                min={10}
                max={500}
              />
            </label>
          </div>
        </section>

        <section className="card page-panel">
          <h2 className="page-panel-title">Hytale</h2>
          <p className="page-panel-desc">Paramètres du serveur de jeu.</p>
          <div className="form-grid form-grid--wide">
            <label>
              <span>Port (UDP)</span>
              <input
                type="number"
                value={form.hytale.port}
                onChange={(e) => updateHytale("port", Number(e.target.value))}
                min={1}
                max={65535}
              />
            </label>
            <label>
              <span>Max joueurs</span>
              <input
                type="number"
                value={form.hytale.max_players}
                onChange={(e) => updateHytale("max_players", Number(e.target.value))}
              />
            </label>
            <label>
              <span>JVM Heap</span>
              <input
                value={form.hytale.jvm_heap}
                onChange={(e) => updateHytale("jvm_heap", e.target.value)}
                placeholder="ex: 2G"
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              <span>JVM Flags (optionnel)</span>
              <input
                value={form.hytale.jvm_flags}
                onChange={(e) => updateHytale("jvm_flags", e.target.value)}
                placeholder="-XX:+UseG1GC"
              />
            </label>
            <label className="form-check">
              <input
                type="checkbox"
                checked={form.hytale.backup_enabled}
                onChange={(e) => updateHytale("backup_enabled", e.target.checked)}
              />
              <span>Sauvegardes automatiques</span>
            </label>
            {form.hytale.backup_enabled && (
              <>
                <label>
                  <span>Fréquence</span>
                  <select
                    value={form.hytale.backup_frequency}
                    onChange={(e) => updateHytale("backup_frequency", e.target.value)}
                  >
                    <option value="12h">Toutes les 12 h</option>
                    <option value="24h">Quotidien</option>
                    <option value="48h">Tous les 2 jours</option>
                  </select>
                </label>
                <label>
                  <span>Rétention (nombre)</span>
                  <input
                    type="number"
                    value={form.hytale.backup_retention}
                    onChange={(e) => updateHytale("backup_retention", Number(e.target.value))}
                    min={1}
                    max={30}
                  />
                </label>
              </>
            )}
            <label>
              <span>Utilisateur SFTP (admin)</span>
              <input
                value={form.hytale.admin_user}
                onChange={(e) => updateHytale("admin_user", e.target.value)}
                placeholder="hytaleadmin"
              />
            </label>
            <label>
              <span>Mot de passe SFTP</span>
              <input
                type="password"
                value={form.hytale.admin_password}
                onChange={(e) => updateHytale("admin_password", e.target.value)}
                placeholder="Généré automatiquement si vide"
              />
            </label>
          </div>
        </section>

        {error && (
          <div className="card page-panel page-panel--error">
            <p className="error">{error}</p>
          </div>
        )}

        <div className="form-actions">
          <button
            type="submit"
            className="btn btn--primary btn--large"
            disabled={submitting || hytaleAuthConfigured === false}
          >
            {submitting ? "Déploiement en cours…" : "Déployer le serveur"}
          </button>
        </div>
      </form>
    </div>
  );
};
