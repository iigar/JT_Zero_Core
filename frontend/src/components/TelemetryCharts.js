import React from 'react';
import { LineChart, Line, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import SafeChart from './SafeChart';

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#0A0C10] border border-[#1E293B] px-2 py-1 text-[10px]">
        {payload.map((p, i) => (
          <div key={i} className="flex gap-2">
            <span style={{ color: p.stroke }}>{p.dataKey}:</span>
            <span className="text-slate-300 tabular-nums">{p.value?.toFixed(4)}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

/* Compute Y-axis domain with padding so "flat" lines are visible in the middle */
function paddedDomain(data, keys, padPercent = 0.3, minRange = 0.01) {
  let allMin = Infinity, allMax = -Infinity;
  for (const d of data) {
    for (const k of keys) {
      const v = d[k];
      if (v != null && isFinite(v)) {
        if (v < allMin) allMin = v;
        if (v > allMax) allMax = v;
      }
    }
  }
  if (!isFinite(allMin)) return ['auto', 'auto'];
  let range = allMax - allMin;
  if (range < minRange) range = minRange;
  const pad = range * padPercent;
  return [
    parseFloat((allMin - pad).toPrecision(6)),
    parseFloat((allMax + pad).toPrecision(6)),
  ];
}

function ChartLabel({ title, values, colors }) {
  return (
    <div className="flex items-center justify-between mb-0.5">
      <span className="text-[8px] text-slate-700 uppercase">{title}</span>
      <div className="flex gap-2">
        {values.map((v, i) => (
          <span key={i} className="text-[9px] font-bold tabular-nums" style={{ color: colors[i] }}>
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function TelemetryCharts({ history }) {
  const data = (history || []).slice(-100);

  if (data.length < 2) {
    return (
      <div className="panel-glass p-3 flex items-center justify-center" style={{ minHeight: '200px' }} data-testid="telemetry-charts">
        <span className="text-[10px] text-slate-700">Collecting telemetry data...</span>
      </div>
    );
  }

  const last = data[data.length - 1] || {};
  const attDomain = paddedDomain(data, ['roll', 'pitch'], 0.2, 1.0);
  const gyroDomain = paddedDomain(data, ['imu_gyro_x', 'imu_gyro_y', 'imu_gyro_z'], 0.3, 0.005);
  const baroDomain = paddedDomain(data, ['baro_pressure'], 0.3, 0.5);
  const sysDomain = paddedDomain(data, ['battery_voltage', 'cpu_usage'], 0.2, 0.5);

  return (
    <div className="panel-glass p-3 relative corner-bracket h-full overflow-y-auto" data-testid="telemetry-charts">
      <h3 className="text-[10px] uppercase tracking-widest text-slate-500 mb-2 font-semibold">Telemetry Charts</h3>

      <div className="space-y-3">
        {/* Attitude */}
        <div>
          <ChartLabel
            title="Attitude (Roll / Pitch)"
            values={[`R:${(last.roll ?? 0).toFixed(2)}°`, `P:${(last.pitch ?? 0).toFixed(2)}°`]}
            colors={['#00F0FF', '#7dd3fc']}
          />
          <SafeChart height="65px">
            <LineChart data={data}>
              <CartesianGrid stroke="#1E293B" strokeDasharray="3 3" />
              <YAxis domain={attDomain} tick={{ fontSize: 8, fill: '#475569' }} width={35} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="#334155" strokeDasharray="2 2" />
              <Line type="monotone" dataKey="roll" stroke="#00F0FF" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="pitch" stroke="#7dd3fc" strokeWidth={1} dot={false} isAnimationActive={false} />
            </LineChart>
          </SafeChart>
        </div>

        {/* IMU Gyro */}
        <div>
          <ChartLabel
            title="IMU Gyroscope (rad/s)"
            values={[
              `X:${(last.imu_gyro_x ?? 0).toFixed(4)}`,
              `Y:${(last.imu_gyro_y ?? 0).toFixed(4)}`,
              `Z:${(last.imu_gyro_z ?? 0).toFixed(4)}`
            ]}
            colors={['#EF4444', '#10B981', '#00F0FF']}
          />
          <SafeChart height="65px">
            <LineChart data={data}>
              <CartesianGrid stroke="#1E293B" strokeDasharray="3 3" />
              <YAxis domain={gyroDomain} tick={{ fontSize: 8, fill: '#475569' }} width={40} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="#334155" strokeDasharray="2 2" />
              <Line type="monotone" dataKey="imu_gyro_x" stroke="#EF4444" strokeWidth={1} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="imu_gyro_y" stroke="#10B981" strokeWidth={1} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="imu_gyro_z" stroke="#00F0FF" strokeWidth={1} dot={false} isAnimationActive={false} />
            </LineChart>
          </SafeChart>
        </div>

        {/* Barometer Pressure */}
        <div>
          <ChartLabel
            title="Barometer (hPa)"
            values={[`${(last.baro_pressure ?? 0).toFixed(2)} hPa`]}
            colors={['#A78BFA']}
          />
          <SafeChart height="55px">
            <LineChart data={data}>
              <CartesianGrid stroke="#1E293B" strokeDasharray="3 3" />
              <YAxis domain={baroDomain} tick={{ fontSize: 8, fill: '#475569' }} width={45} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="baro_pressure" stroke="#A78BFA" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </SafeChart>
        </div>

        {/* Battery + CPU */}
        <div>
          <ChartLabel
            title="System (Battery V / CPU %)"
            values={[
              `${(last.battery_voltage ?? 0).toFixed(2)}V`,
              `${(last.cpu_usage ?? 0).toFixed(1)}%`
            ]}
            colors={['#F59E0B', '#64748B']}
          />
          <SafeChart height="55px">
            <LineChart data={data}>
              <CartesianGrid stroke="#1E293B" strokeDasharray="3 3" />
              <YAxis domain={sysDomain} tick={{ fontSize: 8, fill: '#475569' }} width={35} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="battery_voltage" stroke="#F59E0B" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="cpu_usage" stroke="#64748B" strokeWidth={1} dot={false} isAnimationActive={false} />
            </LineChart>
          </SafeChart>
        </div>
      </div>
    </div>
  );
}
