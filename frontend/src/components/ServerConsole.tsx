import React, { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  serverId: number;
}

export const ServerConsole: React.FC<Props> = ({ serverId }) => {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (eventSourceRef.current) return;
    setStatus("connecting");
    setErrorMessage(null);
    const url = `${window.location.origin}/api/servers/${serverId}/console`;
    const es = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = es;

    es.onopen = () => setStatus("connected");

    es.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === "string" ? e.data : String(e.data);
      setLines((prev) => [...prev.slice(-999), line]);
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return;
      setStatus("error");
      setErrorMessage("Connexion perdue. Vérifiez que le serveur est joignable.");
      es.close();
      eventSourceRef.current = null;
    };
  }, [serverId]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setStatus("idle");
  }, []);

  const clear = useCallback(() => setLines([]), []);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  return (
    <section className="card server-panel server-panel--wide server-console-panel">
      <div className="server-console-header">
        <h2 className="server-panel-title">Console du serveur Minecraft</h2>
        <p className="server-panel-desc">
          Logs en direct du service <code>minecraft</code> (journalctl). Connecte-toi pour voir les messages en temps réel.
        </p>
        <div className="server-console-actions">
          {status !== "connected" && status !== "connecting" && (
            <button type="button" className="server-btn server-btn--primary" onClick={connect}>
              Connecter
            </button>
          )}
          {(status === "connected" || status === "connecting") && (
            <button type="button" className="server-btn server-btn--stop" onClick={disconnect}>
              {status === "connecting" ? "Connexion…" : "Déconnecter"}
            </button>
          )}
          <button type="button" className="server-btn server-btn--stop" onClick={clear}>
            Effacer
          </button>
        </div>
      </div>
      {errorMessage && <p className="error server-console-error">{errorMessage}</p>}
      <div
        ref={containerRef}
        className="server-console-output"
        role="log"
        aria-live="polite"
        aria-label="Logs du serveur Minecraft"
      >
        {lines.length === 0 && status === "idle" && (
          <span className="server-console-placeholder">Clique sur « Connecter » pour afficher les logs en direct.</span>
        )}
        {lines.length === 0 && status === "connecting" && (
          <span className="server-console-placeholder">Connexion en cours…</span>
        )}
        {lines.map((line, i) => (
          <div key={i} className="server-console-line">
            {line || "\u00A0"}
          </div>
        ))}
      </div>
    </section>
  );
};
