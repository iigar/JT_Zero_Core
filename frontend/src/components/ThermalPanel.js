import React, { useEffect, useRef, useState } from 'react';
import { Thermometer, RefreshCw, Power, Flame } from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL || '';

export default function ThermalPanel({ secondary }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(new Image());
  const [streamActive, setStreamActive] = useState(false);
  const [frameId, setFrameId] = useState(0);
  const [fps, setFps] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const fpsCounterRef = useRef({ count: 0, lastTime: Date.now() });

  const {
    camera_open = false,
    frame_count = 0,
    width = 640,
    height = 480,
    label = 'Thermal (Down)',
    device = 'none',
    frame_format = 'gray',
  } = secondary || {};

  const isRealCamera = camera_open && device !== 'none';
  const frameUrl = `${API}/api/camera/secondary/frame`;

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
              drawFrame(imgRef.current);
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

  // Draw thermal frame on canvas
  const drawFrame = (img) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cw = canvas.width;
    const ch = canvas.height;

    ctx.drawImage(img, 0, 0, cw, ch);

    // Crosshair overlay
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cw / 2, 0); ctx.lineTo(cw / 2, ch);
    ctx.moveTo(0, ch / 2); ctx.lineTo(cw, ch / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  };

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
                  drawFrame(imgRef.current);
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
