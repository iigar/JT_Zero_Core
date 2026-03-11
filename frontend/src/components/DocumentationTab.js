import React, { useState } from 'react';
import { FileText, Server, Cpu, Terminal, HardDrive, ExternalLink, Download, ChevronRight } from 'lucide-react';

const API_ENDPOINTS = [
  { method: 'GET', path: '/api/health', desc: 'System health + runtime mode + build info' },
  { method: 'GET', path: '/api/state', desc: 'Current drone state (attitude, sensors, motors)' },
  { method: 'GET', path: '/api/events', desc: 'Event log (last N events)' },
  { method: 'GET', path: '/api/telemetry', desc: 'Full telemetry (state + threads + engines)' },
  { method: 'GET', path: '/api/telemetry/history', desc: 'Telemetry history ring buffer' },
  { method: 'GET', path: '/api/threads', desc: 'Thread statistics (8 threads)' },
  { method: 'GET', path: '/api/engines', desc: 'Engine statistics (event, reflex, rule, memory, output)' },
  { method: 'GET', path: '/api/camera', desc: 'Camera pipeline + Visual Odometry' },
  { method: 'GET', path: '/api/mavlink', desc: 'MAVLink connection state' },
  { method: 'GET', path: '/api/performance', desc: 'CPU, memory, latency metrics' },
  { method: 'GET', path: '/api/simulator/config', desc: 'Current simulator parameters' },
  { method: 'POST', path: '/api/simulator/config', desc: 'Update simulator parameters' },
  { method: 'POST', path: '/api/command', desc: 'Send command (arm, disarm, takeoff, land, rtl, emergency)' },
  { method: 'WS', path: '/api/ws/telemetry', desc: 'Real-time telemetry stream (10Hz)' },
  { method: 'WS', path: '/api/ws/events', desc: 'Event stream' },
];

const THREAD_MODEL = [
  { id: 'T0', name: 'Supervisor', hz: '10 Hz', core: 0, prio: 90 },
  { id: 'T1', name: 'Sensors', hz: '200 Hz', core: 1, prio: 95 },
  { id: 'T2', name: 'Events', hz: '200 Hz', core: 2, prio: 85 },
  { id: 'T3', name: 'Reflex', hz: '200 Hz', core: 2, prio: 98 },
  { id: 'T4', name: 'Rules', hz: '20 Hz', core: 3, prio: 70 },
  { id: 'T5', name: 'MAVLink', hz: '50 Hz', core: 1, prio: 80 },
  { id: 'T6', name: 'Camera', hz: '15 FPS', core: 3, prio: 60 },
  { id: 'T7', name: 'API Bridge', hz: '30 Hz', core: -1, prio: 50 },
];

const FILE_TREE = [
  { path: 'jt-zero/', type: 'dir', children: [
    { path: 'include/jt_zero/', type: 'dir', desc: 'C++ headers' },
    { path: 'core/', type: 'dir', desc: '5 engine implementations' },
    { path: 'sensors/', type: 'dir', desc: 'Sensor modules' },
    { path: 'camera/', type: 'dir', desc: 'Camera + VO pipeline' },
    { path: 'mavlink/', type: 'dir', desc: 'MAVLink interface' },
    { path: 'drivers/', type: 'dir', desc: 'I2C/SPI/UART + MPU6050/BMP280/GPS' },
    { path: 'api/', type: 'dir', desc: 'pybind11 bindings' },
    { path: 'simulator/', type: 'dir', desc: 'Python fallback' },
    { path: 'CMakeLists.txt', type: 'file', desc: 'Build system' },
    { path: 'toolchain-pi-zero.cmake', type: 'file', desc: 'Cross-compilation' },
    { path: 'DEPLOYMENT.md', type: 'file', desc: 'Deployment guide' },
    { path: 'SESSION_LOG.txt', type: 'file', desc: 'Session log' },
  ]},
  { path: 'backend/', type: 'dir', children: [
    { path: 'server.py', type: 'file', desc: 'FastAPI + WebSocket' },
    { path: 'native_bridge.py', type: 'file', desc: 'pybind11 bridge' },
    { path: 'simulator.py', type: 'file', desc: 'Python fallback simulator' },
  ]},
  { path: 'frontend/src/', type: 'dir', children: [
    { path: 'App.js', type: 'file', desc: 'Tab navigation' },
    { path: 'components/', type: 'dir', desc: '14 React panels' },
    { path: 'hooks/useApi.js', type: 'file', desc: 'WebSocket + REST hooks' },
  ]},
];

