# JT-Zero Changelog

## 2026-03-27 — VO Fallback to USB Thermal Camera (P1)

### C++ Core: Automatic Camera Switching
- **VOSource enum** (CSI_PRIMARY, THERMAL_FALLBACK): identifies current VO camera source
- **VOFallbackConfig**: configurable thresholds — CONF_DROP_THRESH=0.10, CONF_RECOVER_THRESH=0.25, FRAMES_TO_SWITCH=15 (~1s), CSI_PROBE_INTERVAL=3s
- **VOFallbackState**: runtime state tracking — source, reason, low_conf_count, fallback_duration, total_switches
- **CameraPipeline::tick()** modified: monitors running_confidence_, counts consecutive low-confidence frames, auto-switches to thermal when threshold exceeded
- **CSI Recovery Probe**: every 3s during fallback, captures one CSI frame, runs FAST detector, switches back if feature quality >= 25%
- **vo_.reset()** on each switch (different focal length between CSI and thermal)
- **THERMAL_FOCAL_PX=180.0**: default focal length for USB thermal camera at 640x480

### Backend: Telemetry Extension
- `native_bridge.py`: Added vo_source, vo_fallback_reason, vo_fallback_duration, vo_fallback_switches to camera stats
- `simulator.py`: CameraStats dataclass extended with fallback fields
- `/api/camera` endpoint now returns VO fallback state

### Frontend: Dashboard Indicators
- **VO Source badge** in Camera tab header: green "VO: CSI" or amber "VO: THERMAL"
- **VO Fallback alert** banner: shows when thermal is active with reason and duration
- **Sidebar VO indicator**: dot + label showing current VO source with pulse animation during fallback

### CLAUDE.md Updated
- Added VO Fallback documentation section (state machine, config, switch logic, hardware constraints)
- Updated USB Camera Implementation section (batch capture, frame cache bug fix)
- Updated session history

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
