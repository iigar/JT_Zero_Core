import React, { useState } from 'react';
import { Radio, Send, Download, Link2, AlertCircle, Activity, Wifi, Cpu, Home } from 'lucide-react';
import { apiCall } from '../hooks/useApi';

function MAVLinkPanelInner({ mavlink }) {
  const [homeResult, setHomeResult] = useState(null);
  const [settingHome, setSettingHome] = useState(false);

  async function handleSetHome() {
    setSettingHome(true);
    try {
      const res = await apiCall('POST', '/api/command', {
        command: 'vo_reset', param1: 0, param2: 0,
      });
      setHomeResult(res?.success ? 'ok' : 'fail');
    } catch {
      setHomeResult('fail');
    }
    setSettingHome(false);
    setTimeout(() => setHomeResult(null), 3000);
  }

  const stateColor = {
    CONNECTED: 'text-emerald-300',
    CONNECTING: 'text-amber-300 animate-pulse',
    DISCONNECTED: 'text-slate-400',
    LOST: 'text-red-400 animate-pulse',
  };

  const stateIcon = {
    CONNECTED: 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]',
    CONNECTING: 'bg-amber-300 animate-pulse',
    DISCONNECTED: 'bg-slate-500',
    LOST: 'bg-red-400 animate-pulse',
  };

  const hb = mavlink?.heartbeats_received || 0;
  const crcErr = mavlink?.crc_errors || 0;
  const bytesRx = mavlink?.bytes_received || 0;
  const bytesTx = mavlink?.bytes_sent || 0;
  const msgIds = mavlink?.detected_msg_ids || [];

  return (
    <div className="panel-glass p-4 relative corner-bracket h-full overflow-hidden" data-testid="mavlink-panel">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-slate-400" />
          <h3 className="text-xs uppercase tracking-widest text-slate-400 font-semibold">MAVLink</h3>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${stateIcon[mavlink?.state] || 'bg-slate-500'}`} />
          <span className={`text-xs font-bold uppercase ${stateColor[mavlink?.state] || 'text-slate-400'}`}>
            {mavlink?.state || 'N/A'}
          </span>
        </div>
      </div>

      {/* Transport info */}
      {mavlink?.transport_info && (
        <div className="mb-3 px-2 py-1.5 bg-black/30 rounded-lg border border-[#2D3A4E]">
          <div className="flex items-center gap-2">
            <Wifi className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[11px] text-[#33CCFF] font-bold tabular-nums">{mavlink.transport_info}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-5 gap-y-1">
        {/* Connection */}
        <div>
          <span className="text-[10px] text-slate-500 uppercase block mb-1 font-semibold">Connection</span>
          <Row label="SYS ID" value={mavlink?.system_id || 0} />
          <Row label="COMP" value={mavlink?.component_id || 0} />
          <Row label="FC SYS" value={mavlink?.fc_system_id || 0} />
          <Row label="LINK Q" 
               value={`${((mavlink?.link_quality || 0) * 100).toFixed(0)}%`}
               color={(mavlink?.link_quality || 0) > 0.8 ? 'text-emerald-300' : 'text-amber-300'} />
          <Row label="ERRORS" value={mavlink?.errors || 0}
               color={(mavlink?.errors || 0) > 0 ? 'text-red-300' : 'text-slate-300'} />
        </div>

        {/* Flight Controller */}
        <div>
          <span className="text-[10px] text-slate-500 uppercase block mb-1 font-semibold">Flight Controller</span>
          <Row label="FC" value={mavlink?.fc_autopilot || 'N/A'} />
          <Row label="FW" value={mavlink?.fc_firmware?.replace('ArduPilot ', 'AP ') || 'N/A'} />
          <Row label="TYPE" value={mavlink?.fc_type || 'N/A'} />
          <Row label="ARMED" value={mavlink?.fc_armed ? 'YES' : 'NO'}
               color={mavlink?.fc_armed ? 'text-amber-300' : 'text-slate-400'} />
        </div>
      </div>

      {/* Message counters */}
      <div className="mt-3 border-t border-[#2D3A4E]/50 pt-2">
        <span className="text-[10px] text-slate-500 uppercase font-semibold">Messages</span>
        <div className="grid grid-cols-3 gap-2 mt-1.5">
          <MsgCounter icon={Send} label="TX" value={mavlink?.messages_sent || 0} />
          <MsgCounter icon={Download} label="RX" value={mavlink?.messages_received || 0} />
          <MsgCounter icon={Activity} label="HB" value={hb} color={hb > 0 ? 'text-emerald-300' : 'text-red-300'} />
        </div>
      </div>

      {/* Bytes & CRC */}
      <div className="mt-2 border-t border-[#2D3A4E]/50 pt-2">
        <span className="text-[10px] text-slate-500 uppercase font-semibold">Transport</span>
        <div className="grid grid-cols-2 gap-x-5 mt-1">
          <Row label="BYTES TX" value={formatBytes(bytesTx)} />
          <Row label="BYTES RX" value={formatBytes(bytesRx)} />
          <Row label="CRC ERR" value={crcErr}
               color={crcErr > 0 ? 'text-red-300' : 'text-emerald-300'} />
          <Row label="HB COUNT" value={hb}
               color={hb > 0 ? 'text-emerald-300' : 'text-amber-300'} />
        </div>
      </div>

      {/* Vision Messages Sent */}
      <div className="mt-2 border-t border-[#2D3A4E]/50 pt-2">
        <span className="text-[10px] text-slate-500 uppercase font-semibold">Vision Messages Sent</span>
        <div className="flex gap-2 mt-1 flex-wrap">
          <MsgTag label="VISION_POS" count={mavlink?.vision_pos_sent || 0} />
          <MsgTag label="ODOMETRY" count={mavlink?.odometry_sent || 0} />
          <MsgTag label="OPT_FLOW" count={mavlink?.optical_flow_sent || 0} />
        </div>
      </div>

      {/* FC Telemetry */}
      {mavlink?.fc_telemetry && (
        <div className="mt-2 border-t border-[#2D3A4E]/50 pt-2">
          <span className="text-[10px] text-slate-500 uppercase font-semibold">FC Telemetry</span>
          <div className="grid grid-cols-2 gap-x-5 mt-1">
            <Row label="ATT" value={mavlink.fc_telemetry.attitude_valid ? 'OK' : '--'}
                 color={mavlink.fc_telemetry.attitude_valid ? 'text-emerald-300' : 'text-slate-500'} />
            <Row label="IMU" value={mavlink.fc_telemetry.imu_valid ? 'OK' : '--'}
                 color={mavlink.fc_telemetry.imu_valid ? 'text-emerald-300' : 'text-slate-500'} />
            <Row label="GPS" value={mavlink.fc_telemetry.gps_valid ? `${mavlink.fc_telemetry.gps_sats} sat` : 'NO'}
                 color={mavlink.fc_telemetry.gps_valid ? 'text-emerald-300' : 'text-slate-500'} />
            <Row label="BATT" value={mavlink.fc_telemetry.battery_voltage > 0 
                 ? `${mavlink.fc_telemetry.battery_voltage.toFixed(1)}V` : '--'}
                 color={mavlink.fc_telemetry.battery_voltage > 14 ? 'text-emerald-300' : 
                        mavlink.fc_telemetry.battery_voltage > 0 ? 'text-amber-300' : 'text-slate-500'} />
          </div>
        </div>
      )}

      {/* Detected Message IDs */}
      {msgIds.length > 0 && (
        <div className="mt-2 border-t border-[#2D3A4E]/50 pt-2">
          <span className="text-[10px] text-slate-500 uppercase font-semibold">Detected Msg IDs</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {msgIds.slice(0, 16).map((id, i) => (
              <span key={i} className="text-[10px] bg-[#33CCFF]/8 border border-[#33CCFF]/15 px-1.5 py-0.5 rounded-md text-slate-400 tabular-nums">
                {id}
              </span>
            ))}
            {msgIds.length > 16 && (
              <span className="text-[10px] text-slate-600">+{msgIds.length - 16}</span>
            )}
          </div>
        </div>
      )}

      {/* SET HOMEPOINT */}
      <div className="mt-3 border-t border-[#2D3A4E]/50 pt-3">
        <button
          onClick={handleSetHome}
          disabled={settingHome}
          data-testid="set-homepoint-btn"
          className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-sm text-[11px] font-bold uppercase tracking-wider transition-all ${
            homeResult === 'ok'
              ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-400'
              : homeResult === 'fail'
              ? 'bg-red-500/15 border border-red-500/40 text-red-400'
              : 'bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
          } disabled:opacity-50`}
        >
          <Home className={`w-4 h-4 ${settingHome ? 'animate-pulse' : ''}`} />
          {homeResult === 'ok' ? 'HOMEPOINT SET' : homeResult === 'fail' ? 'ERROR' : settingHome ? 'SETTING...' : 'SET HOMEPOINT'}
        </button>
        <p className="text-[8px] text-slate-600 mt-1 text-center">
          Reset VO origin to (0,0,0) — current position becomes home
        </p>
      </div>
    </div>
  );
}

function formatBytes(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function Row({ label, value, color }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-[11px] text-slate-500 uppercase">{label}</span>
      <span className={`text-[11px] font-bold tabular-nums ${color || 'text-[#33CCFF]'}`}>{value}</span>
    </div>
  );
}

function MsgCounter({ icon: Icon, label, value, color }) {
  return (
    <div className="flex items-center gap-1.5 bg-black/30 px-2 py-1 rounded-lg">
      <Icon className="w-3.5 h-3.5 text-slate-500" />
      <span className="text-[10px] text-slate-400">{label}</span>
      <span className={`text-[11px] font-bold tabular-nums ml-auto ${color || 'text-[#33CCFF]'}`}>{value}</span>
    </div>
  );
}

function MsgTag({ label, count }) {
  return (
    <div className="text-[10px] bg-[#33CCFF]/8 border border-[#33CCFF]/15 px-2 py-0.5 rounded-md">
      <span className="text-[#33CCFF] font-bold">{label}</span>
      <span className="text-slate-400 ml-1.5">{count}</span>
    </div>
  );
}

const MAVLinkPanel = React.memo(MAVLinkPanelInner);
export default MAVLinkPanel;
