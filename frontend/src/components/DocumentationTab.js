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
    content: 'Скопіюйте .so в backend, створіть venv та встановіть FastAPI.',
    cmd: 'cp ~/jt-zero/jt-zero/build/jtzero_native*.so ~/jt-zero/backend/ && cd ~/jt-zero/backend && python3 -m venv venv && source venv/bin/activate && pip install fastapi uvicorn websockets' },
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
        {section === 'install' && <InstallSection />}
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

function InstallSection() {
  return (
    <div className="max-w-3xl space-y-4" data-testid="install-section">
      <h2 className="text-base font-bold text-[#00F0FF] uppercase tracking-wider">
        Raspberry Pi Zero 2 W — Installation
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
  { fc: 'Matek H743-SLIM V3', uart: 'UART6', pins: 'TX6 / RX6', serial: 'SERIAL6', rec: true },
  { fc: 'SpeedyBee F405 V4', uart: 'UART4', pins: 'TX4 / RX4', serial: 'SERIAL4', rec: false },
  { fc: 'Pixhawk 2.4.8', uart: 'TELEM2', pins: 'Pin 2(TX) / Pin 3(RX)', serial: 'SERIAL2', rec: false },
  { fc: 'Cube Orange+', uart: 'TELEM2', pins: 'Pin 2(TX) / Pin 3(RX)', serial: 'SERIAL2', rec: false },
];

const ARDUPILOT_PARAMS = [
  { param: 'SERIALx_PROTOCOL', value: '2', desc: 'MAVLink2 протокол' },
  { param: 'SERIALx_BAUD', value: '921', desc: '921600 бод' },
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

      {/* FC table */}
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
            {FC_CONFIGS.map(({ fc, uart, pins, serial, rec }) => (
              <tr key={fc} className="border-t border-[#1E293B]/50">
                <td className="px-3 py-1.5 text-[10px] text-slate-200 font-semibold">
                  {fc} {rec && <span className="text-[8px] text-emerald-400 ml-1">(рекоменд.)</span>}
                </td>
                <td className="px-3 py-1.5 text-[9px] text-cyan-400 font-mono">{uart}</td>
                <td className="px-3 py-1.5 text-[9px] text-slate-400 font-mono">{pins}</td>
                <td className="px-3 py-1.5 text-[9px] text-amber-400 font-bold">{serial}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ArduPilot params */}
      <div className="bg-[#0A0C10] border border-[#1E293B] rounded-sm p-3 space-y-2">
        <h4 className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">
          Параметри ArduPilot (Mission Planner → Full Parameter List)
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

      {/* Pi .env config */}
      <div className="bg-[#0A0C10] border border-[#1E293B] rounded-sm p-3 space-y-2">
        <h4 className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">
          Налаштування JT-Zero на Pi
        </h4>
        <code className="text-[9px] text-slate-400 font-mono block bg-black/40 px-2 py-1.5 rounded-sm border border-[#1E293B]/50 whitespace-pre leading-relaxed">{
`# /home/pi/jt-zero/backend/.env
MAVLINK_TRANSPORT=serial
MAVLINK_DEVICE=/dev/ttyAMA0
MAVLINK_BAUD=921600`
        }</code>
        <code className="text-[9px] text-cyan-400 font-mono block mt-1">
          sudo systemctl restart jtzero
        </code>
      </div>

      {/* Safety */}
      <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-sm space-y-1">
        <p className="text-[10px] text-red-400 font-semibold uppercase tracking-wider">Безпека</p>
        <ul className="text-[9px] text-slate-400 space-y-0.5 list-disc pl-4">
          <li>Перший тест — БЕЗ пропелерів, з USB живленням</li>
          <li>ЗАВЖДИ майте RC пульт для екстренного перемикання в STABILIZE</li>
          <li>Не підключайте 5V між Pi та FC</li>
          <li>Перевіряйте мультиметром що UART працює на 3.3V</li>
        </ul>
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
