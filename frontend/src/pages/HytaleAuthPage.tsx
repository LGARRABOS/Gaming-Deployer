import React, { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api/client";

interface DeviceAuthResult {
  verification_url: string;
  user_code: string;
  device_code: string;
  interval?: number; // seconds between polls (RFC 8628)
}

type AuthStatus = "idle" | "device_started" | "polling" | "success" | "error";
type DownloaderAuthStatus = "idle" | "device_started" | "polling" | "success" | "error";

export const HytaleAuthPage: React.FC = () => {
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [verificationUrl, setVerificationUrl] = useState("");
  const [userCode, setUserCode] = useState("");
  const [deviceCode, setDeviceCode] = useState("");
  const [pollIntervalMs, setPollIntervalMs] = useState(5000);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);

  const [downloaderStatus, setDownloaderStatus] = useState<DownloaderAuthStatus>("idle");
  const [downloaderUrl, setDownloaderUrl] = useState("");
  const [downloaderCode, setDownloaderCode] = useState("");
  const [downloaderDeviceCode, setDownloaderDeviceCode] = useState("");
  const [downloaderPollMs, setDownloaderPollMs] = useState(5000);
  const [downloaderError, setDownloaderError] = useState<string | null>(null);
  const [downloaderConfigured, setDownloaderConfigured] = useState<boolean | null>(null);

  const checkStatus = useCallback(() => {
    apiGet<{ configured: boolean }>("/api/hytale/auth/status")
      .then((res) => setConfigured(res.configured))
      .catch(() => setConfigured(false));
  }, []);

  const checkDownloaderStatus = useCallback(() => {
    apiGet<{ configured: boolean }>("/api/hytale/downloader/status")
      .then((res) => setDownloaderConfigured(res.configured))
      .catch(() => setDownloaderConfigured(false));
  }, []);

  useEffect(() => {
    checkStatus();
    checkDownloaderStatus();
  }, [checkStatus, checkDownloaderStatus]);

  const startDeviceAuth = async () => {
    setError(null);
    setStatus("device_started");
    try {
      const res = await apiPost<DeviceAuthResult>("/api/hytale/auth/device", {});
      setVerificationUrl(res.verification_url);
      setUserCode(res.user_code);
      setDeviceCode(res.device_code);
      setPollIntervalMs(Math.max(3000, (res.interval ?? 5) * 1000));
      setStatus("polling");
    } catch (e: unknown) {
      setError((e as Error).message ?? "Erreur au démarrage de l'authentification");
      setStatus("error");
    }
  };

  useEffect(() => {
    if (status !== "polling" || !deviceCode) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

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
          return;
        }
      } catch (e: unknown) {
        setError((e as Error).message ?? "Erreur lors de la vérification");
        setStatus("error");
        return;
      }
    };

    // Premier poll immédiat, puis tous les interval secondes (RFC 8628)
    poll();
    intervalId = setInterval(poll, pollIntervalMs);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [status, deviceCode, pollIntervalMs, checkStatus]);

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

  const startDownloaderAuth = async () => {
    setDownloaderError(null);
    setDownloaderStatus("device_started");
    try {
      const res = await apiPost<DeviceAuthResult>("/api/hytale/downloader/device", {});
      setDownloaderUrl(res.verification_url);
      setDownloaderCode(res.user_code);
      setDownloaderDeviceCode(res.device_code);
      setDownloaderPollMs(Math.max(3000, (res.interval ?? 5) * 1000));
      setDownloaderStatus("polling");
    } catch (e: unknown) {
      setDownloaderError((e as Error).message ?? "Erreur au démarrage de l'authentification");
      setDownloaderStatus("error");
    }
  };

  useEffect(() => {
    if (downloaderStatus !== "polling" || !downloaderDeviceCode) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const res = await apiGet<{ status?: string; ok?: boolean }>(
          `/api/hytale/downloader/poll?device_code=${encodeURIComponent(downloaderDeviceCode)}`
        );
        if (res.ok) {
          setDownloaderStatus("success");
          checkDownloaderStatus();
          return;
        }
        if (res.status === "pending") {
          return;
        }
      } catch (e: unknown) {
        setDownloaderError((e as Error).message ?? "Erreur lors de la vérification");
        setDownloaderStatus("error");
        return;
      }
    };

    poll();
    intervalId = setInterval(poll, downloaderPollMs);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [downloaderStatus, downloaderDeviceCode, downloaderPollMs, checkDownloaderStatus]);

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
          <p className="success">Authentification serveur réussie !</p>
        )}

        {error && (
          <p className="error" style={{ marginTop: "1rem" }}>{error}</p>
        )}
      </div>

      <div className="card page-panel" style={{ marginTop: "1.5rem" }}>
        <h2 className="page-panel-title">2. Authentification téléchargement (auth:downloader)</h2>
        <p className="page-panel-desc">
          Permet de télécharger automatiquement les fichiers serveur Hytale (HytaleServer.jar, assets).
        </p>

        {downloaderConfigured === true && downloaderStatus === "idle" && (
          <>
            <p className="success">L&apos;authentification téléchargement est configurée.</p>
          </>
        )}

        {downloaderConfigured === false && downloaderStatus === "idle" && (
          <>
            <p>Clique pour démarrer le flux d&apos;authentification téléchargement.</p>
            <button type="button" className="btn btn--primary" onClick={startDownloaderAuth}>
              Démarrer l&apos;authentification téléchargement
            </button>
          </>
        )}

        {(downloaderStatus === "device_started" || downloaderStatus === "polling") && (
          <>
            <p>Ouvre le lien ci-dessous et saisis le code :</p>
            <div className="hytale-auth-box">
              <a
                href={downloaderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hytale-auth-link"
              >
                {downloaderUrl}
              </a>
              <p className="hytale-auth-code">
                Code : <strong>{downloaderCode}</strong>
              </p>
              <p className="hytale-auth-wait">
                En attente de l&apos;autorisation…
              </p>
            </div>
          </>
        )}

        {downloaderStatus === "success" && (
          <p className="success">Authentification téléchargement réussie ! Tu peux maintenant déployer des serveurs Hytale.</p>
        )}

        {downloaderError && (
          <p className="error" style={{ marginTop: "1rem" }}>{downloaderError}</p>
        )}
      </div>
    </div>
  );
};
