import React, { useState } from "react";
import { apiPost } from "../api/client";
import { useNavigate } from "react-router-dom";

export const LoginPage: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiPost("/api/login", { username, password });
      navigate("/deployments");
    } catch (e: unknown) {
      const msg = (e as Error).message ?? "Erreur d'authentification";
      setError(msg.includes("401") || msg === "Unauthorized" ? "Identifiants incorrects." : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-main">
      <div className="card login-card">
        <h1 className="login-title">Connexion</h1>
        <p className="login-subtitle">Identifiants administrateur</p>
        <form onSubmit={onSubmit} className="login-form">
          <label>
            <span>Nom d'utilisateur</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label>
            <span>Mot de passe</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          {error && <p className="error login-error">{error}</p>}
          <button type="submit" className="btn btn--primary btn--large btn--full" disabled={loading}>
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      </div>
    </div>
  );
};
