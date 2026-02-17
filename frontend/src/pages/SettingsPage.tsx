import React, { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api/client";

interface ProxmoxConfigForm {
  api_url: string;
  api_token_id: string;
  api_token_secret: string;
  default_node: string;
  default_storage: string;
  default_bridge: string;
  template_vmid: number;
  ssh_user: string;
  ssh_public_key: string;
}

export const SettingsPage: React.FC = () => {
  const [form, setForm] = useState<ProxmoxConfigForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [appPublicKey, setAppPublicKey] = useState<string | null>(null);
  const [sshKeyMessage, setSshKeyMessage] = useState<string | null>(null);
  const [curseForgeApiKey, setCurseForgeApiKey] = useState<string>("");
  const [curseForgeKeySet, setCurseForgeKeySet] = useState<boolean | null>(null);
  const [curseForgeSaving, setCurseForgeSaving] = useState(false);
  const [curseForgeMessage, setCurseForgeMessage] = useState<string | null>(null);
  const [curseForgeTesting, setCurseForgeTesting] = useState(false);
  const [curseForgeTestResult, setCurseForgeTestResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const cfg = await apiGet<ProxmoxConfigForm>("/api/setup/config");
        if (!cancelled) setForm({ ...cfg, api_token_secret: "" });
        try {
          const cf = await apiGet<{ api_key_set: boolean }>("/api/settings/curseforge");
          if (!cancelled) setCurseForgeKeySet(Boolean(cf?.api_key_set));
        } catch {
          if (!cancelled) setCurseForgeKeySet(false);
        }
        try {
          const keyRes = await apiGet<{ public_key: string }>("/api/setup/ssh-key");
          if (!cancelled) setAppPublicKey(keyRes.public_key);
        } catch {
          // ignore
        }
      } catch (e: unknown) {
        if (!cancelled) setError((e as Error).message ?? "Erreur chargement configuration");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((f) =>
      f ? { ...f, [name]: name === "template_vmid" ? Number(value) : value } : f
    );
  };

  const regenerateSSHKey = async () => {
    setSshKeyMessage(null);
    setError(null);
    try {
      const res = await apiPost<{ public_key: string }>("/api/setup/ssh-key/regenerate", {});
      setAppPublicKey(res.public_key);
      setSshKeyMessage(
        `Nouvelle clé générée. Copie-la dans la config Cloud-Init Proxmox (utilisateur : ${form?.ssh_user}).`
      );
    } catch (e: unknown) {
      setError((e as Error).message ?? "Erreur lors de la régénération de la clé SSH");
    }
  };

  const testConnection = async () => {
    if (!form) return;
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      let res: { ok: boolean; error?: string };
      if (form.api_token_secret?.trim() !== "") {
        res = await apiPost<{ ok: boolean; error?: string }>("/api/setup/test-proxmox", {
          api_url: form.api_url,
          api_token_id: form.api_token_id,
          api_token_secret: form.api_token_secret,
        });
      } else {
        res = await apiPost<{ ok: boolean; error?: string }>("/api/setup/test-proxmox-current", {});
      }
      if (res.ok) setTestResult("Connexion Proxmox OK");
      else setTestResult(`Échec : ${res.error ?? "inconnu"}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? "Erreur de test Proxmox");
    } finally {
      setTesting(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      await apiPost<{ ok: boolean }>("/api/setup/config", { proxmox: form });
      setTestResult("Configuration enregistrée.");
    } catch (e: unknown) {
      setError((e as Error).message ?? "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  };

  const onSaveCurseForgeKey = async () => {
    setCurseForgeSaving(true);
    setCurseForgeMessage(null);
    setCurseForgeTestResult(null);
    setError(null);
    try {
      await apiPost<{ ok: boolean }>("/api/settings/curseforge", { api_key: curseForgeApiKey });
      const cf = await apiGet<{ api_key_set: boolean }>("/api/settings/curseforge");
      setCurseForgeKeySet(Boolean(cf?.api_key_set));
      setCurseForgeApiKey("");
      setCurseForgeMessage(cf?.api_key_set ? "Clé CurseForge enregistrée." : "Clé CurseForge supprimée.");
    } catch (e: unknown) {
      setError((e as Error).message ?? "Erreur lors de l'enregistrement de la clé CurseForge");
    } finally {
      setCurseForgeSaving(false);
    }
  };

  const testCurseForgeKey = async () => {
    setCurseForgeTesting(true);
    setCurseForgeTestResult(null);
    setError(null);
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>("/api/settings/curseforge/test", {});
      if (res.ok) setCurseForgeTestResult("Clé CurseForge valide.");
      else setCurseForgeTestResult(`Échec CurseForge : ${res.error ?? "inconnu"}`);
    } catch (e: unknown) {
      setCurseForgeTestResult((e as Error).message ?? "Erreur de test CurseForge");
    } finally {
      setCurseForgeTesting(false);
    }
  };

  if (loading) return <div className="card page-card"><div className="page-loading">Chargement…</div></div>;
  if (!form) return <div className="card page-card"><p className="error">Configuration introuvable.</p></div>;

  return (
    <div className="page-wrap settings-page">
      <header className="page-header">
        <h1>Paramètres</h1>
        <p className="page-subtitle">
          Connexion Proxmox et clé SSH utilisée par l'application pour les déploiements.
        </p>
      </header>

      <form onSubmit={onSubmit} className="settings-form">
        <section className="card page-panel">
          <h2 className="page-panel-title">Proxmox</h2>
          <p className="page-panel-desc">URL API, token et valeurs par défaut (node, storage, bridge, template).</p>
          <div className="form-grid form-grid--wide">
            <label>
              <span>API URL</span>
              <input name="api_url" value={form.api_url} onChange={onChange} required />
            </label>
            <label>
              <span>Token ID</span>
              <input name="api_token_id" value={form.api_token_id} onChange={onChange} required />
            </label>
            <label>
              <span>Token Secret (vide = ne pas modifier)</span>
              <input
                name="api_token_secret"
                type="password"
                value={form.api_token_secret}
                onChange={onChange}
                placeholder="••••••••"
              />
            </label>
            <label>
              <span>Node par défaut</span>
              <input name="default_node" value={form.default_node} onChange={onChange} required />
            </label>
            <label>
              <span>Storage par défaut</span>
              <input name="default_storage" value={form.default_storage} onChange={onChange} required />
            </label>
            <label>
              <span>Bridge par défaut</span>
              <input name="default_bridge" value={form.default_bridge} onChange={onChange} required />
            </label>
            <label>
              <span>Template VMID (cloud-init)</span>
              <input
                name="template_vmid"
                type="number"
                value={form.template_vmid}
                onChange={onChange}
                required
              />
            </label>
            <label>
              <span>Utilisateur SSH</span>
              <input name="ssh_user" value={form.ssh_user} onChange={onChange} required />
            </label>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn--secondary" onClick={testConnection} disabled={testing}>
              {testing ? "Test en cours…" : "Tester la connexion Proxmox"}
            </button>
            {testResult && <span className={testResult.startsWith("Connexion") || testResult.startsWith("Configuration") ? "success" : "hint"}>{testResult}</span>}
          </div>
          {error && <p className="error">{error}</p>}
          <div className="form-actions" style={{ marginTop: "1rem" }}>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer la configuration"}
            </button>
          </div>
        </section>

        <section className="card page-panel">
          <h2 className="page-panel-title">CurseForge</h2>
          <p className="page-panel-desc">
            Clé API utilisée pour rechercher et télécharger des <strong>modpacks serveur</strong> via l'API CurseForge.
            {curseForgeKeySet !== null && (
              <>
                {" "}Statut :{" "}
                <strong className={curseForgeKeySet ? "success" : "hint"}>
                  {curseForgeKeySet ? "clé configurée" : "clé non configurée"}
                </strong>.
              </>
            )}
          </p>
          <div className="settings-inline-form">
            <div className="form-grid form-grid--wide">
              <label style={{ gridColumn: "1 / -1" }}>
                <span>Clé API CurseForge (x-api-key)</span>
                <input
                  type="password"
                  value={curseForgeApiKey}
                  onChange={(e) => setCurseForgeApiKey(e.target.value)}
                  placeholder="•••••••• (laisser vide pour supprimer)"
                />
              </label>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={onSaveCurseForgeKey} disabled={curseForgeSaving}>
                {curseForgeSaving ? "Enregistrement…" : "Enregistrer la clé"}
              </button>
              <button type="button" className="btn btn--secondary" onClick={testCurseForgeKey} disabled={curseForgeTesting}>
                {curseForgeTesting ? "Test en cours…" : "Tester la clé CurseForge"}
              </button>
              {curseForgeMessage && <span className="success">{curseForgeMessage}</span>}
              {curseForgeTestResult && (
                <span className={curseForgeTestResult.startsWith("Clé") ? "success" : "hint"}>
                  {curseForgeTestResult}
                </span>
              )}
            </div>
          </div>
        </section>

        <section className="card page-panel">
          <h2 className="page-panel-title">Clé SSH de l'application</h2>
          <p className="page-panel-desc">
            Cette clé est utilisée pour se connecter aux VMs via Ansible. Copie la clé publique ci-dessous
            et associe-la à l'utilisateur <code>{form.ssh_user}</code> dans la configuration Cloud-Init de ton template Proxmox.
          </p>
          <label>
            <span>Clé publique</span>
            <textarea readOnly value={appPublicKey ?? ""} className="ssh-pubkey-textarea" rows={4} />
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn--secondary" onClick={regenerateSSHKey}>
              Régénérer la clé SSH
            </button>
          </div>
          {sshKeyMessage && <p className="hint">{sshKeyMessage}</p>}
        </section>
      </form>
    </div>
  );
};
