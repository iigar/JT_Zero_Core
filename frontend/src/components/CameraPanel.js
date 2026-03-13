import React, { useEffect, useRef, useState } from 'react';
import { Camera, Eye, Crosshair, Zap } from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL;

export default function CameraPanel({ camera, features = [] }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(new Image());
  const [streamActive, setStreamActive] = useState(false);
  const [frameId, setFrameId] = useState(0);
  const featuresRef = useRef([]);
  const frameUrl = `${API}/api/camera/frame`;
  
  const {
    camera_type = 'SIMULATED',
    camera_open = false,
    frame_count = 0,
    fps_actual = 0,
    width = 320,
    height = 240,
    vo_features_detected = 0,
    vo_features_tracked = 0,
    vo_tracking_quality = 0,
    vo_dx = 0,
    vo_dy = 0,
    vo_valid = false,
  } = camera || {};

  const isReal = !['SIMULATED', 'SIM', 'NONE', ''].includes(camera_type) && camera_open;

  // Keep features ref in sync for use inside draw callback
  useEffect(() => { featuresRef.current = features; }, [features]);

  // Poll camera frames at ~3fps
  useEffect(() => {
    if (!isReal) return;
    let active = true;
    
    const fetchFrame = async () => {
      if (!active) return;
      try {
        const resp = await fetch(`${frameUrl}?t=${Date.now()}`);
        if (resp.ok && resp.status === 200) {
          const blob = await resp.blob();
          if (blob.size > 0) {
            const url = URL.createObjectURL(blob);
            imgRef.current.onload = () => {
              drawFrame(imgRef.current);
              URL.revokeObjectURL(url);
              setStreamActive(true);
              setFrameId(prev => prev + 1);
            };
            imgRef.current.src = url;
          }
        }
      } catch (e) { /* ignore */ }
      if (active) setTimeout(fetchFrame, 333); // ~3fps
    };
    
    fetchFrame();
    return () => { active = false; };
  }, [isReal, frameUrl]);

  // Draw frame + real feature overlay on canvas
  const drawFrame = (img) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cw = canvas.width;
    const ch = canvas.height;
    
    // Draw grayscale camera image
    ctx.drawImage(img, 0, 0, cw, ch);
    
    const scale_x = cw / (width || 320);
    const scale_y = ch / (height || 240);
    const feats = featuresRef.current;
    
    if (feats && feats.length > 0) {
      // Draw REAL feature positions from C++ VO
      for (let i = 0; i < feats.length; i++) {
        const f = feats[i];
        const fx = f.x * scale_x;
        const fy = f.y * scale_y;
        
        if (f.tracked) {
          // Tracked features: green squares with glow
          ctx.shadowColor = 'rgba(0, 255, 100, 0.5)';
          ctx.shadowBlur = 4;
          ctx.fillStyle = 'rgba(0, 255, 100, 0.9)';
          ctx.fillRect(fx - 3, fy - 3, 6, 6);
          ctx.shadowBlur = 0;
        } else {
          // Detected (not tracked): cyan circles
          ctx.fillStyle = 'rgba(0, 240, 255, 0.7)';
          ctx.beginPath();
          ctx.arc(fx, fy, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (vo_features_detected > 0) {
      // Fallback: pseudo-random positions (old simulator has no feature coords)
      ctx.fillStyle = 'rgba(0, 240, 255, 0.5)';
      for (let i = 0; i < Math.min(vo_features_detected, 80); i++) {
        const phi = 1.618033988;
        const fx = ((i * phi * 97.3) % (width || 320)) * scale_x;
        const fy = ((i * phi * 61.7) % (height || 240)) * scale_y;
        ctx.beginPath();
        ctx.arc(fx, fy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    
    // VO displacement vector
    if (vo_valid) {
      const cx = cw / 2;
      const cy = ch / 2;
      const vx = vo_dx * 5000;
      const vy = vo_dy * 5000;
      ctx.strokeStyle = '#FF3366';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + vx, cy + vy);
      ctx.stroke();
      // Arrowhead
      ctx.fillStyle = '#FF3366';
      ctx.beginPath();
      ctx.arc(cx + vx, cy + vy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Crosshair
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cw / 2, 0);
    ctx.lineTo(cw / 2, ch);
    ctx.moveTo(0, ch / 2);
    ctx.lineTo(cw, ch / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // Simulated view (when no real camera)
  const drawSimulated = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cw = canvas.width;
    const ch = canvas.height;
    
    ctx.fillStyle = '#0A0C10';
    ctx.fillRect(0, 0, cw, ch);
    
    // Grid
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < cw; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke(); }
    for (let y = 0; y < ch; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke(); }
    
    // Simulated features
    ctx.fillStyle = 'rgba(0, 240, 255, 0.4)';
    for (let i = 0; i < vo_features_detected; i++) {
      const phi = 1.618033988;
      const fx = (i * phi * 97.3) % cw;
      const fy = (i * phi * 61.7) % ch;
      ctx.beginPath();
      ctx.arc(fx, fy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // "NO CAMERA" label
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SIMULATED', cw / 2, ch / 2 - 8);
    ctx.fillText(`${vo_features_detected} features`, cw / 2, ch / 2 + 8);
  };

  useEffect(() => {
    if (!isReal) drawSimulated();
  }, [isReal, vo_features_detected, vo_features_tracked]);

  const isCSI = camera_type === 'PI_CSI';
  const typeColor = isCSI ? 'text-emerald-400' : camera_type === 'USB' ? 'text-amber-400' : 'text-slate-500';
  const qualityPct = (vo_tracking_quality * 100).toFixed(0);

  return (
    <div className="h-full flex flex-col bg-[#080A0E] border border-[#1E293B] rounded-sm overflow-hidden" data-testid="camera-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0A0C10] border-b border-[#1E293B]/50 shrink-0">
        <div className="flex items-center gap-2">
          <Camera className="w-3.5 h-3.5 text-[#00F0FF]" />
          <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Camera / VO</span>
          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-sm ${
            isReal ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                   : 'bg-slate-700/30 text-slate-500 border border-slate-600/30'
          }`}>
            {isReal ? (isCSI ? 'CSI' : 'USB') : 'SIM'}
          </span>
          {streamActive && (
            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse">
              LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[9px] text-slate-500">
          <span>{fps_actual.toFixed(1)} fps</span>
          <span>#{frame_count}</span>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative min-h-0">
        <canvas
          ref={canvasRef}
          width={320}
          height={240}
          className="absolute inset-0 w-full h-full"
          style={{ imageRendering: 'pixelated' }}
          data-testid="camera-canvas"
        />
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-px bg-[#1E293B]/30 shrink-0">
        <Stat icon={<Eye className="w-3 h-3" />} label="DET" value={vo_features_detected} color="text-cyan-400" />
        <Stat icon={<Crosshair className="w-3 h-3" />} label="TRK" value={vo_features_tracked} color="text-emerald-400" />
        <Stat icon={<Zap className="w-3 h-3" />} label="Q" value={`${qualityPct}%`} color={Number(qualityPct) > 50 ? 'text-emerald-400' : 'text-amber-400'} />
        <Stat icon={null} label="TYPE" value={camera_type} color={typeColor} small />
      </div>
    </div>
  );
}

function Stat({ icon, label, value, color = 'text-slate-400', small = false }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 bg-[#0A0C10]" data-testid={`camera-stat-${label.toLowerCase()}`}>
      {icon && <span className="text-slate-600">{icon}</span>}
      <span className="text-[8px] text-slate-600 uppercase">{label}</span>
      <span className={`${small ? 'text-[8px]' : 'text-[10px]'} font-bold ${color} ml-auto`}>{value}</span>
    </div>
  );
}
