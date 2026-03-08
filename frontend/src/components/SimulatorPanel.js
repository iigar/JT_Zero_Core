import React, { useState, useEffect } from 'react';
import { apiCall } from '../hooks/useApi';
import { Settings, Wind, Battery, Gauge, RefreshCw } from 'lucide-react';

function Slider({ label, value, min, max, step, unit, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-slate-600 uppercase w-14 shrink-0">{label}</span>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 bg-[#1E293B] rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 
          [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full 
          [&::-webkit-slider-thumb]:bg-[#00F0FF] [&::-webkit-slider-thumb]:shadow-[0_0_4px_rgba(0,240,255,0.5)]"
      />
      <span className="text-[10px] text-[#00F0FF] font-bold tabular-nums w-12 text-right">
        {value}{unit}
      </span>
    </div>
  );
}

export default function SimulatorPanel() {
  const [config, setConfig] = useState({
    wind_speed: 0, wind_direction: 0,
    sensor_noise: 1, battery_drain: 1,
    mass_kg: 1.2, drag_coeff: 0.3,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    apiCall('GET', '/api/simulator/config').then(data => {
      if (!data.error) {
        setConfig(data);
        setLoaded(true);
      }
    }).catch(() => {});
  }, []);

  async function updateConfig(key, value) {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    await apiCall('POST', '/api/simulator/config', { [key]: value });
  }

  async function resetConfig() {
    const defaults = {
      wind_speed: 0, wind_direction: 0,
      sensor_noise: 1, battery_drain: 1,
      mass_kg: 1.2, drag_coeff: 0.3,
      turbulence: false,
    };
    setConfig(defaults);
    await apiCall('POST', '/api/simulator/config', defaults);
  }

  return (
    <div className="panel-glass p-3 relative corner-bracket" data-testid="simulator-panel">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Settings className="w-3.5 h-3.5 text-slate-500" />
          <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Simulator</h3>
        </div>
        <button 
          onClick={resetConfig}
          data-testid="sim-reset-btn"
          className="flex items-center gap-1 text-[8px] text-slate-500 hover:text-[#00F0FF] transition-colors"
        >
          <RefreshCw className="w-2.5 h-2.5" />
          RESET
        </button>
      </div>

      <div className="space-y-2">
        {/* Wind */}
        <div>
          <div className="flex items-center gap-1 mb-1">
            <Wind className="w-3 h-3 text-slate-600" />
            <span className="text-[8px] text-slate-700 uppercase">Wind</span>
          </div>
          <Slider label="Speed" value={config.wind_speed} min={0} max={15} step={0.5}
                  unit="m/s" onChange={v => updateConfig('wind_speed', v)} />
          <Slider label="Dir" value={config.wind_direction} min={0} max={360} step={10}
                  unit="°" onChange={v => updateConfig('wind_direction', v)} />
        </div>

        {/* Sensors */}
        <div>
          <span className="text-[8px] text-slate-700 uppercase">Sensor Noise</span>
          <Slider label="Noise" value={config.sensor_noise} min={0} max={3} step={0.1}
                  unit="x" onChange={v => updateConfig('sensor_noise', v)} />
        </div>

        {/* Battery */}
        <div>
          <div className="flex items-center gap-1 mb-1">
            <Battery className="w-3 h-3 text-slate-600" />
            <span className="text-[8px] text-slate-700 uppercase">Battery</span>
          </div>
          <Slider label="Drain" value={config.battery_drain} min={0} max={5} step={0.1}
                  unit="x" onChange={v => updateConfig('battery_drain', v)} />
        </div>

        {/* Physics */}
        <div>
          <div className="flex items-center gap-1 mb-1">
            <Gauge className="w-3 h-3 text-slate-600" />
            <span className="text-[8px] text-slate-700 uppercase">Physics</span>
          </div>
          <Slider label="Mass" value={config.mass_kg} min={0.5} max={5} step={0.1}
                  unit="kg" onChange={v => updateConfig('mass_kg', v)} />
          <Slider label="Drag" value={config.drag_coeff} min={0} max={2} step={0.05}
                  unit="" onChange={v => updateConfig('drag_coeff', v)} />
        </div>
      </div>
    </div>
  );
}
