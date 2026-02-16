import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "../api/client";

/** 12 h à 1 point par minute */
const MAX_POINTS = 12 * 60; // 720
const POLL_INTERVAL_MS = 60 * 1000; // 1 min
const MINECRAFT_POLL_MS = 2 * 60 * 1000; // 2 min

export interface MonitoringDataPoint {
  time: string;
  cpu: number;
  ramPct: number;
  diskPct: number;
  tps: number | null;
  players: number | null;
}

function nowLabel(): string {
  const d = new Date();
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Collecte les métriques dès qu’on est sur le dashboard serveur (pas seulement sur l’onglet Monitoring). */
export function useServerMonitoringData(serverId: number | null): {
  data: MonitoringDataPoint[];
  loading: boolean;
} {
  const [data, setData] = useState<MonitoringDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const lastMc = useRef<number>(0);

  const fetchMetrics = useCallback(async () => {
    if (!serverId) return null;
    try {
      const m = await apiGet<{
        ok: boolean;
        cpu_usage_percent?: number;
        mem_total_bytes?: number;
        mem_used_bytes?: number;
        disk_total_bytes?: number;
        disk_used_bytes?: number;
      }>(`/api/servers/${serverId}/metrics`);
      if (!m?.ok) return null;
      const ramPct =
        (m.mem_total_bytes ?? 0) > 0
          ? (100 * (m.mem_used_bytes ?? 0)) / (m.mem_total_bytes ?? 1)
          : 0;
      const diskPct =
        (m.disk_total_bytes ?? 0) > 0
          ? (100 * (m.disk_used_bytes ?? 0)) / (m.disk_total_bytes ?? 1)
          : 0;
      return {
        cpu: m.cpu_usage_percent ?? 0,
        ramPct,
        diskPct,
      };
    } catch {
      return null;
    }
  }, [serverId]);

  const fetchMinecraft = useCallback(async () => {
    if (!serverId) return null;
    try {
      const mc = await apiGet<{
        ok: boolean;
        online?: number;
        tps?: { "1m"?: string; "5m"?: string; "15m"?: string; current?: string };
      }>(`/api/servers/${serverId}/minecraft-info`);
      if (!mc?.ok) return null;
      let tps: number | null = null;
      if (mc.tps) {
        const v = mc.tps["1m"] ?? mc.tps.current;
        if (v != null) tps = parseFloat(v) || null;
      }
      return { players: mc.online ?? 0, tps };
    } catch {
      return null;
    }
  }, [serverId]);

  const tick = useCallback(async () => {
    if (!serverId) return;
    const time = nowLabel();
    const metrics = await fetchMetrics();
    const now = Date.now();
    let players: number | null = null;
    let tps: number | null = null;
    if (now - lastMc.current >= MINECRAFT_POLL_MS) {
      lastMc.current = now;
      const mc = await fetchMinecraft();
      if (mc) {
        players = mc.players;
        tps = mc.tps;
      }
    }
    setData((prev) => {
      if (!metrics) return prev;
      const last = prev[prev.length - 1];
      const next: MonitoringDataPoint[] = [
        ...prev,
        {
          time,
          cpu: metrics.cpu,
          ramPct: metrics.ramPct,
          diskPct: metrics.diskPct,
          tps: tps ?? last?.tps ?? null,
          players: players ?? last?.players ?? null,
        },
      ];
      return next.slice(-MAX_POINTS);
    });
    setLoading(false);
  }, [serverId, fetchMetrics, fetchMinecraft]);

  useEffect(() => {
    if (!serverId) return;
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [tick, serverId]);

  return { data, loading };
}
