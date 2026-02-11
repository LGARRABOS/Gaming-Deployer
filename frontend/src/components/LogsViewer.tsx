import React, { useEffect, useState } from "react";
import { apiGet } from "../api/client";

interface LogItem {
  id: number;
  ts: string;
  level: string;
  message: string;
}

interface Props {
  deploymentId: number;
}

export const LogsViewer: React.FC<Props> = ({ deploymentId }) => {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [lastId, setLastId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchLogs = async () => {
      try {
        const path =
          lastId == null
            ? `/api/deployments/${deploymentId}/logs`
            : `/api/deployments/${deploymentId}/logs?after_id=${lastId}`;
        const data = await apiGet<LogItem[]>(path);
        if (!cancelled && data.length > 0) {
          setLogs((prev) => [...prev, ...data]);
          setLastId(data[data.length - 1].id);
        }
      } catch {
        // ignore polling errors
      }
    };
    fetchLogs();
    const id = setInterval(fetchLogs, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [deploymentId, lastId]);

  return (
    <div className="logs-viewer">
      {logs.map((l) => (
        <div key={l.id} className={`log log-${l.level.toLowerCase()}`}>
          <span className="log-ts">{new Date(l.ts).toLocaleTimeString()}</span>
          <span className="log-level">{l.level.toUpperCase()}</span>
          <span className="log-message">{l.message}</span>
        </div>
      ))}
      {logs.length === 0 && <p>Aucun log pour le moment.</p>}
    </div>
  );
};

