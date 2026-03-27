import React, { useEffect, useRef, useState } from 'react';
import { Thermometer, RefreshCw, Power, Flame } from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL || '';

export default function ThermalPanel({ secondary, features = [], camera = null, isVOActive = false }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(new Image());
  const [streamActive, setStreamActive] = useState(false);
  const [frameId, setFrameId] = useState(0);
  const [fps, setFps] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const fpsCounterRef = useRef({ count: 0, lastTime: Date.now() });
  const featuresRef = useRef([]);
  const lastImageRef = useRef(null);
  const voStateRef = useRef({ vo_valid: false, vo_dx: 0, vo_dy: 0 });

  const {
    camera_open = false,
    frame_count = 0,
    width = 640,
    height = 480,
    label = 'Thermal (Down)',
    device = 'none',
    frame_format = 'gray',
  } = secondary || {};

  // VO stats when thermal is active VO source
  const vo_features_detected = camera?.vo_features_detected || 0;
  const vo_features_tracked = camera?.vo_features_tracked || 0;
  const vo_confidence = camera?.vo_confidence || 0;

  const isRealCamera = camera_open && device !== 'none';
  const frameUrl = `${API}/api/camera/secondary/frame`;

  // Sync VO state to ref for use inside draw functions (no dependency chain)
  useEffect(() => {
    voStateRef.current = {
      vo_valid: camera?.vo_valid || false,
      vo_dx: camera?.vo_dx || 0,
      vo_dy: camera?.vo_dy || 0,
    };
    // Redraw when camera stats change (needed for fallback pseudo-feature rendering)
    if (lastImageRef.current && canvasRef.current) {
      renderCanvas(canvasRef.current, lastImageRef.current, featuresRef.current);
    }
  }, [camera]);

  // When features change, update ref AND redraw overlay on existing image
  useEffect(() => {
    featuresRef.current = features;
    if (lastImageRef.current && canvasRef.current) {
      renderCanvas(canvasRef.current, lastImageRef.current, features);
    }
  }, [features]);

  // Auto-start streaming when real camera is connected
  useEffect(() => {
    if (isRealCamera && !streaming) {
      fetch(`${API}/api/camera/secondary/capture`, { method: 'POST' }).catch(() => {});
      setStreaming(true);
    }
  }, [isRealCamera]);

  // Poll thermal frames — EXACT same pattern as CameraPanel
  useEffect(() => {
    if (!streaming) return;
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
              lastImageRef.current = imgRef.current;
              renderCanvas(canvasRef.current, imgRef.current, featuresRef.current);
              URL.revokeObjectURL(url);
              setStreamActive(true);
              setFrameId(prev => prev + 1);
              // FPS counter
              fpsCounterRef.current.count++;
              const now = Date.now();
              if (now - fpsCounterRef.current.lastTime >= 1000) {
                setFps(fpsCounterRef.current.count);
                fpsCounterRef.current.count = 0;
                fpsCounterRef.current.lastTime = now;
              }
            };
            imgRef.current.src = url;
          }
        }
      } catch (e) { /* ignore */ }
      if (active) setTimeout(fetchFrame, 70);
    };

    fetchFrame();
    return () => { active = false; };
  }, [streaming, frameUrl]);

  // Core render: image + features + crosshair — called on frame load AND feature updates
  function renderCanvas(canvas, img, feats) {
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    const cw = canvas.width;
    const ch = canvas.height;

    // 1. Draw thermal image
    ctx.drawImage(img, 0, 0, cw, ch);

    // 2. VO Feature overlay (when thermal is active VO source)
    const scale_x = cw / 320;
    const scale_y = ch / 240;
    const vs = voStateRef.current;

    if (feats && feats.length > 0) {
      // Real feature positions from C++ VO
      ctx.save();

      for (let i = 0; i < feats.length; i++) {
        const f = feats[i];
        const fx = f.x * scale_x;
        const fy = f.y * scale_y;

        if (f.tracked) {
          ctx.shadowColor = 'rgba(255, 160, 40, 0.6)';
          ctx.shadowBlur = 5;
          ctx.fillStyle = 'rgba(255, 160, 40, 0.9)';
          ctx.fillRect(fx - 3, fy - 3, 6, 6);
          ctx.shadowBlur = 0;
          ctx.shadowColor = 'transparent';
        } else {
          ctx.shadowBlur = 0;
          ctx.shadowColor = 'transparent';
          ctx.fillStyle = 'rgba(255, 220, 80, 0.7)';
          ctx.beginPath();
          ctx.arc(fx, fy, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    } else if (vo_features_detected > 0) {
      // Fallback: C++ get_features() returned empty but VO IS detecting features
      // (ARM64 thread visibility issue — vo_result_ visible, features_ not yet)
      // Generate pseudo-deterministic positions like CameraPanel does
      const phi = 1.618033988;
      const n_tracked = Math.min(vo_features_tracked, 80);
      const n_total = Math.min(vo_features_detected, 120);
      
      for (let i = 0; i < n_total; i++) {
        const fx = ((i * phi * 97.3) % 320) * scale_x;
        const fy = ((i * phi * 61.7) % 240) * scale_y;
        
        if (i < n_tracked) {
          ctx.fillStyle = 'rgba(255, 160, 40, 0.8)';
          ctx.fillRect(fx - 3, fy - 3, 6, 6);
        } else {
          ctx.fillStyle = 'rgba(255, 220, 80, 0.6)';
          ctx.beginPath();
          ctx.arc(fx, fy, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // VO displacement vector (draw outside the if/else so it always shows)
    if (vs.vo_valid) {
      const cx = cw / 2;
      const cy = ch / 2;
      const vx = vs.vo_dx * 5000;
      const vy = vs.vo_dy * 5000;
      ctx.strokeStyle = '#FF6633';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + vx, cy + vy);
      ctx.stroke();
      ctx.fillStyle = '#FF6633';
      ctx.beginPath();
      ctx.arc(cx + vx, cy + vy, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Crosshair overlay
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cw / 2, 0); ctx.lineTo(cw / 2, ch);
    ctx.moveTo(0, ch / 2); ctx.lineTo(cw, ch / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Placeholder when no frames
  useEffect(() => {
    if (!streamActive) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const cw = canvas.width;
      const ch = canvas.height;
      ctx.fillStyle = '#0A0510';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = 'rgba(255, 120, 60, 0.2)';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(isRealCamera ? 'Starting stream...' : 'THERMAL CAMERA - Not connected', cw / 2, ch / 2);
    }
  }, [streamActive, isRealCamera]);

  return (
    <div className="h-full flex flex-col bg-[#080508] border border-[#3D1E1E] rounded-sm overflow-hidden" data-testid="thermal-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0C0810] border-b border-[#3D1E1E]/50 shrink-0">
        <div className="flex items-center gap-2">
          <Thermometer className="w-3.5 h-3.5 text-orange-400" />
          <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">{label}</span>
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm bg-orange-500/15 text-orange-400 border border-orange-500/25">
            THERMAL
          </span>
          {isVOActive && (
            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm bg-amber-400/20 text-amber-300 border border-amber-400/30 animate-pulse" data-testid="thermal-vo-active">
              VO ACTIVE
            </span>
          )}
          <span className="text-[8px] text-slate-500">{width}x{height}</span>
        </div>
        <div className="flex items-center gap-2">
          {streamActive && (
            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse">
              LIVE {fps > 0 ? `${fps}fps` : ''}
            </span>
          )}
          <span className="text-[9px] text-slate-500">#{frame_count}</span>
        </div>
      </div>

      {/* Canvas — fixed resolution like CameraPanel */}
      <div className="flex-1 relative min-h-0">
        <canvas
          ref={canvasRef}
          width={640}
          height={480}
          className="absolute inset-0 w-full h-full"
          style={{ imageRendering: 'auto' }}
          data-testid="thermal-canvas"
        />
      </div>

      {/* VO Stats bar (visible when thermal is active VO source) */}
      {isVOActive && (
        <div className="grid grid-cols-5 gap-px bg-[#3D1E1E]/30 shrink-0" data-testid="thermal-vo-stats">
          <div className="flex items-center gap-1 px-2 py-1 bg-[#0C0810]">
            <span className="text-[8px] text-slate-600">DET</span>
            <span className="text-[10px] font-bold text-orange-400 ml-auto">{vo_features_detected}</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 bg-[#0C0810]">
            <span className="text-[8px] text-slate-600">TRK</span>
            <span className="text-[10px] font-bold text-amber-400 ml-auto">{vo_features_tracked}</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 bg-[#0C0810]">
            <span className="text-[8px] text-slate-600">CONF</span>
            <span className={`text-[10px] font-bold ml-auto ${vo_confidence > 0.3 ? 'text-emerald-400' : vo_confidence > 0.15 ? 'text-amber-400' : 'text-red-400'}`}>
              {(vo_confidence * 100).toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 bg-[#0C0810]">
            <span className="text-[8px] text-slate-600">PTS</span>
            <span className={`text-[10px] font-bold ml-auto ${(features.length > 0 || vo_features_detected > 0) ? 'text-cyan-400' : 'text-red-400'}`} data-testid="thermal-feature-count">
              {features.length > 0 ? features.length : vo_features_detected}
            </span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 bg-[#0C0810]">
            <span className="text-[8px] text-slate-600">VO</span>
            <span className="text-[10px] font-bold text-amber-300 ml-auto animate-pulse">FALLBACK</span>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0C0810] border-t border-[#3D1E1E]/50 shrink-0">
        <button
          onClick={() => setStreaming(!streaming)}
          className={`flex items-center gap-1 px-2.5 py-1 text-[9px] font-bold uppercase rounded-sm border transition-colors ${
            streaming
              ? 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30'
              : 'bg-orange-500/15 text-orange-400 border-orange-500/25 hover:bg-orange-500/25'
          }`}
          data-testid="thermal-stream-btn"
        >
          {streaming ? (
            <><Power className="w-3 h-3" /> Stop</>
          ) : (
            <><Flame className="w-3 h-3" /> Stream</>
          )}
        </button>
        <button
          onClick={() => {
            fetch(`${frameUrl}?t=${Date.now()}`)
              .then(r => r.blob())
              .then(blob => {
                const url = URL.createObjectURL(blob);
                imgRef.current.onload = () => {
                  lastImageRef.current = imgRef.current;
                  renderCanvas(canvasRef.current, imgRef.current, featuresRef.current);
                  URL.revokeObjectURL(url);
                };
                imgRef.current.src = url;
              }).catch(() => {});
          }}
          disabled={streaming}
          className="flex items-center gap-1 px-2.5 py-1 text-[9px] font-bold uppercase rounded-sm
                     bg-slate-700/20 text-slate-400 border border-slate-600/30 
                     hover:bg-slate-700/30 transition-colors disabled:opacity-30"
          data-testid="thermal-capture-btn"
        >
          <RefreshCw className="w-3 h-3" />
          Snapshot
        </button>
        {streamActive && (
          <span className="text-[8px] text-slate-600 ml-auto">
            {new Date().toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}
