import React from 'react';
import { Radio, Send, Download, Link2, AlertCircle } from 'lucide-react';

function MAVLinkPanelInner({ mavlink }) {
  const stateColor = {
    CONNECTED: 'text-emerald-400',
    CONNECTING: 'text-amber-400 animate-pulse',
    DISCONNECTED: 'text-slate-500',
    LOST: 'text-red-500 animate-pulse',
  };

  const stateIcon = {
    CONNECTED: 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]',
    CONNECTING: 'bg-amber-400 animate-pulse',
    DISCONNECTED: 'bg-slate-600',
    LOST: 'bg-red-500 animate-pulse',
  };

  return (
    <div className="panel-glass p-3 relative corner-bracket h-full overflow-hidden" data-testid="mavlink-panel">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Radio className="w-3.5 h-3.5 text-slate-500" />
          <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">MAVLink</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${stateIcon[mavlink?.state] || 'bg-slate-600'}`} />
          <span className={`text-[10px] font-bold uppercase ${stateColor[mavlink?.state] || 'text-slate-500'}`}>
            {mavlink?.state || 'N/A'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4">
        {/* Connection */}
        <div>
          <span className="text-[8px] text-slate-700 uppercase block mb-1">Connection</span>
          <Row label="SYS ID" value={mavlink?.system_id || 0} />
          <Row label="COMP" value={mavlink?.component_id || 0} />
          <Row label="LINK Q" 
               value={`${((mavlink?.link_quality || 0) * 100).toFixed(0)}%`}
               color={(mavlink?.link_quality || 0) > 0.8 ? 'text-emerald-400' : 'text-amber-400'} />
          <Row label="ERRORS" value={mavlink?.errors || 0}
               color={(mavlink?.errors || 0) > 0 ? 'text-red-400' : 'text-slate-400'} />
        </div>

        {/* Flight Controller */}
        <div>
          <span className="text-[8px] text-slate-700 uppercase block mb-1">Flight Controller</span>
          <Row label="FC" value={mavlink?.fc_autopilot || 'N/A'} />
          <Row label="FW" value={mavlink?.fc_firmware?.replace('ArduPilot ', 'AP ') || 'N/A'} />
          <Row label="TYPE" value={mavlink?.fc_type || 'N/A'} />
          <Row label="ARMED" value={mavlink?.fc_armed ? 'YES' : 'NO'}
               color={mavlink?.fc_armed ? 'text-amber-400' : 'text-slate-400'} />
        </div>
      </div>

      {/* Message counters */}
      <div className="mt-2 border-t border-[#1E293B]/30 pt-1">
        <span className="text-[8px] text-slate-700 uppercase">Messages</span>
        <div className="grid grid-cols-3 gap-2 mt-1">
          <MsgCounter icon={Send} label="TX" value={mavlink?.messages_sent || 0} />
          <MsgCounter icon={Download} label="RX" value={mavlink?.messages_received || 0} />
          <MsgCounter icon={Link2} label="HB" value={Math.floor((mavlink?.messages_sent || 0) / 150)} />
        </div>
      </div>

      {/* MAVLink message types */}
      <div className="mt-2 border-t border-[#1E293B]/30 pt-1">
        <span className="text-[8px] text-slate-700 uppercase">Vision Messages Sent</span>
        <div className="flex gap-3 mt-0.5 flex-wrap">
          <MsgTag label="VISION_POS" count={mavlink?.vision_pos_sent || 0} />
          <MsgTag label="ODOMETRY" count={mavlink?.odometry_sent || 0} />
          <MsgTag label="OPT_FLOW" count={mavlink?.optical_flow_sent || 0} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-[10px] text-slate-600 uppercase">{label}</span>
      <span className={`text-[10px] font-bold tabular-nums ${color || 'text-[#00F0FF]'}`}>{value}</span>
    </div>
  );
}

function MsgCounter({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-1.5 bg-black/30 px-1.5 py-0.5 rounded-sm">
      <Icon className="w-3 h-3 text-slate-600" />
      <span className="text-[9px] text-slate-500">{label}</span>
      <span className="text-[10px] text-[#00F0FF] font-bold tabular-nums ml-auto">{value}</span>
    </div>
  );
}

function MsgTag({ label, count }) {
  return (
    <div className="text-[8px] bg-[#00F0FF]/5 border border-[#00F0FF]/20 px-1.5 py-0.5 rounded-sm">
      <span className="text-[#00F0FF] font-bold">{label}</span>
      <span className="text-slate-500 ml-1">{count}</span>
    </div>
  );
}

const MAVLinkPanel = React.memo(MAVLinkPanelInner);
export default MAVLinkPanel;
