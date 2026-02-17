import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";

interface MinecraftConfig {
  edition: "java";
  version: string;
  type: "vanilla" | "paper" | "purpur" | "forge" | "fabric";
  modded: boolean;
  mods: { url: string; hash?: string }[];
  modpack_url?: string;
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
  minecraft: MinecraftConfig;
}

export const CreateMinecraftServerPage: React.FC = () => {
  const navigate = useNavigate();
  const [vanillaVersions, setVanillaVersions] = useState<string[]>([]);
  const [vanillaLatest, setVanillaLatest] = useState<string>("");
  const [forgeVersions, setForgeVersions] = useState<{ mc_version: string; forge_build: string; full_version: string }[]>([]);
  const [fabricVersions, setFabricVersions] = useState<{ mc_version: string; loader_version: string; full_version: string }[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [minecraftMode, setMinecraftMode] = useState<"config" | "modpack">("config");
  const [form, setForm] = useState<FormState>({
    name: "",
    cores: 2,
    memory_mb: 4096,
    minecraft: {
      edition: "java",
      version: "",
      type: "vanilla",
      modded: false,
      mods: [],
      modpack_url: "",
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

  useEffect(() => {
    setForm((f) => {
      if (f.minecraft.type !== "vanilla" && f.minecraft.type !== "forge" && f.minecraft.type !== "fabric") {
        return { ...f, minecraft: { ...f.minecraft, type: "vanilla" } };
      }
      return f;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setVersionsLoading(true);
    apiGet<{ versions: string[]; latest: string; forge_versions?: { mc_version: string; forge_build: string; full_version: string }[]; fabric_versions?: { mc_version: string; loader_version: string; full_version: string }[] }>("/api/minecraft/versions")
      .then((res) => {
        if (!cancelled && res.versions?.length) {
          setVanillaVersions(res.versions);
          setVanillaLatest(res.latest || res.versions[0] || "");
          if (res.forge_versions?.length) setForgeVersions(res.forge_versions);
          if (res.fabric_versions?.length) setFabricVersions(res.fabric_versions);
          setForm((f) => ({
            ...f,
            minecraft: {
              ...f.minecraft,
              version: f.minecraft.version || res.latest || res.versions[0] || "",
            },
          }));
        }
      })
      .catch(() => {
        if (!cancelled) setVanillaVersions([]);
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const update = (field: keyof FormState, value: unknown) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const updateMinecraft = (field: keyof MinecraftConfig, value: unknown) => {
    setForm((f) => {
      const next = { ...f, minecraft: { ...f.minecraft, [field]: value } };
      if (field === "type") {
        if (value === "vanilla" && vanillaLatest && !next.minecraft.version) next.minecraft.version = vanillaLatest;
        if (value === "forge" && forgeVersions.length && !next.minecraft.version) next.minecraft.version = forgeVersions[0].mc_version;
        if (value === "fabric" && fabricVersions.length && !next.minecraft.version) next.minecraft.version = fabricVersions[0].mc_version;
      }
      return next;
    });
  };

  const parseList = (value: string): string[] =>
    value.split(",").map((v) => v.trim()).filter(Boolean);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload = { ...form, disk_gb: 50 };
      await apiPost("/api/deployments/validate", payload);
      const res = await apiPost<{ deployment_id: number }>("/api/deployments", payload);
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
          </div>
          <p className="page-panel-desc" style={{ marginTop: "0.5rem" }}>
            Stockage par défaut : 50 Go.
          </p>
        </section>

        <section className="card page-panel">
          <h2 className="page-panel-title">Minecraft</h2>
          <p className="page-panel-desc">Version, type de serveur et paramètres de jeu.</p>
          <div className="deployment-detail-tabs" style={{ marginTop: "0.5rem" }}>
            <button
              type="button"
              className={`deployment-detail-tab ${minecraftMode === "config" ? "deployment-detail-tab--active" : ""}`}
              onClick={() => {
                setMinecraftMode("config");
                updateMinecraft("modpack_url", "");
              }}
            >
              Configuration
            </button>
            <button
              type="button"
              className={`deployment-detail-tab ${minecraftMode === "modpack" ? "deployment-detail-tab--active" : ""}`}
              onClick={() => {
                setMinecraftMode("modpack");
              }}
            >
              Modpack (CurseForge)
            </button>
          </div>
          <div className="form-grid form-grid--wide">
            {minecraftMode === "config" ? (
              <>
                <label>
                  <span>Type</span>
                  <select
                    value={form.minecraft.type === "vanilla" || form.minecraft.type === "forge" || form.minecraft.type === "fabric" ? form.minecraft.type : "vanilla"}
                    onChange={(e) => updateMinecraft("type", e.target.value as MinecraftConfig["type"])}
                  >
                    <option value="vanilla">Vanilla</option>
                    <option value="forge">Forge</option>
                    <option value="fabric">Fabric</option>
                  </select>
                </label>
                {form.minecraft.type === "vanilla" ? (
                  vanillaVersions.length > 0 ? (
                    <label>
                      <span>Version (vanilla 1.x.x)</span>
                      <select
                        value={form.minecraft.version || vanillaLatest}
                        onChange={(e) => updateMinecraft("version", e.target.value)}
                        disabled={versionsLoading}
                      >
                        {vanillaVersions.map((v) => (
                          <option key={v} value={v}>
                            {v}{v === vanillaLatest ? " (dernière)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label>
                      <span>Version (vanilla 1.x.x)</span>
                      <input
                        value={form.minecraft.version}
                        onChange={(e) => updateMinecraft("version", e.target.value)}
                        placeholder={versionsLoading ? "Chargement…" : "ex: 1.20.4"}
                        disabled={versionsLoading}
                      />
                    </label>
                  )
                ) : form.minecraft.type === "forge" ? (
                  forgeVersions.length > 0 ? (
                    <label>
                      <span>Version (Forge stable)</span>
                      <select
                        value={form.minecraft.version || forgeVersions[0]?.mc_version}
                        onChange={(e) => updateMinecraft("version", e.target.value)}
                        disabled={versionsLoading}
                      >
                        {forgeVersions.map((f) => (
                          <option key={f.full_version} value={f.mc_version}>
                            {f.mc_version} (Forge {f.forge_build})
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label>
                      <span>Version (Forge)</span>
                      <input
                        value={form.minecraft.version}
                        onChange={(e) => updateMinecraft("version", e.target.value)}
                        placeholder={versionsLoading ? "Chargement…" : "ex: 1.20.4"}
                        disabled={versionsLoading}
                      />
                    </label>
                  )
                ) : (
                  // fabric
                  fabricVersions.length > 0 ? (
                    <label>
                      <span>Version (Fabric stable)</span>
                      <select
                        value={form.minecraft.version || fabricVersions[0]?.mc_version}
                        onChange={(e) => updateMinecraft("version", e.target.value)}
                        disabled={versionsLoading}
                      >
                        {fabricVersions.map((f) => (
                          <option key={f.full_version} value={f.mc_version}>
                            {f.mc_version}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label>
                      <span>Version (Fabric)</span>
                      <input
                        value={form.minecraft.version}
                        onChange={(e) => updateMinecraft("version", e.target.value)}
                        placeholder={versionsLoading ? "Chargement…" : "ex: 1.21.1"}
                        disabled={versionsLoading}
                      />
                    </label>
                  )
                )}
              </>
            ) : (
              <>
                <label style={{ gridColumn: "1 / -1" }}>
                  <span>URL directe du server pack (ZIP)</span>
                  <input
                    value={form.minecraft.modpack_url ?? ""}
                    onChange={(e) => updateMinecraft("modpack_url", e.target.value)}
                    placeholder="https://..."
                  />
                  <p className="hint" style={{ marginTop: "0.4rem" }}>
                    Colle ici l&apos;URL de téléchargement directe du server pack CurseForge (ZIP). L&apos;API n&apos;est pas utilisée ;
                    le ZIP sera téléchargé et extrait automatiquement sur la VM.
                  </p>
                </label>
              </>
            )}
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
