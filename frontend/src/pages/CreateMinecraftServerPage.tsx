import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../api/client";

interface MinecraftConfig {
  edition: "java";
  version: string;
  type: "vanilla" | "paper" | "purpur" | "forge" | "fabric";
  modded: boolean;
  mods: { url: string; hash?: string }[];
  port: number;
  extra_ports: number[];
  eula: boolean;
  max_players: number;
  online_mode: boolean;
  motd: string;
  whitelist: string[];
  operators: string[];
  jvm_heap: string;
  jvm_flags: string;
  backup_enabled: boolean;
  backup_frequency: string;
  backup_retention: number;
}

interface FormState {
  name: string;
  cores: number;
  memory_mb: number;
  disk_gb: number;
  minecraft: MinecraftConfig;
}

export const CreateMinecraftServerPage: React.FC = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>({
    name: "",
    cores: 2,
    memory_mb: 4096,
    disk_gb: 30,
    minecraft: {
      edition: "java",
      version: "1.21.1",
      type: "paper",
      modded: false,
      mods: [],
      port: 25565,
      extra_ports: [],
      eula: true,
      max_players: 20,
      online_mode: true,
      motd: "Bienvenue sur le serveur Minecraft",
      whitelist: [],
      operators: [],
      jvm_heap: "2G",
      jvm_flags: "",
      backup_enabled: false,
      backup_frequency: "daily",
      backup_retention: 7,
    },
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (field: keyof FormState, value: unknown) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const updateMinecraft = (field: keyof MinecraftConfig, value: unknown) => {
    setForm((f) => ({ ...f, minecraft: { ...f.minecraft, [field]: value } }));
  };

  const parseList = (value: string): string[] =>
    value.split(",").map((v) => v.trim()).filter(Boolean);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiPost("/api/deployments/validate", form);
      const res = await apiPost<{ deployment_id: number }>("/api/deployments", form);
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
        <h1>Créer un serveur Minecraft</h1>
        <p className="page-subtitle">
          Configure la VM et les options Minecraft, puis lance le déploiement.
        </p>
      </header>

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
              <span>Disque (GB)</span>
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
          <h2 className="page-panel-title">Minecraft</h2>
          <p className="page-panel-desc">Version, type de serveur et paramètres de jeu.</p>
          <div className="form-grid form-grid--wide">
            <label>
              <span>Version</span>
              <input
                value={form.minecraft.version}
                onChange={(e) => updateMinecraft("version", e.target.value)}
              />
            </label>
            <label>
              <span>Type</span>
              <select
                value={form.minecraft.type}
                onChange={(e) => updateMinecraft("type", e.target.value as MinecraftConfig["type"])}
              >
                <option value="vanilla">Vanilla</option>
                <option value="paper">Paper</option>
                <option value="purpur">Purpur</option>
                <option value="forge">Forge</option>
                <option value="fabric">Fabric</option>
              </select>
            </label>
            <label className="form-check">
              <input
                type="checkbox"
                checked={form.minecraft.eula}
                onChange={(e) => updateMinecraft("eula", e.target.checked)}
              />
              <span>EULA accepté</span>
            </label>
            <label>
              <span>Max joueurs</span>
              <input
                type="number"
                value={form.minecraft.max_players}
                onChange={(e) => updateMinecraft("max_players", Number(e.target.value))}
              />
            </label>
            <label className="form-check">
              <input
                type="checkbox"
                checked={form.minecraft.online_mode}
                onChange={(e) => updateMinecraft("online_mode", e.target.checked)}
              />
              <span>Mode en ligne</span>
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              <span>MOTD</span>
              <input
                value={form.minecraft.motd}
                onChange={(e) => updateMinecraft("motd", e.target.value)}
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              <span>Whitelist (pseudos séparés par des virgules)</span>
              <input
                value={form.minecraft.whitelist.join(", ")}
                onChange={(e) => updateMinecraft("whitelist", parseList(e.target.value))}
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              <span>Ops (pseudos séparés par des virgules)</span>
              <input
                value={form.minecraft.operators.join(", ")}
                onChange={(e) => updateMinecraft("operators", parseList(e.target.value))}
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
          <button type="submit" className="btn btn--primary btn--large" disabled={submitting}>
            {submitting ? "Déploiement en cours…" : "Déployer le serveur"}
          </button>
        </div>
      </form>
    </div>
  );
};
