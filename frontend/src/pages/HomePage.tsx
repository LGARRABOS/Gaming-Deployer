import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

interface MeResponse {
  username: string;
  role: string;
}

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { credentials: "include" })
      .then((res) => {
        if (!cancelled && res.ok) return res.json() as Promise<MeResponse>;
        return null;
      })
      .then((data) => {
        if (!cancelled && data?.username) {
          setLoggedIn(true);
          setRole(data.role ?? "user");
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (checking || !loggedIn) return;
    if (role === "user") navigate("/servers", { replace: true });
    else navigate("/deployments", { replace: true });
  }, [checking, loggedIn, role, navigate]);

  if (checking) {
    return (
      <div className="auth-root">
        <main className="auth-main">
          <div className="auth-card card" style={{ textAlign: "center", padding: "2rem" }}>
            <p className="hint">Chargement…</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="auth-root">
      <header className="auth-header">
        <div className="app-brand">Proxmox Game Deployer</div>
        <p className="app-subtitle">Orchestrateur Proxmox &amp; serveurs Minecraft</p>
      </header>
      <main className="auth-main">
        <div className="auth-card card home-card">
          <h1 className="home-title">Bienvenue</h1>
          <p className="home-desc">
            Générez et gérez vos serveurs Minecraft sur Proxmox. Connectez-vous ou créez un compte pour continuer.
          </p>
          <div className="home-actions">
            <Link to="/login" className="btn btn--primary btn--large">
              Se connecter
            </Link>
            <Link to="/register" className="btn btn--secondary btn--large">
              Créer un compte
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
};
