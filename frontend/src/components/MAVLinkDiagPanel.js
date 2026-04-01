import React, { useState, useEffect, useRef } from 'react';
import { Activity, Radio, Gauge, Zap, Signal, ChevronDown, ChevronUp } from 'lucide-react';
import { apiCall } from '../hooks/useApi';

function MAVLinkDiagPanel({ mavlink }) {
  const [expanded, setExpanded] = useState({ rc: true, fc: true, msgs: false });
  const [fullMavlink, setFullMavlink] = useState(null);
  const prevMsgCountRef = useRef(0);

  // Periodic fetch for full mavlink data (includes RC channels)
  useEffect(() => {
    const fetch = async () => {
      try {
        const data = await apiCall('GET', '/api/mavlink');
        setFullMavlink(data);
      } catch {}
    };
    fetch();
    const interval = setInterval(fetch, 1000);
    return () => clearInterval(interval);
  }, []);

  const data = fullMavlink || mavlink || {};
  const fc = data.fc_telemetry || {};
  const rc = data.rc_channels || [];
  const rcCount = data.rc_chancount || 0;
  const msgIds = data.detected_msg_ids || [];
  const hb = data.heartbeats_received || 0;
  const crcErr = data.crc_errors || 0;
  const parseErr = data.parse_errors || 0;
  const bytesRx = data.bytes_received || 0;
  const bytesTx = data.bytes_sent || 0;
  const msgRate = data.msg_per_second || 0;

  // Detect message rate change
  const msgCount = data.messages_received || 0;
  const msgDelta = msgCount - prevMsgCountRef.current;
  prevMsgCountRef.current = msgCount;

  const toggle = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const SectionHeader = ({ id, icon: Icon, title, badge }) => (
    <button 
      onClick={() => toggle(id)}
      data-testid={`diag-section-${id}`}
      className="w-full flex items-center justify-between py-1.5 px-2 bg-[#0A0C10] border border-[#1E293B] rounded-sm hover:border-[#33CCFF]/20 transition-colors"
    >
      <div className="flex items-center gap-2">
        <Icon className="w-3 h-3 text-slate-500" />
        <span className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">{title}</span>
        {badge !== undefined && (
          <span className="text-[8px] px-1.5 py-0.5 rounded-sm bg-[#33CCFF]/10 text-cyan-400 font-mono">{badge}</span>
        )}
      </div>
      {expanded[id] ? <ChevronUp className="w-3 h-3 text-slate-600" /> : <ChevronDown className="w-3 h-3 text-slate-600" />}
    </button>
  );

  // RC channel bar color based on PWM value
  const rcColor = (pwm) => {
    if (pwm === 0 || pwm === 65535) return 'bg-slate-700';
    if (pwm < 1100) return 'bg-red-500/60';
    if (pwm > 1900) return 'bg-amber-500/60';
    return 'bg-cyan-500/40';
  };

  return (
    <div className="panel-glass p-3 relative corner-bracket h-full overflow-y-auto space-y-2" data-testid="mavlink-diag-panel">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-slate-400" />
          <h3 className="text-[11px] font-bold text-slate-300 uppercase tracking-widest">MAVLink Diagnostics</h3>
        </div>
        <span className="text-[9px] text-cyan-400 font-mono tabular-nums">{msgRate} msg/s</span>
      </div>

      {/* Link stats summary */}
      <div className="grid grid-cols-5 gap-1 text-center">
        {[
          { label: 'HB', value: hb, color: hb > 0 ? 'text-emerald-400' : 'text-red-400' },
          { label: 'RX', value: (bytesRx / 1024).toFixed(0) + 'K', color: 'text-cyan-400' },
          { label: 'TX', value: (bytesTx / 1024).toFixed(0) + 'K', color: 'text-cyan-400' },
          { label: 'CRC ERR', value: crcErr, color: crcErr > 0 ? 'text-red-400' : 'text-slate-500' },
          { label: 'PARSE', value: parseErr, color: parseErr > 0 ? 'text-amber-400' : 'text-slate-500' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-[#0A0C10] border border-[#1E293B]/50 rounded-sm py-1 px-1">
            <div className={`text-[10px] font-bold tabular-nums ${color}`}>{value}</div>
            <div className="text-[7px] text-slate-600 uppercase">{label}</div>
          </div>
        ))}
      </div>

      {/* RC Channels */}
      <SectionHeader id="rc" icon={Signal} title="RC Channels" badge={rcCount > 0 ? `${rcCount}ch` : 'N/A'} />
      {expanded.rc && (
        <div className="space-y-0.5 pl-1">
          {rc.length > 0 ? (
            rc.slice(0, rcCount || 18).map((pwm, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[8px] text-slate-600 w-6 text-right font-mono">CH{i + 1}</span>
                <div className="flex-1 h-3 bg-[#0A0C10] border border-[#1E293B]/30 rounded-sm overflow-hidden">
                  <div
                    className={`h-full rounded-sm transition-all ${rcColor(pwm)}`}
                    style={{ width: `${Math.max(0, Math.min(100, (pwm - 800) / 12))}%` }}
                  />
                </div>
                <span className={`text-[8px] font-mono tabular-nums w-10 text-right ${pwm === 0 ? 'text-slate-700' : 'text-slate-400'}`}>
                  {pwm === 0 ? '---' : pwm}
                </span>
              </div>
            ))
          ) : (
            <p className="text-[9px] text-slate-600 italic py-1">RC not connected</p>
          )}
        </div>
      )}

      {/* FC Telemetry */}
      <SectionHeader id="fc" icon={Gauge} title="FC Telemetry" badge={fc.msg_count ? `${fc.msg_count} msgs` : 'N/A'} />
      {expanded.fc && (
        <div className="grid grid-cols-2 gap-1 pl-1">
          {[
            { label: 'Attitude', ok: fc.attitude_valid },
            { label: 'IMU', ok: fc.imu_valid },
            { label: 'Barometer', ok: fc.baro_valid },
            { label: 'GPS', ok: fc.gps_valid },
            { label: 'HUD', ok: fc.hud_valid },
            { label: 'Status', ok: fc.status_valid },
          ].map(({ label, ok }) => (
            <div key={label} className="flex items-center gap-1.5 py-0.5">
              <div className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-slate-700'}`} />
              <span className={`text-[9px] ${ok ? 'text-slate-300' : 'text-slate-600'}`}>{label}</span>
            </div>
          ))}
          {fc.battery_voltage > 0 && (
            <>
              <div className="flex justify-between col-span-2 border-t border-[#1E293B]/30 pt-1 mt-1">
                <span className="text-[8px] text-slate-500">Battery</span>
                <span className="text-[9px] text-amber-400 font-mono">{fc.battery_voltage?.toFixed(1)}V ({fc.battery_remaining}%)</span>
              </div>
              {fc.gps_valid && (
                <div className="flex justify-between col-span-2">
                  <span className="text-[8px] text-slate-500">GPS</span>
                  <span className="text-[9px] text-cyan-400 font-mono">Fix:{fc.gps_fix} Sats:{fc.gps_sats}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Detected Message IDs */}
      <SectionHeader id="msgs" icon={Zap} title="Message Types" badge={msgIds.length} />
      {expanded.msgs && (
        <div className="flex flex-wrap gap-1 pl-1 py-1">
          {msgIds.map((id, i) => (
            <span key={i} className="text-[8px] bg-[#0A0C10] border border-[#33CCFF]/10 px-1.5 py-0.5 rounded-sm text-slate-400 font-mono tabular-nums">
              {id}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default React.memo(MAVLinkDiagPanel);
