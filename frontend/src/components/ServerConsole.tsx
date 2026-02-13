import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiPost } from "../api/client";

interface Props {
  serverId: number;
}

interface CommandResult {
  ok: boolean;
  response?: string;
  error?: string;
}

interface ConsoleLine {
  text: string;
  error?: boolean;
}

export const ServerConsole: React.FC<Props> = ({ serverId }) => {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [sending, setSending] = useState(false);
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
      setLines((prev) => [...prev.slice(-999), { text: line }]);
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return;
      setStatus("error");
      setErrorMessage("Connexion perdue. Vérifiez que le serveur est joignable.");
      es.close();
      eventSourceRef.current = null;
    };
  }, [serverId]);

  const clear = useCallback(() => setLines([]), []);

  // Auto-connect to the log stream when the panel is shown
  useEffect(() => {
    connect();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [connect]);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  const sendCommand = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = command.trim();
      if (!trimmed || sending) return;
      setSending(true);
      setErrorMessage(null);
      try {
        const res = await apiPost<CommandResult, { command: string }>(
          `/api/servers/${serverId}/console/command`,
          { command: trimmed }
        );
        if (!res.ok) {
          const msg = res.error || "Erreur lors de l'envoi de la commande.";
          setLines((prev) => [...prev.slice(-999), { text: msg, error: true }]);
        }
        setCommand("");
      } catch (err) {
        const msg = (err as Error).message || "Erreur lors de l'envoi de la commande.";
        setLines((prev) => [...prev.slice(-999), { text: msg, error: true }]);
      } finally {
        setSending(false);
      }
    },
    [command, sending, serverId]
  );

  return (
    <section className="card server-panel server-panel--wide server-console-panel">
      <div className="server-console-header">
        <h2 className="server-panel-title">Console du serveur Minecraft</h2>
        <p className="server-panel-desc">
          Sortie du serveur en direct. Saisis une commande en bas pour l’envoyer au serveur.
        </p>
        <div className="server-console-actions">
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
        {lines.length === 0 && status !== "connected" && (
          <span className="server-console-placeholder">Connexion en cours…</span>
        )}
        {lines.map((line, i) => (
          <div
            key={i}
            className={`server-console-line ${line.error ? "server-console-line--error" : ""}`}
          >
            {line.text || "\u00A0"}
          </div>
        ))}
      </div>
      <form className="server-console-input-row" onSubmit={sendCommand}>
        <input
          type="text"
          className="server-console-input"
          placeholder="Commande console (ex: say Bonjour, stop, list, ...)"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          disabled={sending}
        />
        <button
          type="submit"
          className="server-btn server-btn--primary"
          disabled={sending || !command.trim()}
        >
          {sending ? "Envoi…" : "Envoyer"}
        </button>
      </form>
    </section>
  );
};
