import React, { useState } from "react";
import { apiPost } from "../api/client";
import { useNavigate } from "react-router-dom";

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

export const SetupWizard: React.FC = () => {
  const [form, setForm] = useState<ProxmoxConfigForm>({
    api_url: "",
    api_token_id: "",
    api_token_secret: "",
    default_node: "",
    default_storage: "",
    default_bridge: "",
    template_vmid: 9000,
    ssh_user: "ubuntu",
    ssh_public_key: "",
  });
  const [adminUser, setAdminUser] = useState("");
  const [adminPass, setAdminPass] = useState("");
  const [adminPassConfirm, setAdminPassConfirm] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: name === "template_vmid" ? Number(value) : value }));
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>("/api/setup/test-proxmox", {
        api_url: form.api_url,
        api_token_id: form.api_token_id,
        api_token_secret: form.api_token_secret,
      });
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
    setSaving(true);
    setError(null);
    try {
      if (adminPass !== adminPassConfirm) {
        setError("Les mots de passe ne correspondent pas.");
        setSaving(false);
        return;
      }
      await apiPost<{ ok: boolean }>("/api/setup/initialize", {
        proxmox: form,
        admin: { username: adminUser, password: adminPass },
      });
      navigate("/login");
    } catch (e: unknown) {
      setError((e as Error).message ?? "Erreur lors de l'initialisation");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-wrap setup-page">
      <header className="page-header">
        <h1>Configuration initiale</h1>
        <p className="page-subtitle">
          Configure la connexion Proxmox et crée le compte administrateur de l'application.
        </p>
      </header>

      <form onSubmit={onSubmit} className="setup-form">
        <section className="card page-panel">
          <h2 className="page-panel-title">Proxmox</h2>
          <p className="page-panel-desc">URL API, token et paramètres par défaut.</p>
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
              <span>Token Secret</span>
              <input name="api_token_secret" type="password" value={form.api_token_secret} onChange={onChange} required />
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
              <input name="template_vmid" type="number" value={form.template_vmid} onChange={onChange} required />
            </label>
            <label>
              <span>Utilisateur SSH</span>
              <input name="ssh_user" value={form.ssh_user} onChange={onChange} required />
            </label>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn--secondary" onClick={testConnection} disabled={testing}>
              {testing ? "Test…" : "Tester la connexion Proxmox"}
            </button>
            {testResult && <span className={testResult.startsWith("Connexion") ? "success" : "hint"}>{testResult}</span>}
          </div>
          {error && <p className="error">{error}</p>}
        </section>

        <section className="card page-panel">
          <h2 className="page-panel-title">Compte administrateur</h2>
          <p className="page-panel-desc">Identifiants pour te connecter à l'interface après l'initialisation.</p>
          <div className="form-grid form-grid--wide">
            <label>
              <span>Nom d'utilisateur</span>
              <input value={adminUser} onChange={(e) => setAdminUser(e.target.value)} required />
            </label>
            <label>
              <span>Mot de passe</span>
              <input type="password" value={adminPass} onChange={(e) => setAdminPass(e.target.value)} required />
            </label>
            <label>
              <span>Confirmer le mot de passe</span>
              <input type="password" value={adminPassConfirm} onChange={(e) => setAdminPassConfirm(e.target.value)} required />
            </label>
          </div>
        </section>

        <div className="form-actions">
          <button type="submit" className="btn btn--primary btn--large" disabled={saving}>
            {saving ? "Initialisation…" : "Enregistrer et terminer"}
          </button>
        </div>
      </form>
    </div>
  );
};
