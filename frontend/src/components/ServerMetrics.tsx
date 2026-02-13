import React, { useCallback, useEffect, useState } from "react";
import { apiGet } from "../api/client";

interface MetricsSnapshot {
  ok: boolean;
  mem_total_bytes?: number;
  mem_used_bytes?: number;
  mem_available_bytes?: number;
  disk_total_bytes?: number;
  disk_used_bytes?: number;
  disk_available_bytes?: number;
  load_1m?: number;
  load_5m?: number;
  load_15m?: number;
  error?: string;
}

const HISTORY_LENGTH = 30;

function formatBytes(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + " To";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + " Go";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " Mo";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + " Ko";
  return String(n);
}

interface Props {
  serverId: number;
}

export const ServerMetrics: React.FC<Props> = ({ serverId }) => {
  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);
  const [memHistory, setMemHistory] = useState<number[]>([]);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [diskHistory, setDiskHistory] = useState<number[]>([]);

  const fetchMetrics = useCallback(async () => {
    try {
      const data = await apiGet<MetricsSnapshot>(`/api/servers/${serverId}/metrics`);
      if (!data.ok) return;
      setSnapshot(data);
      if (data.mem_total_bytes != null && data.mem_used_bytes != null && data.mem_total_bytes > 0) {
        const pct = (100 * data.mem_used_bytes) / data.mem_total_bytes;
        setMemHistory((prev) => [...prev.slice(-(HISTORY_LENGTH - 1)), pct]);
      }
      if (data.load_1m != null) {
        const v = data.load_1m;
        setCpuHistory((prev) => [...prev.slice(-(HISTORY_LENGTH - 1)), v]);
      }
      if (data.disk_total_bytes != null && data.disk_used_bytes != null && data.disk_total_bytes > 0) {
        const pct = (100 * data.disk_used_bytes) / data.disk_total_bytes;
        setDiskHistory((prev) => [...prev.slice(-(HISTORY_LENGTH - 1)), pct]);
      }
    } catch {
      // ignore
    }
  }, [serverId]);

  useEffect(() => {
    fetchMetrics();
    const t = setInterval(fetchMetrics, 3000);
    return () => clearInterval(t);
  }, [fetchMetrics]);

  if (!snapshot?.ok) {
    return (
      <section className="card server-panel server-metrics-panel">
        <h2 className="server-panel-title">Performances</h2>
        <p className="server-panel-desc">Chargement des métriques…</p>
      </section>
    );
  }

  const memTotal = snapshot.mem_total_bytes ?? 0;
  const memUsed = snapshot.mem_used_bytes ?? 0;
  const memPct = memTotal > 0 ? (100 * memUsed) / memTotal : 0;
  const diskTotal = snapshot.disk_total_bytes ?? 0;
  const diskUsed = snapshot.disk_used_bytes ?? 0;
  const diskPct = diskTotal > 0 ? (100 * diskUsed) / diskTotal : 0;
  const load1 = snapshot.load_1m ?? 0;

  return (
    <section className="card server-panel server-metrics-panel">
      <h2 className="server-panel-title">Performances</h2>
      <p className="server-panel-desc">CPU, RAM et stockage en temps réel.</p>
      <div className="server-metrics-grid">
        <div className="server-metric">
          <div className="server-metric-header">
            <span className="server-metric-label">CPU (charge 1 min)</span>
            <span className="server-metric-value">{load1.toFixed(2)}</span>
          </div>
          <div className="server-metric-sparkline">
            {cpuHistory.map((v, i) => (
              <div
                key={i}
                className="server-metric-sparkline-bar"
                style={{ height: `${Math.min(100, v * 25)}%` }}
                title={`${v.toFixed(2)}`}
              />
            ))}
          </div>
        </div>
        <div className="server-metric">
          <div className="server-metric-header">
            <span className="server-metric-label">RAM</span>
            <span className="server-metric-value">{formatBytes(memUsed)} / {formatBytes(memTotal)}</span>
          </div>
          <div className="server-metric-bar-wrap">
            <div className="server-metric-bar" style={{ width: `${Math.min(100, memPct)}%` }} />
          </div>
          <div className="server-metric-sparkline">
            {memHistory.map((v, i) => (
              <div
                key={i}
                className="server-metric-sparkline-bar server-metric-sparkline-bar--mem"
                style={{ height: `${Math.min(100, v)}%` }}
                title={`${v.toFixed(0)}%`}
              />
            ))}
          </div>
        </div>
        <div className="server-metric">
          <div className="server-metric-header">
            <span className="server-metric-label">Stockage</span>
            <span className="server-metric-value">{formatBytes(diskUsed)} / {formatBytes(diskTotal)}</span>
          </div>
          <div className="server-metric-bar-wrap">
            <div className="server-metric-bar server-metric-bar--disk" style={{ width: `${Math.min(100, diskPct)}%` }} />
          </div>
          <div className="server-metric-sparkline">
            {diskHistory.map((v, i) => (
              <div
                key={i}
                className="server-metric-sparkline-bar server-metric-sparkline-bar--disk"
                style={{ height: `${Math.min(100, v)}%` }}
                title={`${v.toFixed(0)}%`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
