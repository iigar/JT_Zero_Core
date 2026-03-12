# CLAUDE.md — JT-Zero Runtime Technical Reference

## Project Overview
JT-Zero is a real-time robotics runtime for lightweight drone autonomy on Raspberry Pi Zero 2 W.

**Architecture:** Multi-threaded C++ core → pybind11 → FastAPI backend → React dashboard

**Runtime Mode:** Native C++ (primary) or Python Simulator (fallback)

---

## Thread Model (8 threads)

| Thread | Name        | Hz    | Function                                           |
|--------|-------------|-------|-----------------------------------------------------|
| T0     | Supervisor  | 10    | System health, battery, failsafe, mode transitions  |
| T1     | Sensors     | 200   | IMU, Baro, GPS, Rangefinder, Optical Flow           |
| T2     | Events      | 200   | Event queue processing, prioritization              |
| T3     | Reflex      | 200   | Reflexes — instant reactions (obstacle avoidance)   |
| T4     | Rules       | 20    | Rules engine — condition-based state transitions    |
| T5     | MAVLink     | 50    | MAVLink v2 communication with flight controller     |
| T6     | Camera      | 15    | Frame capture + Visual Odometry (FAST + LK)        |
| T7     | API Bridge  | 30    | pybind11 ↔ Python data sync                        |

**Thread communication:** Lock-free SPSC ring buffers between threads.  
**Memory:** Lock-free O(1) MemoryPool using CAS (Compare-And-Swap).

---

## Sensor Hardware Auto-Detection

On startup, the runtime probes hardware interfaces:

| Sensor          | Bus     | Address | Auto-detect Method          |
|-----------------|---------|---------|------------------------------|
| MPU6050 (IMU)   | I2C-1   | 0x68    | i2cdetect probe              |
| BMP280 (Baro)   | I2C-1   | 0x76    | i2cdetect probe              |
| NMEA GPS        | UART    | 9600    | /dev/ttyS0 availability      |
| Rangefinder     | I2C/UART| varies  | Bus scan                     |
| PMW3901 (Flow)  | SPI0    | CS0     | SPI device probe             |

**Fallback:** If no hardware detected → automatic simulation mode. No manual config needed.

---

## Camera Pipeline

**Priority cascade:** PI_CSI → USB → Simulation

| Source    | Interface        | Implementation              |
|-----------|------------------|-----------------------------|
| PI_CSI    | /dev/video0      | V4L2 + libcamera, MMAP      |
| USB       | /dev/videoN      | V4L2 YUYV → grayscale       |
| Simulated | In-memory        | Test pattern with features   |

**Visual Odometry:** FAST corner detector + Lucas-Kanade optical flow tracker  
**Resolution:** 320×240 grayscale, 15 FPS target

---

## MAVLink Interface

**Transport cascade:** Serial → UDP → Simulation

| Transport  | Config                    | Use Case                    |
|-----------|----------------------------|-----------------------------|
| Serial    | /dev/ttyAMA0 @ 921600     | Direct FC UART connection   |
| UDP       | 127.0.0.1:14550           | SITL / QGC / MissionPlanner |
| Simulated | In-memory                 | Development & testing       |

