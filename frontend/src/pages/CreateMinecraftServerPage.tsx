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
  const [success, setSuccess] = useState<string | null>(null);

  const update = (field: keyof FormState, value: any) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const updateMinecraft = (field: keyof MinecraftConfig, value: any) => {
    setForm((f) => ({ ...f, minecraft: { ...f.minecraft, [field]: value } }));
  };

  const parseList = (value: string): string[] =>
    value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      // Validate via backend endpoint first.
      await apiPost("/api/deployments/validate", form);
      const res = await apiPost<{ deployment_id: number }>("/api/deployments", form);
      setSuccess(`Déploiement créé (ID ${res.deployment_id})`);
      navigate(`/deployments/${res.deployment_id}`);
    } catch (e: any) {
      setError(e.message ?? "Erreur lors de la création du déploiement");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card">
      <h1>Créer un serveur Minecraft</h1>
      <form onSubmit={onSubmit} className="form-grid">
        <h2>VM</h2>
        <label>
          Nom de la VM
          <input value={form.name} onChange={(e) => update("name", e.target.value)} required />
        </label>
        <label>
          CPU (cores)
          <input
            type="number"
            value={form.cores}
            onChange={(e) => update("cores", Number(e.target.value))}
            min={1}
            max={4}
          />
        </label>
        <label>
          RAM
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
          Disque (GB) (max 500)
          <input
            type="number"
            value={form.disk_gb}
            onChange={(e) => update("disk_gb", Number(e.target.value))}
            min={10}
            max={500}
          />
        </label>
        <h2>Minecraft</h2>
        <label>
          Version
          <input
            value={form.minecraft.version}
            onChange={(e) => updateMinecraft("version", e.target.value)}
          />
        </label>
        <label>
          Type
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
        {/* Le port Minecraft et les ports additionnels sont maintenant
            attribués automatiquement côté serveur. */}
        <label>
          EULA accepté
          <input
            type="checkbox"
            checked={form.minecraft.eula}
            onChange={(e) => updateMinecraft("eula", e.target.checked)}
          />
        </label>
        <label>
          Max joueurs
          <input
            type="number"
            value={form.minecraft.max_players}
            onChange={(e) => updateMinecraft("max_players", Number(e.target.value))}
          />
        </label>
        <label>
          Online mode
          <input
            type="checkbox"
            checked={form.minecraft.online_mode}
            onChange={(e) => updateMinecraft("online_mode", e.target.checked)}
          />
        </label>
        <label>
          MOTD
          <input
            value={form.minecraft.motd}
            onChange={(e) => updateMinecraft("motd", e.target.value)}
          />
        </label>
        <label>
          Whitelist (pseudos séparés par virgule)
          <input
            value={form.minecraft.whitelist.join(",")}
            onChange={(e) => updateMinecraft("whitelist", parseList(e.target.value))}
          />
        </label>
        <label>
          Ops (pseudos séparés par virgule)
          <input
            value={form.minecraft.operators.join(",")}
            onChange={(e) => updateMinecraft("operators", parseList(e.target.value))}
          />
        </label>
        {/* Backups configurés automatiquement (24h, rétention 2 jours). */}

        {error && <p className="error">{error}</p>}
        {success && <p className="success">{success}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? "Envoi..." : "Déployer"}
        </button>
      </form>
    </div>
  );
};

