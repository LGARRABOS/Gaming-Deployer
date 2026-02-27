import React from "react";
import { Link } from "react-router-dom";

export const AdminPage: React.FC = () => {
  return (
    <div className="admin-page">
      <h1>Administration</h1>
      <p className="admin-desc">
        Gérez les utilisateurs et la configuration de l&apos;application.
      </p>
      <div className="admin-cards">
        <Link to="/admin/users" className="admin-card card">
          <h2 className="admin-card-title">Utilisateurs</h2>
          <p className="admin-card-desc">
            Créer des comptes, attribuer des rôles et assigner des serveurs aux utilisateurs.
          </p>
        </Link>
        <Link to="/admin/settings" className="admin-card card">
          <h2 className="admin-card-title">Paramètres</h2>
          <p className="admin-card-desc">
            Configuration Proxmox, SSH et paramètres globaux de l&apos;application.
          </p>
        </Link>
      </div>
    </div>
  );
};
