import React, { useState, useEffect, useCallback } from 'react';
import { FileText, Server, Cpu, Terminal, HardDrive, ExternalLink, Download, ChevronRight, Camera, CheckCircle, XCircle, RefreshCw, Zap } from 'lucide-react';

const API_ENDPOINTS = [
  { method: 'GET', path: '/api/health', desc: 'System health + runtime mode + build info' },
  { method: 'GET', path: '/api/state', desc: 'Current drone state (attitude, sensors, motors)' },
  { method: 'GET', path: '/api/events', desc: 'Event log (last N events)' },
  { method: 'GET', path: '/api/telemetry', desc: 'Full telemetry (state + threads + engines)' },
  { method: 'GET', path: '/api/telemetry/history', desc: 'Telemetry history ring buffer' },
  { method: 'GET', path: '/api/threads', desc: 'Thread statistics (8 threads)' },
  { method: 'GET', path: '/api/engines', desc: 'Engine statistics (event, reflex, rule, memory, output)' },
  { method: 'GET', path: '/api/camera', desc: 'Camera pipeline + Visual Odometry stats' },
  { method: 'GET', path: '/api/camera/frame', desc: 'Latest primary camera frame as PNG' },
  { method: 'GET', path: '/api/camera/features', desc: 'Current VO feature positions [{x,y,tracked,response}]' },
  { method: 'GET', path: '/api/cameras', desc: 'All camera slots (PRIMARY CSI + SECONDARY USB Thermal)' },
  { method: 'GET', path: '/api/camera/secondary/stats', desc: 'USB thermal camera stats' },
  { method: 'GET', path: '/api/camera/secondary/frame', desc: 'Thermal camera frame (JPEG/PNG)' },
  { method: 'POST', path: '/api/camera/secondary/capture', desc: 'Trigger thermal camera capture' },
  { method: 'GET', path: '/api/vo/profiles', desc: 'Available VO mode profiles (Light/Balanced/Performance)' },
  { method: 'POST', path: '/api/vo/profile/{id}', desc: 'Switch VO mode at runtime' },
  { method: 'GET', path: '/api/mavlink', desc: 'MAVLink connection state + FC telemetry' },
  { method: 'GET', path: '/api/performance', desc: 'CPU, memory, latency metrics' },
  { method: 'GET', path: '/api/diagnostics', desc: 'Hardware diagnostics (camera, I2C, MAVLink)' },
  { method: 'POST', path: '/api/diagnostics/scan', desc: 'Run fresh hardware diagnostics scan' },
  { method: 'GET', path: '/api/sensors', desc: 'Sensor modes (hardware/mavlink/simulation)' },
  { method: 'GET', path: '/api/simulator/config', desc: 'Current simulator parameters' },
  { method: 'POST', path: '/api/simulator/config', desc: 'Update simulator parameters' },
  { method: 'POST', path: '/api/command', desc: 'Send command (arm, disarm, takeoff, land, rtl, hold, vo_reset)' },
  { method: 'WS', path: '/api/ws/telemetry', desc: 'Real-time telemetry stream (10Hz) with camera, features, mavlink' },
  { method: 'WS', path: '/api/ws/events', desc: 'Event stream' },
];

const THREAD_MODEL = [
  { id: 'T0', name: 'Supervisor — health, battery, failsafe', hz: '10 Hz', core: 0, prio: 90 },
  { id: 'T1', name: 'Sensors — IMU CF filter, gyro bias, pre-integration → T6', hz: '200 Hz', core: 1, prio: 95 },
  { id: 'T2', name: 'Events — lock-free queue dispatch', hz: '200 Hz', core: 2, prio: 85 },
  { id: 'T3', name: 'Reflex — safety reactions <5ms', hz: '200 Hz', core: 2, prio: 98 },
  { id: 'T4', name: 'Rules — behavioral logic (RTL, hold)', hz: '20 Hz', core: 3, prio: 70 },
  { id: 'T5', name: 'MAVLink — TX: VO pos/odom/flow; RX: FC telemetry', hz: '50 Hz', core: 1, prio: 80 },
  { id: 'T6', name: 'Camera — FAST+LK+Kalman EKF VO pipeline', hz: '15 FPS', core: 3, prio: 60 },
  { id: 'T7', name: 'API Bridge — WebSocket/REST for Dashboard', hz: '30 Hz', core: -1, prio: 50 },
];

const FILE_TREE = [
  { path: 'jt-zero/', type: 'dir', children: [
    { path: 'include/jt_zero/', type: 'dir', desc: 'C++ headers (camera.h, runtime.h)' },
    { path: 'core/', type: 'dir', desc: '5 engine implementations + runtime' },
    { path: 'sensors/', type: 'dir', desc: 'Sensor modules (IMU, baro, GPS)' },
    { path: 'camera/', type: 'dir', desc: 'Camera pipeline + VO + VO Fallback' },
    { path: 'mavlink/', type: 'dir', desc: 'MAVLink v2 interface + EKF3 integration' },
    { path: 'drivers/', type: 'dir', desc: 'I2C/SPI/UART + MPU6050/BMP280/GPS' },
    { path: 'api/', type: 'dir', desc: 'pybind11 bindings (python_bindings.cpp)' },
    { path: 'CMakeLists.txt', type: 'file', desc: 'Build system' },
  ]},
  { path: 'backend/', type: 'dir', children: [
    { path: 'server.py', type: 'file', desc: 'FastAPI + WebSocket + static frontend' },
    { path: 'native_bridge.py', type: 'file', desc: 'C++ bridge + VO Fallback monitor + Pillow feature detector' },
    { path: 'simulator.py', type: 'file', desc: 'Python fallback simulator' },
    { path: 'usb_camera.py', type: 'file', desc: 'V4L2 subprocess wrapper for USB thermal cam' },
    { path: 'venv/', type: 'dir', desc: 'Python venv (Pillow, FastAPI, uvicorn)' },
    { path: 'static/', type: 'dir', desc: 'Pre-built React frontend (served by FastAPI)' },
  ]},
  { path: 'frontend/src/', type: 'dir', children: [
    { path: 'App.js', type: 'file', desc: 'Tab navigation + layout' },
    { path: 'components/', type: 'dir', desc: '15 React panels (Camera, Thermal, MAVLink, etc.)' },
    { path: 'hooks/useApi.js', type: 'file', desc: 'WebSocket + REST hooks' },
  ]},
  { path: 'update.sh', type: 'file', children: [
    { path: '', type: 'file', desc: 'Auto-update script (git pull, build C++, install deps, restart)' },
  ]},
];

