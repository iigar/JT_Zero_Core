# JT-Zero Changelog

## 2026-03-28 — SET HOMEPOINT + DOCS Update

### SET HOMEPOINT (VO Reset)
- **C++ `camera.h`**: Added `reset_vo()` method on `CameraPipeline` (calls `vo_.reset()`)
- **C++ `runtime.cpp`**: Added `"vo_reset"` command handling in `send_command()` — resets position to (0,0,0), clears distance, Kalman state, hover state
- **Python `simulator.py`**: Added `"vo_reset"` command handling
- **CommandPanel.js**: Added "SET HOMEPOINT" button alongside ARM/DISARM/TAKEOFF/etc.
- **API**: `POST /api/command {"command":"vo_reset"}` → resets VO origin

### VO Fallback Recovery Fix (brightness-based)
- **Problem**: Recovery used confidence threshold (0.40), but in dim environments (brightness ~41) confidence hovers at the threshold → CSI never recovers
- **Fix**: Added brightness-based recovery path: if `frame_brightness >= 30` (BRIGHT_RECOVER), switch back to CSI immediately
- Lowered confidence recovery threshold from 0.40 to 0.20 as secondary path
- Recovery now logs the exact reason: `brightness=41>=30` or `probe_conf=0.25>=0.20`

### DOCS Tab Updated
- Added **VO Fallback** section: architecture diagram, trigger logic, parameters, USB thermal setup, venv dependency note
- Updated **API Reference**: added 10 missing endpoints (camera/features, cameras, secondary, vo/profiles, diagnostics, sensors)
- Updated **File Structure**: added usb_camera.py, venv/, static/, update.sh
- Updated **Hardware Requirements**: added USB Thermal, FC, RC Transmitter as components
- Updated **Install Step 8**: added Pillow to venv setup
- Updated command list: added `vo_reset`


### Root Cause: Pillow installed in SYSTEM Python, service runs in VENV
- `update.sh` ran `apt install python3-pil` → installed into `/usr/lib/python3.13/`
- Service uses `/home/pi/jt-zero/backend/venv/bin/uvicorn` → venv can't see system packages
- Result: `PIL=False FILTERS=False NUMPY=False` — ALL feature detectors disabled
- **Fix**: `update.sh` now detects venv and installs Pillow via `venv/bin/pip install Pillow`

### Additional Fixes
- Error logging in `_decode_jpeg_to_gray`, numpy fallback, raw detector (replaced silent `except: pass`)
- Diagnostic startup log: `PIL=T/F FILTERS=T/F NUMPY=T/F`
- `Image.Resampling.NEAREST` compat fallback
- `/api/camera/features` hardened with try/except → always returns `[]`



## 2026-03-27 — VO Fallback Stabilization + Feature Overlay Fix

### Brightness-Only Trigger (CRITICAL FIX)
- **Removed confidence-based trigger**: FAST detector tracks sensor noise in pitch darkness, causing confidence ~70% when camera is blocked
- **New trigger**: Rolling average brightness < 20 (10-sample window, min 5 samples)
- **Recovery**: Uses CSI brightness probes (3 consecutive good probes needed), with 3s minimum fallback time and 5s cooldown

### ThermalPanel Feature Overlay Fix
- **ROOT CAUSE FOUND**: C++ `get_features()` returns empty on ARM64 Pi during fallback — `vo.feature_count()` reads stale `active_count_` due to no memory barrier between T6 thread (writes) and Python thread (reads)
- **C++ snapshot fix (pending recompile)**: Added `features_snapshot_[]` + `std::atomic<uint32_t>` to CameraPipeline with release/acquire barriers. Will activate when user does clean rebuild
- **Python-side feature detection**: When C++ returns empty during fallback, Python runs its own corner detector (simplified Shi-Tomasi via numpy) on the same thermal frame being injected into C++. Features are at REAL corners/edges of the thermal image, not pseudo-random positions
- **Python detector**: Sobel gradients → `min(|Ix|, |Iy|)` corner response → 3x3 NMS → top 120 by response. ~5-10ms on Pi 4 for 320x240
- **Dual-trigger canvas rendering**: Features redraw on JPEG frame load AND on camera stats update AND on features change
- **PTS counter**: Shows real `features.length` (Python-detected corner count)

### CLAUDE.md Updated
- Documented brightness-only trigger with reasoning
- Updated configuration table with new parameters
- Added Feature Overlay section


## 2026-03-27 — VO Fallback to USB Thermal Camera (P1)

### C++ Core: Hybrid VO Fallback (Python → C++ injection)
- **VOSource enum** (CSI_PRIMARY, THERMAL_FALLBACK): identifies current VO camera source
- **VOFallbackConfig**: configurable thresholds — CONF_DROP_THRESH=0.10, CONF_RECOVER_THRESH=0.25, FRAMES_TO_SWITCH=15 (~1.5s), CSI_PROBE_INTERVAL=3s
- **VOFallbackState**: runtime state tracking — source, reason, low_conf_count, fallback_duration, total_switches
- **inject_frame()**: Thread-safe SPSC (atomic state machine 0→1→2→0) for Python→C++ frame injection
- **activate_fallback() / deactivate_fallback()**: External control from Python, resets VO with thermal/CSI focal lengths
- **tick() modified**: In fallback mode, processes injected thermal frames instead of CSI capture. Periodic CSI probe (every 3s) using FAST detector for recovery check
- **Why hybrid?**: C++ USBCamera uses YUYV which returns all-zero frames on MS210x capture card. Working USB capture is Python usb_camera.py with MJPEG via v4l2-ctl subprocess

