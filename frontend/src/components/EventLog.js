import React, { useRef, useEffect } from 'react';

const TYPE_COLORS = {
  SYS_STARTUP: 'text-emerald-400',
  SYS_SHUTDOWN: 'text-red-400',
  SYS_HEARTBEAT: 'text-slate-600',
  SYS_ERROR: 'text-red-500',
  SYS_WARNING: 'text-amber-400',
  SYSTEM_STARTUP: 'text-emerald-400',
  SYSTEM_SHUTDOWN: 'text-red-400',
  SYSTEM_HEARTBEAT: 'text-slate-600',
  SYSTEM_ERROR: 'text-red-500',
  SYSTEM_WARNING: 'text-amber-400',
  FLIGHT_ARM: 'text-amber-300',
  FLIGHT_DISARM: 'text-slate-400',
  FLIGHT_TAKEOFF: 'text-cyan-400',
  FLIGHT_LAND: 'text-amber-400',
  FLIGHT_RTL: 'text-orange-400',
  FLIGHT_HOLD: 'text-blue-400',
  FLIGHT_ALTITUDE_REACHED: 'text-emerald-400',
  FLIGHT_OBSTACLE_DETECTED: 'text-red-400',
  ALT_REACHED: 'text-emerald-400',
  OBSTACLE: 'text-red-400',
  CMD_USER: 'text-purple-400',
  CMD_API: 'text-purple-300',
  DEFAULT: 'text-green-400',
};

const PRIORITY_BADGE = {
  200: { label: 'CRIT', cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
  150: { label: 'WARN', cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  100: { label: 'INFO', cls: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' },
};

export default function EventLog({ events, fullPage }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const filtered = (events || []).filter(e =>
    e.type !== 'SYSTEM_HEARTBEAT' && e.type !== 'SENSOR_IMU_UPDATE' &&
    e.type !== 'SYS_HEARTBEAT' && e.type !== 'IMU_UPDATE'
  );

  // Full-page mode (Events tab) vs compact (Dashboard mini-log)
  const containerCls = fullPage
    ? 'h-full flex flex-col'
    : 'h-full flex flex-col';

  return (
    <div className={`panel-glass p-3 relative corner-bracket ${containerCls}`} data-testid="event-log">
      <div className="flex items-center justify-between mb-2 shrink-0">
        <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
          {fullPage ? 'Event Log' : 'Recent Events'}
        </h3>
        <span className="text-[9px] text-slate-700 tabular-nums">{filtered.length} events</span>
      </div>

      {/* Fixed container with internal scroll — like ArduPilot messages */}
      <div
        ref={scrollRef}
        data-testid="event-scroll-container"
        className="flex-1 overflow-y-auto font-mono bg-black/40 border border-[#1E293B] rounded-sm"
        style={{
          minHeight: 0,           // Critical for flex scroll
          maxHeight: fullPage ? 'calc(100vh - 160px)' : '100%',
        }}
      >
        <table className="w-full">
          <thead className="sticky top-0 bg-[#0A0C10] z-10">
            <tr className="text-[8px] text-slate-600 uppercase tracking-wider">
              <th className="text-left px-2 py-1 w-16">Time</th>
              {fullPage && <th className="text-left px-1 py-1 w-10">Pri</th>}
              <th className="text-left px-1 py-1 w-32">Type</th>
              <th className="text-left px-1 py-1">Message</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={fullPage ? 4 : 3} className="text-center text-slate-700 text-[10px] py-6">
                  Waiting for events...
                </td>
              </tr>
            ) : (
              filtered.map((ev, i) => {
                const color = TYPE_COLORS[ev.type] || TYPE_COLORS.DEFAULT;
                const badge = fullPage && ev.priority >= 150 ? PRIORITY_BADGE[200] :
                              fullPage && ev.priority >= 100 ? PRIORITY_BADGE[150] :
                              fullPage ? PRIORITY_BADGE[100] : null;

                return (
                  <tr
                    key={i}
                    data-testid={`event-row-${i}`}
                    className="border-b border-[#1E293B]/30 hover:bg-[#00F0FF]/3 transition-colors"
                  >
                    <td className="text-[9px] text-slate-700 tabular-nums px-2 py-0.5 whitespace-nowrap">
                      {ev.timestamp?.toFixed(1) || '0.0'}s
                    </td>
                    {fullPage && (
                      <td className="px-1 py-0.5">
                        {badge && (
                          <span className={`text-[7px] px-1 py-0 rounded border font-bold ${badge.cls}`}>
                            {badge.label}
                          </span>
                        )}
                      </td>
                    )}
                    <td className={`text-[9px] font-bold px-1 py-0.5 whitespace-nowrap ${color}`}>
                      {ev.type}
                    </td>
                    <td className="text-[9px] text-slate-500 px-1 py-0.5 truncate max-w-0">
                      {ev.message}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
