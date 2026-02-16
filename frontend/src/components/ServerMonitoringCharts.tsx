import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiGet } from "../api/client";

const MAX_POINTS = 60;
const POLL_INTERVAL_MS = 5000;
const MINECRAFT_POLL_MS = 10000;

interface DataPoint {
  time: string;
  cpu: number;
  ramPct: number;
  diskPct: number;
  tps: number | null;
  players: number | null;
}

interface Props {
  serverId: number;
}

function nowLabel(): string {
  const d = new Date();
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export const ServerMonitoringCharts: React.FC<Props> = ({ serverId }) => {
  const [data, setData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const lastMc = useRef<number>(0);

  const fetchMetrics = useCallback(async () => {
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
      const next = [
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
  }, [fetchMetrics, fetchMinecraft]);

  useEffect(() => {
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [tick]);

  const chartProps = {
    margin: { top: 8, right: 16, left: 8, bottom: 4 },
    strokeWidth: 2,
  };
  const gridStroke = "rgba(30, 41, 59, 0.8)";
  const colors = {
    cpu: "#38bdf8",
    ram: "#34d399",
    disk: "#a78bfa",
    tps: "#fbbf24",
    players: "#f472b6",
  };

  return (
    <section className="card server-panel server-panel--wide server-monitoring-panel">
      <h2 className="server-panel-title">Monitoring en direct</h2>
      <p className="server-panel-desc">
        Graphiques mis à jour toutes les 5 s (métriques VM) et 10 s (joueurs / TPS). Données sur les 5 dernières minutes.
      </p>
      {loading && data.length === 0 ? (
        <p className="server-panel-desc">Chargement des premières données…</p>
      ) : (
        <div className="server-monitoring-charts">
          <div className="server-monitoring-chart-wrap">
            <h3 className="server-monitoring-chart-title">CPU (%)</h3>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={data} {...chartProps}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#94a3b8" width={32} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
                  labelStyle={{ color: "#94a3b8" }}
                  formatter={(value: number | undefined) => [(value ?? 0).toFixed(1) + " %", "CPU"]}
                />
                <Area type="monotone" dataKey="cpu" stroke={colors.cpu} fill={colors.cpu} fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="server-monitoring-chart-wrap">
            <h3 className="server-monitoring-chart-title">RAM (%)</h3>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={data} {...chartProps}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#94a3b8" width={32} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
                  formatter={(value: number | undefined) => [(value ?? 0).toFixed(1) + " %", "RAM"]}
                />
                <Area type="monotone" dataKey="ramPct" stroke={colors.ram} fill={colors.ram} fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="server-monitoring-chart-wrap">
            <h3 className="server-monitoring-chart-title">Stockage (%)</h3>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={data} {...chartProps}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#94a3b8" width={32} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
                  formatter={(value: number | undefined) => [(value ?? 0).toFixed(1) + " %", "Stockage"]}
                />
                <Area type="monotone" dataKey="diskPct" stroke={colors.disk} fill={colors.disk} fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="server-monitoring-chart-wrap">
            <h3 className="server-monitoring-chart-title">Joueurs connectés</h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={data} {...chartProps}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" width={24} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
                  formatter={(value: unknown) => [String(value ?? "—"), "Joueurs"] as [React.ReactNode, string]}
                />
                <Line type="monotone" dataKey="players" stroke={colors.players} dot={false} name="Joueurs" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="server-monitoring-chart-wrap">
            <h3 className="server-monitoring-chart-title">TPS (1m) — Paper/Spigot</h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={data} {...chartProps}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis domain={[0, 20]} tick={{ fontSize: 11 }} stroke="#94a3b8" width={24} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
                  formatter={(value: unknown) =>
                    [typeof value === "number" ? value.toFixed(1) : "—", "TPS"] as [React.ReactNode, string]
                  }
                />
                <Line type="monotone" dataKey="tps" stroke={colors.tps} dot={false} name="TPS" connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
};