### Python: VO Fallback Monitor (`native_bridge.py`)
- **vo_fallback_tick()**: Called at 10Hz from WebSocket telemetry loop
- Monitors vo_confidence → counts consecutive low readings → triggers activate_fallback()
- **Injection thread**: Captures JPEG from usb_camera.py → decodes to grayscale via Pillow → injects at ~5fps via inject_frame()
- **Recovery monitor**: Reads CSI probe results from C++ fallback state → calls deactivate_fallback() when CSI recovers

### pybind11 Bindings (`python_bindings.cpp`)
- **inject_frame(data, w, h)**: Injects grayscale frame for VO
- **activate_fallback(reason)** / **deactivate_fallback()**: External fallback control
- **is_confidence_low()**: Check if CSI below threshold for N frames
- **get_fallback_state()**: Get detailed fallback state dict
- **camera_stats_to_dict**: Now includes vo_source, vo_fallback_reason, vo_fallback_duration, vo_fallback_switches

### Backend & Frontend
- **server.py**: Calls vo_fallback_tick() in WebSocket telemetry loop (10Hz)
- **simulator.py**: vo_fallback_tick() no-op stub + fallback fields in CameraStats
- **Frontend**: VO Source badge, fallback alert banner, sidebar indicator (unchanged from initial implementation)
- **update.sh**: Added `pip3 install pillow` + VO Source status in health check

## 2026-03-26 — USB Thermal Camera Live Streaming (P0 Fix)

### Root Cause: Frame Cache Never Invalidated
- **Bug**: `get_secondary_frame_data()` in `native_bridge.py` returned frame data but did NOT update `frame_count` in the camera state dict. Server's cache in `server.py` used `frame_count` to decide whether to serve fresh data. Since `frame_count` never changed, the server returned the first cached frame forever.
- **Fix**: Added `self._secondary_camera['frame_count'] = self._usb_capture.frame_count` in `get_secondary_frame_data()`.
- **Symptoms**: Backend captured different frames (unique MD5 hashes), FPS counter showed 12fps, but displayed image was static.

### USB Camera Detection Rewrite
- **Old**: Python `ioctl(VIDIOC_QUERYCAP)` — failed silently on aarch64 Pi
- **New**: Parses `v4l2-ctl --list-devices` subprocess output — reliable on all architectures
- Device shows as `AV TO USB2.0 (usb-...)` at `/dev/video1`

### Capture Architecture: Batch (not Persistent)
- **Persistent process** (`--stream-count=0`): MS210x capture card repeats same frame when device stays open (analog converter "sticks"). Achieved 12fps but all frames identical.
- **Batch capture** (`--stream-count=2`): Each call reopens device, forcing fresh analog-to-digital conversion. Slower (~5fps) but frames are genuinely different.
- Added MD5 hash logging to confirm frame uniqueness: every frame logged as `NEW`

### Frontend ThermalPanel Rewrite
- Rewritten to match CameraPanel's proven pattern: offscreen `new Image()` + canvas + `drawFrame()` in `onload`
- Fixed canvas dimensions: 640x480 (matching MJPEG resolution)
- Sequential polling (70ms delay between fetches)

### Logging Fix
- `_log()` changed from `print()` to `sys.stderr.write()` — now visible in `journalctl`
- `[MultiCam]` messages in `native_bridge.py` also use stderr

### Configuration
- `BATCH_SIZE=2` (1 warm-up + 1 real frame), `TEST_BATCH=4` for initial test
- Resolution: 640x480 MJPEG (known working on MS210x)
- No gap between batch captures (device reopen is sufficient reset)

### Verified on Pi 4
- CSI Camera v2 (VO): ACTIVE, ~14fps
- USB Thermal (AV TO USB2.0): ACTIVE, live video streaming, ~5fps
- Both cameras running simultaneously

## 2026-03-24 — IMX290 STARVIS + GENERIC CSI Fallback

### New Sensor Support
- **IMX290 STARVIS** added to known CSI sensors (8th sensor): 2MP 1920x1080, FOV 82°, focal 400px, excellent low-light (Sony STARVIS back-illuminated)
- **GENERIC CSI fallback**: Unknown sensors detected via `rpicam-hello` output parsing (`"N : sensor_name [WxH ...]"` format). Raw sensor chip name stored and displayed in dashboard
- **CSISensorType::GENERIC = 99**: New enum value for unknown-but-working cameras
- **PiCSICamera::detected_raw_name()**: Static method returns raw chip ID string
- **CameraPipelineStats**: Added `csi_sensor_type` and `csi_sensor_name` fields
- **Python bindings**: `camera_stats_to_dict()` now includes CSI sensor info
- **native_bridge.py**: `get_cameras()` reads sensor name from C++ stats (not hardcoded)
- **Verified on Pi Zero 2W**: IMX290 auto-detected as "IMX290 STARVIS (VO)", VO active

