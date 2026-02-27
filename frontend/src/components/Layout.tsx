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
  const canSeeAdmin = canSeeUsers || canSeeSettings;

  const isMinecraftSection =
    location.pathname.startsWith("/deployments") || location.pathname.startsWith("/servers");
  const isAdminSection = location.pathname.startsWith("/admin");
  const isPlaceholderSection = location.pathname.startsWith("/games/placeholder");

  // Utilisateur : accès uniquement à la page Serveurs Minecraft
  if (!userLoading && role === "user") {
    const p = location.pathname;
    if (
      p === "/" ||
      p.startsWith("/deployments") ||
      p.startsWith("/admin") ||
      p.startsWith("/games")
    ) {
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

  const getBreadcrumb = () => {
    if (location.pathname.startsWith("/deployments/new")) return "Créer un serveur Minecraft";
    if (location.pathname.startsWith("/deployments/") && location.pathname !== "/deployments")
      return "Détail d'un déploiement";
    if (location.pathname.startsWith("/servers/") && location.pathname !== "/servers")
      return "Tableau de bord serveur";
    if (location.pathname === "/servers") return "Serveurs Minecraft";
    if (location.pathname === "/deployments") return "Déploiements";
    if (location.pathname === "/admin") return "Administration";
    if (location.pathname.startsWith("/admin/users")) return "Utilisateurs";
    if (location.pathname.startsWith("/admin/settings")) return "Paramètres";
    if (location.pathname.startsWith("/games/placeholder")) return "Bientôt disponible";
    return "Dashboard";
  };

  return (
    <div className="app-root">
      <header className="navbar">
        <div className="navbar-brand">
          <span className="app-brand">Proxmox Game Deployer</span>
          <span className="app-subtitle navbar-subtitle">Dashboard jeux &amp; VMs</span>
        </div>
        <nav className="navbar-nav">
          <Link
            to="/servers"
            className={
              isMinecraftSection ? "navbar-link navbar-link--active" : "navbar-link"
            }
          >
            Minecraft
          </Link>
          <Link
            to="/games/placeholder"
            className={
              isPlaceholderSection ? "navbar-link navbar-link--active" : "navbar-link"
            }
          >
            Autre jeu
          </Link>
          {canSeeAdmin && (
            <Link
              to="/admin"
              className={isAdminSection ? "navbar-link navbar-link--active" : "navbar-link"}
            >
              Admin
            </Link>
          )}
          <button className="navbar-logout" onClick={onLogout}>
            Déconnexion
          </button>
        </nav>
      </header>
      <div className="app-shell">
        {(isMinecraftSection || isAdminSection) && (
          <aside className="sidebar">
            <nav className="sidebar-nav">
              {isMinecraftSection && (
                <>
                  {canSeeDeployments && (
                    <>
                      <Link
                        to="/deployments"
                        className={
                          isDeploymentsActive
                            ? "sidebar-link sidebar-link--active"
                            : "sidebar-link"
                        }
                      >
                        Déploiements
                      </Link>
                      <Link
                        to="/deployments/new/minecraft"
                        className={
                          isActive("/deployments/new/minecraft")
                            ? "sidebar-link sidebar-link--active"
                            : "sidebar-link"
                        }
                      >
                        Nouveau serveur Minecraft
                      </Link>
                    </>
                  )}
                  <Link
                    to="/servers"
                    className={
                      isActive("/servers") ? "sidebar-link sidebar-link--active" : "sidebar-link"
                    }
                  >
                    Serveurs Minecraft
                  </Link>
                </>
              )}
              {isAdminSection && canSeeAdmin && (
                <>
                  <Link
                    to="/admin"
                    className={
                      location.pathname === "/admin"
                        ? "sidebar-link sidebar-link--active"
                        : "sidebar-link"
                    }
                  >
                    Vue d&apos;ensemble
                  </Link>
                  {canSeeUsers && (
                    <Link
                      to="/admin/users"
                      className={
                        isActive("/admin/users")
                          ? "sidebar-link sidebar-link--active"
                          : "sidebar-link"
                      }
                    >
                      Utilisateurs
                    </Link>
                  )}
                  {canSeeSettings && (
                    <Link
                      to="/admin/settings"
                      className={
                        isActive("/admin/settings")
                          ? "sidebar-link sidebar-link--active"
                          : "sidebar-link"
                      }
                    >
                      Paramètres
                    </Link>
                  )}
                </>
              )}
            </nav>
          </aside>
        )}
        <div className="main-layout">
          <header className="main-header">
            <span className="main-breadcrumb">{getBreadcrumb()}</span>
          </header>
          <main className="app-main">{children}</main>
        </div>
      </div>
    </div>
  );
};
