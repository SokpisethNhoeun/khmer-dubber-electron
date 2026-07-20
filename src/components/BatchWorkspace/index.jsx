import React, { useState, useEffect, useRef } from 'react';
import { Upload, Link2, Folder, Play, FileVideo, Terminal, Trash2, X, Sliders } from 'lucide-react';
import { Input } from '../ui/input';
import { wsService } from '../../services/websocket';
import './BatchWorkspace.css';

export default function BatchWorkspace({
  customizerSettings,
  inputs,
  setInputs,
  exportDir,
  setExportDir,
  isProcessing,
  setIsProcessing,
  logs,
  setLogs,
  showTerminal,
  setShowTerminal,
  startBatchFlag,
  setStartBatchFlag
}) {
  const [urlInput, setUrlInput] = useState('');
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [pendingBurnConfirm, setPendingBurnConfirm] = useState(false);

  // Configuration popup states
  const [showConfigPopup, setShowConfigPopup] = useState(false);
  const [popupTargetItem, setPopupTargetItem] = useState(null); // null = global batch settings, otherwise item object
  const [popupConfig, setPopupConfig] = useState({});

  const logsEndRef = useRef(null);

  // Auto-scroll logs terminal
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Auto-save Batch sessions
  useEffect(() => {
    if (inputs.length > 0) {
      const sessions = JSON.parse(localStorage.getItem('dubify_sessions') || '[]');
      const filtered = sessions.filter(s => s.id !== 'batch_active');
      const newSession = {
        id: 'batch_active',
        type: 'batch',
        name: `Batch (${inputs.length} videos)`,
        path: exportDir || 'Batch Workspace',
        timestamp: Date.now(),
        extraData: {
          inputs,
          exportDir,
          customizerSettings
        }
      };
      localStorage.setItem('dubify_sessions', JSON.stringify([newSession, ...filtered].slice(0, 20)));
    }
  }, [inputs, exportDir, customizerSettings]);

  // Auto-start on Video Splitter trigger
  useEffect(() => {
    if (startBatchFlag) {
      setStartBatchFlag(false);
      setTimeout(() => {
        handleStartBatch();
      }, 500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startBatchFlag]);

  // Bind WebSocket events
  useEffect(() => {
    const handleBatchLog = (data) => {
      setLogs((prev) => [...prev, {
        message: data.message,
        type: data.type || 'info',
        time: new Date().toLocaleTimeString()
      }]);

      // Parse status updates in-place to update the items queue UI
      if (data.message.includes('Processing video') && data.message.includes(':')) {
        const parts = data.message.split('Processing video')[1].trim().split(':');
        const namePart = parts.slice(1).join(':').trim(); // e.g. "source.mp4..."
        const cleanName = namePart.replace(/\.\.\./g, '').trim();

        setInputs((prev) =>
          prev.map((item) => {
            const itemBasename = item.type === 'local' ? item.path.split(/[\\/]/).pop() : item.url;
            if (itemBasename === cleanName || item.url === cleanName) {
              return { ...item, status: 'processing' };
            }
            return item;
          })
        );
      } else if (data.message.includes('successfully dubbed!')) {
        const match = data.message.match(/dubbed! Saved to: (.*)/);
        if (match) {
          const exportPath = match[1];
          const filename = exportPath.split(/[\\/]/).pop().replace(/^dubbed_/, '');
          setInputs((prev) =>
            prev.map((item) => {
              const itemBasename = item.type === 'local' ? item.path.split(/[\\/]/).pop() : item.url;
              if (itemBasename.includes(filename.split('.')[0]) || filename.includes(itemBasename.split('.')[0])) {
                return { ...item, status: 'success' };
              }
              return item;
            })
          );
        }
      } else if (data.message.includes('failed:')) {
        const parts = data.message.split('failed:');
        const errDesc = parts[1]?.trim() || '';
        // If fail, find the one currently "processing" and mark as failed
        setInputs((prev) =>
          prev.map((item) => {
            if (item.status === 'processing') {
              return { ...item, status: 'failed', error: errDesc };
            }
            return item;
          })
        );
      }
    };

    const handleBatchCompleted = (data) => {
      setIsProcessing(false);
      setLogs((prev) => [...prev, {
        message: `System: Batch process finished! Results: ${JSON.stringify(data.results)}`,
        type: 'success',
        time: new Date().toLocaleTimeString()
      }]);
      alert("Batch processing complete!");
    };

    const unsubLog = wsService.on('batch_log', handleBatchLog);
    const unsubCompleted = wsService.on('batch_process_completed', handleBatchCompleted);

    return () => {
      unsubLog();
      unsubCompleted();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddLocal = async () => {
    if (!window.electron) return;
    try {
      const filePaths = await window.electron.selectFile({
        title: 'Select Video Files',
        multiple: true,
        filters: [
          { name: 'Videos', extensions: ['mp4', 'mkv', 'avi', 'mov'] }
        ]
      });

      if (filePaths && Array.isArray(filePaths)) {
        const newItems = filePaths.map((path) => ({
          id: `local_${Date.now()}_${Math.random()}`,
          type: 'local',
          path,
          name: path.split(/[\\/]/).pop(),
          status: 'pending',
          error: ''
        }));
        setInputs((prev) => [...prev, ...newItems]);
        setPopupTargetItem(null);
        setPopupConfig({ ...customizerSettings });
        setShowConfigPopup(true);
      } else if (filePaths && typeof filePaths === 'string') {
        const newItem = {
          id: `local_${Date.now()}`,
          type: 'local',
          path: filePaths,
          name: filePaths.split(/[\\/]/).pop(),
          status: 'pending',
          error: ''
        };
        setInputs((prev) => [...prev, newItem]);
        setPopupTargetItem(null);
        setPopupConfig({ ...customizerSettings });
        setShowConfigPopup(true);
      }
    } catch (e) {
      console.error("Select file failed", e);
    }
  };

  const handleAddUrl = () => {
    if (!urlInput.trim()) return;
    const newItem = {
      id: `url_${Date.now()}`,
      type: 'url',
      url: urlInput.trim(),
      name: urlInput.trim(),
      status: 'pending',
      error: ''
    };
    setInputs((prev) => [...prev, newItem]);
    setUrlInput('');
    setPopupTargetItem(null);
    setPopupConfig({ ...customizerSettings });
    setShowConfigPopup(true);
  };

  const handleRemoveItem = (id) => {
    setInputs((prev) => prev.filter((item) => item.id !== id));
  };

  const handleBrowseFile = async (field) => {
    if (!window.electron) return;
    try {
      const filePaths = await window.electron.selectFile({
        title: `Select ${field === 'logo_path' ? 'Logo Image' : 'Sponsor Asset'}`,
        multiple: false,
        filters: field === 'logo_path' 
          ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
          : [{ name: 'Media', extensions: ['png', 'jpg', 'jpeg', 'mp4', 'mkv', 'avi', 'mov'] }]
      });
      if (filePaths && filePaths.length > 0) {
        const path = Array.isArray(filePaths) ? filePaths[0] : filePaths;
        setPopupConfig(prev => ({ ...prev, [field]: path }));
      }
    } catch (e) {
      console.error("Browse file failed", e);
    }
  };

  const handleSelectFolder = async () => {
    if (!window.electron) return;
    try {
      const folderPath = await window.electron.selectFolder();
      if (folderPath) {
        setExportDir(folderPath);
      }
    } catch (e) {
      console.error("Select folder failed", e);
    }
  };

  const handleStartBatch = async () => {
    if (inputs.length === 0) {
      alert("Please add at least one video to process.");
      return;
    }
    if (!exportDir) {
      alert("Please select a target export folder.");
      return;
    }

    const burnConfirm = window.confirm("Do you want to burn translated subtitles into the dubbed videos?");

    const hasSuccess = inputs.some(item => item.status === 'success');
    const hasFailed = inputs.some(item => item.status === 'failed' || item.status === 'error');

    if (hasSuccess || hasFailed) {
      setPendingBurnConfirm(burnConfirm);
      setShowResumeModal(true);
    } else {
      executeBatchProcess(inputs, burnConfirm);
    }
  };

  const executeBatchProcess = async (itemsToProcess, burnConfirm) => {
    setLogs([]);
    setIsProcessing(true);
    setShowTerminal(true);

    // Reset status of only the items we are actually processing (keep 'success' status for skipped ones)
    const targetIds = new Set(itemsToProcess.map(item => item.id));
    setInputs((prev) =>
      prev.map((item) => {
        if (targetIds.has(item.id)) {
          return { ...item, status: 'pending', error: '' };
        }
        return item;
      })
    );

    const apiKey = localStorage.getItem('gemini_api_key_encrypted');
    let decryptedKey = '';
    if (apiKey && window.electron) {
      try {
        decryptedKey = await window.electron.decryptString(apiKey);
      } catch (err) {
        console.error("Decrypt failed", err);
      }
    } else if (apiKey) {
      decryptedKey = apiKey;
    }

    if (!decryptedKey) {
      alert("Gemini API key is not configured. Please go to Settings to add and validate your key first.");
      setIsProcessing(false);
      setShowTerminal(false);
      return;
    }

    const geminiModel = localStorage.getItem('gemini_model') || 'gemini-3.1-flash-lite';
    const whisperModel = localStorage.getItem('whisper_model') || 'base';

    const batchPayload = {
      inputs: itemsToProcess.map((item) => {
        if (item.type === 'local') return { type: 'local', path: item.path };
        return { type: 'url', url: item.url };
      }),
      export_dir: exportDir,
      burn_subtitles: burnConfirm,
      api_key: decryptedKey,
      model: geminiModel,
      whisper_model: whisperModel,
      customizer: customizerSettings
    };

    wsService.send('start_batch_process', batchPayload);
  };

  const handleCancelBatch = () => {
    if (window.confirm("Are you sure you want to cancel the entire batch process?")) {
      wsService.send('cancel_job', { job_name: 'batch' });
      setIsProcessing(false);
    }
  };

  return (
    <div className="batch-container">
      <div className="batch-layout">
        {/* Left Side: Videos Queue List */}
        <div className="batch-panel">
          <div className="batch-panel-header">
            <h3>Batch Processing Queue</h3>
            <div className="flex gap-2">
              <button 
                className="btn btn-secondary btn-sm"
                onClick={() => setShowTerminal(true)}
              >
                <Terminal size={14} className="mr-1" />
                Open Logs
              </button>
            </div>
          </div>

          <div className="batch-panel-body">
            {/* Input Controls */}
            <div className="batch-input-controls ">
              <button 
                className="btn btn-import" 
                onClick={handleAddLocal}
                disabled={isProcessing}
              >
                <Upload size={14} className="mr-1" />
                Upload Videos
              </button>

              <div className="batch-url-input-group">
                <Input
                  className="w-full"
                  type="text"
                  placeholder="Paste URL Link (Douyin/TikTok)..."
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  disabled={isProcessing}
                />
                <button 
                  className="btn btn-import flex w-[25%]" 
                  onClick={handleAddUrl}
                  disabled={isProcessing || !urlInput.trim()}
                >
                  <Link2 size={14} className="mr-1" />
                  Add Link
                </button>
              </div>
            </div>

            {/* Video List */}
            {inputs.length === 0 ? (
              <div className="empty-state">
                <FileVideo size={48} strokeWidth={1} />
                <p>No videos added to the queue yet.</p>
                <p style={{ fontSize: '11px', opacity: 0.7 }}>Click "Upload Videos" or paste URLs to start batch processing.</p>
              </div>
            ) : (
              <div className="batch-video-list">
                {inputs.map((item) => (
                  <div key={item.id} className="batch-video-item">
                    <div className="video-item-info">
                      <FileVideo size={16} className="video-item-icon" />
                      <span className="video-item-name" title={item.name}>
                        {item.name}
                      </span>
                      <span className="video-item-type">{item.type}</span>
                    </div>

                    <div className="video-item-actions">
                      <span className={`status-badge ${item.status}`}>
                        {item.status}
                      </span>

                      {!isProcessing && (
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            className="btn-remove-item"
                            title={item.customizer ? "Layout override active" : "Customize item layout"}
                            onClick={() => {
                              setPopupTargetItem(item);
                              setPopupConfig(item.customizer || { ...customizerSettings });
                              setShowConfigPopup(true);
                            }}
                            style={{ color: item.customizer ? 'var(--primary)' : 'var(--text-muted)' }}
                          >
                            <Sliders size={14} />
                          </button>
                          <button 
                            className="btn-remove-item"
                            onClick={() => handleRemoveItem(item.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Setup Options */}
        <div className="batch-panel" style={{ height: 'fit-content' }}>
          <div className="batch-panel-header">
            <h3>Configuration & Launch</h3>
          </div>

          <div className="batch-panel-body batch-config-section">
            <div className="folder-select-box">
              <span className="font-semibold text-xs uppercase tracking-wider text-muted flex items-center gap-1">
                <Folder size={14} className="text-primary" />
                Target Save Folder
              </span>
              <p className="text-xs text-muted mb-2 leading-relaxed">
                Choose the folder where successfully dubbed videos will be saved.
              </p>
              {exportDir && (
                <div className="folder-path-display mb-2">{exportDir}</div>
              )}
              <button 
                className="btn btn-secondary w-full"
                onClick={handleSelectFolder}
                disabled={isProcessing}
              >
                Choose Export Directory
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {!isProcessing ? (
                <button
                  className="btn btn-primary w-full"
                  onClick={handleStartBatch}
                  disabled={inputs.length === 0 || !exportDir}
                  style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
                >
                  <Play size={14} fill="currentColor" />
                  Start Batch Processing
                </button>
              ) : (
                <button
                  className="btn btn-danger w-full"
                  onClick={handleCancelBatch}
                  style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
                >
                  <X size={14} />
                  Cancel Processing
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Terminal Log Popup */}
      {showTerminal && (
        <div className="terminal-overlay" onClick={() => setShowTerminal(false)}>
          <div className="terminal-box" onClick={(e) => e.stopPropagation()}>
            <div className="terminal-header">
              <div className="terminal-dots">
                <span className="terminal-dot red" onClick={() => setShowTerminal(false)}></span>
                <span className="terminal-dot yellow"></span>
                <span className="terminal-dot green"></span>
              </div>
              <div className="terminal-title">
                <Terminal size={14} className="text-primary" />
                <span>Process Logs Terminal</span>
              </div>
              <button className="btn-close" style={{ fontSize: '18px' }} onClick={() => setShowTerminal(false)}>&times;</button>
            </div>

            <div className="terminal-body">
              {logs.length === 0 ? (
                <div className="terminal-line info">Waiting for processing to start...</div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className={`terminal-line ${log.type}`}>
                    <span style={{ color: '#64748b', marginRight: '8px' }}>[{log.time}]</span>
                    {log.message}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>

            <div className="terminal-footer">
              <button 
                className="btn btn-secondary btn-sm"
                onClick={() => setLogs([])}
              >
                Clear Screen
              </button>
              <button 
                className="btn btn-primary btn-sm"
                onClick={() => setShowTerminal(false)}
              >
                Close Terminal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resume Batch Dialog Overlay */}
      {showResumeModal && (
        <div className="custom-dialog-overlay" onClick={() => setShowResumeModal(false)}>
          <div className="custom-dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="custom-dialog-header">
              <h3>Resume Batch Dubbing</h3>
            </div>
            <div className="custom-dialog-body">
              <p style={{ margin: '8px 0 16px 0', fontSize: '13.5px', color: 'var(--text-muted)' }}>
                You have {inputs.filter(item => item.status === 'success').length} successfully dubbed and{' '}
                {inputs.filter(item => item.status === 'failed' || item.status === 'error').length} failed/error videos in this batch queue.
                Would you like to resume only the remaining/failed videos, or start over from scratch?
              </p>
            </div>
            <div className="custom-dialog-footer">
              <button 
                className="btn btn-ghost" 
                onClick={() => setShowResumeModal(false)}
              >
                Cancel
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={() => {
                  setShowResumeModal(false);
                  executeBatchProcess(inputs, pendingBurnConfirm);
                }}
              >
                Start All Over
              </button>
              <button 
                className="btn btn-primary" 
                onClick={() => {
                  setShowResumeModal(false);
                  const remainingItems = inputs.filter(item => item.status !== 'success');
                  executeBatchProcess(remainingItems, pendingBurnConfirm);
                }}
              >
                Resume Batch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Customizer Settings Popup */}
      {showConfigPopup && (
        <div className="custom-dialog-overlay" onClick={() => setShowConfigPopup(false)}>
          <div className="custom-dialog-box" style={{ width: '600px' }} onClick={(e) => e.stopPropagation()}>
            <div className="custom-dialog-header">
              <h3>{popupTargetItem ? `Customize Layout: ${popupTargetItem.name}` : 'Default Batch Layout Settings'}</h3>
            </div>
            
            <div className="custom-dialog-body" style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'left' }}>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                {popupTargetItem 
                  ? "Configure custom overrides for this specific video. If empty, the global default settings will be used." 
                  : "Configure the default layout settings that will be applied to all videos in this batch."}
              </p>

              {/* Logo Options */}
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '12px' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: '600', color: 'var(--primary)' }}>1. Logo Overlay</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Logo Path</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        placeholder="Path to logo file (e.g. logo.png)..."
                        value={popupConfig.logo_path || ''}
                        onChange={(e) => setPopupConfig(prev => ({ ...prev, logo_path: e.target.value }))}
                        style={{ flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text)', padding: '6px 10px', borderRadius: '4px', fontSize: '12px' }}
                      />
                      {window.electron && (
                        <button 
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleBrowseFile('logo_path')}
                        >
                          Browse...
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Position</label>
                      <select
                        value={popupConfig.logo_position || 'top_left'}
                        onChange={(e) => setPopupConfig(prev => ({ ...prev, logo_position: e.target.value }))}
                        style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text)', padding: '6px 10px', borderRadius: '4px', fontSize: '12px' }}
                      >
                        <option value="top_left">Top Left</option>
                        <option value="top_right">Top Right</option>
                        <option value="bottom_left">Bottom Left</option>
                        <option value="bottom_right">Bottom Right</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Opacity ({popupConfig.logo_opacity !== undefined ? popupConfig.logo_opacity : 0.85})</label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={popupConfig.logo_opacity !== undefined ? popupConfig.logo_opacity : 0.85}
                        onChange={(e) => setPopupConfig(prev => ({ ...prev, logo_opacity: parseFloat(e.target.value) }))}
                        style={{ width: '100%', accentColor: 'var(--primary)', marginTop: '8px' }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer Options */}
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '12px' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: '600', color: 'var(--primary)' }}>2. Footer Banner Text</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Text Overlay</label>
                    <input
                      type="text"
                      placeholder="Footer text (e.g. Subscribe for more!)..."
                      value={popupConfig.footer_text || ''}
                      onChange={(e) => setPopupConfig(prev => ({ ...prev, footer_text: e.target.value }))}
                      style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text)', padding: '6px 10px', borderRadius: '4px', fontSize: '12px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Opacity ({popupConfig.footer_opacity !== undefined ? popupConfig.footer_opacity : 0.85})</label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={popupConfig.footer_opacity !== undefined ? popupConfig.footer_opacity : 0.85}
                      onChange={(e) => setPopupConfig(prev => ({ ...prev, footer_opacity: parseFloat(e.target.value) }))}
                      style={{ width: '100%', accentColor: 'var(--primary)', marginTop: '8px' }}
                    />
                  </div>
                </div>
              </div>

              {/* Subtitles Options */}
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '12px' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: '600', color: 'var(--primary)' }}>3. Subtitles Background</h4>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Style</label>
                  <select
                    value={popupConfig.subtitle_bg_style || 'black'}
                    onChange={(e) => setPopupConfig(prev => ({ ...prev, subtitle_bg_style: e.target.value }))}
                    style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text)', padding: '6px 10px', borderRadius: '4px', fontSize: '12px' }}
                  >
                    <option value="black">Black Rectangular Background Box</option>
                    <option value="outline">Outline Only (No Background Box)</option>
                    <option value="none">No Outline, No Background Box</option>
                  </select>
                </div>
              </div>

              {/* Sponsor Options */}
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '12px' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: '600', color: 'var(--primary)' }}>4. Sponsor / Ad Overlay</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Sponsor Type</label>
                      <select
                        value={popupConfig.sponsor_type || 'none'}
                        onChange={(e) => setPopupConfig(prev => ({ ...prev, sponsor_type: e.target.value }))}
                        style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text)', padding: '6px 10px', borderRadius: '4px', fontSize: '12px' }}
                      >
                        <option value="none">None</option>
                        <option value="image">Image Overlay</option>
                        <option value="video">Video Overlay (Intro/Outro)</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Position</label>
                      <select
                        value={popupConfig.sponsor_position || 'front'}
                        onChange={(e) => setPopupConfig(prev => ({ ...prev, sponsor_position: e.target.value }))}
                        style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text)', padding: '6px 10px', borderRadius: '4px', fontSize: '12px' }}
                      >
                        <option value="front">Front (Intro Video/Image)</option>
                        <option value="end">End (Outro Video/Image)</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Asset Path</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        placeholder="Path to sponsor video/image file..."
                        value={popupConfig.sponsor_asset || ''}
                        onChange={(e) => setPopupConfig(prev => ({ ...prev, sponsor_asset: e.target.value }))}
                        style={{ flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text)', padding: '6px 10px', borderRadius: '4px', fontSize: '12px' }}
                      />
                      {window.electron && (
                        <button 
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleBrowseFile('sponsor_asset')}
                        >
                          Browse...
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Sponsor Duration (seconds)</label>
                    <input
                      type="number"
                      min="1"
                      value={popupConfig.sponsor_duration || 5}
                      onChange={(e) => setPopupConfig(prev => ({ ...prev, sponsor_duration: parseInt(e.target.value) || 5 }))}
                      style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text)', padding: '6px 10px', borderRadius: '4px', fontSize: '12px' }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="custom-dialog-footer">
              <button 
                className="btn btn-ghost" 
                onClick={() => setShowConfigPopup(false)}
              >
                Cancel
              </button>
              {popupTargetItem && popupTargetItem.customizer && (
                <button 
                  className="btn btn-danger" 
                  onClick={() => {
                    // Reset override to use defaults
                    setInputs((prev) =>
                      prev.map((item) =>
                        item.id === popupTargetItem.id
                          ? { ...item, customizer: undefined }
                          : item
                      )
                    );
                    setShowConfigPopup(false);
                  }}
                >
                  Clear Overrides
                </button>
              )}
              <button 
                className="btn btn-primary" 
                onClick={() => {
                  if (popupTargetItem) {
                    // Update individual item customizer overrides
                    setInputs((prev) =>
                      prev.map((item) =>
                        item.id === popupTargetItem.id
                          ? { ...item, customizer: popupConfig }
                          : item
                      )
                    );
                  } else {
                    // Update global defaults in App state
                    Object.keys(popupConfig).forEach(key => {
                      customizerSettings[key] = popupConfig[key];
                    });
                  }
                  setShowConfigPopup(false);
                }}
              >
                Apply Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
