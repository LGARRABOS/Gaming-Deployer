import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiPost } from "../api/client";

export const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    if (password.length < 6) {
      setError("Le mot de passe doit faire au moins 6 caractères.");
      return;
    }
    setLoading(true);
    try {
      await apiPost("/api/register", { username: username.trim(), password });
      navigate("/login?registered=1");
    } catch (e: unknown) {
      setError((e as Error).message ?? "Erreur lors de la création du compte");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-root">
      <header className="auth-header">
        <div className="app-brand">Proxmox Game Deployer</div>
        <p className="app-subtitle">Créer un compte</p>
      </header>
      <main className="auth-main">
        <div className="card login-card">
          <h1 className="login-title">Créer un compte</h1>
          <p className="login-subtitle">
            Les nouveaux comptes ont le rôle « Utilisateur ». Un administrateur pourra vous attribuer des serveurs à gérer.
          </p>
          <form onSubmit={onSubmit} className="login-form">
            <label>
              <span>Nom d'utilisateur</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                placeholder="ex: Magickblack"
              />
            </label>
            <label>
              <span>Mot de passe (min. 6 caractères)</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </label>
            <label>
              <span>Confirmer le mot de passe</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </label>
            {error && <p className="error login-error">{error}</p>}
            <button type="submit" className="btn btn--primary btn--large btn--full" disabled={loading}>
              {loading ? "Création…" : "Créer mon compte"}
            </button>
          </form>
          <p className="hint" style={{ marginTop: "1rem", textAlign: "center" }}>
            Déjà un compte ? <Link to="/login">Se connecter</Link>
          </p>
        </div>
      </main>
    </div>
  );
};
