import React, { useState, useEffect } from 'react';
import { HardDrive, Play, Square, Lock, Unlock, FileText, Eye } from 'lucide-react';
import { apiCall } from '../hooks/useApi';

export default function FlightLogPanel() {
  const [status, setStatus] = useState(null);
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState('main'); // main, sessions, setpw

  const fetchStatus = async () => {
    try {
      const s = await apiCall('GET', '/api/logs/status');
      setStatus(s);
    } catch {}
  };

  useEffect(() => { fetchStatus(); const i = setInterval(fetchStatus, 3000); return () => clearInterval(i); }, []);

  const handleStart = async () => {
    setError('');
    const res = await apiCall('POST', '/api/logs/start', { password });
    if (res?.success) { fetchStatus(); }
    else { setError(res?.error || 'Failed'); }
  };

  const handleStop = async () => {
    await apiCall('POST', '/api/logs/stop');
    fetchStatus();
  };

  const handleSetPassword = async () => {
    setError('');
    const res = await apiCall('POST', '/api/logs/password', { password: newPassword });
    if (res?.success) { setView('main'); fetchStatus(); setPassword(newPassword); setNewPassword(''); }
    else { setError(res?.error || 'Failed'); }
  };

  const handleListSessions = async () => {
    setError('');
    const res = await apiCall('POST', '/api/logs/sessions', { password });
    if (res?.success) { setSessions(res.sessions); setView('sessions'); }
    else { setError(res?.error || 'Invalid password'); }
  };

  if (!status) return null;

  return (
    <div className="panel-glass p-3 relative corner-bracket space-y-2" data-testid="flight-log-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-slate-400" />
          <h3 className="text-[11px] font-bold text-slate-300 uppercase tracking-widest">Flight Log</h3>
        </div>
        {status.recording && (
          <span className="flex items-center gap-1 text-[9px] text-red-400 font-bold animate-pulse">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
            REC {status.record_count}
          </span>
        )}
      </div>

      {/* Set Password View */}
      {view === 'setpw' && (
        <div className="space-y-2">
          <p className="text-[9px] text-slate-400">Set log encryption password (min 6 chars):</p>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="New password"
            data-testid="log-new-password"
            className="w-full bg-[#0A0C10] border border-[#1E293B] rounded-sm px-2 py-1.5 text-[10px] text-slate-300 focus:border-cyan-500/50 outline-none"
          />
          <div className="flex gap-1">
            <button onClick={handleSetPassword} data-testid="log-set-pw-btn" className="flex-1 py-1.5 bg-cyan-500/10 border border-cyan-500/30 rounded-sm text-[9px] text-cyan-400 font-bold uppercase hover:bg-cyan-500/20">
              Set Password
            </button>
            <button onClick={() => setView('main')} className="px-3 py-1.5 border border-[#1E293B] rounded-sm text-[9px] text-slate-500">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Sessions View */}
      {view === 'sessions' && sessions && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-slate-400">{sessions.length} session(s)</span>
            <button onClick={() => setView('main')} className="text-[8px] text-slate-500 hover:text-slate-300">Back</button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {sessions.map((s, i) => (
              <div key={i} className="flex items-center justify-between bg-[#0A0C10] border border-[#1E293B]/50 rounded-sm px-2 py-1">
                <div className="flex items-center gap-1.5">
                  <FileText className="w-3 h-3 text-slate-600" />
                  <span className="text-[8px] text-slate-300 font-mono">{s.filename}</span>
                </div>
                <span className="text-[8px] text-slate-500">{s.size_kb} KB</span>
              </div>
            ))}
            {sessions.length === 0 && <p className="text-[9px] text-slate-600 italic">No sessions yet</p>}
          </div>
        </div>
      )}

      {/* Main View */}
      {view === 'main' && (
        <div className="space-y-2">
          {/* Password input */}
          {!status.recording && (
            <div className="flex gap-1">
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={status.password_set ? "Password" : "Set password first"}
                data-testid="log-password"
                className="flex-1 bg-[#0A0C10] border border-[#1E293B] rounded-sm px-2 py-1.5 text-[10px] text-slate-300 focus:border-cyan-500/50 outline-none"
              />
              <button onClick={() => setView('setpw')} data-testid="log-setpw-btn" className="px-2 py-1.5 border border-[#1E293B] rounded-sm text-slate-500 hover:text-amber-400">
                {status.password_set ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              </button>
            </div>
          )}

          {/* Controls */}
          <div className="flex gap-1">
            {!status.recording ? (
              <button
                onClick={handleStart}
                disabled={!password || !status.password_set}
                data-testid="log-start-btn"
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-red-500/10 border border-red-500/30 rounded-sm text-[10px] text-red-400 font-bold uppercase hover:bg-red-500/20 disabled:opacity-30"
              >
                <Play className="w-3 h-3" /> Start Recording
              </button>
            ) : (
              <button
                onClick={handleStop}
                data-testid="log-stop-btn"
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-slate-500/10 border border-slate-500/30 rounded-sm text-[10px] text-slate-400 font-bold uppercase hover:bg-slate-500/20"
              >
                <Square className="w-3 h-3" /> Stop Recording
              </button>
            )}
            <button
              onClick={handleListSessions}
              disabled={!password}
              data-testid="log-sessions-btn"
              className="px-3 py-1.5 border border-[#1E293B] rounded-sm text-slate-500 hover:text-cyan-400 disabled:opacity-30"
            >
              <Eye className="w-3 h-3" />
            </button>
          </div>

          {/* Encryption info */}
          <p className="text-[7px] text-slate-600 text-center">
            AES-256 encrypted + point cloud logging
          </p>
        </div>
      )}

      {error && <p className="text-[9px] text-red-400 text-center">{error}</p>}
    </div>
  );
}
