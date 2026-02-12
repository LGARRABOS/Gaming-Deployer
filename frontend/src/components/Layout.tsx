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
  const isLogin = location.pathname.startsWith("/login");
  const isAuthScreen = isSetup || isLogin;

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + "/");

  if (isAuthScreen) {
    return (
      <div className="auth-root">
        <header className="auth-header">
          <div className="app-brand">Proxmox Game Deployer</div>
          <p className="app-subtitle">Orchestrateur Proxmox &amp; serveurs de jeux</p>
        </header>
        <main className="auth-main">
          <div className="auth-card">{children}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-root">
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="app-brand">Proxmox Game Deployer</div>
            <p className="app-subtitle">Dashboard jeux &amp; VMs</p>
          </div>
          <nav className="sidebar-nav">
            <Link
              to="/deployments"
              className={isActive("/deployments") ? "sidebar-link sidebar-link--active" : "sidebar-link"}
            >
              Déploiements
            </Link>
            <Link
              to="/deployments/new/minecraft"
              className={isActive("/deployments/new/minecraft") ? "sidebar-link sidebar-link--active" : "sidebar-link"}
            >
              Nouveau serveur Minecraft
            </Link>
          </nav>
          <button className="sidebar-logout" onClick={onLogout}>
            Déconnexion
          </button>
        </aside>
        <div className="main-layout">
          <header className="main-header">
            <span className="main-breadcrumb">
              {location.pathname.startsWith("/deployments/new")
                ? "Créer un serveur Minecraft"
                : location.pathname.startsWith("/deployments/") && location.pathname !== "/deployments"
                ? "Détail d’un déploiement"
                : "Déploiements"}
            </span>
          </header>
          <main className="app-main">{children}</main>
        </div>
      </div>
    </div>
  );
};

