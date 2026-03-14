import React, { useState, useEffect } from 'react';
import { apiCall } from '../hooks/useApi';
import { Settings, Wind, Battery, Gauge, RefreshCw, Cpu, Activity, Wifi, MemoryStick, Server } from 'lucide-react';
import DiagnosticsPanel from './DiagnosticsPanel';

function Slider({ label, value, min, max, step, unit, onChange, testId }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-slate-600 uppercase w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        data-testid={testId}
        className="flex-1 h-1 bg-[#1E293B] rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 
          [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full 
          [&::-webkit-slider-thumb]:bg-[#00F0FF] [&::-webkit-slider-thumb]:shadow-[0_0_4px_rgba(0,240,255,0.5)]"
      />
      <span className="text-[10px] text-[#00F0FF] font-bold tabular-nums w-14 text-right">
        {Number.isInteger(value) ? value : parseFloat(value.toFixed(2))}{unit}
      </span>
    </div>
  );
}

function InfoRow({ label, value, color = 'text-[#00F0FF]' }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-[9px] text-slate-600 uppercase">{label}</span>
      <span className={`text-[10px] font-bold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children, testId }) {
  return (
    <div className="bg-[#0A0C10] border border-[#1E293B] rounded-sm p-3" data-testid={testId}>
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-3.5 h-3.5 text-slate-500" />
        <h3 className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function SettingsTab({ state, threads, engines, runtimeMode, mavlink, sensorModes }) {
  const [config, setConfig] = useState({
    wind_speed: 0, wind_direction: 0,
    sensor_noise: 1, battery_drain: 1,
    mass_kg: 1.2, drag_coeff: 0.3,
  });

  useEffect(() => {
    apiCall('GET', '/api/simulator/config').then(data => {
      if (!data.error) setConfig(data);
    }).catch(() => {});
  }, []);

  async function updateConfig(key, value) {
    const next = { ...config, [key]: value };
    setConfig(next);
    await apiCall('POST', '/api/simulator/config', { [key]: value });
  }

  async function resetConfig() {
    const defaults = {
      wind_speed: 0, wind_direction: 0,
      sensor_noise: 1, battery_drain: 1,
      mass_kg: 1.2, drag_coeff: 0.3,
      turbulence: false,
    };
    setConfig(defaults);
    await apiCall('POST', '/api/simulator/config', defaults);
  }

  const activeThreads = threads?.filter(t => t.running).length || 0;

  return (
    <div className="h-full overflow-y-auto p-4" data-testid="settings-tab">
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Row 1: Simulator + System Info */}
        <div className="grid grid-cols-12 gap-4">
          {/* Simulator Config */}
          <div className="col-span-7">
            <SectionCard title="Simulator Configuration" icon={Settings} testId="settings-simulator">
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-1 mb-1.5">
                    <Wind className="w-3 h-3 text-slate-600" />
                    <span className="text-[8px] text-slate-600 uppercase tracking-wider font-semibold">Wind</span>
                  </div>
                  <div className="space-y-1">
                    <Slider label="Speed" value={config.wind_speed} min={0} max={15} step={0.5}
                            unit=" m/s" onChange={v => updateConfig('wind_speed', v)} testId="sim-wind-speed" />
                    <Slider label="Direction" value={config.wind_direction} min={0} max={360} step={10}
                            unit="°" onChange={v => updateConfig('wind_direction', v)} testId="sim-wind-dir" />
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-1 mb-1.5">
                    <Activity className="w-3 h-3 text-slate-600" />
                    <span className="text-[8px] text-slate-600 uppercase tracking-wider font-semibold">Sensors</span>
                  </div>
                  <Slider label="Noise" value={config.sensor_noise} min={0} max={3} step={0.1}
                          unit="x" onChange={v => updateConfig('sensor_noise', v)} testId="sim-noise" />
                </div>

                <div>
                  <div className="flex items-center gap-1 mb-1.5">
                    <Battery className="w-3 h-3 text-slate-600" />
                    <span className="text-[8px] text-slate-600 uppercase tracking-wider font-semibold">Battery</span>
                  </div>
                  <Slider label="Drain Rate" value={config.battery_drain} min={0} max={5} step={0.1}
                          unit="x" onChange={v => updateConfig('battery_drain', v)} testId="sim-battery" />
                </div>

                <div>
                  <div className="flex items-center gap-1 mb-1.5">
                    <Gauge className="w-3 h-3 text-slate-600" />
                    <span className="text-[8px] text-slate-600 uppercase tracking-wider font-semibold">Physics</span>
                  </div>
                  <div className="space-y-1">
                    <Slider label="Mass" value={config.mass_kg} min={0.5} max={5} step={0.1}
                            unit=" kg" onChange={v => updateConfig('mass_kg', v)} testId="sim-mass" />
                    <Slider label="Drag Coeff" value={config.drag_coeff} min={0} max={2} step={0.05}
                            unit="" onChange={v => updateConfig('drag_coeff', v)} testId="sim-drag" />
                  </div>
                </div>

                <button
                  onClick={resetConfig}
                  data-testid="settings-reset-btn"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider
                    text-slate-400 border border-[#1E293B] rounded-sm hover:text-[#00F0FF] hover:border-[#00F0FF]/30 transition-all"
                >
                  <RefreshCw className="w-3 h-3" />
                  Reset to Defaults
                </button>
              </div>
            </SectionCard>
          </div>

          {/* System Info */}
          <div className="col-span-5 space-y-4">
            <SectionCard title="Runtime" icon={Server} testId="settings-runtime">
              <div className="space-y-1">
                <InfoRow label="Mode" value={runtimeMode === 'native' ? 'C++ Native' : 'Python Simulator'}
                         color={runtimeMode === 'native' ? 'text-emerald-400' : 'text-amber-400'} />
                <InfoRow label="Uptime" value={`${state?.uptime_sec?.toFixed(0) || 0}s`} />
                <InfoRow label="Flight" value={state?.flight_mode?.toUpperCase() || 'IDLE'} />
                <InfoRow label="Armed" value={state?.armed ? 'YES' : 'NO'}
                         color={state?.armed ? 'text-amber-400' : 'text-slate-500'} />
              </div>
            </SectionCard>

            <SectionCard title="System Resources" icon={Cpu} testId="settings-resources">
              <div className="space-y-1">
                <InfoRow label="CPU" value={`${state?.cpu_usage?.toFixed(1) || 0}%`} />
                <InfoRow label="RAM" value={`${state?.ram_usage_mb?.toFixed(1) || 0} MB`} />
                <InfoRow label="Temperature" value={`${state?.cpu_temp?.toFixed(1) || 0}°C`} />
                <InfoRow label="Threads" value={`${activeThreads}/8 active`}
                         color={activeThreads >= 7 ? 'text-emerald-400' : 'text-amber-400'} />
              </div>
            </SectionCard>

            <SectionCard title="MAVLink" icon={Wifi} testId="settings-mavlink">
              <div className="space-y-1">
                <InfoRow label="Connected" value={mavlink?.connected ? 'YES' : 'NO'}
                         color={mavlink?.connected ? 'text-emerald-400' : 'text-slate-500'} />
                <InfoRow label="Heartbeats" value={mavlink?.heartbeats_sent || 0} />
                <InfoRow label="TX" value={`${mavlink?.messages_sent || 0} msg`} />
                <InfoRow label="RX" value={`${mavlink?.messages_received || 0} msg`} />
              </div>
            </SectionCard>
          </div>
        </div>

        {/* Row 2: Hardware Diagnostics */}
        <DiagnosticsPanel />

        {/* Row 3: Thread Details */}
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12">
            <SectionCard title="Thread Status" icon={Activity} testId="settings-threads">
              <div className="space-y-1">
                {threads?.map((t, i) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b border-[#1E293B]/30">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${t.running ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      <span className="text-[10px] text-slate-300 font-mono">T{i}</span>
                      <span className="text-[9px] text-slate-500">{t.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[9px] text-cyan-400 font-mono tabular-nums">{t.actual_hz?.toFixed(0) || 0} Hz</span>
                      <span className="text-[8px] text-slate-600 tabular-nums">iter: {t.iterations || 0}</span>
                    </div>
                  </div>
                ))}
                {(!threads || threads.length === 0) && (
                  <p className="text-[9px] text-slate-600 py-2">Waiting for thread data...</p>
                )}
              </div>
            </SectionCard>
          </div>
        </div>

        {/* Row 3: Engines */}
        <SectionCard title="Engine Statistics" icon={MemoryStick} testId="settings-engines">
          <div className="grid grid-cols-5 gap-3">
            {[
              { name: 'Events', data: engines?.events, fields: [
                ['Pending', engines?.events?.pending],
                ['Processed', engines?.events?.total_processed],
                ['Dropped', engines?.events?.dropped],
              ]},
              { name: 'Reflexes', data: engines?.reflexes, fields: [
                ['Active', engines?.reflexes?.active_count],
                ['Fires', engines?.reflexes?.total_fires],
                ['Latency', `${engines?.reflexes?.avg_latency_us || 0}μs`],
              ]},
              { name: 'Rules', data: engines?.rules, fields: [
                ['Active', engines?.rules?.active_count],
                ['Evals', engines?.rules?.total_evaluations],
                ['Triggers', engines?.rules?.total_triggers],
              ]},
              { name: 'Memory', data: engines?.memory, fields: [
                ['Used', `${((engines?.memory?.usage_bytes || 0) / 1024).toFixed(0)}K`],
                ['Allocs', engines?.memory?.allocations],
                ['Frees', engines?.memory?.deallocations],
              ]},
              { name: 'Output', data: engines?.output, fields: [
                ['Sent', engines?.output?.total_sent],
                ['Queued', engines?.output?.queued],
                ['Errors', engines?.output?.errors],
              ]},
            ].map(({ name, fields }) => (
              <div key={name} className="bg-black/30 border border-[#1E293B]/50 rounded-sm p-2">
                <h4 className="text-[9px] text-[#00F0FF] font-bold uppercase tracking-wider mb-1.5">{name}</h4>
                {fields.map(([label, val]) => (
                  <div key={label} className="flex justify-between py-0.5">
                    <span className="text-[8px] text-slate-600 uppercase">{label}</span>
                    <span className="text-[9px] text-slate-300 font-mono tabular-nums">{val ?? 0}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
