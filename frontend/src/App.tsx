import React from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { SetupWizard } from "./pages/SetupWizard";
import { LoginPage } from "./pages/LoginPage";
import { CreateMinecraftServerPage } from "./pages/CreateMinecraftServerPage";
import { DeploymentsListPage } from "./pages/DeploymentsListPage";
import { DeploymentDetailsPage } from "./pages/DeploymentDetailsPage";
import { useAppStatus } from "./hooks/useAppStatus";
import { SettingsPage } from "./pages/SettingsPage";

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

  // Force wizard if not initialized.
  if (!initialized && !location.pathname.startsWith("/setup")) {
    return <Navigate to="/setup" replace />;
  }

  return (
    <Routes>
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
        path="/settings"
        element={
          <Layout>
            <SettingsPage />
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
            <DeploymentsListPage />
          </Layout>
        }
      />
      <Route
        path="/"
        element={
          <Layout>
            <DeploymentsListPage />
          </Layout>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const App: React.FC = () => {
  return <AppRoutes />;
};

export default App;

