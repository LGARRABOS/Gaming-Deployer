import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../api/client";

const POLL_INTERVAL_MS = 60 * 1000; // 1 min, aligné avec la collecte serveur

export interface MonitoringDataPoint {
  time: string;
  cpu: number;
  ramPct: number;
  diskPct: number;
  tps: number | null;
  players: number | null;
}

interface HistoryPoint {
  time: string;
  cpu: number;
  ramPct: number;
  diskPct: number;
  tps?: number;
  players?: number;
}

/** Récupère l’historique monitoring depuis le serveur (collecte en arrière-plan côté serveur). */
export function useServerMonitoringData(serverId: number | null): {
  data: MonitoringDataPoint[];
  loading: boolean;
} {
  const [data, setData] = useState<MonitoringDataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    if (!serverId) return;
    try {
      const res = await apiGet<{ points?: HistoryPoint[] }>(
        `/api/servers/${serverId}/monitoring-history`
      );
      const points = res?.points ?? [];
      setData(
        points.map((p) => ({
          time: p.time,
          cpu: p.cpu,
          ramPct: p.ramPct,
          diskPct: p.diskPct,
          tps: p.tps ?? null,
          players: p.players ?? null,
        }))
      );
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    if (!serverId) return;
    fetchHistory();
    const id = setInterval(fetchHistory, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchHistory, serverId]);

  return { data, loading };
}
