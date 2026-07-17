import {
  Film,
  FolderOpen,
  Globe,
  Loader2,
  Lock,
  Music,
  Pause,
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
import { apiFetch } from './services/apiFetch';
import { AlertCircle, Key, Link as LinkIcon } from 'lucide-react';

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
  const [isDragging, setIsDragging] = useState(false);

  // Settings Dialog
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Background Job Progress Overlay
  const [activeJob, setActiveJob] = useState(null); // { stage, progress, status }
  const [activeButton, setActiveButton] = useState(null); // 'import_local', 'import_url', 'transcribe', 'translate', 'isolate_bgm', 'generate_tts', 'export'
  const [displaySubtitles, setDisplaySubtitles] = useState(false);
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
    sponsor_duration: 5,
    subtitle_bg_style: 'black'
  });

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
        const res = await apiFetch('/v1/licenses/validate', {
          method: 'POST',
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
        const res = await apiFetch('/v1/licenses/validate', {
          method: 'POST',
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

    const unsubTtsPaused = wsService.on('tts_paused', (data) => {
      setProjectData(data.project_data);
      setActiveJob(null);
      setActiveButton(null);
    });

    const unsubJobCancelled = wsService.on('job_cancelled', (data) => {
      setActiveJob(null);
      setActiveButton(null);
    });

    const unsubAutoEmotion = wsService.on('auto_emotion_completed', (data) => {
      setProjectData(data.project_data);
      setActiveJob(null);
      setActiveButton(null);
      alert("Successfully auto-classified emotions for all segments using Gemini API!");
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
      unsubTtsPaused();
      unsubJobCancelled();
      unsubAutoEmotion();
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

  const handleImportDroppedFile = (filePath) => {
    if (activeJob) return;
    if (projectData?.video_path) {
      const confirmReplace = window.confirm("Importing a new video will replace the current video and overwrite any existing subtitles. Do you want to proceed?");
      if (!confirmReplace) return;
    }
    setActiveJob({ stage: 'importing', progress: 0, status: 'Copying file to workspace...' });
    setActiveButton('import_local');
    wsService.send('import_media', { local_path: filePath });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const ext = file.name.split('.').pop().toLowerCase();
      const videoExtensions = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v'];
      if (videoExtensions.includes(ext) || file.type.startsWith('video/')) {
        if (file.path) {
          handleImportDroppedFile(file.path);
        } else {
          alert("Could not read file path. Drag and drop file path is only supported in the desktop app.");
        }
      } else {
        alert("Please drop a valid video file.");
      }
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
    if (activeJob && (activeJob.stage === 'transcribing' || activeJob.stage === 'downloading_model')) {
      wsService.send('cancel_job', { job_name: 'transcribe' });
      setActiveJob({ stage: 'transcribing', progress: activeJob.progress, status: 'Cancelling transcription...' });
      return;
    }
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
    if (activeJob && activeJob.stage === 'translating') {
      wsService.send('cancel_job', { job_name: 'translate' });
      setActiveJob({ stage: 'translating', progress: activeJob.progress, status: 'Cancelling translation...' });
      return;
    }
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

  const handleAutoEmotion = async () => {
    if (activeJob) return;
    const apiKey = await getDecryptedKey();
    const model = localStorage.getItem('gemini_model') || 'gemini-3.1-flash-lite';

    if (!apiKey) {
      alert('Please enter your Gemini API key in Settings before auto-detecting emotions.');
      setIsSettingsOpen(true);
      return;
    }

    const isValid = localStorage.getItem('gemini_api_key_valid') === 'true';
    if (!isValid) {
      alert('Your Gemini API key is not validated. Please go to Settings, configure your key, and verify it is validated first.');
      setIsSettingsOpen(true);
      return;
    }

    setActiveJob({ stage: 'auto_emotion', progress: 0, status: 'Initiating auto-emotion classification...' });
    setActiveButton('auto_emotion');
    wsService.send('auto_emotion', { api_key: apiKey, model: model });
  };

  const handleIsolateBgm = () => {
    if (activeJob && activeJob.stage === 'isolating_bgm') {
      wsService.send('cancel_job', { job_name: 'isolate_bgm' });
      setActiveJob({ stage: 'isolating_bgm', progress: activeJob.progress, status: 'Cancelling BGM isolation...' });
      return;
    }
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
    console.log("handleGenerateTTS clicked. activeJob:", activeJob);
    // If currently running, click to pause
    if (activeJob && (activeJob.stage === 'generating_tts' || activeJob.stage === 'resuming_tts')) {
      console.log("Sending cancel_job for generate_tts...");
      wsService.send('cancel_job', { job_name: 'generate_tts' });
      setActiveJob({ stage: 'generating_tts', progress: activeJob.progress, status: 'Pausing generation...' });
      return;
    }

    if (activeJob) return;
    if (!projectData || !projectData.subtitles) return;

    const readySubs = projectData.subtitles.filter(sub => sub.audio_status === 'ready' && sub.audio_path);

    if (readySubs.length > 0) {
      if (readySubs.length < projectData.subtitles.length) {
        // Partially completed project - offer resume or restart
        const choice = window.confirm("You have partially generated audio. Click 'OK' to Resume from where you left off, or 'Cancel' to regenerate all audio from scratch.");
        if (choice) {
          // Resume (send as is)
          setActiveJob({ stage: 'generating_tts', progress: Math.round((readySubs.length / projectData.subtitles.length) * 100), status: 'Resuming TTS generation...' });
          setActiveButton('generate_tts');
          wsService.send('generate_tts', { subtitles: projectData.subtitles });
          return;
        } else {
          // Start from scratch (clear statuses first)
          const resetSubs = projectData.subtitles.map(sub => ({ ...sub, audio_status: 'not_generated', audio_path: '' }));
          setProjectData(prev => ({ ...prev, subtitles: resetSubs }));
          setActiveJob({ stage: 'generating_tts', progress: 0, status: 'Initiating TTS generation...' });
          setActiveButton('generate_tts');
          wsService.send('generate_tts', { subtitles: resetSubs });
          return;
        }
      } else {
        // Fully completed project - prompt to overwrite
        const confirmOverwrite = window.confirm("You have already generated all speech audio. Do you want to overwrite it and generate again from scratch?");
        if (!confirmOverwrite) return;

        const resetSubs = projectData.subtitles.map(sub => ({ ...sub, audio_status: 'not_generated', audio_path: '' }));
        setProjectData(prev => ({ ...prev, subtitles: resetSubs }));
        setActiveJob({ stage: 'generating_tts', progress: 0, status: 'Initiating TTS generation...' });
        setActiveButton('generate_tts');
        wsService.send('generate_tts', { subtitles: resetSubs });
        return;
      }
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
    if (activeJob && activeJob.stage === 'exporting') {
      wsService.send('cancel_job', { job_name: 'export' });
      setActiveJob({ stage: 'exporting', progress: activeJob.progress, status: 'Cancelling export...' });
      return;
    }
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

  // Keyboard Shortcuts Effect
  useEffect(() => {
    const handleKeyDown = (e) => {
      const activeEl = document.activeElement;
      if (activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.isContentEditable ||
        activeEl.classList.contains('select-trigger')
      )) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying(prev => {
          const next = !prev;
          const video = document.querySelector('.main-video-element');
          if (video) {
            if (next) video.play().catch(err => console.error(err));
            else video.pause();
          }
          return next;
        });
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        const video = document.querySelector('.main-video-element');
        if (video) {
          const newTime = Math.min(video.duration, video.currentTime + 2);
          video.currentTime = newTime;
          setCurrentTime(newTime);
        }
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        const video = document.querySelector('.main-video-element');
        if (video) {
          const newTime = Math.max(0, video.currentTime - 2);
          video.currentTime = newTime;
          setCurrentTime(newTime);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
        e.preventDefault();
        handleSaveProject();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [projectData]);

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
    <div 
      className="app-container"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drag-drop-overlay">
          <Upload size={48} />
          <h2>Drop Video File Here</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginTop: '5px' }}>The video will import automatically.</p>
        </div>
      )}
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

      {!projectData?.video_path ? (
        <div className="welcome-dashboard glass-panel">
          <div className="welcome-header">
            <h2 className="gradient-text" style={{ background: 'linear-gradient(to right, var(--primary), var(--secondary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', margin: 0 }}>Welcome to Khmer Dubber</h2>
            <p style={{ marginTop: '12px' }}>High-performance AI Dubbing & Translation. Upload a local file or paste a link to get started.</p>
          </div>
          
          <div className="dashboard-cards-grid">
            <div className="dashboard-card upload-card" onClick={handleImportLocal}>
              <Upload size={32} className="card-icon" />
              <h3>Upload Local File</h3>
              <p>Drag and drop a video file here, or click to browse your computer.</p>
            </div>
            
            <div className="dashboard-card url-card" onClick={(e) => e.stopPropagation()}>
              <LinkIcon size={32} className="card-icon" />
              <h3>Translate from Link</h3>
              <p>Paste a Chinese video URL (TikTok, Douyin, etc.) to download and import it.</p>
              
              <div className="dashboard-url-input-group">
                <input
                  type="text"
                  placeholder="Paste video URL here..."
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  className="url-input"
                />
                <button className="btn btn-import" onClick={handleImportUrl} disabled={activeJob}>
                  {activeButton === 'import_url' && activeJob ? (
                    <Loader2 size={14} className="button-spinner spinner" />
                  ) : (
                    'Import'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
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
                onAutoEmotion={handleAutoEmotion}
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
        </>
      )}

      {projectData?.video_path && (
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
               <button className="btn btn-import w-[40%]" onClick={handleImportUrl} disabled={activeJob}>
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

            <button className="btn btn-import" onClick={handleImportLocal} disabled={activeJob}>
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
              className="btn btn-transcribe"
              onClick={handleTranscribe}
              disabled={!projectData?.video_path || (activeJob && activeJob.stage !== 'transcribing' && activeJob.stage !== 'downloading_model')}
            >
              {activeJob && (activeJob.stage === 'transcribing' || activeJob.stage === 'downloading_model') ? (
                <>
                  <Pause size={14} className="button-spinner spinner" />
                  <span>Pause Transcribing ({activeJob.progress}%)</span>
                </>
              ) : (
                <>
                  <Film size={14} />
                  <span>Transcribe Video</span>
                </>
              )}
            </button>

            <button
              className="btn btn-translate"
              onClick={handleTranslate}
              disabled={!projectData?.subtitles || projectData.subtitles.length === 0 || (activeJob && activeJob.stage !== 'translating')}
            >
              {activeJob && activeJob.stage === 'translating' ? (
                <>
                  <Pause size={14} className="button-spinner spinner" />
                  <span>Pause Translating ({activeJob.progress}%)</span>
                </>
              ) : (
                <>
                  <Lock size={14} />
                  <span>Translate Subtitles</span>
                </>
              )}
            </button>

            <button
              className="btn btn-isolate"
              onClick={handleIsolateBgm}
              disabled={!projectData?.video_path || (activeJob && activeJob.stage !== 'isolating_bgm')}
            >
              {activeJob && activeJob.stage === 'isolating_bgm' ? (
                <>
                  <Pause size={14} className="button-spinner spinner" />
                  <span>Pause BGM ({activeJob.progress}%)</span>
                </>
              ) : (
                <>
                  <Music size={14} />
                  <span>Isolate BGM</span>
                </>
              )}
            </button>

            <button
              className="btn btn-generate"
              onClick={handleGenerateTTS}
              disabled={!projectData?.subtitles || projectData.subtitles.length === 0 || (activeJob && activeJob.stage !== 'generating_tts')}
            >
              {activeJob && activeJob.stage === 'generating_tts' ? (
                <>
                  <Pause size={14} className="button-spinner spinner" />
                  <span>Pause Generating ({activeJob.progress}%)</span>
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
              disabled={!projectData?.video_path || (activeJob && activeJob.stage !== 'exporting')}
            >
              {activeJob && activeJob.stage === 'exporting' ? (
                <>
                  <Pause size={14} className="button-spinner spinner" />
                  <span>Pause Export ({activeJob.progress}%)</span>
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
      )}

      {/* Settings Dialog Overlay */}
      <Settings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
