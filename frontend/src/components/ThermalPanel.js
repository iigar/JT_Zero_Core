import React, { useEffect, useRef, useState } from 'react';
import { Thermometer, RefreshCw, Power, Flame } from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL || '';

export default function ThermalPanel({ secondary }) {
  const imgDisplayRef = useRef(null);
  const canvasRef = useRef(null);
  const [lastFrame, setLastFrame] = useState(null);
  const [error, setError] = useState(null);
  const [fps, setFps] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const fpsCounterRef = useRef({ count: 0, lastTime: Date.now() });
  const prevBlobUrl = useRef(null);

  const {
    camera_type = 'USB_THERMAL',
    camera_open = false,
    active = false,
    frame_count = 0,
    width = 640,
    height = 480,
    label = 'Thermal (Down)',
    device = 'none',
    frame_format = 'gray',
  } = secondary || {};

  const isRealCamera = camera_open && device !== 'none';
  const isJpeg = frame_format === 'jpeg';

  // Auto-start streaming when real camera is connected
  useEffect(() => {
    if (isRealCamera && !streaming) {
      fetch(`${API}/api/camera/secondary/capture`, { method: 'POST' }).catch(() => {});
      setStreaming(true);
    }
  }, [isRealCamera]);

  // Sequential polling — fetch next frame only after current one completes
  useEffect(() => {
    if (!streaming) {
      setFps(0);
      return;
    }
    let running = true;

    const fetchFrame = async () => {
      if (!running) return;
      try {
        const resp = await fetch(`${API}/api/camera/secondary/frame?t=${Date.now()}`);
        if (!running) return;
        if (resp.ok && resp.status === 200) {
          const blob = await resp.blob();
          if (!running) return;
          if (blob.size > 0) {
            // Revoke previous blob URL to prevent memory leak
            if (prevBlobUrl.current) {
              URL.revokeObjectURL(prevBlobUrl.current);
            }
            const url = URL.createObjectURL(blob);
            prevBlobUrl.current = url;

            if (isJpeg && imgDisplayRef.current) {
              // Direct <img> update — simplest, most reliable for JPEG
              imgDisplayRef.current.src = url;
            } else if (canvasRef.current) {
              // Grayscale: draw to canvas with false-color palette
              const img = new Image();
              img.onload = () => {
                drawGrayscaleFrame(img);
                URL.revokeObjectURL(url);
                prevBlobUrl.current = null;
              };
              img.src = url;
            }

            setLastFrame(Date.now());
            setError(null);

            // FPS counter
            fpsCounterRef.current.count++;
            const now = Date.now();
            if (now - fpsCounterRef.current.lastTime >= 1000) {
              setFps(fpsCounterRef.current.count);
              fpsCounterRef.current.count = 0;
              fpsCounterRef.current.lastTime = now;
            }
          }
        }
      } catch (e) {
        if (running) setError('No signal');
      }
      // Schedule next fetch after current completes
      if (running) setTimeout(fetchFrame, 100);
    };

    fetchFrame();
    return () => {
      running = false;
      if (prevBlobUrl.current) {
        URL.revokeObjectURL(prevBlobUrl.current);
        prevBlobUrl.current = null;
      }
    };
  }, [streaming, isJpeg]);

  // Manual snapshot
  const handleSnapshot = async () => {
    try {
      const resp = await fetch(`${API}/api/camera/secondary/frame?t=${Date.now()}`);
      if (resp.ok && resp.status === 200) {
        const blob = await resp.blob();
        if (blob.size > 0) {
          if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
          const url = URL.createObjectURL(blob);
          prevBlobUrl.current = url;
          if (isJpeg && imgDisplayRef.current) {
            imgDisplayRef.current.src = url;
          }
          setLastFrame(Date.now());
          setError(null);
        }
      }
    } catch (e) {
      setError('No signal');
    }
  };

  // Draw grayscale frame with iron palette (only for non-JPEG)
  const drawGrayscaleFrame = (img) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cw = canvas.width;
    const ch = canvas.height;

    ctx.drawImage(img, 0, 0, cw, ch);

    const imageData = ctx.getImageData(0, 0, cw, ch);
    const data = imageData.data;

    let vmin = 255, vmax = 0;
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i];
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
    const range = vmax - vmin;
    const scale = range > 2 ? 255.0 / range : 1.0;

    for (let i = 0; i < data.length; i += 4) {
      const raw = data[i];
      const v = range > 2 ? Math.min(255, Math.max(0, Math.round((raw - vmin) * scale))) : raw;
      let r, g, b;
      if (v < 64) {
        const t = v / 64;
        r = 0; g = 0; b = Math.floor(t * 180);
      } else if (v < 128) {
        const t = (v - 64) / 64;
        r = Math.floor(t * 220); g = 0; b = 180 - Math.floor(t * 100);
      } else if (v < 200) {
        const t = (v - 128) / 72;
        r = 220 + Math.floor(t * 35); g = Math.floor(t * 200); b = 80 - Math.floor(t * 80);
      } else {
        const t = (v - 200) / 55;
        r = 255; g = 200 + Math.floor(t * 55); b = Math.floor(t * 200);
      }
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
    ctx.putImageData(imageData, 0, 0);

    // Crosshair overlay
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cw / 2, 0); ctx.lineTo(cw / 2, ch);
    ctx.moveTo(0, ch / 2); ctx.lineTo(cw, ch / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  };

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
          {streaming && lastFrame && (
            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse">
              LIVE {fps > 0 ? `${fps}fps` : ''}
            </span>
          )}
          <span className="text-[9px] text-slate-500">#{frame_count}</span>
        </div>
      </div>

      {/* Video display */}
      <div className="flex-1 relative min-h-0 bg-black">
        {isJpeg ? (
          <img
            ref={imgDisplayRef}
            className="absolute inset-0 w-full h-full object-contain"
            alt="Thermal"
            data-testid="thermal-img"
          />
        ) : (
          <canvas
            ref={canvasRef}
            width={width || 256}
            height={height || 192}
            className="absolute inset-0 w-full h-full"
            style={{ imageRendering: 'pixelated' }}
            data-testid="thermal-canvas"
          />
        )}
        {!lastFrame && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-[11px] text-orange-400/30 font-mono">THERMAL CAMERA</p>
              <p className="text-[10px] text-orange-400/20 font-mono mt-1">
                {isRealCamera ? 'Starting stream...' : 'Not connected'}
              </p>
            </div>
          </div>
        )}
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
          onClick={handleSnapshot}
          disabled={streaming}
          className="flex items-center gap-1 px-2.5 py-1 text-[9px] font-bold uppercase rounded-sm
                     bg-slate-700/20 text-slate-400 border border-slate-600/30 
                     hover:bg-slate-700/30 transition-colors disabled:opacity-30"
          data-testid="thermal-capture-btn"
        >
          <RefreshCw className="w-3 h-3" />
          Snapshot
        </button>
        {error && <span className="text-[8px] text-red-400">{error}</span>}
        {lastFrame && (
          <span className="text-[8px] text-slate-600 ml-auto">
            {new Date(lastFrame).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}
