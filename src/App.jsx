import {
  Film,
  FolderOpen,
  Globe,
  Loader2,
  Lock,
  Music,
  Play,
  Save,
  Settings as SettingsIcon,
  Upload,
  Video,
  VolumeX
} from 'lucide-react';
import { useEffect, useState } from 'react';
import './App.css';
import Settings from './components/Settings';
import SubtitleTable from './components/SubtitleTable';
import TimelineEditor from './components/TimelineEditor';
import VideoCustomizer from './components/VideoCustomizer';
import VideoPreview from './components/VideoPreview';
import LicenseActivation from './components/LicenseActivation';
import { Input } from './components/ui/input';
import { wsService } from './services/websocket';
import { AlertCircle, Key } from 'lucide-react';

export default function App() {
  const [activationState, setActivationState] = useState('checking'); // 'checking' | 'unactivated' | 'activated'
  const [showGeminiSetup, setShowGeminiSetup] = useState(false);
  const [newGeminiKey, setNewGeminiKey] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [geminiError, setGeminiError] = useState('');

  const [wsStatus, setWsStatus] = useState('connecting');
  const [projectDir, setProjectDir] = useState('');
  const [projectData, setProjectData] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeRowId, setActiveRowId] = useState(null);

  // URL Input
  const [urlInput, setUrlInput] = useState('');

  // Settings Dialog
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Background Job Progress Overlay
  const [activeJob, setActiveJob] = useState(null); // { stage, progress, status }
  const [activeButton, setActiveButton] = useState(null); // 'import_local', 'import_url', 'transcribe', 'translate', 'isolate_bgm', 'generate_tts', 'export'
  const [displaySubtitles, setDisplaySubtitles] = useState(true);
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [stats, setStats] = useState({ ram_total: 0, ram_used: 0, gpu_total: 0, gpu_used: 0, gpu_name: 'N/A' });
  const [customizerSettings, setCustomizerSettings] = useState({
    logo_path: '',
    logo_position: 'top_left',
    logo_opacity: 0.85,
    logo_effect: 'none',
    text_overlay: '',
    text_position: 'top_right',
    text_opacity: 0.8,
    text_bg_opacity: 0.5,
    text_effect: 'none',
    footer_text: '',
    footer_opacity: 0.85,
    footer_bg_opacity: 0.6,
    footer_effect: 'none',
    sponsor_type: 'none',
    sponsor_asset: '',
    sponsor_position: 'front',
    sponsor_time: 10,
    sponsor_duration: 5
  });

  // Helper: fetch with retry (waits for local proxy to be ready)
  const fetchWithRetry = async (url, options, retries = 5, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      try {
        return await fetch(url, options);
      } catch (e) {
        if (i < retries - 1) {
          await new Promise(r => setTimeout(r, delay));
        } else {
          throw e;
        }
      }
    }
  };

  // 1. Initial License Verification on Startup
  useEffect(() => {
    const verifyLicense = async () => {
      const storedToken = localStorage.getItem('kvd_activation_token');
      const storedDeviceId = localStorage.getItem('kvd_device_id');
      
      if (!storedToken || !storedDeviceId) {
        setActivationState('unactivated');
        return;
      }
      
      try {
        const serverUrl = import.meta.env.VITE_LICENSE_SERVER_URL || 'https://video-dubber-khmer-v1.fastapicloud.dev';
        const res = await fetchWithRetry(`${serverUrl}/v1/licenses/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            activation_token: storedToken,
            device_id: storedDeviceId
          })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.valid) {
            localStorage.setItem('kvd_last_online_validation', Date.now().toString());
            setActivationState('activated');
            return;
          }
        } else {
          localStorage.removeItem('kvd_activation_token');
        }
      } catch (e) {
        console.error('Validation check failed, using offline fallback', e);
        const lastValid = localStorage.getItem('kvd_last_online_validation');
        const now = Date.now();
        // 24 hours offline grace limit
        if (lastValid && now - parseInt(lastValid, 10) > 24 * 60 * 60 * 1000) {
          alert('You have been offline for more than 24 hours. Please connect to the internet to validate your license.');
          setActivationState('unactivated');
          return;
        }
        if (!lastValid) {
          localStorage.setItem('kvd_last_online_validation', now.toString());
        }
        setActivationState('activated');
        return;
      }
      setActivationState('unactivated');
    };
    verifyLicense();
  }, []);

  // 1.1. Periodic License Validity Check (Every 2 minutes)
  useEffect(() => {
    if (activationState !== 'activated') return;

    const checkInterval = setInterval(async () => {
      const storedToken = localStorage.getItem('kvd_activation_token');
      const storedDeviceId = localStorage.getItem('kvd_device_id');
      
      if (!storedToken || !storedDeviceId) {
        setActivationState('unactivated');
        return;
      }
      
      try {
        const serverUrl = import.meta.env.VITE_LICENSE_SERVER_URL || 'https://video-dubber-khmer-v1.fastapicloud.dev';
        const res = await fetch(`${serverUrl}/v1/licenses/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            activation_token: storedToken,
            device_id: storedDeviceId
          })
        });
        
        if (res.ok) {
          const data = await res.json();
          if (data.valid) {
            localStorage.setItem('kvd_last_online_validation', Date.now().toString());
          } else {
            localStorage.removeItem('kvd_activation_token');
            setActivationState('unactivated');
            alert('License has expired or was reset by the administrator. Device logged out.');
          }
        } else {
          // License expired, disabled, or device was reset by admin
          localStorage.removeItem('kvd_activation_token');
          setActivationState('unactivated');
          alert('License has expired or was reset by the administrator. Device logged out.');
        }
      } catch (e) {
        console.error('Periodic license check failed (offline), maintaining session', e);
        const lastValid = localStorage.getItem('kvd_last_online_validation');
        const now = Date.now();
        if (lastValid && now - parseInt(lastValid, 10) > 24 * 60 * 60 * 1000) {
          localStorage.removeItem('kvd_activation_token');
          setActivationState('unactivated');
          alert('You have been offline for more than 24 hours. Please connect to the internet to validate your license.');
        }
      }
    }, 120000); // 2 minutes

    return () => clearInterval(checkInterval);
  }, [activationState]);

  // 2. Check if Gemini API key exists after activation
  useEffect(() => {
    if (activationState !== 'activated') return;
    
    const checkGeminiKey = async () => {
      const savedEncryptedKey = localStorage.getItem('gemini_api_key_encrypted');
      const savedPlainKey = localStorage.getItem('gemini_api_key');
      
      if (!savedEncryptedKey && !savedPlainKey) {
        setShowGeminiSetup(true);
      } else {
        setShowGeminiSetup(false);
      }
    };
    checkGeminiKey();
  }, [activationState]);

  // 3. Connect to WebSocket backend once activated
  useEffect(() => {
    if (activationState !== 'activated') return;

    // Establish WebSocket Connection
    wsService.connect((status) => {
      setWsStatus(status);
    });

    // Register WebSocket Message Listeners
    const unsubStatus = wsService.on('status', (data) => {
      console.log('Backend Status:', data);
    });

    const unsubProjectOpened = wsService.on('project_opened', (data) => {
      setProjectDir(data.project_dir);
      setProjectData(data.project_data);
      setActiveJob(null);
      setActiveButton(null);
    });

    const unsubMediaImported = wsService.on('media_imported', (data) => {
      setProjectData(data.project_data);
      setActiveJob(null);
      setActiveButton(null);
    });

    const unsubTranscribed = wsService.on('transcribed', (data) => {
      setProjectData(data.project_data);
      setActiveJob(null);
      setActiveButton(null);
    });

    const unsubTranslated = wsService.on('translated', (data) => {
      setProjectData(data.project_data);
      setActiveJob(null);
      setActiveButton(null);
    });

    const unsubBgmIsolated = wsService.on('bgm_isolated', (data) => {
      setProjectData(data.project_data);
      setActiveJob(null);
      setActiveButton(null);
    });

    const unsubTtsGenerated = wsService.on('tts_generated', (data) => {
      setProjectData(data.project_data);
      setActiveJob(null);
      setActiveButton(null);
    });

    const unsubExported = (data) => {
      setActiveJob(null);
      setActiveButton(null);
      alert(`Export completed successfully! Final video saved to:\n${data.video_path}`);
    };
    wsService.on('exported', unsubExported);

    const unsubProgress = wsService.on('progress', (data) => {
      setActiveJob(data);
    });

    const unsubError = wsService.on('error', (data) => {
      setActiveJob(null);
      setActiveButton(null);
      alert(`Error from backend:\n${data.message}`);
    });

    const unsubStats = wsService.on('sys_stats', (data) => {
      setStats(data);
    });

    // Auto-Open/Create Temporary Project on Startup
    setTimeout(async () => {
      if (window.electron) {
        try {
          const tempPath = await window.electron.getTempWorkspace();
          wsService.send('open_project', { project_dir: tempPath });
        } catch (e) {
          console.error('Failed to get temp workspace path', e);
        }
      } else {
        wsService.send('open_project', { project_dir: './dubify_temp_project' });
      }
    }, 1000);

    return () => {
      unsubStatus();
      unsubProjectOpened();
      unsubMediaImported();
      unsubTranscribed();
      unsubTranslated();
      unsubBgmIsolated();
      unsubTtsGenerated();
      wsService.off('exported', unsubExported);
      unsubProgress();
      unsubError();
      unsubStats();
    };
  }, [activationState]);

  // API Key Retrieval Helper
  const getDecryptedKey = async () => {
    const encryptedKey = localStorage.getItem('gemini_api_key_encrypted');
    if (!encryptedKey) return '';
    if (window.electron) {
      try {
        return await window.electron.decryptString(encryptedKey);
      } catch (e) {
        console.error('Failed to decrypt API Key', e);
        return '';
      }
    }
    return encryptedKey; // Dev browser fallback
  };

  // HANDLERS
  const handleImportLocal = async () => {
    if (activeJob) return;
    if (projectData?.video_path) {
      const confirmReplace = window.confirm("Importing a new video will replace the current video and overwrite any existing subtitles. Do you want to proceed?");
      if (!confirmReplace) return;
    }
    if (!window.electron) return;
    const filePath = await window.electron.selectVideo();
    if (filePath) {
      setActiveJob({ stage: 'importing', progress: 0, status: 'Copying file to workspace...' });
      setActiveButton('import_local');
      wsService.send('import_media', { local_path: filePath });
    }
  };

  const handleImportUrl = () => {
    if (activeJob) return;
    if (projectData?.video_path) {
      const confirmReplace = window.confirm("Importing a new video will replace the current video and overwrite any existing subtitles. Do you want to proceed?");
      if (!confirmReplace) return;
    }
    if (!urlInput.trim()) return;
    setActiveJob({ stage: 'downloading', progress: 0, status: 'Initiating download...' });
    setActiveButton('import_url');
    wsService.send('import_media', { url: urlInput.trim() });
  };

  const handleTranscribe = () => {
    if (activeJob) return;
    if (projectData?.subtitles && projectData.subtitles.length > 0) {
      const confirmTranscribe = window.confirm("You have already transcribed this video. Do you want to re-transcribe it? This will overwrite your existing subtitles.");
      if (!confirmTranscribe) return;
    }
    const whisperModel = localStorage.getItem('whisper_model') || 'base';
    setActiveJob({ stage: 'transcribing', progress: 0, status: 'Initiating transcription...' });
    setActiveButton('transcribe');
    wsService.send('transcribe', { model: whisperModel });
  };

  const handleTranslate = async () => {
    if (activeJob) return;
    const apiKey = await getDecryptedKey();
    const model = localStorage.getItem('gemini_model') || 'gemini-3.1-flash-lite';

    if (!apiKey) {
      alert('Please enter your Gemini API key in Settings before translating.');
      setIsSettingsOpen(true);
      return;
    }

    const isValid = localStorage.getItem('gemini_api_key_valid') === 'true';
    if (!isValid) {
      alert('Your Gemini API key is not validated. Please go to Settings, configure your key, and verify it is validated before translating.');
      setIsSettingsOpen(true);
      return;
    }

    const isAlreadyTranslated = projectData?.subtitles?.some(sub => sub.khmer_text && sub.khmer_text.trim().length > 0);
    if (isAlreadyTranslated) {
      const confirmTranslate = window.confirm("You have already translated the subtitles. Do you want to translate them again? This will overwrite your current Khmer translations.");
      if (!confirmTranslate) return;
    }

    setActiveJob({ stage: 'translating', progress: 0, status: 'Initiating translation...' });
    setActiveButton('translate');
    wsService.send('translate', { api_key: apiKey, model: model });
  };

  const handleIsolateBgm = () => {
    if (activeJob) return;
    if (projectData?.bgm_path) {
      const confirmIsolate = window.confirm("You have already isolated the background music. Do you want to run BGM isolation again?");
      if (!confirmIsolate) return;
    }
    setActiveJob({ stage: 'isolating_bgm', progress: 0, status: 'Initiating BGM isolation...' });
    setActiveButton('isolate_bgm');
    wsService.send('isolate_bgm');
  };

  const handleGenerateTTS = () => {
    if (activeJob) return;
    if (!projectData || !projectData.subtitles) return;
    const isAlreadyGenerated = projectData?.subtitles?.some(sub => sub.audio_path || sub.audio_status === 'ready');
    if (isAlreadyGenerated) {
      const confirmTTS = window.confirm("You have already generated the speech audio. Do you want to generate and overwrite it again?");
      if (!confirmTTS) return;
    }
    setActiveJob({ stage: 'generating_tts', progress: 0, status: 'Initiating TTS generation...' });
    setActiveButton('generate_tts');
    wsService.send('generate_tts', { subtitles: projectData.subtitles });
  };

  const handleUpdateSubtitles = (updatedSubs) => {
    setProjectData(prev => ({ ...prev, subtitles: updatedSubs }));
    wsService.send('update_subtitles', { subtitles: updatedSubs });
  };

  const handleRowSelect = (sub) => {
    setActiveRowId(sub.id);
    // Parse start time and seek video
    const parts = sub.start.split(':');
    const sec = parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
    setCurrentTime(sec);
  };

  const handleExportVideo = async () => {
    if (activeJob) return;
    if (!window.electron) return;
    const destPath = await window.electron.selectExportVideo();
    if (destPath) {
      setActiveJob({ stage: 'exporting', progress: 0, status: 'Initiating video export...' });
      setActiveButton('export');
      wsService.send('export', {
        burn_subtitles: displaySubtitles,
        output_path: destPath,
        aspect_ratio: aspectRatio,
        customizer: customizerSettings
      });
    }
  };

  const handleSaveProject = async () => {
    if (activeJob) return;
    if (!window.electron) return;
    const zipPath = await window.electron.selectSaveProject();
    if (zipPath) {
      setActiveJob({ stage: 'saving_project', progress: 0, status: 'Saving project...' });
      setActiveButton('save_project');
      wsService.send('save_project', { zip_path: zipPath });
    }
  };

  const handleLoadProject = async () => {
    if (activeJob) return;
    if (!window.electron) return;
    const filePath = await window.electron.selectOpenProject();
    if (filePath && filePath.endsWith('.dubify')) {
      const tempPath = await window.electron.getTempWorkspace();
      setActiveJob({ stage: 'loading_project', progress: 0, status: 'Loading project...' });
      setActiveButton('load_project');
      wsService.send('load_project', { zip_path: filePath, project_dir: tempPath });
    } else if (filePath) {
      alert('Invalid file format. Please select a .dubify file.');
    }
  };

  // Serve path resolver for video elements
  const getVideoSourceUrl = () => {
    if (!projectData || !projectData.video_path) return '';
    return `http://127.0.0.1:9847/files/${projectData.video_path}`;
  };

  // Helper Promise to make WebSocket key validation awaitable
  const validateApiKeyPromise = (key, model) => {
    return new Promise((resolve) => {
      const unsubscribe = wsService.on('api_key_validated', (data) => {
        unsubscribe();
        resolve(data.valid);
      });
      wsService.send('validate_api_key', { api_key: key, model: model });
      setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, 10000);
    });
  };

  const handleSaveGeminiKey = async () => {
    if (!newGeminiKey.trim()) {
      setGeminiError('Please enter a Gemini API key.');
      return;
    }
    setGeminiError('');
    setIsSavingKey(true);
    
    try {
      const isValid = await validateApiKeyPromise(newGeminiKey.trim(), 'gemini-3.1-flash-lite');
      if (!isValid) {
        setGeminiError('Invalid API key or model validation failed.');
        setIsSavingKey(false);
        return;
      }
      
      // Save key
      localStorage.setItem('gemini_api_key', newGeminiKey.trim());
      if (window.electron) {
        const encrypted = await window.electron.encryptString(newGeminiKey.trim());
        localStorage.setItem('gemini_api_key_encrypted', encrypted);
      }
      
      setShowGeminiSetup(false);
    } catch (e) {
      setGeminiError('Validation failed: ' + e.message);
      setIsSavingKey(false);
    }
  };

  if (activationState === 'checking') {
    return (
      <div className="activation-container">
        <div className="activation-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 30px' }}>
          <Loader2 size={32} className="animate-spin text-blue-500" style={{ marginBottom: '16px' }} />
          <h2 style={{ fontSize: '15px', fontWeight: '600', color: '#e5e7eb', margin: 0 }}>Verifying activation status...</h2>
        </div>
      </div>
    );
  }

  if (activationState === 'unactivated') {
    return (
      <LicenseActivation onActivated={() => setActivationState('activated')} />
    );
  }

  if (showGeminiSetup) {
    return (
      <div className="activation-container">
        <div className="activation-card">
          <div className="activation-header">
            <h1 className="activation-logo-text">Khmer Dubber</h1>
            <p className="activation-subtitle">Fast, AI-powered Khmer video translation & dubbing</p>
          </div>
          
          <div className="activation-step-title flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '10px', marginBottom: '16px' }}>
            <Key size={16} className="text-blue-500" />
            <span>Step 2: Setup Gemini API Key</span>
          </div>
          
          {geminiError && (
            <div className="activation-alert alert-error" style={{ marginBottom: '16px' }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{geminiError}</span>
            </div>
          )}
          
          <div className="activation-form">
            <div className="form-group">
              <label className="form-label">Gemini API Key</label>
              <div className="form-input-container">
                <Input
                  type="password"
                  placeholder="AIzaSy..."
                  value={newGeminiKey}
                  onChange={(e) => setNewGeminiKey(e.target.value)}
                  disabled={isSavingKey}
                />
              </div>
            </div>
            <button
              className="btn btn-primary w-full flex items-center justify-center gap-2"
              onClick={handleSaveGeminiKey}
              disabled={isSavingKey}
            >
              {isSavingKey ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Validating Key...</span>
                </>
              ) : (
                <span>Save & Continue</span>
              )}
            </button>

            <div className="activation-footer-link" style={{ textAlign: 'center', marginTop: '20px', fontSize: '12px' }}>
              <span>Don't have an API key? </span>
              <span 
                className="footer-link" 
                style={{ color: '#3b82f6', textDecoration: 'none', cursor: 'pointer', fontWeight: 500 }}
                onClick={() => {
                  if (window.electron && typeof window.electron.openExternal === 'function') {
                    window.electron.openExternal('https://aistudio.google.com/app/apikey');
                  } else {
                    window.open('https://aistudio.google.com/app/apikey', '_blank');
                  }
                }}
                onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
              >
                Get it from Google AI Studio
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Background neon glows */}
      <div className="glow-bg"></div>
      <div className="glow-bg-secondary"></div>

      {/* Top Navbar */}
      <header className="navbar glass-panel">
        <div className="navbar-left">
          <div className="app-logo">
            <Video className="logo-icon" />
            <h1>Khmer Dubber</h1>
            <span className="project-credits" style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              marginLeft: '12px',
              borderLeft: '1px solid var(--border-color)',
              paddingLeft: '12px',
              whiteSpace: 'nowrap',
              fontStyle: 'italic'
            }}>
              Khmer Translate by Nhoeun Sokpiseth
            </span>
          </div>
          <div className="connection-status">
            <span className={`status-dot ${wsStatus}`}></span>
            <span className="status-text">{wsStatus === 'connected' ? 'Engine Active' : 'Connecting...'}</span>
          </div>
        </div>

        <div className="navbar-center" style={{ display: 'flex', gap: '20px', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
          {projectDir && (
            <span className="project-path-display" style={{ borderRight: '1px solid var(--border-color)', paddingRight: '15px' }}>
              Workspace: <code>{projectDir.split('/').pop()}</code>
            </span>
          )}
          {stats.ram_total > 0 && (
            <div className="stats-item" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="stats-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }}></span>
              <span>RAM: <strong>{(stats.ram_used / 1024 / 1024 / 1024).toFixed(1)}GB</strong> / {(stats.ram_total / 1024 / 1024 / 1024).toFixed(0)}GB</span>
            </div>
          )}
          {stats.gpu_total > 0 ? (
            <div className="stats-item" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="stats-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#8b5cf6' }}></span>
              <span>GPU VRAM: <strong>{(stats.gpu_used / 1024 / 1024 / 1024).toFixed(1)}GB</strong> / {(stats.gpu_total / 1024 / 1024 / 1024).toFixed(0)}GB</span>
            </div>
          ) : (
            <div className="stats-item" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="stats-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--text-muted)' }}></span>
              <span>GPU: CUDA CPU Fallback</span>
            </div>
          )}
        </div>

        <div className="navbar-right">
          <button className="btn btn-secondary btn-sm" onClick={handleLoadProject} disabled={activeJob}>
            <FolderOpen size={14} />
            <span>Open Project</span>
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleSaveProject} disabled={activeJob}>
            <Save size={14} />
            <span>Save Project</span>
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setIsSettingsOpen(true)} disabled={activeJob}>
            <SettingsIcon size={14} />
            <span>Settings</span>
          </button>
        </div>
      </header>

      {/* Main Workspace panels */}
      <main className="workspace-grid">
        <div className="grid-left">
          <VideoPreview
            videoUrl={getVideoSourceUrl()}
            subtitles={projectData?.subtitles || []}
            currentTime={currentTime}
            onTimeUpdate={setCurrentTime}
            setPlayingState={setIsPlaying}
            displaySubtitles={displaySubtitles}
            setDisplaySubtitles={setDisplaySubtitles}
            aspectRatio={aspectRatio}
            setAspectRatio={setAspectRatio}
            customizerSettings={customizerSettings}
          />
          <VideoCustomizer
            settings={customizerSettings}
            onChange={(key, val) => setCustomizerSettings(prev => ({ ...prev, [key]: val }))}
          />
        </div>

        <div className="grid-right">
          <SubtitleTable
            subtitles={projectData?.subtitles || []}
            onUpdateSubtitles={handleUpdateSubtitles}
            onRowSelect={handleRowSelect}
            activeRowId={activeRowId}
          />
        </div>
      </main>

      {/* Bottom Timeline Section */}
      <section className="timeline-container-wrapper">
        <TimelineEditor
          subtitles={projectData?.subtitles || []}
          bgmPath={projectData?.bgm_path}
          currentTime={currentTime}
          onTimeUpdate={setCurrentTime}
          isPlaying={isPlaying}
          activeRowId={activeRowId}
          onRowSelect={handleRowSelect}
        />
      </section>

      {/* Action Footer */}
      <footer className="footer-action-bar glass-panel">
        <div className="footer-left">
          <div className="url-import-wrapper">
            <Globe className="url-icon" />
            <Input
              type="text"
              placeholder="Paste Chinese video URL (TikTok, Douyin)..."
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="url-input"
            />
            <button className="btn btn-secondary w-[40%]" onClick={handleImportUrl} disabled={activeJob}>
              {activeButton === 'import_url' && activeJob ? (
                <>
                  <Loader2 size={14} className="button-spinner spinner" />
                  <span>Importing ({activeJob.progress}%)</span>
                </>
              ) : (
                'Import URL'
              )}
            </button>
          </div>

          <button className="btn btn-secondary" onClick={handleImportLocal} disabled={activeJob}>
            {activeButton === 'import_local' && activeJob ? (
              <Loader2 size={14} className="button-spinner spinner" />
            ) : (
              <Upload size={14} />
            )}
            <span>
              {activeButton === 'import_local' && activeJob
                ? `Copying (${activeJob.progress}%)`
                : 'Upload Local File'}
            </span>
          </button>
        </div>

        <div className="footer-right">
          <button
            className="btn btn-secondary"
            onClick={handleTranscribe}
            disabled={!projectData?.video_path || activeJob}
          >
            {activeButton === 'transcribe' && activeJob ? (
              <>
                <Loader2 size={14} className="button-spinner spinner" />
                <span>Transcribing ({activeJob.progress}%)</span>
              </>
            ) : (
              <>
                <Film size={14} />
                <span>Transcribe Video</span>
              </>
            )}
          </button>

          <button
            className="btn btn-secondary"
            onClick={handleTranslate}
            disabled={!projectData?.subtitles || projectData.subtitles.length === 0 || activeJob}
          >
            {activeButton === 'translate' && activeJob ? (
              <>
                <Loader2 size={14} className="button-spinner spinner" />
                <span>Translating ({activeJob.progress}%)</span>
              </>
            ) : (
              <>
                <Lock size={14} />
                <span>Translate Subtitles</span>
              </>
            )}
          </button>

          <button
            className="btn btn-secondary"
            onClick={handleIsolateBgm}
            disabled={!projectData?.video_path || activeJob}
          >
            {activeButton === 'isolate_bgm' && activeJob ? (
              <>
                <Loader2 size={14} className="button-spinner spinner" />
                <span>Isolating BGM ({activeJob.progress}%)</span>
              </>
            ) : (
              <>
                <Music size={14} />
                <span>Isolate BGM</span>
              </>
            )}
          </button>

          <button
            className="btn btn-secondary"
            onClick={handleGenerateTTS}
            disabled={!projectData?.subtitles || projectData.subtitles.length === 0 || activeJob}
          >
            {activeButton === 'generate_tts' && activeJob ? (
              <>
                <Loader2 size={14} className="button-spinner spinner" />
                <span>Generating ({activeJob.progress}%)</span>
              </>
            ) : (
              <>
                <VolumeX size={14} />
                <span>Generate Audio</span>
              </>
            )}
          </button>

          <button
            className="btn btn-primary"
            onClick={handleExportVideo}
            disabled={!projectData?.video_path || activeJob}
          >
            {activeButton === 'export' && activeJob ? (
              <>
                <Loader2 size={14} className="button-spinner spinner" />
                <span>Exporting ({activeJob.progress}%)</span>
              </>
            ) : (
              <>
                <Play size={14} fill="currentColor" />
                <span>Export Video</span>
              </>
            )}
          </button>
        </div>
      </footer>

      {/* Settings Dialog Overlay */}
      <Settings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
