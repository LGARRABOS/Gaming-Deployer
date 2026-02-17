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

type LogSegment =
  | { type: "timestamp"; text: string }
  | { type: "level"; level: string; text: string }
  | { type: "message"; text: string };

/** Parse une ligne de log Minecraft [HH:MM:SS] [Thread/LEVEL]: message pour le coloriage */
function parseLogLine(line: string): LogSegment[] {
  const parts: LogSegment[] = [];
  // [12:34:56] [Server thread/INFO]: message
  const timeMatch = line.match(/^(\[\d{2}:\d{2}:\d{2}\])/);
  let rest = line;
  if (timeMatch) {
    parts.push({ type: "timestamp", text: timeMatch[1] });
    rest = rest.slice(timeMatch[1].length).replace(/^\s+/, "");
  }
  const levelMatch = rest.match(/^(\[[^\]]+\/(INFO|WARN|ERROR|DEBUG)\]):\s*/);
  if (levelMatch) {
    parts.push({ type: "level", level: levelMatch[2], text: levelMatch[1] + ": " });
    rest = rest.slice(levelMatch[0].length);
  }
  if (rest.length > 0) {
    parts.push({ type: "message", text: rest });
  }
  return parts;
}

/** Convertit les codes ANSI en spans HTML colorés (si le flux en contient) */
function ansiToSpans(text: string): React.ReactNode[] {
  const ansiRegex = /\x1b\[([0-9;]*)m/g;
  const defaultColor = "#94a3b8";
  const ansiColors: Record<number, string> = {
    30: "#1e293b",
    31: "#f87171",
    32: "#4ade80",
    33: "#facc15",
    34: "#60a5fa",
    35: "#c084fc",
    36: "#22d3ee",
    37: "#e2e8f0",
    90: "#64748b",
    91: "#f87171",
    92: "#4ade80",
    93: "#facc15",
    94: "#60a5fa",
    95: "#c084fc",
    96: "#22d3ee",
    97: "#f1f5f9",
  };
  let lastColor = defaultColor;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ansiRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        <span key={nodes.length} style={{ color: lastColor }}>
          {text.slice(lastIndex, match.index)}
        </span>
      );
    }
    const codes = match[1] ? match[1].split(";").map(Number) : [0];
    for (const code of codes) {
      if (code === 0) lastColor = defaultColor;
      else if (ansiColors[code]) lastColor = ansiColors[code];
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(
      <span key={nodes.length} style={{ color: lastColor }}>
        {text.slice(lastIndex)}
      </span>
    );
  }
  return nodes.length > 0 ? nodes : [text];
}

/** Affiche une ligne de console avec couleurs (format Minecraft + ANSI) */
function ConsoleLineContent({ text, forceError }: { text: string; forceError?: boolean }) {
  if (forceError) {
    return <span className="server-console-segment server-console-segment--error">{text || "\u00A0"}</span>;
  }
  const hasAnsi = /\x1b\[[0-9;]*m/.test(text);
  if (hasAnsi) {
    return <>{ansiToSpans(text)}</>;
  }
  const segments = parseLogLine(text);
  if (segments.length === 0) {
    return <span className="server-console-segment">{text || "\u00A0"}</span>;
  }
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "timestamp") {
          return (
            <span key={i} className="server-console-segment server-console-segment--ts">
              {seg.text}
            </span>
          );
        }
        if (seg.type === "level") {
          const levelClass =
            seg.level === "ERROR"
              ? "server-console-segment--level-error"
              : seg.level === "WARN"
                ? "server-console-segment--level-warn"
                : seg.level === "DEBUG"
                  ? "server-console-segment--level-debug"
                  : "server-console-segment--level-info";
          return (
            <span key={i} className={`server-console-segment ${levelClass}`}>
              {seg.text}
            </span>
          );
        }
        return (
          <span key={i} className="server-console-segment server-console-segment--msg">
            {seg.text}
          </span>
        );
      })}
    </>
  );
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
          if (line.error) cls += " server-console-line--error";
          return (
            <div key={i} className={cls}>
              <ConsoleLineContent text={line.text} forceError={line.error} />
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