const PI_INSTALL_STEPS = [
  { step: 1, title: 'Prepare Pi Zero 2 W', content: 'Flash Raspberry Pi OS Lite (64-bit) on SD card. Enable SSH, I2C, SPI, UART via raspi-config.' },
  { step: 2, title: 'Install Dependencies', content: 'sudo apt update && sudo apt install -y cmake g++ python3-dev python3-pip python3-venv pybind11-dev' },
  { step: 3, title: 'Transfer Files', content: 'scp -r jt-zero/ backend/ frontend/ pi@<PI_IP>:~/jt-zero/' },
  { step: 4, title: 'Build C++ Runtime', content: 'cd ~/jt-zero/jt-zero && mkdir build && cd build && cmake -DCMAKE_BUILD_TYPE=Release .. && make -j4' },
  { step: 5, title: 'Install Python', content: 'cd ~/jt-zero/backend && python3 -m venv venv && source venv/bin/activate && pip install fastapi uvicorn websockets' },
  { step: 6, title: 'Copy Native Module', content: 'cp ~/jt-zero/jt-zero/build/jtzero_native*.so ~/jt-zero/backend/' },
  { step: 7, title: 'Run', content: 'cd ~/jt-zero/backend && source venv/bin/activate && uvicorn server:app --host 0.0.0.0 --port 8001' },
  { step: 8, title: 'Auto-start (systemd)', content: 'Create /etc/systemd/system/jtzero.service, enable and start.' },
];

const HARDWARE_REQS = [
  { item: 'Raspberry Pi Zero 2 W', status: 'required', note: 'Also compatible: Pi 3B+, Pi 4, Pi 5' },
  { item: 'MPU6050 IMU', status: 'optional', note: 'I2C address 0x68. Falls back to simulation.' },
  { item: 'BMP280 Barometer', status: 'optional', note: 'I2C address 0x76. Falls back to simulation.' },
  { item: 'GPS Module (NMEA)', status: 'optional', note: 'UART /dev/ttyS0 @ 9600 baud' },
  { item: 'Rangefinder (TFmini)', status: 'optional', note: 'I2C or UART' },
  { item: 'Optical Flow (PMW3901)', status: 'optional', note: 'SPI' },
  { item: 'Pi Camera v2/v3', status: 'optional', note: 'CSI. Falls back to simulated camera.' },
];

