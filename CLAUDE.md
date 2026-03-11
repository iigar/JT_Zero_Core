# CLAUDE.md — JT-Zero Runtime Context

## Project
JT-Zero — multi-threaded C++ robotics runtime for Raspberry Pi Zero 2 W drone autonomy.
Exposed to Python via pybind11, served by FastAPI, visualized in React dashboard.

## Architecture
```
C++ Runtime (8 threads T0-T7) → pybind11 → FastAPI → WebSocket 10Hz → React Dashboard
```

## Thread Model
| Thread | Function | Rate | Priority |
|--------|----------|------|----------|
| T0 | Supervisor | 10 Hz | 90 |
| T1 | Sensors | 200 Hz | 95 |
| T2 | Events | 200 Hz | 85 |
| T3 | Reflex | 200 Hz | 98 (highest) |
| T4 | Rules | 20 Hz | 70 |
| T5 | MAVLink | 50 Hz | 80 |
| T6 | Camera | 15 FPS | 60 |
| T7 | API Bridge | 30 Hz | 50 |

## Key Files
```
jt-zero/
├── include/jt_zero/     # C++ headers (common.h, runtime.h, camera.h, etc.)
├── core/                # 5 engines: event, reflex, rule, memory, output
├── sensors/sensors.cpp  # Simulated sensors with xorshift32 PRNG
├── camera/              # FAST-9 detector + Lucas-Kanade tracker + VO
├── mavlink/             # MAVLink interface (vision_pos, odometry, optical_flow)
├── drivers/             # Real hardware: I2C/SPI/UART bus + MPU6050/BMP280/GPS
├── api/                 # pybind11 bindings (python_bindings.cpp)
├── CMakeLists.txt       # C++17, -fno-exceptions -fno-rtti, pybind11 module
├── toolchain-pi-zero.cmake  # Cross-compilation for aarch64
└── DEPLOYMENT.md

backend/
├── server.py            # FastAPI: 11 REST + 2 WebSocket endpoints
├── native_bridge.py     # Auto-detect native C++ or Python fallback
├── simulator.py         # Pure Python fallback simulator
└── jtzero_native.*.so   # Compiled C++ module

frontend/src/
├── App.js               # Tab navigation (7 tabs)
├── components/          # 14+ React panels
└── hooks/useApi.js      # WebSocket + REST hooks
```

## Build
```bash
cd jt-zero/build && cmake .. -DCMAKE_BUILD_TYPE=Release && make -j4
cp jtzero_native.*.so ../backend/
```

## Dual-Mode Runtime
Backend auto-detects `jtzero_native.so`:
- Found → C++ Native mode (full performance, real threads)
- Not found → Python Simulator fallback (same API interface)

## Realtime Rules (Embedded)
- No dynamic allocation in hot paths
- Lock-free SPSC ring buffer (1024 events)
- Lock-free MemoryPool with CAS free-list (O(1) alloc/dealloc)
- Thread-local xorshift32 PRNG (not rand())
- Fixed memory pools, no heap in RT loops

## API Endpoints
```
GET  /api/health, /api/state, /api/events, /api/telemetry
GET  /api/threads, /api/engines, /api/camera, /api/mavlink
GET  /api/performance, /api/simulator/config
POST /api/simulator/config, /api/command
WS   /api/ws/telemetry (10Hz), /api/ws/events
```

## Bug Fixes Applied (from 3 independent code reviews)
1. VO displacement was always 0 → Added prev_features_ array, computes real flow
2. FAST threshold uint8_t overflow → int comparison
3. MemoryPool race condition → lock-free CAS free-list
4. MAVLink heartbeat double-increment → fixed
5. MAVLink GPS-as-vision-position → uses VO local pose
6. MAVLink delta-as-odometry-position → accumulated pose
7. Sensor uint8_t overflow → clamp
8. rand() not thread-safe → thread-local xorshift32
9. Camera sim sqrt per-pixel → squared distance

## Sensor Drivers (Phase 11)
Real hardware drivers created but sensors currently run in simulated mode:
- MPU6050 (I2C 0x68): gyro + accel, 14-byte burst read
- BMP280 (I2C 0x76): pressure + temp, datasheet compensation
- NMEA GPS (UART 9600): $GPGGA + $GPRMC parsing
- Auto-detection: if /dev/i2c-1 not available, falls back to simulation

## Frontend (React Dashboard)
Tab-based navigation:
1. Dashboard — 3D drone + telemetry + sensors + mini event log
2. Telemetry — Charts + performance + detailed sensors
3. Camera/VO — Camera pipeline + Visual Odometry
4. MAVLink — Connection status + flight commands
5. Events — Full event log (fixed container, internal scroll)
6. Docs — API reference, thread model, file structure, Pi install guide, hardware
7. Settings — Simulator config + system info + hardware status

## System Constraints
| Metric | Target | Actual |
|--------|--------|--------|
| CPU | <= 65% | ~3% |
| RAM | <= 300 MB | ~1 MB |
| Event drops | 0% | 0% |
| Reflex latency | < 5ms | ~0 us |

## Cross-Compilation (for Pi Zero 2 W from x86 host)
```bash
cmake -DCMAKE_TOOLCHAIN_FILE=../toolchain-pi-zero.cmake -DCMAKE_BUILD_TYPE=Release ..
```

## Testing
5 test iterations completed. Backend 100%, Frontend 100%.
Test reports: /app/test_reports/iteration_1-5.json