### New Camera Setup (not in known list)
If `rpicam-hello` shows "No cameras available":
1. Set `camera_auto_detect=0` in `/boot/firmware/config.txt`
2. Add `dtoverlay=<sensor>,clock-frequency=37125000`
3. Reboot → `rpicam-hello --list-cameras` should show the camera
4. JT-Zero auto-detects as GENERIC or known sensor

## 2026-03-24 — GitHub Actions CI/CD + update.sh Refactor

### Frontend Build Automation
- **GitHub Actions workflow** (`.github/workflows/build-frontend.yml`): Auto-builds frontend on push when `frontend/src/`, `frontend/public/`, or `package.json` changes. Commits `backend/static/` back to repo with `[skip ci]`.
- **Pre-built frontend in git**: `backend/static/` (8.7MB) committed to repo — Pi Zero no longer needs Node.js/npm
- **update.sh refactored**: Checks for pre-built `backend/static/index.html` first (instant), falls back to local npm build only if missing
- **Root cause fix**: Pi Zero 2W (416MB RAM) cannot run `npm install` — OOM kills the process silently. Pre-built approach eliminates this entirely.
- **.gitignore cleaned**: Removed ~60 duplicate entries, kept `!backend/static/` exception

## 2026-03-23 — Multi-Camera Architecture (P1)

### Multi-Camera Support
- **C++ Header (camera.h)**: Added `CameraSlot` enum (PRIMARY/SECONDARY), `CameraSlotInfo` struct, multi-camera methods to `CameraPipeline` (init_secondary, capture_secondary, get_slot_info, camera_count)
- **C++ Pipeline (camera_pipeline.cpp)**: Implemented secondary camera lifecycle (init, capture on-demand, shutdown), slot info reporting
- **Backend API (server.py)**: 4 new endpoints — `GET /api/cameras`, `GET /api/camera/secondary/stats`, `POST /api/camera/secondary/capture`, `GET /api/camera/secondary/frame`
- **Backend Bridge (native_bridge.py)**: Multi-camera fallback methods for C++ runtime (lazy-init, simulated thermal frames)
- **Backend Simulator (simulator.py)**: Full multi-camera simulation with thermal hotspot generation
- **Frontend ThermalPanel.js**: New component — on-demand capture, auto-refresh (1fps), iron palette false-color rendering, temperature legend
- **Frontend App.js**: CameraTab with SPLIT/VO ONLY/THERMAL view switcher, Dashboard sidebar CAMERAS section
- **WebSocket**: `cameras` array added to telemetry payload
- **Testing**: 24/24 tests pass (100%)

### Variant B — CSI Priority, USB Fallback
- **C++ camera.h**: Added `CSISensorType` enum (OV5647, IMX219, IMX477, IMX708, OV9281, IMX296, OV64A40), `CSISensorInfo` struct with sensor specs
- **C++ camera_drivers.cpp**: `detect_sensor()` — parses rpicam-hello output to identify CSI sensor model; `find_usb_device()` — scans /dev/video0..9 for USB cameras (skips CSI V4L2 devices); `initialize_multicam()` — Variant B logic
- **C++ PiCSICamera**: Stores detected sensor type and info, dynamic camera name from sensor model
- **Backend labels**: Dynamic PRIMARY label (CSI sensor name or "USB fallback"), "USB Thermal (Down)" for secondary
- **Frontend**: CSI sensor badge in Camera tab header, "USB Fallback" warning badge when no CSI

## 2026-03-23 — EKF3 Integration, Automation, UI Refresh

### EKF3 ExternalNav
- ArduPilot EKF3 confirmed using JT-Zero VO data: "EKF3 IMU0/1 is using external nav data"
- VISION_POSITION_ESTIMATE @ 25Hz + ODOMETRY @ 25Hz flowing to FC
- Verified on both Pi Zero 2W and Pi 4B + Matek H743

### Automation Scripts
- `setup.sh` — full first-install automation (deps, UART/I2C/SPI, build, systemd, reboot)
- `update.sh` — quick update with auto Pi model detection (make -j2 for Zero, -j4 for Pi 4/5)

### UI Refresh
- Rounded corners, font scaling, colors lightened
- MAVLink panel expanded with full diagnostics
- Events tab: scroll-lock

## 2026-03-22 — MAVLink Parser Overhaul (P0 Fix)

### Bug Fixes
- Auto-baud detection, CRC validation, heartbeat filter, v2 zero truncation, v2 signing support
- Verified: Pi Zero 2W + Matek H743 @ 115200 baud, 0 CRC errors

## 2026-02/03 — Visual Odometry & Camera Overhaul
- USB Camera V4L2 MMAP rewrite
- LK Tracker bilinear interpolation, Sobel 3x3 gradients
- Shi-Tomasi grid corner detector for thermal
- Verified on Pi 4 + Caddx thermal: Det:180, Track:16-59, Conf:0.18-0.29