const PI_INSTALL_STEPS = [
  { step: 1, title: 'Підготовка SD-карти',
    content: 'Завантажте Raspberry Pi Imager. Виберіть "Raspberry Pi OS Lite (64-bit)". В налаштуваннях: hostname "jtzero", SSH увімкнути, Wi-Fi SSID/пароль, user: pi.',
    cmd: 'https://www.raspberrypi.com/software/' },
  { step: 2, title: 'Підключення SSH',
    content: 'Вставте SD-карту в Pi, увімкніть живлення, зачекайте 1-2 хв. Підключіться з комп\'ютера через SSH.',
    cmd: 'ssh pi@jtzero.local' },
  { step: 3, title: 'Налаштування інтерфейсів',
    content: 'Увімкніть I2C, SPI та Serial Port через raspi-config. Serial: login shell = No, hardware = Yes. Потім перезавантажте.',
    cmd: 'sudo raspi-config  # Interface Options → I2C/SPI/Serial → Yes → Finish → Reboot' },
  { step: 4, title: 'Встановлення залежностей',
    content: 'Компілятор, CMake, Python, pybind11, git. Займає 2-5 хвилин.',
    cmd: 'sudo apt update && sudo apt install -y cmake g++ python3-dev python3-pip python3-venv pybind11-dev libatomic1 i2c-tools git' },
  { step: 5, title: 'Завантаження проєкту',
    content: 'Клонуйте репозиторій з GitHub на Pi.',
    cmd: 'git clone https://github.com/iigar/JT_Zero_Core.git ~/jt-zero' },
  { step: 6, title: 'Виправлення для GCC 14',
    content: 'Новий GCC 14 на Pi OS Bookworm вимагає явний include <cstdlib>.',
    cmd: 'sed -i \'10a #include <cstdlib>\' ~/jt-zero/jt-zero/main.cpp' },
  { step: 7, title: 'Збірка C++ Runtime',
    content: 'Збірка на Pi займає 5-10 хв. Жовті warning — нормально, головне немає error.',
    cmd: 'cd ~/jt-zero/jt-zero && rm -rf build && mkdir build && cd build && cmake -DCMAKE_BUILD_TYPE=Release .. && make -j4' },
  { step: 8, title: 'Копіювання модуля + Python',
    content: 'Скопіюйте .so в backend, створіть venv та встановіть FastAPI + Pillow (для VO Fallback).',
    cmd: 'cp ~/jt-zero/jt-zero/build/jtzero_native*.so ~/jt-zero/backend/ && cd ~/jt-zero/backend && python3 -m venv venv && source venv/bin/activate && pip install fastapi uvicorn websockets Pillow' },
  { step: 9, title: 'Перевірка модуля',
    content: 'Якщо бачите OK — C++ рантайм працює. Якщо помилка — система використає Python-симулятор.',
    cmd: 'python3 -c "import jtzero_native; print(\'OK\')"' },
  { step: 10, title: 'Тестовий запуск',
    content: 'Запустіть сервер вручну. Dashboard: http://jtzero.local:8001. Ctrl+C щоб зупинити.',
    cmd: 'uvicorn server:app --host 0.0.0.0 --port 8001' },
  { step: 11, title: 'Автозапуск (systemd)',
    content: 'Створіть systemd сервіс (див. DEPLOYMENT.md). Після цього JT-Zero запускатиметься автоматично.',
    cmd: 'sudo systemctl daemon-reload && sudo systemctl enable jtzero && sudo systemctl start jtzero' },
];

const HARDWARE_REQS = [
  { item: 'Raspberry Pi Zero 2 W', status: 'required', note: 'Also compatible: Pi 3B+, Pi 4, Pi 5' },
  { item: 'Pi Camera v2/v3 (CSI)', status: 'required', note: 'Primary VO camera. Auto-detected (8 known sensors + GENERIC fallback)' },
  { item: 'USB Thermal Camera', status: 'optional', note: 'Secondary camera for VO Fallback in darkness. Via AV-to-USB converter (MS210x)' },
  { item: 'Flight Controller (FC)', status: 'required', note: 'ArduPilot-compatible. Matek H743 recommended. MAVLink2 via UART' },
  { item: 'MPU6050 IMU', status: 'optional', note: 'I2C 0x68. Falls back to MAVLink IMU from FC' },
  { item: 'BMP280 Barometer', status: 'optional', note: 'I2C 0x76. Falls back to MAVLink baro from FC' },
  { item: 'GPS Module (NMEA)', status: 'optional', note: 'UART /dev/ttyS0 @ 9600 baud. FC GPS used if not connected' },
  { item: 'RC Transmitter', status: 'required', note: 'Safety: manual override via STABILIZE mode switch' },
];

export default function DocumentationTab() {
  const [section, setSection] = useState('quickstart');

  const sections = [
    { id: 'quickstart', label: 'Quick Start', icon: Zap },
    { id: 'install', label: 'Pi Zero Install', icon: Download },
    { id: 'camera', label: 'Camera Setup', icon: Camera },
    { id: 'vo_fallback', label: 'VO Fallback', icon: RefreshCw },
    { id: 'fc', label: 'Flight Controller', icon: ExternalLink },
    { id: 'wiring', label: 'Wiring / GPIO', icon: Terminal },
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
        {section === 'quickstart' && <QuickStartSection />}
        {section === 'install' && <InstallSection />}
        {section === 'camera' && <CameraSetupSection />}
        {section === 'vo_fallback' && <VOFallbackSection />}
        {section === 'fc' && <FCSection />}
        {section === 'wiring' && <WiringSection />}
        {section === 'api' && <APISection />}
        {section === 'threads' && <ThreadsSection />}
        {section === 'files' && <FilesSection />}
        {section === 'hardware' && <HardwareSection />}
      </div>
    </div>
  );
}


const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

const CHECKS = [
  { id: 'server', label: 'JT-Zero Server', desc: 'Backend is running and responding', endpoint: '/api/health', validate: d => d?.status === 'ok' },
  { id: 'runtime', label: 'C++ Runtime', desc: 'Native C++ module loaded (not Python simulator)', endpoint: '/api/health', validate: d => d?.mode === 'native' },
  { id: 'camera', label: 'Camera', desc: 'CSI or USB camera detected and streaming', endpoint: '/api/camera', validate: d => d?.camera_open === true },
  { id: 'mavlink', label: 'MAVLink Connection', desc: 'Flight controller connected via UART', endpoint: '/api/mavlink', validate: d => d?.state === 'CONNECTED' },
  { id: 'fc_type', label: 'FC Identified', desc: 'Flight controller type recognized', endpoint: '/api/mavlink', validate: d => d?.fc_autopilot && d.fc_autopilot !== 'Unknown' && d.fc_autopilot !== 'N/A' },
  { id: 'vo', label: 'Visual Odometry', desc: 'VO messages being sent to FC', endpoint: '/api/mavlink', validate: d => (d?.vision_pos_sent || 0) > 0 },
  { id: 'sensors', label: 'IMU Data', desc: 'IMU sensor receiving data (hardware or MAVLink)', endpoint: '/api/sensors', validate: d => d?.imu === 'mavlink' || d?.imu === 'hardware' },
  { id: 'gps', label: 'GPS Fix', desc: 'GPS has valid fix (3D)', endpoint: '/api/state', validate: d => (d?.gps?.fix_type || 0) >= 3 && d?.gps?.satellites >= 4 },
];

