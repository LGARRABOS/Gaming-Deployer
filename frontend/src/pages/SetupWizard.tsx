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
      const res = await apiPost<{ ok: boolean; error?: string }>(
        "/api/setup/test-proxmox",
        {
          api_url: form.api_url,
          api_token_id: form.api_token_id,
          api_token_secret: form.api_token_secret,
        }
      );
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
    setSaving(true);
    setError(null);
    try {
      if (adminPass !== adminPassConfirm) {
        setError("Les mots de passe administrateur ne correspondent pas.");
        setSaving(false);
        return;
      }
      await apiPost<{ ok: boolean }>("/api/setup/initialize", {
        proxmox: form,
        admin: { username: adminUser, password: adminPass },
      });
      navigate("/login");
    } catch (e: any) {
      setError(e.message ?? "Erreur lors de l'initialisation");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <h1>Setup initial</h1>
      <p>Configure la connexion Proxmox et crée le compte administrateur.</p>

      <form onSubmit={onSubmit} className="form-grid">
        <h2>Proxmox</h2>
        <label>
          API URL
          <input name="api_url" value={form.api_url} onChange={onChange} required />
        </label>
        <label>
          Token ID
          <input name="api_token_id" value={form.api_token_id} onChange={onChange} required />
        </label>
        <label>
          Token Secret
          <input
            name="api_token_secret"
            type="password"
            value={form.api_token_secret}
            onChange={onChange}
            required
          />
        </label>
        <label>
          Node par défaut
          <input name="default_node" value={form.default_node} onChange={onChange} required />
        </label>
        <label>
          Storage par défaut
          <input name="default_storage" value={form.default_storage} onChange={onChange} required />
        </label>
        <label>
          Bridge par défaut
          <input name="default_bridge" value={form.default_bridge} onChange={onChange} required />
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
          <input name="ssh_user" value={form.ssh_user} onChange={onChange} required />
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

        <h2>Compte admin</h2>
        <label>
          Nom d'utilisateur
          <input value={adminUser} onChange={(e) => setAdminUser(e.target.value)} required />
        </label>
        <label>
          Mot de passe
          <input
            type="password"
            value={adminPass}
            onChange={(e) => setAdminPass(e.target.value)}
            required
          />
        </label>
        <label>
          Confirmer le mot de passe
          <input
            type="password"
            value={adminPassConfirm}
            onChange={(e) => setAdminPassConfirm(e.target.value)}
            required
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={saving}>
          {saving ? "Initialisation..." : "Enregistrer la configuration"}
        </button>
      </form>
    </div>
  );
};