**Messages sent:**
- `VISION_POSITION_ESTIMATE` (#102) — accumulated VO pose, NED frame
- `ODOMETRY` (#331) — full 6DOF with quaternion
- `OPTICAL_FLOW_RAD` (#106) — integrated flow + gyro
- `HEARTBEAT` (#0) — 1Hz companion computer heartbeat

---

## API Endpoints

| Method | Path                     | Description                          |
|--------|--------------------------|--------------------------------------|
| GET    | /api/health              | Runtime status, mode, build info     |
| GET    | /api/state               | Full system state (attitude, sensors)|
| GET    | /api/hardware            | Hardware detection status            |
| GET    | /api/events              | Recent event log                     |
| GET    | /api/telemetry/history   | Time-series telemetry data           |
| GET    | /api/threads             | Thread stats (Hz, CPU, iterations)   |
| GET    | /api/engines             | Engine stats (events, reflexes, etc) |
| GET    | /api/camera              | Camera & VO pipeline stats           |
| GET    | /api/mavlink             | MAVLink connection & message stats   |
| GET    | /api/performance         | CPU, memory, latency breakdown       |
| GET    | /api/simulator/config    | Current simulator parameters         |
| POST   | /api/simulator/config    | Update simulator parameters          |
| POST   | /api/command             | Send command (arm, takeoff, land)    |
| WS     | /api/ws/telemetry        | Real-time telemetry @ 10Hz           |

---

## WebSocket Telemetry Payload

```json
{
  "type": "telemetry",
  "timestamp": 1710192000.0,
  "runtime_mode": "native",
  "state": { "roll": 0.5, "pitch": -0.3, "yaw": 45.2, "altitude_agl": 7.0, ... },
  "threads": [ { "name": "T0_Supervisor", "actual_hz": 10.0, "running": true, ... } ],
  "engines": { "events": {...}, "reflexes": {...}, "rules": {...}, "memory": {...}, "output": {...} },
  "recent_events": [ { "timestamp": 100.5, "type": "OBSTACLE", "priority": 200, "message": "..." } ],
  "camera": { "fps_actual": 15.0, "vo_features_tracked": 21, "vo_valid": true, ... },
  "mavlink": { "state": "CONNECTED", "messages_sent": 779, ... },
  "sensor_modes": { "imu": "simulation", "baro": "simulation", "gps": "simulation", ... }
}
```

---

## Key Bug Fixes (from code review)

1. **VO displacement = 0** — Fixed: was using median pixel shift as displacement. Now: `displacement = pixel_shift * (ground_distance / focal_length)`
2. **MemoryPool race** — Replaced mutex-based pool with lock-free CAS free-list (O(1))
3. **FAST threshold overflow** — `int t = threshold_` prevents uint8_t subtraction underflow
4. **MAVLink VISION_POS** — Now uses accumulated VO local pose, not GPS coordinates
5. **MAVLink ODOMETRY** — Uses accumulated pose, not per-frame delta
6. **rand() thread safety** — Replaced with per-thread xorshift32 PRNG
7. **Roll calculation** — Fixed `atan2(acc_y, acc_z)` → `atan2(acc_y, -acc_z)` (acc_z is -9.81 when level)

---

## File Structure

```
jt-zero/
├── include/jt_zero/      # Public headers
│   ├── common.h           # SystemState, sensor data structs, MemoryPool
│   ├── sensors.h          # Sensor interfaces + auto-detect
│   ├── camera.h           # Camera sources + VO + Pipeline
│   └── mavlink_interface.h # MAVLink with Serial/UDP/Sim transport
├── core/                  # Runtime core
│   └── runtime.cpp        # Thread management, main loop
├── sensors/
│   └── sensors.cpp        # Sensor implementations + hw probing
├── camera/
│   ├── camera_pipeline.cpp # VO pipeline + SimulatedCamera
│   └── camera_drivers.cpp  # PiCSI (V4L2/MMAP) + USB (V4L2)
├── drivers/
│   ├── bus.h/cpp          # I2C, SPI, UART HAL
│   └── sensor_drivers.h/cpp # MPU6050, BMP280, NMEA drivers
├── mavlink/
│   └── mavlink_interface.cpp # Serial/UDP/Sim transport
├── api/
│   └── python_bindings.cpp # pybind11 module
├── simulator/             # Test pattern generators
├── CMakeLists.txt
└── toolchain-pi-zero.cmake
```

---

## FAQ: Running Without External IMU

**Q: Чи працюватиме система тільки з Pi Zero + польотний контролер, без зовнішнього IMU?**

**A: Так, повністю.** Ось як:

1. **Сценарій: Pi Zero + FC (ArduPilot/PX4)**
   - IMU вбудований у польотний контролер (він завжди має свій MPU6050/ICM20948)
   - JT-Zero отримує дані через MAVLink: `ATTITUDE`, `SCALED_IMU`, `GLOBAL_POSITION_INT`
   - Зовнішній MPU6050 на Pi НЕ потрібен

2. **Що робить JT-Zero без зовнішнього IMU:**
   - Камера + Visual Odometry — працює (не залежить від IMU)
   - MAVLink → FC — працює (передає VO дані польотнику)
   - Рефлекси та правила — працюють (використовують дані від FC)
   - IMU канал → автоматично переходить у SIM режим (генерує тестові дані)

3. **Мінімальна конфігурація:**
   - Pi Zero 2 W
   - Pi Camera Module v2 (або USB камера)
   - UART з'єднання з FC: TX→RX, RX→TX, GND
   - JT-Zero надсилає `VISION_POSITION_ESTIMATE` та `OPTICAL_FLOW_RAD` для fusion у EKF

4. **Оптимальна конфігурація:**
   - + MPU6050 на I2C (для власного AHRS і VO компенсації)
   - + BMP280 (незалежна альтиметрія)
   - + GPS UART (для absolute position backup)

---

## Build & Deploy

### On Pi Zero (native build):
```bash
cd ~/jt-zero/jt-zero && mkdir build && cd build
cmake -DCMAKE_BUILD_TYPE=Release .. && make -j4
cp jtzero_native*.so ~/jt-zero/backend/
```

### Cross-compilation (from x86 host):
```bash
sudo apt install gcc-aarch64-linux-gnu g++-aarch64-linux-gnu
cmake -DCMAKE_TOOLCHAIN_FILE=../toolchain-pi-zero.cmake -DCMAKE_BUILD_TYPE=Release ..
make -j$(nproc)
scp jtzero_native*.so pi@jtzero.local:~/jt-zero/backend/
```

### Run:
```bash
cd ~/jt-zero/backend && source venv/bin/activate
uvicorn server:app --host 0.0.0.0 --port 8001
```

---

## Session History
- Phase 1-11: Core runtime, sensors, camera, MAVLink, dashboard
- Bug fixes: VO displacement, MemoryPool, MAVLink semantics, roll atan2
- UI overhaul: 7-tab interface, detailed 3D drone, GPIO docs, Settings
- P1: Sensor auto-detect (I2C/UART probing)
- P2: Camera drivers (PiCSI V4L2, USB V4L2), MAVLink Serial/UDP transport
- Deployment: Successfully deployed on real Pi Zero 2W with native C++ runtime
- FC Connection guide: Matek H743-SLIM V3, SpeedyBee F405 V4, Pixhawk 2.4.8, Cube Orange+
- Test reports: /app/test_reports/iteration_1-8.json

---

## Flight Controller Connection (Quick Reference)

### Підключення Pi → FC (3 дроти):
```
Pi Pin 8  (TX)  ──► FC RX (UART порт)
Pi Pin 10 (RX)  ◄── FC TX
Pi Pin 6  (GND) ─── FC GND
```

### ArduPilot параметри:
```
SERIALx_PROTOCOL = 2    (MAVLink2)
SERIALx_BAUD = 921      (921600)
VISO_TYPE = 1            (MAVLink vision)
EK3_SRC1_POSXY = 6      (ExternalNav)
EK3_SRC1_VELXY = 6      (ExternalNav)
```

### UART порти по контролерах:
| FC | UART | Serial |
|----|------|--------|
| Matek H743-SLIM V3 | UART6 | SERIAL6 |
| SpeedyBee F405 V4 | UART4 | SERIAL4 |
| Pixhawk 2.4.8 | TELEM2 | SERIAL2 |
| Cube Orange+ | TELEM2 | SERIAL2 |

Детальна інструкція: /jt-zero/FC_CONNECTION.md
