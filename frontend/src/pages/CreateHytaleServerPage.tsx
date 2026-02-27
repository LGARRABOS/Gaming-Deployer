import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";

interface HytaleConfig {
  max_players: number;
  jvm_heap: string;
  jvm_flags: string;
}

interface FormState {
  name: string;
  cores: number;
  memory_mb: number;
  hytale: HytaleConfig;
}

export const CreateHytaleServerPage: React.FC = () => {
  const navigate = useNavigate();
  const [hytaleAuthConfigured, setHytaleAuthConfigured] = useState<boolean | null>(null);
  const [downloaderAuthConfigured, setDownloaderAuthConfigured] = useState<boolean | null>(null);
  const [form, setForm] = useState<FormState>({
    name: "",
    cores: 2,
    memory_mb: 4096,
    hytale: {
      max_players: 20,
      jvm_heap: "2G",
      jvm_flags: "",
    },
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ configured: boolean }>("/api/hytale/auth/status")
      .then((res) => setHytaleAuthConfigured(res.configured))
      .catch(() => setHytaleAuthConfigured(false));
    apiGet<{ configured: boolean }>("/api/hytale/downloader/status")
      .then((res) => setDownloaderAuthConfigured(res.configured))
      .catch(() => setDownloaderAuthConfigured(false));
  }, []);

  const update = (field: keyof FormState, value: unknown) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const updateHytale = (field: keyof HytaleConfig, value: unknown) => {
    setForm((f) => ({ ...f, hytale: { ...f.hytale, [field]: value } }));
  };

  const authReady = hytaleAuthConfigured && downloaderAuthConfigured;
  const authMissing = hytaleAuthConfigured === false || downloaderAuthConfigured === false;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authReady) {
      setError("Authentifications Hytale requises (serveur + téléchargement). Configure-les dans Paramètres Hytale.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload = {
      ...form,
      disk_gb: 50,
      hytale: {
        ...form.hytale,
        port: 0,
        backup_enabled: false,
        backup_frequency: "24h",
        backup_retention: 7,
        admin_user: "",
        admin_password: "",
      },
    };
    try {
      await apiPost("/api/deployments/hytale/validate", payload);
      const res = await apiPost<{ deployment_id: number }>("/api/deployments/hytale", payload);
      navigate(`/hytale/deployments/${res.deployment_id}`);
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

      {authMissing && (
        <div className="card page-panel page-panel--error">
          <p>
            {!hytaleAuthConfigured && "L'authentification serveur Hytale n'est pas configurée. "}
            {!downloaderAuthConfigured && "L'authentification téléchargement n'est pas configurée. "}
            <Link to="/hytale/auth">Configurer les authentifications Hytale</Link> avant de créer un serveur.
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
          </div>
          <p className="page-panel-desc" style={{ marginTop: "0.5rem" }}>
            Stockage par défaut : 50 Go.
          </p>
        </section>

        <section className="card page-panel">
          <h2 className="page-panel-title">Hytale</h2>
          <p className="page-panel-desc">Paramètres du serveur de jeu.</p>
          <div className="form-grid form-grid--wide">
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
            disabled={submitting || !authReady}
          >
            {submitting ? "Déploiement en cours…" : "Déployer le serveur"}
          </button>
        </div>
      </form>
    </div>
  );
};
