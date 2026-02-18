import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiPost } from "../api/client";
import { useCurrentUser, type UserRole } from "../hooks/useCurrentUser";

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: userLoading } = useCurrentUser();
  const role: UserRole | null = user?.role ?? null;

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

  // Déploiements = actif uniquement sur la liste ou le détail d'un déploiement, pas sur "nouveau"
  const isDeploymentsActive =
    location.pathname === "/deployments" ||
    (location.pathname.startsWith("/deployments/") && !location.pathname.startsWith("/deployments/new"));

  const canSeeDeployments = role === "owner" || role === "admin";
  const canSeeSettings = role === "owner";
  const canSeeUsers = role === "owner" || role === "admin";

  // Utilisateur : accès uniquement à la page Serveurs Minecraft
  if (!userLoading && role === "user") {
    const p = location.pathname;
    if (p === "/" || p.startsWith("/deployments") || p === "/settings" || p.startsWith("/users")) {
      navigate(p === "/" ? "/servers" : "/servers", { replace: true });
      return null;
    }
  }

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
            {canSeeDeployments && (
              <>
                <Link
                  to="/deployments"
                  className={isDeploymentsActive ? "sidebar-link sidebar-link--active" : "sidebar-link"}
                >
                  Déploiements
                </Link>
                <Link
                  to="/deployments/new/minecraft"
                  className={isActive("/deployments/new/minecraft") ? "sidebar-link sidebar-link--active" : "sidebar-link"}
                >
                  Nouveau serveur Minecraft
                </Link>
              </>
            )}
            <Link
              to="/servers"
              className={isActive("/servers") ? "sidebar-link sidebar-link--active" : "sidebar-link"}
            >
              Serveurs Minecraft
            </Link>
            {canSeeUsers && (
              <Link
                to="/users"
                className={isActive("/users") ? "sidebar-link sidebar-link--active" : "sidebar-link"}
              >
                Utilisateurs
              </Link>
            )}
            {canSeeSettings && (
              <Link
                to="/settings"
                className={isActive("/settings") ? "sidebar-link sidebar-link--active" : "sidebar-link"}
              >
                Paramètres
              </Link>
            )}
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
                : location.pathname.startsWith("/servers/") && location.pathname !== "/servers"
                ? "Tableau de bord serveur"
                : location.pathname === "/servers"
                ? "Serveurs Minecraft"
                : location.pathname.startsWith("/users")
                ? "Utilisateurs"
                : location.pathname === "/settings"
                ? "Paramètres"
                : "Déploiements"}
            </span>
          </header>
          <main className="app-main">{children}</main>
        </div>
      </div>
    </div>
  );
};

