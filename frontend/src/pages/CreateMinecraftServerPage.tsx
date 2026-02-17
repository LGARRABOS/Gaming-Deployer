import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";

type CurseForgeModpackResult = {
  id: number;
  name: string;
  slug: string;
  summary: string;
  logo_url?: string;
};

type CurseForgeServerPackFile = {
  file_id: number;
  display_name: string;
  file_name: string;
  game_versions?: string[];
  file_date?: string;
};

interface MinecraftConfig {
  edition: "java";
  version: string;
  type: "vanilla" | "paper" | "purpur" | "forge" | "fabric";
  modded: boolean;
  mods: { url: string; hash?: string }[];
  modpack: { provider: "curseforge"; project_id: number; file_id: number } | null;
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
  const [curseForgeKeySet, setCurseForgeKeySet] = useState<boolean | null>(null);
  const [modpackQuery, setModpackQuery] = useState("");
  const [modpackResults, setModpackResults] = useState<CurseForgeModpackResult[]>([]);
  const [modpackLoading, setModpackLoading] = useState(false);
  const [selectedModpack, setSelectedModpack] = useState<CurseForgeModpackResult | null>(null);
  const [serverPacks, setServerPacks] = useState<CurseForgeServerPackFile[]>([]);
  const [serverPacksLoading, setServerPacksLoading] = useState(false);
  const [modpackError, setModpackError] = useState<string | null>(null);
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
      modpack: null,
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
    let cancelled = false;
    apiGet<{ api_key_set: boolean }>("/api/settings/curseforge")
      .then((res) => {
        if (!cancelled) setCurseForgeKeySet(Boolean(res?.api_key_set));
      })
      .catch(() => {
        if (!cancelled) setCurseForgeKeySet(false);
      });
    return () => { cancelled = true; };
  }, []);

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

  const pickMinecraftVersionFromGameVersions = (versions?: string[]): string | null => {
    if (!versions?.length) return null;
    const stable = versions.find((v) => /^1\.\d+\.\d+$/.test(v));
    return stable ?? null;
  };

  const searchModpacks = async () => {
    if (!curseForgeKeySet) {
      setModpackError("Clé API CurseForge non configurée. Va dans Paramètres → CurseForge.");
      return;
    }
    const q = modpackQuery.trim();
    if (!q) {
      setModpackResults([]);
      return;
    }
    setModpackLoading(true);
    setModpackError(null);
    try {
      const res = await apiGet<{ data: CurseForgeModpackResult[] }>(`/api/curseforge/modpacks/search?q=${encodeURIComponent(q)}`);
      setModpackResults(res?.data ?? []);
    } catch (e: unknown) {
      setModpackError((e as Error).message ?? "Erreur CurseForge");
      setModpackResults([]);
    } finally {
      setModpackLoading(false);
    }
  };

  const loadServerPacks = async (modpack: CurseForgeModpackResult) => {
    setSelectedModpack(modpack);
    setServerPacks([]);
    setModpackError(null);
    setServerPacksLoading(true);
    try {
      const res = await apiGet<{ data: CurseForgeServerPackFile[] }>(`/api/curseforge/modpacks/${modpack.id}/server-packs`);
      setServerPacks(res?.data ?? []);
      if (!res?.data?.length) {
        setModpackError("Aucun server pack trouvé pour ce modpack sur CurseForge.");
      }
    } catch (e: unknown) {
      setModpackError((e as Error).message ?? "Erreur CurseForge");
    } finally {
      setServerPacksLoading(false);
    }
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
                setSelectedModpack(null);
                setServerPacks([]);
                setModpackResults([]);
                setModpackError(null);
                updateMinecraft("modpack", null);
              }}
            >
              Configuration
            </button>
            <button
              type="button"
              className={`deployment-detail-tab ${minecraftMode === "modpack" ? "deployment-detail-tab--active" : ""}`}
              onClick={() => {
                setMinecraftMode("modpack");
                setModpackError(null);
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
                {!curseForgeKeySet ? (
                  <div style={{ gridColumn: "1 / -1", maxWidth: "640px", textAlign: "left" }}>
                    <p className="error" style={{ marginBottom: "0.25rem" }}>
                      Clé API CurseForge non configurée. Va dans Paramètres → CurseForge.
                    </p>
                    <p className="hint" style={{ marginBottom: "0.25rem" }}>
                      Comment obtenir une clé CurseForge&nbsp;?
                    </p>
                    <ol className="hint" style={{ paddingLeft: "1.2rem", margin: 0 }}>
                      <li>
                        Va sur{" "}
                        <a href="https://console.curseforge.com/" target="_blank" rel="noreferrer">
                          https://console.curseforge.com/
                        </a>{" "}
                        et connecte-toi avec ton compte CurseForge.
                      </li>
                      <li>Crée (ou sélectionne) ton organisation si besoin.</li>
                      <li>
                        Dans la console, ouvre la section <strong>API Keys</strong> / <strong>API Access</strong> et génère
                        une clé pour l&apos;API CurseForge.
                      </li>
                      <li>
                        Copie la valeur de la clé et colle-la dans l&apos;onglet{" "}
                        <strong>Paramètres → CurseForge → Clé API CurseForge</strong>, puis enregistre.
                      </li>
                    </ol>
                  </div>
                ) : (
                  <>
                    <label style={{ gridColumn: "1 / -1" }}>
                      <span>Recherche modpack (server pack)</span>
                      <input
                        value={modpackQuery}
                        onChange={(e) => setModpackQuery(e.target.value)}
                        placeholder="Ex: All the Mods"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            searchModpacks();
                          }
                        }}
                      />
                    </label>
                    <div className="form-actions" style={{ gridColumn: "1 / -1", marginTop: "-0.25rem" }}>
                      <button type="button" className="btn btn--secondary" onClick={searchModpacks} disabled={modpackLoading}>
                        {modpackLoading ? "Recherche…" : "Rechercher"}
                      </button>
                    </div>

                    {modpackError && (
                      <div className="card page-panel page-panel--error" style={{ gridColumn: "1 / -1" }}>
                        <p className="error">{modpackError}</p>
                      </div>
                    )}

                    {modpackResults.length > 0 && (
                      <div style={{ gridColumn: "1 / -1" }}>
                        <p className="page-panel-desc" style={{ marginTop: "0.25rem" }}>Résultats :</p>
                        <ul className="deployments-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", marginTop: "0.5rem" }}>
                          {modpackResults.map((m) => (
                            <li key={m.id} className="deployment-card-wrapper">
                              <button
                                type="button"
                                className="card deployment-card"
                                style={{ textAlign: "left" }}
                                onClick={() => loadServerPacks(m)}
                                disabled={serverPacksLoading}
                              >
                                <span className="deployment-card-title">{m.name}</span>
                                <span className="deployment-card-date">{m.summary}</span>
                                <span className="deployment-card-cta">Choisir →</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {selectedModpack && (
                      <label style={{ gridColumn: "1 / -1" }}>
                        <span>Server pack (pour {selectedModpack.name})</span>
                        <select
                          value={form.minecraft.modpack?.file_id ?? ""}
                          onChange={(e) => {
                            const fileId = Number(e.target.value);
                            const f = serverPacks.find((x) => x.file_id === fileId);
                            const derived = pickMinecraftVersionFromGameVersions(f?.game_versions ?? undefined);
                            setForm((prev) => ({
                              ...prev,
                              minecraft: {
                                ...prev.minecraft,
                                modpack: { provider: "curseforge", project_id: selectedModpack.id, file_id: fileId },
                                version: derived ?? prev.minecraft.version,
                              },
                            }));
                          }}
                          disabled={serverPacksLoading || !serverPacks.length}
                        >
                          <option value="" disabled>
                            {serverPacksLoading ? "Chargement…" : serverPacks.length ? "Sélectionner une version" : "Aucun server pack"}
                          </option>
                          {serverPacks.map((f) => (
                            <option key={f.file_id} value={f.file_id}>
                              {f.display_name}
                            </option>
                          ))}
                        </select>
                        <p className="hint" style={{ marginTop: "0.4rem" }}>
                          La version Minecraft utilisée pour ce déploiement est déduite du server pack (si possible). Tu peux ensuite ajuster les configs côté serveur.
                        </p>
                      </label>
                    )}
                  </>
                )}
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