function QuickStartSection() {
  const [results, setResults] = useState({});
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState(null);

  const runChecks = useCallback(async () => {
    setChecking(true);
    const newResults = {};
    const endpoints = {};

    for (const check of CHECKS) {
      if (!endpoints[check.endpoint]) {
        try {
          const res = await fetch(`${BACKEND_URL}${check.endpoint}`);
          endpoints[check.endpoint] = await res.json();
        } catch {
          endpoints[check.endpoint] = null;
        }
      }
      const data = endpoints[check.endpoint];
      try {
        newResults[check.id] = { ok: data ? check.validate(data) : false, data };
      } catch {
        newResults[check.id] = { ok: false, data: null };
      }
    }

    setResults(newResults);
    setChecking(false);
    setLastCheck(new Date());
  }, []);

  useEffect(() => { runChecks(); }, [runChecks]);

  const passed = Object.values(results).filter(r => r.ok).length;
  const total = CHECKS.length;

  return (
    <div className="max-w-3xl space-y-4" data-testid="quickstart-section">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-[#00F0FF] uppercase tracking-wider">Quick Start Check</h2>
          <p className="text-xs text-slate-400 mt-1">Automatic system health check. Verifies all components are working.</p>
        </div>
        <button
          onClick={runChecks}
          disabled={checking}
          data-testid="run-checks-btn"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00F0FF]/10 border border-[#00F0FF]/30 rounded-sm text-[10px] text-[#00F0FF] font-bold uppercase tracking-wider hover:bg-[#00F0FF]/20 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />
          {checking ? 'Checking...' : 'Re-check'}
        </button>
      </div>

      {/* Score */}
      <div className="p-4 bg-[#0A0C10] border border-[#1E293B] rounded-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">System Readiness</span>
          <span className={`text-lg font-bold tabular-nums ${passed === total ? 'text-emerald-400' : passed > total / 2 ? 'text-amber-400' : 'text-red-400'}`}>
            {passed}/{total}
          </span>
        </div>
        <div className="h-2 bg-black/50 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${passed === total ? 'bg-emerald-500' : passed > total / 2 ? 'bg-amber-500' : 'bg-red-500'}`}
            style={{ width: `${(passed / total) * 100}%` }}
          />
        </div>
        {lastCheck && (
          <p className="text-[8px] text-slate-600 mt-2">
            Last check: {lastCheck.toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* Check items */}
      <div className="space-y-1.5">
        {CHECKS.map(check => {
          const result = results[check.id];
          const ok = result?.ok;
          const pending = !result && checking;
          return (
            <div key={check.id} data-testid={`check-${check.id}`}
              className={`flex items-center gap-3 p-3 rounded-sm border transition-all ${
                ok ? 'bg-emerald-500/5 border-emerald-500/20' :
                pending ? 'bg-slate-800/30 border-slate-700/30 animate-pulse' :
                result ? 'bg-red-500/5 border-red-500/20' :
                'bg-[#0A0C10] border-[#1E293B]'
              }`}>
              <div className="shrink-0">
                {ok ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : pending ? (
                  <RefreshCw className="w-4 h-4 text-slate-500 animate-spin" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-[11px] font-bold text-slate-200">{check.label}</h4>
                <p className="text-[9px] text-slate-500">{check.desc}</p>
              </div>
              <span className={`text-[9px] font-bold uppercase ${ok ? 'text-emerald-400' : pending ? 'text-slate-600' : 'text-red-400'}`}>
                {ok ? 'PASS' : pending ? '...' : 'FAIL'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Tips based on results */}
      {Object.keys(results).length > 0 && passed < total && (
        <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-sm space-y-2">
          <h4 className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Fix suggestions</h4>
          <div className="space-y-1">
            {!results.server?.ok && (
              <p className="text-[9px] text-slate-400">Server: Check <code className="text-cyan-400">sudo systemctl status jtzero</code></p>
            )}
            {!results.runtime?.ok && results.server?.ok && (
              <p className="text-[9px] text-slate-400">C++ Runtime: Rebuild with <code className="text-cyan-400">cd ~/jt-zero/jt-zero/build && make -j4</code></p>
            )}
            {!results.camera?.ok && results.server?.ok && (
              <p className="text-[9px] text-slate-400">Camera: Check <code className="text-cyan-400">rpicam-hello --list-cameras</code></p>
            )}
            {!results.mavlink?.ok && results.server?.ok && (
              <p className="text-[9px] text-slate-400">MAVLink: Check UART wiring and <code className="text-cyan-400">ls -la /dev/ttyAMA0</code></p>
            )}
            {!results.vo?.ok && results.mavlink?.ok && (
              <p className="text-[9px] text-slate-400">VO: Camera must be working. Check <code className="text-cyan-400">curl localhost:8001/api/camera</code></p>
            )}
            {!results.gps?.ok && (
              <p className="text-[9px] text-slate-400">GPS: Connect GPS module or this is expected for indoor flights</p>
            )}
          </div>
        </div>
      )}

      {passed === total && (
        <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-sm text-center">
          <p className="text-[11px] text-emerald-400 font-bold">All systems operational! Ready for flight testing.</p>
          <p className="text-[9px] text-slate-500 mt-1">Remember: First test WITHOUT propellers!</p>
        </div>
      )}
    </div>
  );
}

function InstallSection() {
  return (
    <div className="max-w-3xl space-y-4" data-testid="install-section">
      {/* UPDATE — the most important workflow */}
      <div className="p-4 bg-emerald-500/5 border-2 border-emerald-500/30 rounded-sm space-y-3">
        <h2 className="text-base font-bold text-emerald-400 uppercase tracking-wider">
          Оновлення системи
        </h2>
        <p className="text-xs text-slate-400 leading-relaxed">
          Якщо JT-Zero вже встановлено на Pi — оновлення займає 1 хвилину.
          Скрипт <span className="text-emerald-400 font-bold">update.sh</span> автоматично:
          перезбирає C++ ядро, встановлює Python залежності (Pillow у venv),
          будує фронтенд, копіює статичні файли та перезапускає сервіс.
        </p>
        <code className="block text-sm text-emerald-400 font-mono bg-black/40 px-3 py-2 rounded-sm border border-emerald-500/20 leading-relaxed whitespace-pre">{
`cd ~/jt-zero
git pull
./update.sh`
        }</code>
        <div className="space-y-1.5 mt-2">
          <p className="text-[9px] text-slate-500">
            <span className="text-emerald-400 font-bold">update.sh</span> виконує:
          </p>
          <div className="grid grid-cols-2 gap-1">
            {[
              'git pull (оновлення коду)',
              'cmake + make -j4 (збірка C++)',
              'venv/bin/pip install Pillow',
              'Копіює .so в backend/',
              'Копіює static/ (frontend)',
              'systemctl restart jtzero',
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-emerald-500/50" />
                <span className="text-[8px] text-slate-500">{item}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[9px] text-slate-600 mt-2">
          Перевірка: <code className="text-cyan-400">sudo journalctl -u jtzero -n 30 --no-pager</code> або
          відкрийте <code className="text-cyan-400">http://jtzero.local:8001</code>
        </p>
      </div>

      {/* FIRST-TIME INSTALLATION */}
      <h2 className="text-base font-bold text-[#00F0FF] uppercase tracking-wider pt-2">
        Перша установка — Raspberry Pi Zero 2 W
      </h2>
      <p className="text-xs text-slate-400 leading-relaxed">
        JT-Zero працює на Raspberry Pi Zero 2 W (BCM2710A1, Cortex-A53 quad-core @ 1GHz) нативно.
        Також сумісний з Pi 3B+, Pi 4, Pi 5. Всі драйвери сенсорів автоматично визначають обладнання
        і переходять у режим симуляції, якщо датчик не підключено.
      </p>

      <div className="space-y-2">
        {PI_INSTALL_STEPS.map(({ step, title, content, cmd }) => (
          <div key={step} className="flex gap-3 p-3 bg-[#0A0C10] border border-[#1E293B] rounded-sm">
            <div className="w-6 h-6 shrink-0 flex items-center justify-center rounded-full bg-[#00F0FF]/10 text-[#00F0FF] text-[10px] font-bold">
              {step}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-[11px] font-bold text-slate-200 uppercase tracking-wider">{title}</h4>
              <p className="text-[10px] text-slate-400 mt-0.5">{content}</p>
              {cmd && (
                <code className="block mt-1.5 text-[9px] text-cyan-400 font-mono bg-black/40 px-2 py-1 rounded-sm border border-[#1E293B]/50 break-all">
                  {cmd}
                </code>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Cross-compilation */}
      <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-sm space-y-2">
        <p className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider">
          Крос-компіляція (з x86 хоста — набагато швидше)
        </p>
        <p className="text-[9px] text-slate-400">
          Замість збірки на Pi (крок 6), можна зібрати на потужному x86 комп'ютері та скопіювати результат:
        </p>
        <code className="text-[9px] text-cyan-400 font-mono block bg-black/40 px-2 py-1 rounded-sm border border-[#1E293B]/50">
          sudo apt install gcc-aarch64-linux-gnu g++-aarch64-linux-gnu{'\n'}
          cmake -DCMAKE_TOOLCHAIN_FILE=../toolchain-pi-zero.cmake -DCMAKE_BUILD_TYPE=Release ..{'\n'}
          make -j$(nproc){'\n'}
          scp jtzero_native*.so pi@jtzero.local:~/jt-zero/backend/
        </code>
      </div>

      {/* systemd service */}
      <div className="p-3 bg-[#0A0C10] border border-[#1E293B] rounded-sm space-y-2">
        <p className="text-[10px] text-slate-300 font-semibold uppercase tracking-wider">
          systemd Service File
        </p>
        <code className="text-[9px] text-slate-400 font-mono block bg-black/40 px-2 py-1.5 rounded-sm border border-[#1E293B]/50 whitespace-pre leading-relaxed">{
`[Unit]
Description=JT-Zero Runtime
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/jt-zero/backend
Environment=PYTHONPATH=/home/pi/jt-zero
ExecStart=/home/pi/jt-zero/backend/venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target`
        }</code>
        <p className="text-[8px] text-slate-600">
          Зберегти як /etc/systemd/system/jtzero.service
        </p>
      </div>
    </div>
  );
}

const CAMERA_STEPS = [
  { step: 1, title: "Підключення камери",
    content: "Вимкніть Pi. Pi Zero 2W має міні-CSI роз'єм (22-pin) — стандартний 15-pin шлейф від Pi 3/4 НЕ підходить! Потрібен перехідник 'Pi Zero Camera Cable'. Вставте шлейф контактами вниз, синьою стороною вгору. Закрийте фіксатор.",
    cmd: null },
  { step: 2, title: "Встановлення libcamera",
    content: "На Bookworm (Pi OS 12) libcamera може бути не встановлена за замовчуванням.",
    cmd: "sudo apt update && sudo apt install -y libcamera-apps libcamera-dev" },
  { step: 3, title: "Перевірка boot config",
    content: "Переконайтесь що camera_auto_detect=1 є в конфігурації.",
    cmd: "grep -i camera /boot/firmware/config.txt\n# Якщо немає:\necho 'camera_auto_detect=1' | sudo tee -a /boot/firmware/config.txt" },
  { step: 4, title: "Перезавантаження",
    content: "Після зміни boot config потрібне перезавантаження.",
    cmd: "sudo reboot" },
  { step: 5, title: "Перевірка камери",
    content: "Перевірте що libcamera бачить камеру. На Pi OS Trixie/Bookworm команди починаються з rpicam- (не libcamera-).",
    cmd: "rpicam-hello --list-cameras\n# Маєте побачити список камер (ov5647/imx219/imx708)\nrpicam-hello --timeout 2000" },
  { step: 6, title: "Тестове фото",
    content: "Якщо rpicam-hello працює — зробіть фото для перевірки якості.",
    cmd: "rpicam-still -o test.jpg && ls -la test.jpg" },
];

const CAMERA_TROUBLESHOOT = [
  { problem: "libcamera-hello: command not found", solution: "На Pi OS Trixie/Bookworm команди перейменовані: rpicam-hello, rpicam-still, rpicam-vid" },
  { problem: "vcgencmd get_camera → detected=0", solution: "Перевірте шлейф і boot config. Для Pi Camera v3: додайте dtoverlay=imx708 в config.txt" },
  { problem: "Немає /dev/video0", solution: "Камера не підключена або шлейф пошкоджений. Перевірте: dmesg | grep -i camera" },
  { problem: "raspi-config не має пункту Camera", solution: "Це нормально для Bookworm. Камера увімкнена через camera_auto_detect=1 в config.txt" },
  { problem: "Зображення темне/розмите", solution: "Pi Camera v2: фокус фіксований. v3: має автофокус. Перевірте освітлення." },
];

function CameraSetupSection() {
  return (
    <div className="max-w-3xl space-y-4" data-testid="camera-setup-section">
      <h2 className="text-base font-bold text-[#00F0FF] uppercase tracking-wider">
        Camera Setup
      </h2>
      <p className="text-xs text-slate-400 leading-relaxed">
        JT-Zero підтримує Pi Camera (CSI) та USB веб-камери. Камера потрібна для Visual Odometry —
        визначення позиції дрона за допомогою комп'ютерного зору (без GPS).
      </p>

      {/* CSI vs USB */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#0A0C10] border border-emerald-500/20 rounded-sm p-3">
          <h4 className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider mb-2">Pi Camera (CSI) — рекомендовано</h4>
          <ul className="text-[9px] text-slate-400 space-y-1 list-disc pl-3">
            <li>Pi Camera v2 (IMX219) або v3 (IMX708)</li>
            <li>Підключається через міні-CSI шлейф</li>
            <li>Низька затримка, апаратне кодування</li>
            <li>320x240 grayscale для VO pipeline</li>
          </ul>
        </div>
        <div className="bg-[#0A0C10] border border-amber-500/20 rounded-sm p-3">
          <h4 className="text-[10px] text-amber-400 font-bold uppercase tracking-wider mb-2">USB Camera — альтернатива</h4>
          <ul className="text-[9px] text-slate-400 space-y-1 list-disc pl-3">
            <li>Будь-яка UVC-сумісна камера</li>
            <li>Через micro-USB OTG адаптер</li>
            <li>Більша затримка ніж CSI</li>
            <li>Простіше підключення</li>
          </ul>
        </div>
      </div>

      {/* Mini-CSI warning */}
      <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-sm">
        <p className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider mb-1">Pi Zero 2W — Міні-CSI!</p>
        <p className="text-[9px] text-slate-400">
          Pi Zero 2W має <span className="text-amber-400 font-bold">22-pin міні-CSI</span> роз'єм (менший за стандартний 15-pin).
          Стандартний шлейф від Pi 3/4 <span className="text-red-400 font-bold">НЕ підходить</span>!
          Потрібен перехідний шлейф "Pi Zero Camera Cable" (22→15 pin) або "Raspberry Pi Zero Camera Adapter".
        </p>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {CAMERA_STEPS.map(({ step, title, content, cmd }) => (
          <div key={step} className="flex gap-3 p-3 bg-[#0A0C10] border border-[#1E293B] rounded-sm">
            <div className="w-6 h-6 shrink-0 flex items-center justify-center rounded-full bg-[#00F0FF]/10 text-[#00F0FF] text-[10px] font-bold">
              {step}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-[11px] font-bold text-slate-200 uppercase tracking-wider">{title}</h4>
              <p className="text-[10px] text-slate-400 mt-0.5">{content}</p>
              {cmd && (
                <code className="block mt-1.5 text-[9px] text-cyan-400 font-mono bg-black/40 px-2 py-1 rounded-sm border border-[#1E293B]/50 whitespace-pre-wrap break-all">
                  {cmd}
                </code>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* USB alternative */}
      <div className="bg-[#0A0C10] border border-[#1E293B] rounded-sm p-3 space-y-2">
        <h4 className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">USB камера (альтернатива)</h4>
        <p className="text-[9px] text-slate-400">Підключіть камеру через micro-USB OTG адаптер:</p>
        <code className="text-[9px] text-cyan-400 font-mono block bg-black/40 px-2 py-1 rounded-sm border border-[#1E293B]/50 whitespace-pre leading-relaxed">{
`ls /dev/video*          # Пошук відео-пристроїв
v4l2-ctl --list-devices # Детальна інформація
# JT-Zero автоматично визначить USB камеру`
        }</code>
      </div>

      {/* Troubleshooting */}
      <div className="border border-[#1E293B] rounded-sm overflow-hidden">
        <div className="bg-[#0A0C10] px-3 py-2">
          <h4 className="text-[10px] text-red-400 font-bold uppercase tracking-wider">Вирішення проблем з камерою</h4>
        </div>
        <div className="divide-y divide-[#1E293B]/50">
          {CAMERA_TROUBLESHOOT.map(({ problem, solution }, i) => (
            <div key={i} className="px-3 py-2">
              <p className="text-[10px] text-slate-200 font-semibold">{problem}</p>
              <p className="text-[9px] text-slate-400 mt-0.5">{solution}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Auto-detection */}
      <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-sm">
        <p className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider mb-1">Автоматичне визначення</p>
        <p className="text-[9px] text-slate-400">
          JT-Zero при запуску автоматично сканує: <span className="text-cyan-400">CSI → USB → Симуляція</span>.
          Якщо камера працює з libcamera-hello — JT-Zero її побачить. Жодного додаткового налаштування не потрібно.
        </p>
      </div>
    </div>
  );
}



function VOFallbackSection() {
  return (
    <div className="max-w-3xl space-y-4" data-testid="vo-fallback-section">
      <h2 className="text-base font-bold text-[#00F0FF] uppercase tracking-wider">
        VO Fallback — USB Thermal Camera
      </h2>
      <p className="text-xs text-slate-400 leading-relaxed">
        Коли основна CSI камера втрачає можливість трекінгу (повна темрява, туман, закрита лінза),
        JT-Zero автоматично перемикається на USB термальну камеру для Visual Odometry.
      </p>

      {/* How it works */}
      <div className="bg-[#0A0C10] border border-[#1E293B] rounded-sm p-3 space-y-3">
        <h4 className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider">Як працює</h4>
        <div className="space-y-2">
          {[
            { step: '1', title: 'Моніторинг яскравості', desc: 'Кожні 0.1с система перевіряє середню яскравість кадру CSI камери (rolling average, 10 samples).' },
            { step: '2', title: 'Тригер: темрява', desc: 'Якщо avg_brightness < 20 протягом 0.8с — CSI камера вважається "сліпою". Confidence НЕ використовується (FAST детектор трекає шум у темряві).' },
            { step: '3', title: 'Перемикання на USB', desc: 'Python захоплює MJPEG з USB камери → Pillow конвертує в grayscale 320x240 → inject_frame() передає в C++ VO pipeline.' },
            { step: '4', title: 'Детекція фіч', desc: 'Pillow Sobel corner detector знаходить реальні кути/краї на термальному зображенні для візуалізації на Dashboard.' },
            { step: '5', title: 'Відновлення CSI', desc: 'Кожні 3с система перевіряє CSI зондом. Якщо яскравість повернулась — автоматичне перемикання назад (з 5с cooldown).' },
          ].map(({ step, title, desc }) => (
            <div key={step} className="flex gap-3">
              <div className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full bg-[#00F0FF]/10 text-[#00F0FF] text-[9px] font-bold">{step}</div>
              <div>
                <span className="text-[10px] text-slate-200 font-bold">{title}</span>
                <p className="text-[9px] text-slate-500 mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Architecture diagram */}
      <div className="bg-[#0A0C10] border border-[#1E293B] rounded-sm p-3">
        <h4 className="text-[10px] text-slate-300 font-bold uppercase tracking-wider mb-2">Архітектура (Hybrid Python/C++)</h4>
        <pre className="text-[8px] font-mono text-slate-400 leading-relaxed">{
`  USB Thermal Camera (MJPEG ~5fps)
       │
       ▼
  usb_camera.py ─── v4l2-ctl subprocess (batch capture)
       │
       ▼
  native_bridge.py ─── Pillow: JPEG → grayscale → 320x240
       │                    │
       │               Pillow Sobel corner detector
       │                    │
       │               Python features → /api/camera/features
       ▼
  C++ inject_frame() ─── VO pipeline (FAST + LK + Kalman EKF)
       │
       ▼
  MAVLink VISION_POSITION_ESTIMATE → ArduPilot EKF3`
        }</pre>
      </div>

      {/* IMU-VO Fusion */}
      <div className="bg-[#0A0C10] border border-[#00F0FF]/20 rounded-sm p-3 space-y-2">
        <h4 className="text-[10px] text-[#00F0FF] font-bold uppercase tracking-wider">IMU-VO Fusion Pipeline</h4>
        <p className="text-[9px] text-slate-400">
          T1 (200Hz) та T6 (15fps) синхронізуються через mutex-захищений PreIntState:
        </p>
        <pre className="text-[9px] text-cyan-400 font-mono bg-black/40 px-2 py-2 rounded-sm border border-[#1E293B]/50 overflow-x-auto whitespace-pre leading-relaxed">{
`T1 (200Hz):  CF filter → roll/pitch  (α=0.98, gyro+accel)
             gyro_z bias EMA          (gate: !armed, |gyro|<0.05)
             accumulate_gyro()        (mutex → PreIntState)
             set_imu_hint(ax,ay,gz)   (for T6 Kalman predict)
                  ↓ mutex / atomic
T6 (15fps):  read PreIntState  →  shift_x = focal × dgz
                                   shift_y = −focal × dgy
             LK track(hint_dx, hint_dy)   ← flow starts at IMU prediction
             Phase 2: kf_v += imu_ax × dt  (IMU predict step)
                      Kalman update (VO measurement)
             Phase 3: ΔV_VO vs ΔV_IMU  → imu_consistency
             Phase 5: hover gyro_z_bias estimation`
        }</pre>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {[
            { label: 'CF alpha', value: '0.98', desc: 'гіро/акселерометр' },
            { label: 'Bias α (ground)', value: '0.0005', desc: '~30s settling' },
            { label: 'Bias α (hover)', value: '0.005', desc: 'gate |gz|<0.3' },
            { label: 'LK hint gate', value: '>0.3px', desc: 'мін зсув' },
          ].map(({ label, value, desc }) => (
            <div key={label} className="flex items-center gap-2">
              <code className="text-[9px] text-cyan-400 font-mono w-28">{label}</code>
              <span className="text-[9px] text-amber-400 font-bold w-16">{value}</span>
              <span className="text-[8px] text-slate-500">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* SET HOMEPOINT */}
      <div className="bg-[#0A0C10] border border-amber-500/20 rounded-sm p-3 space-y-2">
        <h4 className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">SET HOMEPOINT (VO Reset)</h4>
        <p className="text-[9px] text-slate-400">
          Кнопка <span className="text-amber-400 font-bold">SET HOMEPOINT</span> на вкладці MAVLink скидає VO позицію на (0,0,0).
          Поточне місце стає "домом". Це корисно перед зльотом або після переміщення дрона.
        </p>
        <code className="text-[9px] text-cyan-400 font-mono block bg-black/40 px-2 py-1 rounded-sm border border-[#1E293B]/50">
          {`curl -X POST http://jtzero.local:8001/api/command -H "Content-Type: application/json" -d '{"command":"vo_reset"}'`}
        </code>
      </div>

      {/* Configuration */}
      <div className="bg-[#0A0C10] border border-[#1E293B] rounded-sm p-3 space-y-2">
        <h4 className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">Параметри</h4>
        <div className="space-y-0.5">
          {[
            { param: 'BRIGHT_DROP', value: '20', desc: 'Тригер: avg brightness нижче цього = темрява' },
            { param: 'WINDOW_SIZE', value: '10', desc: 'Кількість samples для rolling average (1с при 10Hz)' },
            { param: 'MIN_SAMPLES', value: '8', desc: 'Мінімум samples перед прийняттям рішення' },
            { param: 'MIN_FALLBACK_S', value: '3', desc: 'Мінімальний час у fallback перед перевіркою CSI' },
            { param: 'COOLDOWN_S', value: '5', desc: 'Cooldown після повернення на CSI' },
            { param: 'INJECT_W x H', value: '320x240', desc: 'Роздільність кадру для VO injection' },
          ].map(({ param, value, desc }) => (
            <div key={param} className="flex items-center gap-2 py-0.5">
              <code className="text-[9px] text-cyan-400 font-mono w-32">{param}</code>
              <span className="text-[9px] text-amber-400 font-bold w-14">{value}</span>
              <span className="text-[8px] text-slate-500">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* USB Thermal Setup */}
      <div className="bg-[#0A0C10] border border-[#1E293B] rounded-sm p-3 space-y-2">
        <h4 className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">USB Thermal Camera Setup</h4>
        <p className="text-[9px] text-slate-400">
          JT-Zero автоматично знаходить USB камеру через <code className="text-cyan-400">v4l2-ctl --list-devices</code>.
          Працює з AV-to-USB конвертерами (MS210x, EasyCap) та Caddx Thermal.
        </p>
        <code className="text-[9px] text-cyan-400 font-mono block bg-black/40 px-2 py-1 rounded-sm border border-[#1E293B]/50 whitespace-pre leading-relaxed">{
`# Перевірити USB камеру:
v4l2-ctl --list-devices
v4l2-ctl -d /dev/video1 --list-formats-ext

# Тест MJPEG:
v4l2-ctl -d /dev/video1 --set-fmt-video=width=640,height=480,pixelformat=MJPG \\
  --stream-mmap --stream-count=1 --stream-to=test.jpg
ls -la test.jpg  # має бути >0 bytes`
        }</code>
      </div>

      {/* Dependencies */}
      <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-sm">
        <p className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider mb-1">Python залежності (venv)</p>
        <p className="text-[9px] text-slate-400">
          Сервіс працює в <span className="text-amber-400 font-bold">venv</span> (<code className="text-cyan-400">backend/venv/</code>).
          Pillow ОБОВ'ЯЗКОВО встановлювати в venv, не в системний Python:
        </p>
        <code className="text-[9px] text-cyan-400 font-mono block mt-1 bg-black/40 px-2 py-1 rounded-sm border border-[#1E293B]/50">
          ~/jt-zero/backend/venv/bin/pip install Pillow
        </code>
        <p className="text-[8px] text-slate-600 mt-1">
          update.sh робить це автоматично. <code className="text-cyan-400">apt install python3-pil</code> НЕ працює для venv.
        </p>
      </div>
    </div>
  );
}


const GPIO_WIRING = [
  { sensor: 'MPU6050 (IMU)', pin_sda: 'GPIO 2 (Pin 3)', pin_scl: 'GPIO 3 (Pin 5)', pin_extra: 'VCC: 3.3V (Pin 1), GND: Pin 6', bus: 'I2C-1', addr: '0x68' },
  { sensor: 'BMP280 (Baro)', pin_sda: 'GPIO 2 (Pin 3)', pin_scl: 'GPIO 3 (Pin 5)', pin_extra: 'VCC: 3.3V (Pin 1), GND: Pin 9', bus: 'I2C-1', addr: '0x76' },
  { sensor: 'GPS (NMEA)', pin_sda: 'TX→GPIO 15 (Pin 10)', pin_scl: 'RX→GPIO 14 (Pin 8)', pin_extra: 'VCC: 3.3V, GND', bus: 'UART0', addr: '9600 baud' },
  { sensor: 'PMW3901 (Flow)', pin_sda: 'MOSI: GPIO 10 (Pin 19)', pin_scl: 'MISO: GPIO 9 (Pin 21)', pin_extra: 'SCLK: GPIO 11 (Pin 23), CS: GPIO 8 (Pin 24)', bus: 'SPI0', addr: 'CS0' },
];

function WiringSection() {
  return (
    <div className="max-w-4xl space-y-4" data-testid="wiring-section">
      <h2 className="text-base font-bold text-[#00F0FF] uppercase tracking-wider">GPIO Wiring Guide</h2>
      <p className="text-xs text-slate-400 leading-relaxed">
        Підключення сенсорів до Raspberry Pi Zero 2 W. Всі сенсори працюють від 3.3V.
        I2C пристрої можна підключати до однієї шини (SDA/SCL спільні).
      </p>

      <div className="border border-[#1E293B] rounded-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-[#0A0C10] text-[9px] text-slate-500 uppercase tracking-wider">
              <th className="text-left px-3 py-2">Sensor</th>
              <th className="text-left px-3 py-2">Data Lines</th>
              <th className="text-left px-3 py-2">Clock / RX</th>
              <th className="text-left px-3 py-2">Extra</th>
              <th className="text-left px-3 py-2">Bus</th>
              <th className="text-left px-3 py-2">Address</th>
            </tr>
          </thead>
          <tbody>
            {GPIO_WIRING.map(({ sensor, pin_sda, pin_scl, pin_extra, bus, addr }) => (
              <tr key={sensor} className="border-t border-[#1E293B]/50">
                <td className="px-3 py-1.5 text-[10px] text-slate-200 font-semibold">{sensor}</td>
                <td className="px-3 py-1.5 text-[9px] text-cyan-400 font-mono">{pin_sda}</td>
                <td className="px-3 py-1.5 text-[9px] text-cyan-400 font-mono">{pin_scl}</td>
                <td className="px-3 py-1.5 text-[9px] text-slate-500 font-mono">{pin_extra}</td>
                <td className="px-3 py-1.5 text-[9px] text-amber-400 font-bold">{bus}</td>
                <td className="px-3 py-1.5 text-[9px] text-emerald-400 font-mono">{addr}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ASCII diagram */}
      <div className="bg-[#0A0C10] border border-[#1E293B] rounded-sm p-3">
        <h4 className="text-[10px] text-slate-300 font-bold uppercase tracking-wider mb-2">Pi Zero 2 W — GPIO Header (Pin 1-10)</h4>
        <pre className="text-[9px] text-slate-400 font-mono leading-relaxed">{
`  3V3  (1) (2)  5V
  SDA  (3) (4)  5V        ← I2C: MPU6050 + BMP280
  SCL  (5) (6)  GND
  GP4  (7) (8)  TX (UART) ← GPS RX
  GND  (9) (10) RX (UART) ← GPS TX`
        }</pre>
      </div>

      <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-sm">
        <p className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider mb-1">Auto-detection</p>
        <p className="text-[9px] text-slate-400">
          JT-Zero автоматично сканує I2C шину при запуску. Якщо сенсор не знайдено —
          відповідний канал переходить у режим симуляції. Жодного налаштування не потрібно.
        </p>
      </div>
    </div>
  );
}


const FC_CONFIGS = [
  { fc: 'Matek H743-SLIM V3', uart: 'UART3', pins: 'TX3 / RX3', serial: 'SERIAL4', rec: true },
  { fc: 'SpeedyBee F405 V4', uart: 'UART4', pins: 'TX4 / RX4', serial: 'SERIAL4', rec: false },
  { fc: 'Pixhawk 2.4.8', uart: 'TELEM2', pins: 'Pin 2(TX) / Pin 3(RX)', serial: 'SERIAL2', rec: false },
  { fc: 'Cube Orange+', uart: 'TELEM2', pins: 'Pin 2(TX) / Pin 3(RX)', serial: 'SERIAL2', rec: false },
];

const ARDUPILOT_PARAMS = [
  { param: 'SERIALx_PROTOCOL', value: '2', desc: 'MAVLink2 протокол' },
  { param: 'SERIALx_BAUD', value: '115', desc: '115200 бод' },
  { param: 'VISO_TYPE', value: '1', desc: 'MAVLink vision position' },
  { param: 'EK3_SRC1_POSXY', value: '6', desc: 'ExternalNav (Visual Odometry)' },
  { param: 'EK3_SRC1_VELXY', value: '6', desc: 'ExternalNav velocity' },
  { param: 'EK3_SRC1_POSZ', value: '1', desc: 'Barometer (висота)' },
  { param: 'FLOW_TYPE', value: '1', desc: 'MAVLink optical flow' },
];

function FCSection() {
  return (
    <div className="max-w-4xl space-y-4" data-testid="fc-section">
      <h2 className="text-base font-bold text-[#00F0FF] uppercase tracking-wider">
        Flight Controller Connection
      </h2>
      <p className="text-xs text-slate-400 leading-relaxed">
        JT-Zero працює як companion computer. З'єднується з FC через UART (MAVLink2).
        Pi відправляє Visual Odometry та Optical Flow дані в EKF польотника.
      </p>

      {/* Wiring diagram */}
      <div className="bg-[#0A0C10] border border-[#1E293B] rounded-sm p-3">
        <h4 className="text-[10px] text-slate-300 font-bold uppercase tracking-wider mb-2">
          Підключення (3 дроти)
        </h4>
        <pre className="text-[9px] font-mono leading-relaxed">{
`  Pi Zero 2W                 Flight Controller
  ──────────                 ─────────────────
  `}<span className="text-emerald-400">{`Pin 8  (GPIO14, TX) ──────► RX  (UART порт FC)`}</span>{`
  `}<span className="text-amber-400">{`Pin 10 (GPIO15, RX) ◄────── TX  (UART порт FC)`}</span>{`
  `}<span className="text-slate-500">{`Pin 6  (GND)        ─────── GND (будь-який GND)`}</span>
        </pre>
        <p className="text-[8px] text-red-400 mt-2 font-semibold">
          TX Pi → RX FC (перехресно!). НЕ підключайте 5V між Pi та FC.
        </p>
      </div>

      {/* ═══ MATEK H743-SLIM V3 DETAILED ═══ */}
      <div className="border-2 border-emerald-500/30 rounded-sm overflow-hidden">
        <div className="bg-emerald-500/10 px-3 py-2 flex items-center gap-2">
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm bg-emerald-500/20 border border-emerald-500/30 text-emerald-400">РЕКОМЕНДОВАНО</span>
          <h3 className="text-[11px] text-emerald-400 font-bold uppercase tracking-wider">Matek H743-SLIM V3 — Детальна інструкція</h3>
        </div>
        <div className="p-3 space-y-3">
          <p className="text-[10px] text-slate-400">
            Matek H743-SLIM V3 — один з найкращих FC для роботи з companion computer.
            STM32H743 процесор, 7 UART портів, вбудований барометр DPS310, гіроскоп ICM42688P.
          </p>

          {/* Real hardware images */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-black/30 border border-[#1E293B] rounded-sm p-2">
              <h5 className="text-[8px] text-cyan-400 font-bold uppercase mb-1">Pi Zero 2W — Pinout</h5>
              <img 
                src="https://customer-assets.emergentagent.com/job_005e4ff9-18ff-4dd0-95cc-8a677768a88f/artifacts/8xhhmnsw_Raspberry%20Pi%20Zero%20W%202%20pinout1.png"
                alt="Raspberry Pi Zero 2W pinout"
                className="w-full rounded-sm"
                data-testid="pi-pinout-img"
              />
              <p className="text-[7px] text-slate-500 mt-1">Pin 8 (GPIO14) = TX, Pin 10 (GPIO15) = RX, Pin 6 = GND</p>
            </div>
            <div className="bg-black/30 border border-[#1E293B] rounded-sm p-2">
              <h5 className="text-[8px] text-cyan-400 font-bold uppercase mb-1">Matek H743-SLIM V3</h5>
              <img 
                src="https://customer-assets.emergentagent.com/job_005e4ff9-18ff-4dd0-95cc-8a677768a88f/artifacts/jvm9rhy3_poletnyj-kontroller-matek-h743-slim-v3-3.jpg"
                alt="Matek H743-SLIM V3 board"
                className="w-full rounded-sm"
                data-testid="matek-board-img"
              />
              <p className="text-[7px] text-slate-500 mt-1">TX3/RX3 на нижньому лівому краю плати (поряд з TX2/RX2)</p>
            </div>
          </div>

          {/* Board UART mapping */}
          <div className="bg-black/30 border border-[#1E293B] rounded-sm p-3">
            <h4 className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider mb-2">UART маппінг Matek H743 (ArduPilot)</h4>
            <pre className="text-[8px] text-slate-400 font-mono leading-relaxed">{
`  Matek H743-SLIM V3 — UART → ArduPilot SERIAL
  ──────────────────────────────────────────────
  SERIAL1 = UART7 (TX7/RX7)  — з RTS/CTS
  SERIAL2 = UART1 (TX1/RX1)
  SERIAL3 = UART2 (TX2/RX2)
  `}<span className="text-emerald-400 font-bold">{`SERIAL4 = UART3 (TX3/RX3)  <-- JT-Zero (MAVLink2, 115200)`}</span>{`
  SERIAL5 = UART8
  SERIAL6 = UART4 (TX4/RX4)
  SERIAL7 = UART6 (TX6/RX6)  — за замовч. RCIN`
            }</pre>
          </div>

          {/* Wiring table */}
          <div className="border border-[#1E293B] rounded-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-[#0A0C10] text-[9px] text-slate-500 uppercase tracking-wider">
                  <th className="text-left px-3 py-2">Дріт</th>
                  <th className="text-left px-3 py-2">Від (Pi Zero 2W)</th>
                  <th className="text-left px-3 py-2">До (Matek H743)</th>
                  <th className="text-left px-3 py-2">Колір</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { n: '1', from: 'Pin 8 (GPIO14, TX)', to: 'RX3 (UART3 RX)', color: 'Зелений', colorClass: 'text-emerald-400' },
                  { n: '2', from: 'Pin 10 (GPIO15, RX)', to: 'TX3 (UART3 TX)', color: 'Жовтий', colorClass: 'text-amber-400' },
                  { n: '3', from: 'Pin 6 (GND)', to: 'GND (будь-який)', color: 'Чорний', colorClass: 'text-slate-400' },
                ].map(({ n, from, to, color, colorClass }) => (
                  <tr key={n} className="border-t border-[#1E293B]/50">
                    <td className="px-3 py-1.5 text-[10px] text-slate-400 font-bold">{n}</td>
                    <td className="px-3 py-1.5 text-[10px] text-cyan-400 font-mono">{from}</td>
                    <td className="px-3 py-1.5 text-[10px] text-emerald-400 font-mono">{to}</td>
                    <td className={`px-3 py-1.5 text-[10px] font-bold ${colorClass}`}>{color}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ArduPilot params for Matek */}
          <div className="bg-black/30 border border-[#1E293B] rounded-sm p-3 space-y-2">
            <h4 className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">
              ArduPilot параметри для Matek H743 SERIAL4 (UART3)
            </h4>
            <p className="text-[8px] text-slate-500">
              Mission Planner → Config/Tuning → Full Parameter List
            </p>
            <code className="text-[9px] font-mono block bg-black/40 px-2 py-1.5 rounded-sm border border-[#1E293B]/50 whitespace-pre leading-relaxed">{
`# === SERIAL4 (UART3) — Companion Computer (JT-Zero) ===
SERIAL4_PROTOCOL = 2          # MAVLink2
SERIAL4_BAUD     = 115        # 115200 бод

# === EKF — приймати Visual Odometry ===
VISO_TYPE        = 1          # MAVLink vision position
EK3_SRC1_POSXY   = 6          # ExternalNav (VO)
EK3_SRC1_VELXY   = 6          # ExternalNav velocity
EK3_SRC1_POSZ    = 1          # Barometer (висота)
EK3_SRC1_YAW     = 1          # Compass

# === Optical Flow (опціонально) ===
FLOW_TYPE        = 1          # MAVLink optical flow

# === System ===
SYSID_THISMAV    = 1          # System ID`
            }</code>
            <p className="text-[8px] text-amber-400 font-semibold">
              Після зміни: Write Params → перезавантажте FC
            </p>
          </div>

          {/* JT-Zero config */}
          <div className="bg-black/30 border border-[#1E293B] rounded-sm p-3 space-y-2">
            <h4 className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider">
              Конфігурація JT-Zero на Pi
            </h4>
            <code className="text-[9px] font-mono block bg-black/40 px-2 py-1.5 rounded-sm border border-[#1E293B]/50 whitespace-pre leading-relaxed">{
`# Відредагуйте /home/pi/jt-zero/backend/.env:
MAVLINK_TRANSPORT=serial
MAVLINK_DEVICE=/dev/ttyAMA0
MAVLINK_BAUD=115200

# Перезапустіть:
sudo systemctl restart jtzero`
            }</code>
          </div>

          {/* Verification steps */}
          <div className="bg-black/30 border border-[#1E293B] rounded-sm p-3 space-y-2">
            <h4 className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
              Перевірка з'єднання
            </h4>
            <code className="text-[9px] font-mono block bg-black/40 px-2 py-1.5 rounded-sm border border-[#1E293B]/50 whitespace-pre leading-relaxed">{
`# 1. Перевірити UART:
ls -la /dev/ttyAMA0

# 2. Логи JT-Zero:
journalctl -u jtzero -f
# Маєте побачити: [MAVLink] Serial opened: /dev/ttyAMA0 @ 921600

# 3. В Mission Planner → Messages:
# VISION_POSITION_ESTIMATE або Companion heartbeat`
            }</code>
          </div>
        </div>
      </div>

      {/* Other FC table */}
      <div className="space-y-2">
        <h3 className="text-[11px] text-slate-300 font-bold uppercase tracking-wider">Інші контролери</h3>
        <div className="border border-[#1E293B] rounded-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-[#0A0C10] text-[9px] text-slate-500 uppercase tracking-wider">
                <th className="text-left px-3 py-2">Контролер</th>
                <th className="text-left px-3 py-2">UART порт</th>
                <th className="text-left px-3 py-2">Піни на платі</th>
                <th className="text-left px-3 py-2">ArduPilot Serial</th>
              </tr>
            </thead>
            <tbody>
              {FC_CONFIGS.filter(fc => !fc.rec).map(({ fc, uart, pins, serial }) => (
                <tr key={fc} className="border-t border-[#1E293B]/50">
                  <td className="px-3 py-1.5 text-[10px] text-slate-200 font-semibold">{fc}</td>
                  <td className="px-3 py-1.5 text-[9px] text-cyan-400 font-mono">{uart}</td>
                  <td className="px-3 py-1.5 text-[9px] text-slate-400 font-mono">{pins}</td>
                  <td className="px-3 py-1.5 text-[9px] text-amber-400 font-bold">{serial}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ArduPilot params (general) */}
      <div className="bg-[#0A0C10] border border-[#1E293B] rounded-sm p-3 space-y-2">
        <h4 className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">
          Параметри ArduPilot — загальне
        </h4>
        <p className="text-[8px] text-slate-600">
          Замініть "x" на номер вашого Serial (6 для Matek, 4 для SpeedyBee, 2 для Pixhawk)
        </p>
        <div className="space-y-0.5">
          {ARDUPILOT_PARAMS.map(({ param, value, desc }) => (
            <div key={param} className="flex items-center gap-2 py-0.5">
              <code className="text-[9px] text-cyan-400 font-mono w-36">{param}</code>
              <span className="text-[9px] text-amber-400 font-bold w-8">{value}</span>
              <span className="text-[8px] text-slate-500">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Pixhawk TELEM2 pinout */}
      <div className="bg-[#0A0C10] border border-[#1E293B] rounded-sm p-3">
        <h4 className="text-[10px] text-slate-300 font-bold uppercase tracking-wider mb-2">
          Pixhawk / Cube Orange+ — TELEM2 конектор
        </h4>
        <pre className="text-[9px] font-mono text-slate-400 leading-relaxed">{
`  TELEM2 (DF13 або JST-GH):
  ┌─────────────────────────────┐
  │ 1: 5V  (`}<span className="text-red-400">НЕ підключати!</span>{`)     │
  │ 2: TX  → RX Pi (Pin 10)    │
  │ 3: RX  → TX Pi (Pin 8)     │
  │ 4: CTS (не підключати)     │
  │ 5: RTS (не підключати)     │
  │ 6: GND → GND Pi (Pin 6)    │
  └─────────────────────────────┘`
        }</pre>
      </div>

      {/* Safety */}
      <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-sm space-y-1">
        <p className="text-[10px] text-red-400 font-semibold uppercase tracking-wider">Безпека</p>
        <ul className="text-[9px] text-slate-400 space-y-0.5 list-disc pl-4">
          <li>Перший тест — БЕЗ пропелерів, з USB живленням</li>
          <li>ЗАВЖДИ майте RC пульт для екстренного перемикання в STABILIZE</li>
          <li>Не підключайте 5V між Pi та FC</li>
          <li>Перевіряйте мультиметром що UART працює на 3.3V</li>
          <li>Тестуйте спочатку на столі, потім у польоті в LOITER/GUIDED</li>
        </ul>
      </div>

      {/* Full drone diagram */}
      <div className="bg-[#0A0C10] border border-[#1E293B] rounded-sm p-3">
        <h4 className="text-[10px] text-slate-300 font-bold uppercase tracking-wider mb-2">
          Повна схема підключення дрона
        </h4>
        <pre className="text-[8px] font-mono text-slate-400 leading-relaxed">{
`                                ┌─── GPS Module
                                │    (до FC)
                                │
┌──────────────┐    UART    ┌───┴──────────┐   PWM/DShot   ┌─────────┐
│  Pi Zero 2W  │◄──────────►│ Matek H743   │──────────────►│ ESC x4  │
│              │ TX/RX/GND  │ SLIM V3      │               │         │
│  ┌────────┐  │            │ IMU (вбудов.)│               │ Мотори  │
│  │ Pi Cam │  │            │ Баро (вбудов)│               └─────────┘
│  └────────┘  │            │ RC Receiver  │◄── Пульт
│  Wi-Fi ))))  │            └──────────────┘
└──────────────┘
  USB 5V (окремий)          LiPo → BEC 5V`
        }</pre>
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
            { label: 'CPU Target', value: '<= 55%', actual: 'alert 70%' },
            { label: 'RAM Target', value: '<= 180MB', actual: 'alert 250MB' },
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
