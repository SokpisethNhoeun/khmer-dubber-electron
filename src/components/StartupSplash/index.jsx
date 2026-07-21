import React, { useState, useEffect } from 'react';
import { Film, Loader2, RefreshCw, AlertCircle, FileText } from 'lucide-react';
import './StartupSplash.css';

export default function StartupSplash({ wsStatus }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleExportLogs = async () => {
    if (window.electron && window.electron.exportLogs) {
      const res = await window.electron.exportLogs();
      if (res.success) {
        alert(`Startup logs exported successfully to:\n${res.path}`);
      } else {
        alert(`Failed to export logs: ${res.error || 'Unknown error'}`);
      }
    }
  };

  const handleReload = () => {
    window.location.reload();
  };

  let statusText = 'Initializing Python AI Engine...';
  let progressPct = Math.min(95, Math.max(10, seconds * 8));

  if (seconds > 3 && seconds <= 8) {
    statusText = 'Unpacking Whisper & Demucs AI Voice Models...';
  } else if (seconds > 8 && seconds <= 15) {
    statusText = 'Loading Neural Libraries & Connecting to Port 9847...';
  } else if (seconds > 15) {
    statusText = 'Finalizing Backend Startup Handshake...';
  }

  return (
    <div className="startup-splash-overlay">
      <div className="startup-splash-card glass-panel">
        <div className="splash-logo-container">
          <div className="splash-logo-aura"></div>
          <Film size={48} className="splash-logo-icon" />
        </div>

        <h2 className="splash-title">Khmer Dubber AI Pro</h2>
        <p className="splash-subtitle">Automated Chinese to Khmer Video Dubbing Studio</p>

        <div className="splash-loader-area">
          <div className="splash-status-row">
            <Loader2 size={16} className="spinner splash-spinner" />
            <span className="splash-status-text">{statusText}</span>
          </div>

          <div className="splash-progress-track">
            <div 
              className="splash-progress-bar" 
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="splash-timer-text">Elapsed: {seconds}s</div>
        </div>

        {seconds >= 20 && (
          <div className="splash-fallback-actions">
            <div className="splash-warning-note">
              <AlertCircle size={14} style={{ color: '#f59e0b' }} />
              <span>Cold boot initial model setup may take up to 30 seconds.</span>
            </div>
            <div className="splash-btn-group">
              <button type="button" className="btn btn-secondary splash-btn" onClick={handleReload}>
                <RefreshCw size={13} />
                <span>Retry</span>
              </button>
              <button type="button" className="btn btn-secondary splash-btn" onClick={handleExportLogs}>
                <FileText size={13} />
                <span>Export Logs</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