export default function DocumentationTab() {
  const [section, setSection] = useState('install');

  const sections = [
    { id: 'install', label: 'Pi Zero Install', icon: Download },
    { id: 'api', label: 'API Reference', icon: Server },
    { id: 'threads', label: 'Thread Model', icon: Cpu },
    { id: 'files', label: 'File Structure', icon: FileText },
    { id: 'hardware', label: 'Hardware', icon: HardDrive },
  ];

  return (
    <div className="h-full flex" data-testid="docs-tab">
      {/* Section nav */}
      <div className="w-44 shrink-0 bg-[#0A0C10] border-r border-[#1E293B] p-2 space-y-0.5">
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            data-testid={`doc-section-${id}`}
            onClick={() => setSection(id)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-[10px] font-semibold uppercase tracking-wider transition-all ${
              section === id
                ? 'bg-[#00F0FF]/10 text-[#00F0FF] border-l-2 border-[#00F0FF]'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/3'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 p-4 overflow-y-auto">
        {section === 'install' && <InstallSection />}
        {section === 'api' && <APISection />}
        {section === 'threads' && <ThreadsSection />}
        {section === 'files' && <FilesSection />}
        {section === 'hardware' && <HardwareSection />}
      </div>
    </div>
  );
}

function InstallSection() {
  return (
    <div className="max-w-3xl space-y-4" data-testid="install-section">
      <h2 className="text-base font-bold text-[#00F0FF] uppercase tracking-wider">
        Pi Zero 2 W Installation Guide
      </h2>
      <p className="text-xs text-slate-400">
        JT-Zero can run on Raspberry Pi Zero 2 W natively. All sensor drivers auto-detect hardware
        and fall back to simulation if not connected.
      </p>
      <div className="space-y-3">
        {PI_INSTALL_STEPS.map(({ step, title, content }) => (
          <div key={step} className="flex gap-3 p-3 bg-[#0A0C10] border border-[#1E293B] rounded-sm">
            <div className="w-6 h-6 shrink-0 flex items-center justify-center rounded-full bg-[#00F0FF]/10 text-[#00F0FF] text-[10px] font-bold">
              {step}
            </div>
            <div>
              <h4 className="text-[11px] font-bold text-slate-200 uppercase tracking-wider">{title}</h4>
              <p className="text-[10px] text-slate-400 mt-0.5 font-mono">{content}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-sm">
        <p className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider mb-1">Cross-Compilation (from x86 host)</p>
        <code className="text-[9px] text-slate-400 font-mono block">
          cmake -DCMAKE_TOOLCHAIN_FILE=../toolchain-pi-zero.cmake -DCMAKE_BUILD_TYPE=Release .. && make -j$(nproc)
        </code>
      </div>
    </div>
  );
}

function APISection() {
  return (
    <div className="max-w-4xl space-y-3" data-testid="api-section">
      <h2 className="text-base font-bold text-[#00F0FF] uppercase tracking-wider">API Reference</h2>
      <div className="border border-[#1E293B] rounded-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-[#0A0C10] text-[9px] text-slate-500 uppercase tracking-wider">
              <th className="text-left px-3 py-2 w-16">Method</th>
              <th className="text-left px-3 py-2 w-52">Endpoint</th>
              <th className="text-left px-3 py-2">Description</th>
            </tr>
          </thead>
          <tbody>
            {API_ENDPOINTS.map(({ method, path, desc }, i) => (
              <tr key={i} className="border-t border-[#1E293B]/50 hover:bg-white/2">
                <td className="px-3 py-1.5">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-sm border ${
                    method === 'GET' ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5' :
                    method === 'POST' ? 'text-amber-400 border-amber-500/20 bg-amber-500/5' :
                    'text-purple-400 border-purple-500/20 bg-purple-500/5'
                  }`}>{method}</span>
                </td>
                <td className="px-3 py-1.5 text-[10px] text-cyan-400 font-mono">{path}</td>
                <td className="px-3 py-1.5 text-[10px] text-slate-400">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ThreadsSection() {
  return (
    <div className="max-w-3xl space-y-3" data-testid="threads-section">
      <h2 className="text-base font-bold text-[#00F0FF] uppercase tracking-wider">Thread Model</h2>
      <p className="text-xs text-slate-400">8 dedicated threads with RT priorities. Reflex (T3) has highest priority for safety-critical reactions.</p>
      <div className="border border-[#1E293B] rounded-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-[#0A0C10] text-[9px] text-slate-500 uppercase tracking-wider">
              <th className="text-left px-3 py-2">Thread</th>
              <th className="text-left px-3 py-2">Function</th>
              <th className="text-left px-3 py-2">Rate</th>
              <th className="text-left px-3 py-2">CPU Core</th>
              <th className="text-left px-3 py-2">RT Priority</th>
            </tr>
          </thead>
          <tbody>
            {THREAD_MODEL.map(({ id, name, hz, core, prio }) => (
              <tr key={id} className="border-t border-[#1E293B]/50">
                <td className="px-3 py-1.5 text-[10px] text-[#00F0FF] font-bold font-mono">{id}</td>
                <td className="px-3 py-1.5 text-[10px] text-slate-300">{name}</td>
                <td className="px-3 py-1.5 text-[10px] text-emerald-400 font-mono tabular-nums">{hz}</td>
                <td className="px-3 py-1.5 text-[10px] text-slate-400">{core >= 0 ? `Core ${core}` : 'Any'}</td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 rounded-full bg-[#00F0FF]/20" style={{ width: `${prio}%`, maxWidth: '60px' }}>
                      <div className="h-full rounded-full bg-[#00F0FF]" />
                    </div>
                    <span className="text-[9px] text-slate-500 tabular-nums">{prio}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilesSection() {
  return (
    <div className="max-w-3xl space-y-3" data-testid="files-section">
      <h2 className="text-base font-bold text-[#00F0FF] uppercase tracking-wider">File Structure</h2>
      <div className="bg-[#0A0C10] border border-[#1E293B] rounded-sm p-3 font-mono text-[10px]">
        {FILE_TREE.map(dir => (
          <div key={dir.path} className="mb-2">
            <div className="text-amber-400 font-bold">{dir.path}</div>
            {dir.children?.map(f => (
              <div key={f.path} className="flex items-center gap-2 pl-4 py-0.5">
                <ChevronRight className="w-2.5 h-2.5 text-slate-700" />
                <span className={f.type === 'dir' ? 'text-amber-400/70' : 'text-cyan-400'}>{f.path}</span>
                <span className="text-slate-600 text-[9px]">{f.desc}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function HardwareSection() {
  return (
    <div className="max-w-3xl space-y-3" data-testid="hardware-section">
      <h2 className="text-base font-bold text-[#00F0FF] uppercase tracking-wider">Hardware Requirements</h2>
      <div className="border border-[#1E293B] rounded-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-[#0A0C10] text-[9px] text-slate-500 uppercase tracking-wider">
              <th className="text-left px-3 py-2">Component</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {HARDWARE_REQS.map(({ item, status, note }, i) => (
              <tr key={i} className="border-t border-[#1E293B]/50">
                <td className="px-3 py-1.5 text-[10px] text-slate-200 font-semibold">{item}</td>
                <td className="px-3 py-1.5">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-sm border ${
                    status === 'required'
                      ? 'text-amber-400 border-amber-500/20 bg-amber-500/5'
                      : 'text-slate-400 border-slate-500/20 bg-slate-500/5'
                  }`}>{status.toUpperCase()}</span>
                </td>
                <td className="px-3 py-1.5 text-[10px] text-slate-400">{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="p-3 bg-[#0A0C10] border border-[#1E293B] rounded-sm space-y-2">
        <h4 className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">System Constraints</h4>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'CPU Target', value: '<= 65%', actual: '~3%' },
            { label: 'RAM Target', value: '<= 300MB', actual: '~1MB' },
            { label: 'Threads', value: '8', actual: '8/8' },
          ].map(({ label, value, actual }) => (
            <div key={label} className="text-center">
              <div className="text-[9px] text-slate-600 uppercase">{label}</div>
              <div className="text-[11px] text-[#00F0FF] font-bold">{value}</div>
              <div className="text-[9px] text-emerald-400">Actual: {actual}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
