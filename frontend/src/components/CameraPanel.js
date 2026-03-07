import React from 'react';
import { Camera, Eye, Crosshair, Activity } from 'lucide-react';

function FeatureMap({ detected, tracked, quality }) {
  // Simple visualization of feature detection
  const points = [];
  const count = Math.min(detected || 0, 40);
  for (let i = 0; i < count; i++) {
    const isTracked = i < (tracked || 0);
    points.push(
      <circle
        key={i}
        cx={15 + (i % 10) * 27 + (Math.sin(i * 1.7) * 8)}
        cy={15 + Math.floor(i / 10) * 25 + (Math.cos(i * 2.3) * 6)}
        r={isTracked ? 2.5 : 1.5}
        fill={isTracked ? '#00F0FF' : '#64748B'}
        opacity={isTracked ? 0.9 : 0.4}
      />
    );
    // Draw flow vectors for tracked features
    if (isTracked) {
      const angle = (i * 0.5) + quality * 3;
      const len = 4 + Math.sin(i) * 2;
      points.push(
        <line
          key={`v${i}`}
          x1={15 + (i % 10) * 27 + (Math.sin(i * 1.7) * 8)}
          y1={15 + Math.floor(i / 10) * 25 + (Math.cos(i * 2.3) * 6)}
          x2={15 + (i % 10) * 27 + (Math.sin(i * 1.7) * 8) + Math.cos(angle) * len}
          y2={15 + Math.floor(i / 10) * 25 + (Math.cos(i * 2.3) * 6) + Math.sin(angle) * len}
          stroke="#00F0FF"
          strokeWidth="0.8"
          opacity="0.5"
        />
      );
    }
  }

  return (
    <div className="relative bg-black/60 border border-[#1E293B] rounded-sm overflow-hidden">
      <svg viewBox="0 0 280 120" className="w-full h-auto">
        {/* Grid overlay */}
        <line x1="0" y1="60" x2="280" y2="60" stroke="#1E293B" strokeWidth="0.3" />
        <line x1="140" y1="0" x2="140" y2="120" stroke="#1E293B" strokeWidth="0.3" />
        <line x1="0" y1="30" x2="280" y2="30" stroke="#1E293B" strokeWidth="0.2" strokeDasharray="2" />
        <line x1="0" y1="90" x2="280" y2="90" stroke="#1E293B" strokeWidth="0.2" strokeDasharray="2" />
        <line x1="70" y1="0" x2="70" y2="120" stroke="#1E293B" strokeWidth="0.2" strokeDasharray="2" />
        <line x1="210" y1="0" x2="210" y2="120" stroke="#1E293B" strokeWidth="0.2" strokeDasharray="2" />
        {/* Feature points + flow vectors */}
        {points}
        {/* Camera crosshair */}
        <circle cx="140" cy="60" r="12" fill="none" stroke="#1E293B" strokeWidth="0.5" />
        <line x1="135" y1="60" x2="145" y2="60" stroke="#00F0FF" strokeWidth="0.5" opacity="0.5" />
        <line x1="140" y1="55" x2="140" y2="65" stroke="#00F0FF" strokeWidth="0.5" opacity="0.5" />
      </svg>
      {/* Resolution label */}
      <div className="absolute bottom-0.5 right-1 text-[8px] text-slate-700">320x240 SIM</div>
    </div>
  );
}

export default function CameraPanel({ camera }) {
  const qualityColor = (camera?.vo_tracking_quality || 0) > 0.6 ? 'text-emerald-400' :
                       (camera?.vo_tracking_quality || 0) > 0.3 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="panel-glass p-3 relative corner-bracket" data-testid="camera-panel">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Camera className="w-3.5 h-3.5 text-slate-500" />
          <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Camera / Visual Odometry</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${
            camera?.camera_open ? 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]' : 'bg-red-500'
          }`} />
          <span className="text-[9px] text-slate-600">{camera?.camera_type || 'N/A'}</span>
        </div>
      </div>

      {/* Feature map visualization */}
      <FeatureMap 
        detected={camera?.vo_features_detected} 
        tracked={camera?.vo_features_tracked}
        quality={camera?.vo_tracking_quality || 0}
      />

      <div className="grid grid-cols-2 gap-x-4 mt-2">
        {/* Camera stats */}
        <div>
          <span className="text-[8px] text-slate-700 uppercase block mb-1">Camera</span>
          <Row label="FPS" value={camera?.fps_actual?.toFixed(1) || '0'} />
          <Row label="FRAMES" value={camera?.frame_count || 0} />
          <Row label="RES" value={`${camera?.width || 0}x${camera?.height || 0}`} />
        </div>
        {/* VO stats */}
        <div>
          <span className="text-[8px] text-slate-700 uppercase block mb-1">Visual Odometry</span>
          <Row label="FEAT" value={`${camera?.vo_features_tracked || 0}/${camera?.vo_features_detected || 0}`} />
          <Row label="QUAL" value={`${((camera?.vo_tracking_quality || 0) * 100).toFixed(0)}%`} color={qualityColor} />
          <Row label="VALID" value={camera?.vo_valid ? 'YES' : 'NO'} 
               color={camera?.vo_valid ? 'text-emerald-400' : 'text-red-400'} />
        </div>
      </div>

      {/* VO motion estimates */}
      <div className="mt-2 border-t border-[#1E293B]/30 pt-1">
        <span className="text-[8px] text-slate-700 uppercase">VO Delta (m)</span>
        <div className="flex gap-4 mt-0.5">
          <div className="flex gap-1 items-center">
            <span className="text-[9px] text-slate-600">dX</span>
            <span className="text-[10px] text-[#00F0FF] font-bold tabular-nums">{(camera?.vo_dx || 0).toFixed(4)}</span>
          </div>
          <div className="flex gap-1 items-center">
            <span className="text-[9px] text-slate-600">dY</span>
            <span className="text-[10px] text-[#00F0FF] font-bold tabular-nums">{(camera?.vo_dy || 0).toFixed(4)}</span>
          </div>
          <div className="flex gap-1 items-center">
            <span className="text-[9px] text-slate-600">Vx</span>
            <span className="text-[10px] text-cyan-300 font-bold tabular-nums">{(camera?.vo_vx || 0).toFixed(3)}</span>
          </div>
          <div className="flex gap-1 items-center">
            <span className="text-[9px] text-slate-600">Vy</span>
            <span className="text-[10px] text-cyan-300 font-bold tabular-nums">{(camera?.vo_vy || 0).toFixed(3)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-[10px] text-slate-600 uppercase">{label}</span>
      <span className={`text-[11px] font-bold tabular-nums ${color || 'text-[#00F0FF]'}`}>{value}</span>
    </div>
  );
}
