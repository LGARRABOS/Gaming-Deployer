import React, { useCallback, useEffect, useState } from "react";
import { apiGet } from "../api/client";

interface MetricsSnapshot {
  ok: boolean;
  cpu_usage_percent?: number;
  mem_total_bytes?: number;
  mem_used_bytes?: number;
  mem_available_bytes?: number;
  disk_total_bytes?: number;
  disk_used_bytes?: number;
  disk_available_bytes?: number;
  error?: string;
}

// Unités binaires (1024) pour coller à ce que rapporte Linux (RAM, df)
function formatBytes(n: number): string {
  const Ki = 1024;
  const Mi = Ki * 1024;
  const Gi = Mi * 1024;
  const Ti = Gi * 1024;
  if (n >= Ti) return (n / Ti).toFixed(1) + " To";
  if (n >= Gi) return (n / Gi).toFixed(1) + " Go";
  if (n >= Mi) return (n / Mi).toFixed(1) + " Mo";
  if (n >= Ki) return (n / Ki).toFixed(1) + " Ko";
  return String(n);
}

interface Props {
  serverId: number;
}

export const ServerMetrics: React.FC<Props> = ({ serverId }) => {
  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      const data = await apiGet<MetricsSnapshot>(`/api/servers/${serverId}/metrics`);
      if (!data.ok) return;
      setSnapshot(data);
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

  const cpuPct = snapshot.cpu_usage_percent ?? 0;
  const memTotal = snapshot.mem_total_bytes ?? 0;
  const memUsed = snapshot.mem_used_bytes ?? 0;
  const memPct = memTotal > 0 ? (100 * memUsed) / memTotal : 0;
  const diskTotal = snapshot.disk_total_bytes ?? 0;
  const diskUsed = snapshot.disk_used_bytes ?? 0;
  const diskPct = diskTotal > 0 ? (100 * diskUsed) / diskTotal : 0;

  return (
    <section className="card server-panel server-metrics-panel">
      <h2 className="server-panel-title">Performances</h2>
      <div className="server-metrics-grid">
        <div className="server-metric">
          <div className="server-metric-header">
            <span className="server-metric-label">CPU</span>
            <span className="server-metric-value">{cpuPct.toFixed(0)} %</span>
          </div>
          <div className="server-metric-bar-wrap">
            <div className="server-metric-bar" style={{ width: `${Math.min(100, cpuPct)}%` }} />
          </div>
        </div>
        <div className="server-metric">
          <div className="server-metric-header">
            <span className="server-metric-label">RAM</span>
            <span className="server-metric-value">{formatBytes(memUsed)} / {formatBytes(memTotal)}</span>
          </div>
          <div className="server-metric-bar-wrap">
            <div className="server-metric-bar server-metric-bar--mem" style={{ width: `${Math.min(100, memPct)}%` }} />
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
        </div>
      </div>
    </section>
  );
};
