import React from 'react';
import { Cpu, HardDrive, Thermometer, Wifi, Activity } from 'lucide-react';

function Bar({ value, max = 100, color = 'bg-[#00F0FF]', warn = 70, danger = 90 }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const barColor = pct > danger ? 'bg-red-500' : pct > warn ? 'bg-amber-400' : color;
  return (
    <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden">
      <div className={`h-full ${barColor} transition-all duration-300`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Spark({ data, color = '#00F0FF', height = 20 }) {
  if (!data || data.length < 2) return null;
  const vals = data.map(d => d.v ?? d.send ?? 0);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const w = 100;
  const points = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${height - ((v - min) / range) * (height - 2)}`).join(' ');
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function PerformancePanelInner({ performance, systemMetrics, runtimeMode }) {
  const sys = systemMetrics || {};
  const cpu = sys.cpu || {};
  const mem = sys.memory || {};
  const disk = sys.disk || {};
  const net = sys.network || {};
  const proc = sys.process || {};
  const hist = sys.histories || {};
  const temp = sys.temperature || 0;

  // Fallback to old engine performance data if no system metrics
  const enginePerf = performance || {};
  const engineMem = enginePerf.memory || {};
  const latency = enginePerf.latency || {};
  const throughput = enginePerf.throughput || {};

  return (
    <div className="panel-glass p-3 relative corner-bracket h-full overflow-hidden flex flex-col" data-testid="performance-panel">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-slate-500" />
          <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">System Monitor</h3>
        </div>
        <div className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm ${
          runtimeMode === 'native'
            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
            : 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
        }`} data-testid="runtime-mode-badge">
          {runtimeMode === 'native' ? 'C++ NATIVE' : 'PY SIM'}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
        {/* CPU */}
        <div data-testid="perf-cpu-section">
          <div className="flex justify-between items-center mb-0.5">
            <div className="flex items-center gap-1">
              <Cpu className="w-3 h-3 text-slate-600" />
              <span className="text-[9px] text-slate-600 uppercase">CPU</span>
            </div>
            <span className="text-[10px] text-[#00F0FF] font-bold tabular-nums">
              {cpu.total_percent ?? 0}%
            </span>
          </div>
          <Bar value={cpu.total_percent ?? 0} max={100} warn={60} danger={85} />
          {hist.cpu && <div className="mt-1"><Spark data={hist.cpu} color="#00F0FF" height={18} /></div>}
          {cpu.per_core && cpu.per_core.length > 0 && (
            <div className="flex gap-1 mt-1">
              {cpu.per_core.map((c, i) => (
                <div key={i} className="flex-1">
                  <div className="text-[7px] text-slate-700 text-center">C{i}</div>
                  <div className="h-1 bg-black/40 rounded-full overflow-hidden">
                    <div className={`h-full ${c > 85 ? 'bg-red-500' : c > 60 ? 'bg-amber-400' : 'bg-[#00F0FF]'} transition-all`}
                      style={{ width: `${Math.min(100, c)}%` }} />
                  </div>
                  <div className="text-[7px] text-slate-600 text-center tabular-nums">{c}%</div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-3 mt-0.5">
            <span className="text-[8px] text-slate-600">Load: <span className="text-slate-400 tabular-nums">{cpu.load_1m ?? 0}</span></span>
            <span className="text-[8px] text-slate-600">Freq: <span className="text-slate-400 tabular-nums">{cpu.freq_mhz ?? 0}MHz</span></span>
          </div>
        </div>

        {/* RAM */}
        <div className="border-t border-[#1E293B]/30 pt-1.5" data-testid="perf-ram-section">
          <div className="flex justify-between items-center mb-0.5">
            <span className="text-[9px] text-slate-600 uppercase">RAM</span>
            <span className="text-[10px] text-emerald-400 font-bold tabular-nums">
              {mem.used_mb ?? 0} / {mem.total_mb ?? 0} MB
            </span>
          </div>
          <Bar value={mem.percent ?? 0} max={100} color="bg-emerald-400" warn={70} danger={90} />
          {hist.ram && <div className="mt-1"><Spark data={hist.ram} color="#10B981" height={18} /></div>}
          <span className="text-[8px] text-slate-600">Avail: <span className="text-slate-400 tabular-nums">{mem.available_mb ?? 0} MB</span></span>
        </div>

        {/* Temperature */}
        <div className="border-t border-[#1E293B]/30 pt-1.5" data-testid="perf-temp-section">
          <div className="flex justify-between items-center mb-0.5">
            <div className="flex items-center gap-1">
              <Thermometer className="w-3 h-3 text-slate-600" />
              <span className="text-[9px] text-slate-600 uppercase">TEMP</span>
            </div>
            <span className={`text-[10px] font-bold tabular-nums ${
              temp > 75 ? 'text-red-400' : temp > 60 ? 'text-amber-400' : 'text-[#00F0FF]'
            }`}>
              {temp}°C
            </span>
          </div>
          <Bar value={temp} max={100} color="bg-orange-400" warn={60} danger={75} />
          {hist.temp && <div className="mt-1"><Spark data={hist.temp} color="#F97316" height={16} /></div>}
        </div>

        {/* Disk */}
        <div className="border-t border-[#1E293B]/30 pt-1.5" data-testid="perf-disk-section">
          <div className="flex justify-between items-center mb-0.5">
            <div className="flex items-center gap-1">
              <HardDrive className="w-3 h-3 text-slate-600" />
              <span className="text-[9px] text-slate-600 uppercase">DISK</span>
            </div>
            <span className="text-[10px] text-violet-400 font-bold tabular-nums">
              {disk.used_gb ?? 0} / {disk.total_gb ?? 0} GB
            </span>
          </div>
          <Bar value={disk.percent ?? 0} max={100} color="bg-violet-400" warn={80} danger={95} />
        </div>

        {/* Network */}
        <div className="border-t border-[#1E293B]/30 pt-1.5" data-testid="perf-net-section">
          <div className="flex items-center gap-1 mb-0.5">
            <Wifi className="w-3 h-3 text-slate-600" />
            <span className="text-[9px] text-slate-600 uppercase">NETWORK</span>
          </div>
          <div className="flex gap-3">
            <span className="text-[8px] text-slate-600">TX: <span className="text-sky-400 font-bold tabular-nums">{net.send_kbps ?? 0} KB/s</span></span>
            <span className="text-[8px] text-slate-600">RX: <span className="text-amber-400 font-bold tabular-nums">{net.recv_kbps ?? 0} KB/s</span></span>
          </div>
          {hist.net && <div className="mt-1"><Spark data={hist.net} color="#38BDF8" height={16} /></div>}
        </div>

        {/* Process */}
        <div className="border-t border-[#1E293B]/30 pt-1.5" data-testid="perf-process-section">
          <span className="text-[8px] text-slate-700 uppercase">JT-Zero Process</span>
          <div className="flex gap-3 mt-0.5">
            <span className="text-[8px] text-slate-600">MEM: <span className="text-slate-400 tabular-nums">{proc.memory_mb ?? 0} MB</span></span>
            <span className="text-[8px] text-slate-600">THR: <span className="text-slate-400 tabular-nums">{proc.threads ?? 0}</span></span>
            <span className="text-[8px] text-slate-600">PID: <span className="text-slate-400 tabular-nums">{proc.pid ?? 0}</span></span>
          </div>
        </div>

        {/* Engine metrics (if native) */}
        {(latency.reflex_avg_us || throughput.events_total) ? (
          <div className="border-t border-[#1E293B]/30 pt-1.5" data-testid="perf-engine-section">
            <span className="text-[8px] text-slate-700 uppercase">Engine</span>
            <div className="grid grid-cols-2 gap-x-3 mt-0.5">
              <Stat label="Reflex" value={`${(latency.reflex_avg_us || 0).toFixed(1)}us`} />
              <Stat label="Events" value={throughput.events_total || 0} />
              <Stat label="Dropped" value={throughput.events_dropped || 0}
                color={(throughput.events_dropped || 0) > 0 ? 'text-red-400' : 'text-emerald-400'} />
              <Stat label="C++ Mem" value={`${((engineMem.total_mb || 0)).toFixed(1)}MB`} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-[8px] text-slate-600">{label}</span>
      <span className={`text-[9px] font-bold tabular-nums ${color || 'text-[#00F0FF]'}`}>{value}</span>
    </div>
  );
}

const PerformancePanel = React.memo(PerformancePanelInner);
export default PerformancePanel;