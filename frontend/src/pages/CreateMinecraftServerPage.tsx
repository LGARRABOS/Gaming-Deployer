import React, { useState } from "react";
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
  node: string;
  template_vmid: number;
  cores: number;
  memory_mb: number;
  disk_gb: number;
  storage: string;
  bridge: string;
  vlan?: number;
  ip_address: string;
  cidr: number;
  gateway: string;
  dns: string;
  hostname: string;
  minecraft: MinecraftConfig;
}

export const CreateMinecraftServerPage: React.FC = () => {
  const [form, setForm] = useState<FormState>({
    name: "",
    node: "",
    template_vmid: 9000,
    cores: 2,
    memory_mb: 4096,
    disk_gb: 30,
    storage: "",
    bridge: "",
    vlan: undefined,
    ip_address: "",
    cidr: 24,
    gateway: "",
    dns: "1.1.1.1",
    hostname: "",
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

  const parsePorts = (value: string): number[] =>
    value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => Number(v))
      .filter((n) => !Number.isNaN(n));

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
          Node
          <input value={form.node} onChange={(e) => update("node", e.target.value)} />
        </label>
        <label>
          Template VMID
          <input
            type="number"
            value={form.template_vmid}
            onChange={(e) => update("template_vmid", Number(e.target.value))}
          />
        </label>
        <label>
          CPU (cores)
          <input
            type="number"
            value={form.cores}
            onChange={(e) => update("cores", Number(e.target.value))}
          />
        </label>
        <label>
          RAM (MB)
          <input
            type="number"
            value={form.memory_mb}
            onChange={(e) => update("memory_mb", Number(e.target.value))}
          />
        </label>
        <label>
          Disque (GB)
          <input
            type="number"
            value={form.disk_gb}
            onChange={(e) => update("disk_gb", Number(e.target.value))}
          />
        </label>
        <label>
          Storage
          <input value={form.storage} onChange={(e) => update("storage", e.target.value)} />
        </label>
        <label>
          Bridge
          <input value={form.bridge} onChange={(e) => update("bridge", e.target.value)} />
        </label>
        <label>
          VLAN (optionnel)
          <input
            type="number"
            value={form.vlan ?? ""}
            onChange={(e) => update("vlan", e.target.value ? Number(e.target.value) : undefined)}
          />
        </label>

        <h2>Réseau</h2>
        <label>
          IP fixe
          <input
            value={form.ip_address}
            onChange={(e) => update("ip_address", e.target.value)}
            required
          />
        </label>
        <label>
          CIDR
          <input
            type="number"
            value={form.cidr}
            onChange={(e) => update("cidr", Number(e.target.value))}
          />
        </label>
        <label>
          Gateway
          <input value={form.gateway} onChange={(e) => update("gateway", e.target.value)} required />
        </label>
        <label>
          DNS
          <input value={form.dns} onChange={(e) => update("dns", e.target.value)} />
        </label>
        <label>
          Hostname
          <input value={form.hostname} onChange={(e) => update("hostname", e.target.value)} />
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
        <label>
          Port Minecraft
          <input
            type="number"
            value={form.minecraft.port}
            onChange={(e) => updateMinecraft("port", Number(e.target.value))}
          />
        </label>
        <label>
          Ports additionnels (séparés par des virgules)
          <input
            value={form.minecraft.extra_ports.join(",")}
            onChange={(e) => updateMinecraft("extra_ports", parsePorts(e.target.value))}
          />
        </label>
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
        <label>
          Mémoire JVM (ex: 2G)
          <input
            value={form.minecraft.jvm_heap}
            onChange={(e) => updateMinecraft("jvm_heap", e.target.value)}
          />
        </label>
        <label>
          Flags JVM
          <input
            value={form.minecraft.jvm_flags}
            onChange={(e) => updateMinecraft("jvm_flags", e.target.value)}
          />
        </label>

        <h2>Backups</h2>
        <label>
          Activer les backups
          <input
            type="checkbox"
            checked={form.minecraft.backup_enabled}
            onChange={(e) => updateMinecraft("backup_enabled", e.target.checked)}
          />
        </label>
        <label>
          Fréquence (ex: daily, weekly)
          <input
            value={form.minecraft.backup_frequency}
            onChange={(e) => updateMinecraft("backup_frequency", e.target.value)}
          />
        </label>
        <label>
          Rétention (nombre de backups)
          <input
            type="number"
            value={form.minecraft.backup_retention}
            onChange={(e) => updateMinecraft("backup_retention", Number(e.target.value))}
          />
        </label>

        {error && <p className="error">{error}</p>}
        {success && <p className="success">{success}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? "Envoi..." : "Déployer"}
        </button>
      </form>
    </div>
  );
};

