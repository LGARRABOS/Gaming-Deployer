import React from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { SetupWizard } from "./pages/SetupWizard";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { CreateMinecraftServerPage } from "./pages/CreateMinecraftServerPage";
import { CreateHytaleServerPage } from "./pages/CreateHytaleServerPage";
import { HytaleAuthPage } from "./pages/HytaleAuthPage";
import { DeploymentsListPage } from "./pages/DeploymentsListPage";
import { DeploymentDetailsPage } from "./pages/DeploymentDetailsPage";
import { ServersListPage } from "./pages/ServersListPage";
import { ServerDashboardPage } from "./pages/ServerDashboardPage";
import { useAppStatus } from "./hooks/useAppStatus";
import { SettingsPage } from "./pages/SettingsPage";
import { UsersPage } from "./pages/UsersPage";
import { AdminPage } from "./pages/AdminPage";
import { PlaceholderGamePage } from "./pages/PlaceholderGamePage";

const AppRoutes: React.FC = () => {
  const location = useLocation();
  const { initialized, loading } = useAppStatus();

  if (loading) {
    return (
      <Layout>
        <p>Chargement...</p>
      </Layout>
    );
  }

  // Force wizard if not initialized (sauf page d'accueil pour afficher un message)
  if (!initialized && !location.pathname.startsWith("/setup")) {
    return <Navigate to="/setup" replace />;
  }

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/setup"
        element={
          <Layout>
            <SetupWizard />
          </Layout>
        }
      />
      <Route
        path="/login"
        element={
          <Layout>
            <LoginPage />
          </Layout>
        }
      />
      <Route
        path="/deployments/new/minecraft"
        element={
          <Layout>
            <CreateMinecraftServerPage />
          </Layout>
        }
      />
      <Route
        path="/deployments/new/hytale"
        element={
          <Layout>
            <CreateHytaleServerPage />
          </Layout>
        }
      />
      <Route
        path="/hytale/auth"
        element={
          <Layout>
            <HytaleAuthPage />
          </Layout>
        }
      />
      <Route
        path="/admin"
        element={
          <Layout>
            <AdminPage />
          </Layout>
        }
      />
      <Route
        path="/admin/users"
        element={
          <Layout>
            <UsersPage />
          </Layout>
        }
      />
      <Route
        path="/admin/settings"
        element={
          <Layout>
            <SettingsPage />
          </Layout>
        }
      />
      <Route
        path="/hytale/servers"
        element={
          <Layout>
            <ServersListPage game="hytale" />
          </Layout>
        }
      />
      <Route
        path="/hytale/servers/:id"
        element={
          <Layout>
            <ServerDashboardPage />
          </Layout>
        }
      />
      <Route
        path="/hytale/deployments"
        element={
          <Layout>
            <DeploymentsListPage game="hytale" />
          </Layout>
        }
      />
      <Route
        path="/games/placeholder"
        element={
          <Layout>
            <PlaceholderGamePage />
          </Layout>
        }
      />
      <Route
        path="/deployments/:id"
        element={
          <Layout>
            <DeploymentDetailsPage />
          </Layout>
        }
      />
      <Route
        path="/deployments"
        element={
          <Layout>
            <DeploymentsListPage game="minecraft" />
          </Layout>
        }
      />
      <Route
        path="/servers/:id"
        element={
          <Layout>
            <ServerDashboardPage />
          </Layout>
        }
      />
      <Route
        path="/servers"
        element={
          <Layout>
            <ServersListPage />
          </Layout>
        }
      />
      <Route path="/users" element={<Navigate to="/admin/users" replace />} />
      <Route path="/settings" element={<Navigate to="/admin/settings" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const App: React.FC = () => {
  return <AppRoutes />;
};

export default App;

