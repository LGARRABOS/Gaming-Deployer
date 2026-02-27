import React, { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api/client";

interface DeviceAuthResult {
  verification_url: string;
  user_code: string;
  device_code: string;
}

type AuthStatus = "idle" | "device_started" | "polling" | "success" | "error";

export const HytaleAuthPage: React.FC = () => {
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [verificationUrl, setVerificationUrl] = useState("");
  const [userCode, setUserCode] = useState("");
  const [deviceCode, setDeviceCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);

  const checkStatus = useCallback(() => {
    apiGet<{ configured: boolean }>("/api/hytale/auth/status")
      .then((res) => setConfigured(res.configured))
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const startDeviceAuth = async () => {
    setError(null);
    setStatus("device_started");
    try {
      const res = await apiPost<DeviceAuthResult>("/api/hytale/auth/device", {});
      setVerificationUrl(res.verification_url);
      setUserCode(res.user_code);
      setDeviceCode(res.device_code);
      setStatus("polling");
    } catch (e: unknown) {
      setError((e as Error).message ?? "Erreur au démarrage de l'authentification");
      setStatus("error");
    }
  };

  useEffect(() => {
    if (status !== "polling" || !deviceCode) return;

    const poll = async () => {
      try {
        const res = await apiGet<{ status?: string; ok?: boolean }>(
          `/api/hytale/auth/poll?device_code=${encodeURIComponent(deviceCode)}`
        );
        if (res.ok) {
          setStatus("success");
          checkStatus();
          return;
        }
        if (res.status === "pending") {
          // Continue polling
          return;
        }
      } catch (e: unknown) {
        setError((e as Error).message ?? "Erreur lors de la vérification");
        setStatus("error");
        return;
      }
    };

    const interval = setInterval(poll, 5000);
    poll();

    return () => clearInterval(interval);
  }, [status, deviceCode, checkStatus]);

  const handleLogout = async () => {
    setError(null);
    try {
      await apiDelete("/api/hytale/auth");
      setConfigured(false);
      setStatus("idle");
      setVerificationUrl("");
      setUserCode("");
      setDeviceCode("");
    } catch (e: unknown) {
      setError((e as Error).message ?? "Erreur lors de la déconnexion");
    }
  };

  return (
    <div className="page-wrap">
      <header className="page-header">
        <h1>Authentification Hytale</h1>
        <p className="page-subtitle">
          Connecte ton compte Hytale pour permettre le déploiement automatisé des serveurs.
          Tu dois posséder une copie du jeu.
        </p>
      </header>

      <div className="card page-panel">
        {configured === true && status === "idle" && (
          <>
            <p className="success">L&apos;authentification Hytale est configurée.</p>
            <button type="button" className="btn btn--secondary" onClick={handleLogout}>
              Déconnecter
            </button>
          </>
        )}

        {configured === false && status === "idle" && (
          <>
            <p>Clique pour démarrer le flux d&apos;authentification (Device Code).</p>
            <button type="button" className="btn btn--primary" onClick={startDeviceAuth}>
              Démarrer l&apos;authentification
            </button>
          </>
        )}

        {(status === "device_started" || status === "polling") && (
          <>
            <p>Ouvre le lien ci-dessous et saisis le code :</p>
            <div className="hytale-auth-box">
              <a
                href={verificationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hytale-auth-link"
              >
                {verificationUrl}
              </a>
              <p className="hytale-auth-code">
                Code : <strong>{userCode}</strong>
              </p>
              <p className="hytale-auth-wait">
                En attente de l&apos;autorisation…
              </p>
            </div>
          </>
        )}

        {status === "success" && (
          <p className="success">Authentification réussie ! Tu peux maintenant créer des serveurs Hytale.</p>
        )}

        {error && (
          <p className="error" style={{ marginTop: "1rem" }}>{error}</p>
        )}
      </div>
    </div>
  );
};
