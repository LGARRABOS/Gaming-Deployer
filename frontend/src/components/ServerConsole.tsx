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
  const inputRef = useRef<HTMLInputElement | null>(null);

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
      // Ignore noisy RCON client connect/disconnect logs
      if (line.includes("Thread RCON Client")) return;
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

  // Auto-focus input when console mounts
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
        } else if (typeof res.response === "string" && res.response.trim() !== "") {
          const respText = res.response.trim();
          setLines((prev) => [...prev.slice(-999), { text: respText }]);
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
        {lines.map((line, i) => {
          let cls = "server-console-line";
          if (line.error) {
            cls += " server-console-line--error";
          } else if (line.text.includes("[Server thread/INFO]") || line.text.includes("/INFO]:")) {
            cls += " server-console-line--info";
          } else if (line.text.includes("/WARN]") || line.text.includes("/WARNING]")) {
            cls += " server-console-line--warn";
          } else if (line.text.includes("/ERROR]") || line.text.includes("[Server thread/ERROR]")) {
            cls += " server-console-line--error";
          }
          return (
            <div key={i} className={cls}>
              {line.text || "\u00A0"}
            </div>
          );
        })}
      </div>
      <form className="server-console-input-row" onSubmit={sendCommand}>
        <input
          type="text"
          className="server-console-input"
          placeholder="Commande console (ex: say Bonjour, stop, list, ...)"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          disabled={sending}
          ref={inputRef}
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
