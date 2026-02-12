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

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const cfg = await apiGet<ProxmoxConfigForm>("/api/setup/config");
        if (!cancelled) {
          // On ne renvoie pas le secret existant, donc on laisse le champ vide
          // pour indiquer "inchangé" tant que l'utilisateur ne saisit rien.
          setForm({ ...cfg, api_token_secret: "" });
        }
        // Charger (et éventuellement générer) la clé publique gérée par l'app.
        try {
          const keyRes = await apiGet<{ public_key: string }>(
            "/api/setup/ssh-key"
          );
          if (!cancelled) {
            setAppPublicKey(keyRes.public_key);
          }
        } catch (e) {
          // On ne bloque pas la page si la récup de la clé échoue.
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Erreur chargement configuration");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
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
      const res = await apiPost<{ public_key: string }>(
        "/api/setup/ssh-key/regenerate",
        {}
      );
      setAppPublicKey(res.public_key);
      setSshKeyMessage(
        "Nouvelle clé SSH générée. Pense à la copier dans la configuration Cloud-Init de Proxmox."
      );
    } catch (e: any) {
      setError(e.message ?? "Erreur lors de la régénération de la clé SSH");
    }
  };

  const testConnection = async () => {
    if (!form) return;
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      let res: { ok: boolean; error?: string };
      if (form.api_token_secret && form.api_token_secret.trim() !== "") {
        // L'utilisateur teste un nouveau secret explicite.
        res = await apiPost<{ ok: boolean; error?: string }>(
          "/api/setup/test-proxmox",
          {
            api_url: form.api_url,
            api_token_id: form.api_token_id,
            api_token_secret: form.api_token_secret,
          }
        );
      } else {
        // Utilise la configuration existante côté serveur (secret déjà stocké).
        res = await apiPost<{ ok: boolean; error?: string }>(
          "/api/setup/test-proxmox-current",
          {}
        );
      }
      if (res.ok) setTestResult("Connexion Proxmox OK");
      else setTestResult(`Échec connexion Proxmox: ${res.error ?? "inconnue"}`);
    } catch (e: any) {
      setError(e.message ?? "Erreur de test Proxmox");
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
      await apiPost<{ ok: boolean }>("/api/setup/config", {
        proxmox: form,
      });
      setTestResult("Configuration mise à jour.");
    } catch (e: any) {
      setError(e.message ?? "Erreur lors de la mise à jour de la configuration");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p>Chargement...</p>;
  if (!form) return <p className="error">Configuration introuvable.</p>;

  return (
    <div className="card">
      <h1>Paramètres Proxmox</h1>
      <p>Modifier la configuration de la connexion Proxmox et de l'accès SSH.</p>

      <form onSubmit={onSubmit} className="form-grid">
        <h2>Proxmox</h2>
        <label>
          API URL
          <input name="api_url" value={form.api_url} onChange={onChange} required />
        </label>
        <label>
          Token ID
          <input
            name="api_token_id"
            value={form.api_token_id}
            onChange={onChange}
            required
          />
        </label>
        <label>
          Token Secret (laisser vide pour ne pas le changer)
          <input
            name="api_token_secret"
            type="password"
            value={form.api_token_secret}
            onChange={onChange}
            placeholder="••••••••••"
          />
        </label>
        <label>
          Node par défaut
          <input
            name="default_node"
            value={form.default_node}
            onChange={onChange}
            required
          />
        </label>
        <label>
          Storage par défaut
          <input
            name="default_storage"
            value={form.default_storage}
            onChange={onChange}
            required
          />
        </label>
        <label>
          Bridge par défaut
          <input
            name="default_bridge"
            value={form.default_bridge}
            onChange={onChange}
            required
          />
        </label>
        <label>
          Template VMID (cloud-init)
          <input
            name="template_vmid"
            type="number"
            value={form.template_vmid}
            onChange={onChange}
            required
          />
        </label>
        <label>
          Utilisateur SSH
          <input
            name="ssh_user"
            value={form.ssh_user}
            onChange={onChange}
            required
          />
        </label>
        <label>
          Clé publique SSH
          <input
            name="ssh_public_key"
            value={form.ssh_public_key}
            onChange={onChange}
            required
          />
        </label>

        <button type="button" onClick={testConnection} disabled={testing}>
          {testing ? "Test en cours..." : "Tester connexion Proxmox"}
        </button>
        {testResult && <p className="hint">{testResult}</p>}

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={saving}>
          {saving ? "Enregistrement..." : "Enregistrer la configuration"}
        </button>
      </form>

      <hr className="section-separator" />

      <section>
        <h2>Clé SSH de l'application</h2>
        <p className="hint">
          Cette clé est utilisée par l'application pour se connecter aux VMs
          via Ansible. Copie la clé publique ci-dessous dans le champ{" "}
          <code>SSH public key</code> de la configuration Cloud-Init de Proxmox
          pour ton template.
        </p>

        <label>
          Clé publique gérée par l'application
          <textarea
            readOnly
            value={appPublicKey ?? ""}
            className="ssh-pubkey-textarea"
            rows={4}
          />
        </label>

        <button type="button" onClick={regenerateSSHKey}>
          Régénérer la clé SSH de l'application
        </button>

        {sshKeyMessage && <p className="hint">{sshKeyMessage}</p>}
      </section>
    </div>
  );
};

