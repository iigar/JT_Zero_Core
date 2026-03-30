# JT-Zero Changelog

## 2026-03-22 — MAVLink Parser Overhaul (P0 Fix)

### Bug Fixes
- **Auto-baud detection**: Probes 115200/921600/57600/230400/460800, picks first with valid MAVLink STX markers (~500ms/rate)
- **CRC validation**: Added CRC-16/MCRF4XX on all received frames. Previously garbage bytes from baud mismatch counted as valid messages.
- **Heartbeat filter relaxed**: Old code rejected type=0 (GENERIC) and type=18 unconditionally. Now only filters own echoes (sysid=1+type=18), GCS, ADSB.
- **MAVLink v2 zero truncation**: Heartbeat min payload length 7→5. v2 trims trailing zeros, so base_mode=0 heartbeats had len<7.
- **MAVLink v2 signing**: Parser detects incompat_flags bit 0, adds 13-byte signature to frame length.

### New Diagnostics
- `bytes_sent` / `bytes_received` raw byte counters in /api/mavlink
- `heartbeats_received` separate heartbeat counter
- `crc_errors` count of CRC-failed frames
- `detected_msg_ids` always visible (not just after heartbeat)
- `transport_info` shows port + baud rate
- Raw hex dump of first 32 bytes in journalctl logs
- Per-heartbeat logging (first 10) with type/sysid/autopilot

### Verified
- Pi Zero 2W + Matek H743 @ 115200 baud
- State=CONNECTED, Heartbeats=4, FC=ArduPilot QUADROTOR
- Attitude + IMU telemetry flowing, 0 CRC errors

## 2026-02/03 — Visual Odometry & Camera Overhaul

- USB Camera V4L2 MMAP rewrite
- Platform/VO Mode separation
- LK Tracker bilinear interpolation (critical fix)
- Sobel 3x3 gradients (4x signal amplification)
- Shi-Tomasi grid corner detector for thermal
- Verified on Pi 4 + Caddx thermal: Det:180, Track:16-59, Conf:0.18-0.29
