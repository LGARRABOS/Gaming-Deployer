import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiPost } from "../api/client";

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const onLogout = async () => {
    try {
      await apiPost<unknown>("/api/logout", {});
    } finally {
      navigate("/login");
    }
  };

  const isSetup = location.pathname.startsWith("/setup");

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-brand">Proxmox Game Deployer</div>
        {!isSetup && (
          <nav className="app-nav">
            <Link to="/deployments">Déploiements</Link>
            <Link to="/deployments/new/minecraft">Nouveau serveur Minecraft</Link>
            <button onClick={onLogout}>Déconnexion</button>
          </nav>
        )}
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
};

