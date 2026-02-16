import React from "react";
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
import type { MonitoringDataPoint } from "../hooks/useServerMonitoringData";

interface Props {
  data: MonitoringDataPoint[];
  loading: boolean;
}

export const ServerMonitoringCharts: React.FC<Props> = ({ data, loading }) => {
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
        Un point par minute, données sur les 12 dernières heures. La collecte s’effectue en arrière-plan sur le
        serveur (même si l’app n’est pas ouverte).
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
