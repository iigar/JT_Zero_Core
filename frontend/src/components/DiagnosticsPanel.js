import React, { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../hooks/useApi';
import { 
  Camera, Cpu, HardDrive, Radio, CircuitBoard, 
  RefreshCw, CheckCircle2, XCircle, AlertTriangle, Loader2 
} from 'lucide-react';

function StatusIcon({ status }) {
  if (status === 'ok' || status === true) return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === 'busy') return <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />;
  return <XCircle className="w-3.5 h-3.5 text-slate-600" />;
}

function StatusBadge({ ok, label }) {
  return (
    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-sm border ${
      ok ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5'
         : 'text-slate-500 border-slate-700/30 bg-slate-800/30'
    }`}>{label}</span>
  );
}

function SubSection({ title, icon: Icon, children }) {
  return (
    <div className="bg-black/30 border border-[#1E293B]/50 rounded-sm p-2.5">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3 h-3 text-slate-500" />
        <span className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold">{title}</span>
      </div>
      {children}
    </div>
  );
}

export default function DiagnosticsPanel() {
  const [diag, setDiag] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);

  const fetchDiag = useCallback(async () => {
    try {
      const data = await apiCall('GET', '/api/diagnostics');
      if (data && !data.error) setDiag(data);
    } catch (e) {
      setError('Failed to fetch diagnostics');
    }
  }, []);

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const data = await apiCall('POST', '/api/diagnostics/scan');
      if (data && !data.error) setDiag(data);
      else setError('Scan returned error');
    } catch (e) {
      setError('Scan failed');
    }
    setScanning(false);
  }, []);

  useEffect(() => { fetchDiag(); }, [fetchDiag]);

  const summary = diag?.summary || {};
  const platform = diag?.platform || {};
  const cameras = diag?.camera || [];
  const i2c = diag?.i2c || {};
  const spi = diag?.spi || {};
  const uart = diag?.uart || {};
  const gpio = diag?.gpio || {};
  const mavlink = diag?.mavlink || {};

  return (
    <div className="bg-[#0A0C10] border border-[#1E293B] rounded-sm p-3" data-testid="diagnostics-panel">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CircuitBoard className="w-4 h-4 text-slate-500" />
          <h3 className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Hardware Diagnostics</h3>
        </div>
        <button
          onClick={runScan}
          disabled={scanning}
          data-testid="diagnostics-scan-btn"
          className="flex items-center gap-1 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider
            text-slate-400 border border-[#1E293B] rounded-sm hover:text-[#00F0FF] hover:border-[#00F0FF]/30 
            transition-all disabled:opacity-50"
        >
          {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {scanning ? 'Scanning...' : 'Re-Scan'}
        </button>
      </div>

      {error && (
        <div className="text-[9px] text-red-400 mb-2 px-2 py-1 bg-red-500/5 border border-red-500/20 rounded-sm">
          {error}
        </div>
      )}

      {/* Summary bar */}
      {diag && (
        <div className="flex items-center gap-2 mb-3 p-2 bg-[#050505] border border-[#1E293B]/30 rounded-sm" data-testid="diagnostics-summary">
          <span className="text-[8px] text-slate-600 uppercase">Status:</span>
          <StatusBadge ok={summary.camera !== 'NONE'} label={`CAM: ${summary.camera}`} />
          <StatusBadge ok={summary.i2c_devices > 0} label={`I2C: ${summary.i2c_devices} dev`} />
          <StatusBadge ok={summary.spi_available} label={`SPI: ${summary.spi_available ? 'OK' : 'N/A'}`} />
          <StatusBadge ok={summary.uart_available} label={`UART: ${summary.uart_available ? 'OK' : 'N/A'}`} />
          <StatusBadge ok={summary.mavlink_connected} label={`MAV: ${summary.mavlink_connected ? 'OK' : 'N/A'}`} />
          {diag.scan_duration_ms && (
            <span className="text-[8px] text-slate-600 ml-auto tabular-nums">{diag.scan_duration_ms}ms</span>
          )}
        </div>
      )}

      {!diag && !error && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-4 h-4 text-slate-600 animate-spin mr-2" />
          <span className="text-[10px] text-slate-600">Loading diagnostics...</span>
        </div>
      )}

      {diag && (
        <div className="grid grid-cols-3 gap-3">
          {/* Column 1: Platform + Camera */}
          <div className="space-y-3">
            {/* Platform */}
            <SubSection title="Platform" icon={Cpu}>
              <div className="space-y-1">
                <Row label="Type" value={platform.is_raspberry_pi ? 'Raspberry Pi' : 'Linux'} ok={platform.is_raspberry_pi} />
                {platform.model && <Row label="Model" value={platform.model} />}
                {platform.cpu && <Row label="CPU" value={platform.cpu} />}
                <Row label="Kernel" value={platform.kernel || 'N/A'} />
                {platform.os && <Row label="OS" value={platform.os} />}
              </div>
            </SubSection>

            {/* Camera */}
            <SubSection title="Camera" icon={Camera}>
              <div className="space-y-1.5">
                {cameras.map((cam, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <StatusIcon status={cam.detected} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[9px] text-slate-300">{cam.name}</div>
                      <div className="text-[8px] text-slate-600 truncate">{cam.info}</div>
                    </div>
                  </div>
                ))}
              </div>
            </SubSection>
          </div>

          {/* Column 2: I2C + SPI */}
          <div className="space-y-3">
            {/* I2C */}
            <SubSection title={`I2C Bus (${i2c.buses?.length || 0} bus)`} icon={HardDrive}>
              {i2c.devices && i2c.devices.length > 0 ? (
                <div className="space-y-1">
                  {i2c.devices.map((dev, i) => (
                    <div key={i} className="flex items-center gap-2 py-0.5 border-b border-[#1E293B]/20 last:border-0">
                      <StatusIcon status={dev.status} />
                      <span className="text-[9px] text-[#00F0FF] font-mono tabular-nums w-8">{dev.address}</span>
                      <span className="text-[9px] text-slate-400 flex-1 truncate">{dev.name}</span>
                      <span className="text-[8px] text-slate-600">bus {dev.bus}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[9px] text-slate-600 py-2">
                  {i2c.available ? 'No I2C devices detected' : 'I2C bus not available'}
                </div>
              )}
            </SubSection>

            {/* SPI */}
            <SubSection title="SPI Bus" icon={HardDrive}>
              <div className="flex items-center gap-2">
                <StatusIcon status={spi.available} />
                <span className="text-[9px] text-slate-400">{spi.info}</span>
              </div>
              {spi.devices && spi.devices.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {spi.devices.map((d, i) => (
                    <span key={i} className="text-[8px] text-slate-500 font-mono block">{d}</span>
                  ))}
                </div>
              )}
            </SubSection>
          </div>

          {/* Column 3: UART + MAVLink + GPIO */}
          <div className="space-y-3">
            {/* UART */}
            <SubSection title={`UART (${uart.available_count || 0} ports)`} icon={Radio}>
              <div className="space-y-1">
                {uart.ports?.filter(p => p.available).map((port, i) => (
                  <div key={i} className="flex items-center gap-2 py-0.5">
                    <StatusIcon status={true} />
                    <span className="text-[9px] text-[#00F0FF] font-mono">{port.device}</span>
                    <span className="text-[8px] text-slate-600 truncate flex-1">{port.description}</span>
                  </div>
                ))}
                {uart.ports?.filter(p => !p.available).length > 0 && (
                  <details className="mt-1">
                    <summary className="text-[8px] text-slate-600 cursor-pointer hover:text-slate-400">
                      {uart.ports.filter(p => !p.available).length} unavailable
                    </summary>
                    {uart.ports.filter(p => !p.available).map((port, i) => (
                      <div key={i} className="flex items-center gap-2 py-0.5 ml-2">
                        <StatusIcon status={false} />
                        <span className="text-[8px] text-slate-600 font-mono">{port.device}</span>
                      </div>
                    ))}
                  </details>
                )}
              </div>
            </SubSection>

            {/* MAVLink */}
            <SubSection title="MAVLink / FC" icon={Radio}>
              <div className="space-y-1">
                <Row label="Connected" value={mavlink.connected ? 'YES' : 'NO'} ok={mavlink.connected} />
                <Row label="FC Type" value={mavlink.fc_type} />
                <Row label="Firmware" value={mavlink.fc_firmware} />
              </div>
            </SubSection>

            {/* GPIO */}
            <SubSection title="GPIO" icon={CircuitBoard}>
              <div className="space-y-1">
                <Row label="sysfs" value={gpio.sysfs_available ? 'Available' : 'N/A'} ok={gpio.sysfs_available} />
                <Row label="gpiomem" value={gpio.gpiomem ? 'Available' : 'N/A'} ok={gpio.gpiomem} />
                <Row label="gpiochip0" value={gpio.gpiochip0 ? 'Available' : 'N/A'} ok={gpio.gpiochip0} />
                {gpio.exported_pins?.length > 0 && (
                  <div className="mt-1 text-[8px] text-slate-600">
                    {gpio.exported_pins.length} exported pin(s)
                  </div>
                )}
              </div>
            </SubSection>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, ok }) {
  let color = 'text-slate-400';
  if (ok === true) color = 'text-emerald-400';
  if (ok === false) color = 'text-slate-600';
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-[9px] text-slate-600 uppercase">{label}</span>
      <span className={`text-[9px] font-bold tabular-nums ${color} truncate ml-2 max-w-[160px] text-right`}>{value}</span>
    </div>
  );
}
