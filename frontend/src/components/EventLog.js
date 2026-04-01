import React, { useRef, useEffect, useCallback, useState } from 'react';

const TYPE_COLORS = {
  SYS_STARTUP: 'text-emerald-300',
  SYS_SHUTDOWN: 'text-red-300',
  SYS_HEARTBEAT: 'text-slate-500',
  SYS_ERROR: 'text-red-400',
  SYS_WARNING: 'text-amber-300',
  SYSTEM_STARTUP: 'text-emerald-300',
  SYSTEM_SHUTDOWN: 'text-red-300',
  SYSTEM_HEARTBEAT: 'text-slate-500',
  SYSTEM_ERROR: 'text-red-400',
  SYSTEM_WARNING: 'text-amber-300',
  FLIGHT_ARM: 'text-amber-200',
  FLIGHT_DISARM: 'text-slate-300',
  FLIGHT_TAKEOFF: 'text-cyan-300',
  FLIGHT_LAND: 'text-amber-300',
  FLIGHT_RTL: 'text-orange-300',
  FLIGHT_HOLD: 'text-blue-300',
  FLIGHT_ALTITUDE_REACHED: 'text-emerald-300',
  FLIGHT_OBSTACLE_DETECTED: 'text-red-300',
  ALT_REACHED: 'text-emerald-300',
  OBSTACLE: 'text-red-300',
  CMD_USER: 'text-purple-300',
  CMD_API: 'text-purple-200',
  DEFAULT: 'text-green-300',
};

const PRIORITY_BADGE = {
  200: { label: 'CRIT', cls: 'bg-red-500/20 text-red-300 border-red-500/30' },
  150: { label: 'WARN', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  100: { label: 'INFO', cls: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20' },
};

export default function EventLog({ events, fullPage }) {
  const scrollRef = useRef(null);
  const [userScrolled, setUserScrolled] = useState(false);

  // Detect if user has scrolled away from bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    setUserScrolled(!atBottom);
  }, []);

  // Only auto-scroll if user hasn't scrolled up
  useEffect(() => {
    if (!userScrolled && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, userScrolled]);

  const filtered = (events || []).filter(e =>
    e.type !== 'SYSTEM_HEARTBEAT' && e.type !== 'SENSOR_IMU_UPDATE' &&
    e.type !== 'SYS_HEARTBEAT' && e.type !== 'IMU_UPDATE'
  );

  return (
    <div className="panel-glass p-4 relative corner-bracket h-full flex flex-col" data-testid="event-log">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h3 className="text-xs uppercase tracking-widest text-slate-400 font-semibold">
          {fullPage ? 'Event Log' : 'Recent Events'}
        </h3>
        <div className="flex items-center gap-3">
          {userScrolled && (
            <button
              data-testid="scroll-to-bottom-btn"
              onClick={() => {
                setUserScrolled(false);
                if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              }}
              className="text-[10px] text-[#33CCFF] bg-[#33CCFF]/10 border border-[#33CCFF]/20 px-2 py-0.5 rounded-md hover:bg-[#33CCFF]/20 transition-colors"
            >
              Scroll to bottom
            </button>
          )}
          <span className="text-[10px] text-slate-500 tabular-nums">{filtered.length} events</span>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="event-scroll-container"
        className="flex-1 overflow-y-auto font-mono bg-black/30 border border-[#2D3A4E] rounded-lg"
        style={{
          minHeight: 0,
          maxHeight: fullPage ? 'calc(100vh - 160px)' : '100%',
        }}
      >
        <table className="w-full">
          <thead className="sticky top-0 bg-[#0D1017] z-10">
            <tr className="text-[10px] text-slate-500 uppercase tracking-wider">
              <th className="text-left px-3 py-1.5 w-16">Time</th>
              {fullPage && <th className="text-left px-2 py-1.5 w-10">Pri</th>}
              <th className="text-left px-2 py-1.5 w-32">Type</th>
              <th className="text-left px-2 py-1.5">Message</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={fullPage ? 4 : 3} className="text-center text-slate-500 text-xs py-8">
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
                    className="border-b border-[#2D3A4E]/30 hover:bg-[#33CCFF]/5 transition-colors"
                  >
                    <td className="text-[11px] text-slate-500 tabular-nums px-3 py-1 whitespace-nowrap">
                      {ev.timestamp?.toFixed(1) || '0.0'}s
                    </td>
                    {fullPage && (
                      <td className="px-2 py-1">
                        {badge && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-md border font-bold ${badge.cls}`}>
                            {badge.label}
                          </span>
                        )}
                      </td>
                    )}
                    <td className={`text-[11px] font-bold px-2 py-1 whitespace-nowrap ${color}`}>
                      {ev.type}
                    </td>
                    <td className="text-[11px] text-slate-400 px-2 py-1 truncate max-w-0">
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
