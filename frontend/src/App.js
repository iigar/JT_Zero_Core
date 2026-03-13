import React, { useState, useCallback, useRef } from 'react';
import Header from './components/Header';
import SensorPanels from './components/SensorPanels';
import DronePanel from './components/DronePanel';
import Drone3DPanel from './components/Drone3DPanel';
import EventLog from './components/EventLog';
import CommandPanel from './components/CommandPanel';
import TelemetryCharts from './components/TelemetryCharts';
import CameraPanel from './components/CameraPanel';
import MAVLinkPanel from './components/MAVLinkPanel';
import PerformancePanel from './components/PerformancePanel';
import SimulatorPanel from './components/SimulatorPanel';
import DocumentationTab from './components/DocumentationTab';
import SettingsTab from './components/SettingsTab';
import { useWebSocket } from './hooks/useApi';
import { LayoutDashboard, LineChart, Camera, Radio, ScrollText, FileText, Settings } from 'lucide-react';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'telemetry', label: 'Telemetry', icon: LineChart },
  { id: 'camera', label: 'Camera / VO', icon: Camera },
  { id: 'mavlink', label: 'MAVLink', icon: Radio },
  { id: 'events', label: 'Events', icon: ScrollText },
  { id: 'docs', label: 'Docs', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [state, setState] = useState(null);
  const [threads, setThreads] = useState([]);
  const [engines, setEngines] = useState({});
  const [events, setEvents] = useState([]);
  const [camera, setCamera] = useState(null);
  const [mavlink, setMavlink] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [features, setFeatures] = useState([]);
  const [runtimeMode, setRuntimeMode] = useState('simulator');
  const [sensorModes, setSensorModes] = useState({});
  const historyRef = useRef([]);
  const [history, setHistory] = useState([]);

  const handleMessage = useCallback((data) => {
    if (data.type === 'telemetry') {
      setState(data.state);
      setThreads(data.threads || []);
      setEngines(data.engines || {});
      if (data.camera) setCamera(data.camera);
      if (data.mavlink) setMavlink(data.mavlink);
      if (data.performance) setPerformance(data.performance);
      if (data.features) setFeatures(data.features);
      if (data.runtime_mode) setRuntimeMode(data.runtime_mode);
      if (data.sensor_modes) setSensorModes(data.sensor_modes);
      if (data.recent_events) {
        setEvents(prev => {
          const combined = [...prev, ...data.recent_events];
          const unique = combined.filter((e, i, arr) =>
            i === arr.findIndex(x => x.timestamp === e.timestamp && x.type === e.type && x.message === e.message)
          );
          return unique.slice(-500);
        });
      }
      if (data.state) {
        const s = data.state;
        const record = {
          timestamp: s.uptime_sec,
          roll: s.roll, pitch: s.pitch, yaw: s.yaw,
          altitude: s.altitude_agl,
          battery_voltage: s.battery_voltage,
          cpu_usage: s.cpu_usage,
          imu_gyro_x: s.imu?.gyro_x, imu_gyro_y: s.imu?.gyro_y, imu_gyro_z: s.imu?.gyro_z,
          baro_pressure: s.baro?.pressure,
          range_distance: s.rangefinder?.distance,
          flow_x: s.optical_flow?.flow_x, flow_y: s.optical_flow?.flow_y,
        };
        historyRef.current = [...historyRef.current.slice(-200), record];
        setHistory([...historyRef.current]);
      }
    }
  }, []);

  const { connected } = useWebSocket('/api/ws/telemetry', handleMessage);

  return (
    <div className="h-screen flex flex-col bg-[#050505] overflow-hidden" data-testid="app-root">
      <Header state={state} connected={connected} runtimeMode={runtimeMode} />

      {/* Tab Navigation */}
      <nav className="flex items-center gap-0 bg-[#0A0C10] border-b border-[#1E293B] px-2 shrink-0" data-testid="tab-nav">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            data-testid={`tab-${id}`}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider transition-all border-b-2 ${
              activeTab === id
                ? 'text-[#00F0FF] border-[#00F0FF] bg-[#00F0FF]/5'
                : 'text-slate-500 border-transparent hover:text-slate-300 hover:border-slate-600'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}

        {/* Status pills right-aligned */}
        <div className="ml-auto flex items-center gap-2 pr-2">
          <StatusPill label="THREADS" value={`${threads?.filter(t => t.running).length || 0}/8`} ok={threads?.filter(t => t.running).length >= 7} />
          <StatusPill label="MODE" value={runtimeMode === 'native' ? 'C++' : 'PY'} ok={runtimeMode === 'native'} />
          <StatusPill label="EVT" value={events.length} ok />
        </div>
      </nav>

      {/* Tab Content */}
      <main className="flex-1 overflow-hidden">
        {activeTab === 'dashboard' && (
          <DashboardTab state={state} history={history} threads={threads} engines={engines} camera={camera} mavlink={mavlink} performance={performance} runtimeMode={runtimeMode} events={events} features={features} />
        )}
        {activeTab === 'telemetry' && (
          <TelemetryTab state={state} history={history} performance={performance} runtimeMode={runtimeMode} threads={threads} />
        )}
        {activeTab === 'camera' && (
          <div className="h-full p-3">
            <CameraPanel camera={camera} features={features} />
          </div>
        )}
        {activeTab === 'mavlink' && (
          <MavlinkTab mavlink={mavlink} />
        )}
        {activeTab === 'events' && (
          <div className="h-full p-3">
            <EventLog events={events} fullPage />
          </div>
        )}
        {activeTab === 'docs' && (
          <DocumentationTab />
        )}
        {activeTab === 'settings' && (
          <SettingsTab state={state} threads={threads} engines={engines} runtimeMode={runtimeMode} mavlink={mavlink} sensorModes={sensorModes} />
        )}
      </main>

      {/* Scanline overlay */}
      <div className="fixed inset-0 pointer-events-none z-50" style={{
        background: 'repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0,0,0,0.03) 1px, rgba(0,0,0,0.03) 2px)',
      }} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/* Dashboard Tab                                              */
/* ═══════════════════════════════════════════════════════════ */

function DashboardTab({ state, history, threads, engines, camera, mavlink, performance, runtimeMode, events, features }) {
  return (
    <div className="h-full flex overflow-hidden">
      {/* Compact sidebar */}
      <aside className="w-36 shrink-0 bg-[#0A0C10] border-r border-[#1E293B] p-2 overflow-y-auto">
        <Section title="System">
          <DataRow label="CPU" value={`${state?.cpu_usage?.toFixed(1) || 0}%`} />
          <DataRow label="RAM" value={`${state?.ram_usage_mb?.toFixed(0) || 0}MB`} />
          <DataRow label="TEMP" value={`${state?.cpu_temp?.toFixed(1) || 0}C`} />
        </Section>
        <Section title="Sensors">
          {['IMU', 'BARO', 'GPS', 'RANGE', 'FLOW'].map(s => {
            const valid = s === 'IMU' ? state?.imu?.valid :
              s === 'BARO' ? state?.baro?.valid :
              s === 'GPS' ? state?.gps?.valid :
              s === 'RANGE' ? state?.rangefinder?.valid :
              state?.optical_flow?.valid;
            return (
              <div key={s} className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${valid ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className="text-[9px] text-slate-400 uppercase">{s}</span>
              </div>
            );
          })}
        </Section>
        <Section title="Threads">
          {threads?.map((t, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className={`w-1.5 h-1.5 rounded-full ${t.running ? 'bg-emerald-500' : 'bg-slate-700'}`} />
              <span className="text-[8px] text-slate-500 truncate flex-1">{t.name?.split('_')[1] || t.name}</span>
              <span className="text-[8px] text-cyan-400 tabular-nums">{t.actual_hz?.toFixed(0)}</span>
            </div>
          ))}
        </Section>
        <Section title="Engines">
          <DataRow label="EVT" value={engines?.events?.pending || 0} />
          <DataRow label="REFLEX" value={`${engines?.reflexes?.total_fires || 0}`} />
          <DataRow label="RULES" value={`${engines?.rules?.total_evaluations || 0}`} />
          <DataRow label="MEM" value={`${((engines?.memory?.usage_bytes || 0) / 1024).toFixed(0)}K`} />
        </Section>
      </aside>

      {/* Main grid */}
      <div className="flex-1 flex flex-col gap-2 p-2 overflow-y-auto">
        {/* Row 1: 3D + Telemetry + Sensors */}
        <div className="grid grid-cols-12 gap-2 shrink-0" style={{ height: '240px' }}>
          <div className="col-span-3 overflow-hidden"><Drone3DPanel state={state} /></div>
          <div className="col-span-3 overflow-hidden"><DronePanel state={state} history={history} /></div>
          <div className="col-span-6 overflow-hidden"><SensorPanels state={state} history={history} /></div>
        </div>
        {/* Row 2: Camera + MAVLink + Performance */}
        <div className="grid grid-cols-12 gap-2 shrink-0" style={{ height: '220px' }}>
          <div className="col-span-4 overflow-hidden"><CameraPanel camera={camera} features={features} /></div>
          <div className="col-span-4 overflow-hidden"><MAVLinkPanel mavlink={mavlink} /></div>
          <div className="col-span-4 overflow-hidden"><PerformancePanel performance={performance} runtimeMode={runtimeMode} /></div>
        </div>
        {/* Row 3: Mini event log */}
        <div className="shrink-0 overflow-hidden" style={{ height: '150px' }}>
          <EventLog events={events} />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/* Telemetry Tab                                              */
/* ═══════════════════════════════════════════════════════════ */

function TelemetryTab({ state, history, performance, runtimeMode, threads }) {
  return (
    <div className="h-full flex flex-col gap-2 p-3 overflow-y-auto">
      <div className="grid grid-cols-12 gap-2 shrink-0" style={{ height: '300px' }}>
        <div className="col-span-8 overflow-hidden">
          <TelemetryCharts history={history} />
        </div>
        <div className="col-span-4 overflow-hidden">
          <PerformancePanel performance={performance} runtimeMode={runtimeMode} />
        </div>
      </div>
      {/* Sensor detail grid */}
      <div className="grid grid-cols-12 gap-2 shrink-0" style={{ height: '220px' }}>
        <div className="col-span-12 overflow-hidden">
          <SensorPanels state={state} history={history} />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/* MAVLink Tab                                                */
/* ═══════════════════════════════════════════════════════════ */

function MavlinkTab({ mavlink }) {
  return (
    <div className="h-full flex flex-col gap-2 p-3 overflow-y-auto">
      <div className="grid grid-cols-12 gap-2" style={{ minHeight: '280px' }}>
        <div className="col-span-6"><MAVLinkPanel mavlink={mavlink} /></div>
        <div className="col-span-6"><CommandPanel /></div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/* Shared Mini-Components                                     */
/* ═══════════════════════════════════════════════════════════ */

function Section({ title, children }) {
  return (
    <div className="mb-3">
      <h4 className="text-[8px] uppercase tracking-widest text-slate-600 mb-1.5 font-semibold">{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function DataRow({ label, value }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[9px] text-slate-600 uppercase">{label}</span>
      <span className="text-[9px] text-[#00F0FF] font-bold tabular-nums">{value}</span>
    </div>
  );
}

function StatusPill({ label, value, ok }) {
  return (
    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-sm text-[8px] font-bold uppercase tracking-wider border ${
      ok ? 'border-emerald-500/20 text-emerald-400 bg-emerald-500/5' : 'border-amber-500/20 text-amber-400 bg-amber-500/5'
    }`}>
      <span className="text-slate-500">{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default App;
