import {
  Globe,
  Loader2,
  Pause,
  Play,
  VolumeX,
  FileText,
  Upload,
  Film,
  Lock,
  Music,
  Video,
  FolderOpen,
  Save,
  FilePlus,
  Link as LinkIcon,
  Settings as SettingsIcon,
  Download
} from 'lucide-react';
import { useEffect, useState, useRef, useCallback } from 'react';
import './App.css';
import Settings from './components/Settings';
import StartupSplash from './components/StartupSplash';
import SubtitleTable from './components/SubtitleTable';
import TimelineEditor from './components/TimelineEditor';
import VideoCustomizer from './components/VideoCustomizer';
import VideoPreview from './components/VideoPreview';
import LicenseActivation from './components/LicenseActivation';
import ExportSubtitlesModal from './components/ExportSubtitlesModal';
import BatchWorkspace from './components/BatchWorkspace';
import VideoSplitterWorkspace from './components/VideoSplitterWorkspace';
import { Input } from './components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { wsService } from './services/websocket';
import { apiFetch } from './services/apiFetch';
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
  const [isDragging, setIsDragging] = useState(false);

  // Settings Dialog
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isExportSrtOpen, setIsExportSrtOpen] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState('single'); // 'single', 'batch', 'splitter'
  const isBatchMode = workspaceMode === 'batch';
  const [batchInputs, setBatchInputs] = useState([]);
  const [batchExportDir, setBatchExportDir] = useState('');
  const [batchIsProcessing, setBatchIsProcessing] = useState(false);
  const [splitterIsProcessing, setSplitterIsProcessing] = useState(false);
  const [batchShowTerminal, setBatchShowTerminal] = useState(false);
  const [batchLogs, setBatchLogs] = useState([]);
  const [startBatchFlag, setStartBatchFlag] = useState(false);
  const [isSessionsOpen, setIsSessionsOpen] = useState(false);
  const [newProjectDialog, setNewProjectDialog] = useState(false);
  const [exportDialog, setExportDialog] = useState(false);
  const [exportDestPath, setExportDestPath] = useState(null);
  const [exportAudioMode, setExportAudioMode] = useState('khmer');

  const pendingActionRef = useRef(null);
  const [ttsDialog, setTtsDialog] = useState({ isOpen: false, failedCount: 0, readyCount: 0 });

  // Background Job Progress Overlay
  const [activeJob, setActiveJob] = useState(null); // { stage, progress, status }
  const [activeButton, setActiveButton] = useState(null); // 'import_local', 'import_url', 'transcribe', 'translate', 'isolate_bgm', 'generate_tts', 'export'
  const activeButtonRef = useRef(null);
  
  useEffect(() => {
    activeButtonRef.current = activeButton;
  }, [activeButton]);
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
    wsService.connect(async (status) => {
      setWsStatus(status);
      if (status === 'connected') {
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
      }
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

      // Save session to localStorage
      if (data.project_dir) {
        const sessions = JSON.parse(localStorage.getItem('dubify_sessions') || '[]');
        const name = data.project_data?.video_path 
          ? data.project_data.video_path.split(/[\\/]/).pop() 
          : data.project_dir.split(/[\\/]/).pop();
        const filtered = sessions.filter(s => s.path !== data.project_dir);
        const newSession = {
          id: `single_${Date.now()}`,
          type: 'single',
          name,
          path: data.project_dir,
          timestamp: Date.now(),
          extraData: {}
        };
        const updated = [newSession, ...filtered].slice(0, 20);
        localStorage.setItem('dubify_sessions', JSON.stringify(updated));
      }
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

    const unsubExported = (data) => {
      setActiveJob(null);
      setActiveButton(null);
      alert(`Export completed successfully! Final video saved to:\n${data.video_path}`);
    };
    wsService.on('exported', unsubExported);

    const unsubProjectSaved = wsService.on('project_saved', (data) => {
      setActiveJob(null);
      setActiveButton(null);
      if (pendingActionRef.current === 'new_project') {
        pendingActionRef.current = null;
        handleNewProject();
      } else {
        alert('Project saved successfully!');
      }
    });

    const unsubProgress = wsService.on('progress', (data) => {
      if (!activeButtonRef.current) return;
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

    // Project auto-open is now handled in the wsService.connect callback
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
      wsService.off('exported', unsubExported);
      unsubProjectSaved();
      wsService.off('progress', unsubProgress);
      wsService.off('error', unsubError);
      wsService.off('sys_stats', unsubStats);
    };
  }, [activationState]);

  // API Key Retrieval Helper
  const getDecryptedKey = async () => {
    const encryptedKey = localStorage.getItem('gemini_api_key_encrypted');
    if (!encryptedKey) {
      // Fallback to plain key if encrypted key was never stored
      return localStorage.getItem('gemini_api_key') || '';
    }
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

    console.log('[Translate] API Key found:', apiKey ? `${apiKey.substring(0, 6)}...` : 'EMPTY');
    console.log('[Translate] Model:', model);

    if (!apiKey) {
      alert('Please enter your Gemini API key in Settings before translating.');
      setIsSettingsOpen(true);
      return;
    }

    // Auto-mark key as valid when present so translation starts smoothly
    localStorage.setItem('gemini_api_key_valid', 'true');

    const isAlreadyTranslated = projectData?.subtitles?.some(sub => sub.khmer_text && sub.khmer_text.trim().length > 0);
    if (isAlreadyTranslated) {
      const confirmTranslate = window.confirm("You have already translated the subtitles. Do you want to translate them again? This will overwrite your current Khmer translations.");
      if (!confirmTranslate) return;
    }

    setActiveJob({ stage: 'translating', progress: 0, status: 'Initiating translation...' });
    setActiveButton('translate');
    const sent = wsService.send('translate', { api_key: apiKey, model: model });
    if (!sent) {
      alert('Cannot translate: WebSocket is not connected to the backend. Please restart the application.');
      setActiveJob(null);
      setActiveButton(null);
    }
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

  const handleResumeTTS = () => {
    if (!projectData) return;
    const readySubs = projectData.subtitles.filter(sub => sub.audio_status === 'ready' && sub.audio_path);
    setActiveJob({ stage: 'generating_tts', progress: Math.round((readySubs.length / projectData.subtitles.length) * 100), status: 'Resuming TTS generation...' });
    setActiveButton('generate_tts');
    wsService.send('generate_tts', { subtitles: projectData.subtitles });
  };

  const handleRegenerateAllTTS = () => {
    if (!projectData) return;
    const resetSubs = projectData.subtitles.map(sub => ({ ...sub, audio_status: 'not_generated', audio_path: '' }));
    setProjectData(prev => ({ ...prev, subtitles: resetSubs }));
    setActiveJob({ stage: 'generating_tts', progress: 0, status: 'Initiating TTS generation...' });
    setActiveButton('generate_tts');
    wsService.send('generate_tts', { subtitles: resetSubs });
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

    const failedSubs = projectData.subtitles.filter(sub => sub.audio_status === 'failed');
    const readySubs = projectData.subtitles.filter(sub => sub.audio_status === 'ready' && sub.audio_path);

    if (readySubs.length > 0 || failedSubs.length > 0) {
      setTtsDialog({
        isOpen: true,
        failedCount: failedSubs.length,
        readyCount: readySubs.length
      });
      return;
    }

    // Start clean if none are ready or failed
    handleRegenerateAllTTS();
  };

  const handleUpdateSubtitles = useCallback((updatedSubs) => {
    setProjectData(prev => ({ ...prev, subtitles: updatedSubs }));
    wsService.send('update_subtitles', { subtitles: updatedSubs });
  }, []);

  const handleRowSelect = useCallback((sub) => {
    setActiveRowId(sub.id);
    // Parse start time and seek video
    const parts = sub.start.split(':');
    const sec = parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
    setCurrentTime(sec);
  }, []);

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
      setExportDestPath(destPath);
      setExportAudioMode('khmer'); // Default to khmer dub
      setExportDialog(true);
    }
  };

  const confirmExportVideo = () => {
    setExportDialog(false);
    if (!exportDestPath) return;
    
    setActiveJob({ stage: 'exporting', progress: 0, status: 'Initiating video export...' });
    setActiveButton('export');
    wsService.send('export', {
      burn_subtitles: displaySubtitles,
      output_path: exportDestPath,
      aspect_ratio: aspectRatio,
      customizer: customizerSettings,
      audio_mode: exportAudioMode
    });
  };
  const handleNewProject = async () => {
    setNewProjectDialog(false);
    
    // Completely reset the frontend UI state to return to the Welcome Dashboard
    setWorkspaceMode('single');
    setUrlInput('');
    setProjectData(null);
    setActiveJob(null);
    setActiveButton(null);

    // Tell the backend to create a fresh workspace directory
    if (window.electron) {
      try {
        const tempPath = await window.electron.getTempWorkspace();
        wsService.send('open_project', { project_dir: tempPath });
      } catch (e) {
        console.error('Failed to create new project workspace', e);
      }
    } else {
      wsService.send('open_project', { project_dir: `./dubify_temp_project_${Date.now()}` });
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
    } else {
      // User cancelled the file picker, clear pending action so we don't accidentally wipe the project later
      if (pendingActionRef.current === 'new_project') {
        pendingActionRef.current = null;
      }
    }
  };

  const getActiveSessions = () => {
    const sessions = JSON.parse(localStorage.getItem('dubify_sessions') || '[]');
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const active = sessions.filter(s => s.timestamp > sevenDaysAgo);
    if (active.length !== sessions.length) {
      localStorage.setItem('dubify_sessions', JSON.stringify(active));
    }
    return active;
  };

  const handleRemoveSession = (id) => {
    const sessions = JSON.parse(localStorage.getItem('dubify_sessions') || '[]');
    const updated = sessions.filter(s => s.id !== id);
    localStorage.setItem('dubify_sessions', JSON.stringify(updated));
  };

  const handleClearAllSessions = () => {
    localStorage.removeItem('dubify_sessions');
  };

  const handleLoadSession = (session) => {
    if (session.type === 'single') {
      wsService.send('open_project', { project_dir: session.path });
      setWorkspaceMode('single');
    } else if (session.type === 'batch') {
      setBatchInputs(session.extraData?.inputs || []);
      setBatchExportDir(session.extraData?.exportDir || '');
      if (session.extraData?.customizerSettings) {
        setCustomizerSettings(session.extraData.customizerSettings);
      }
      setWorkspaceMode('batch');
    }
    setIsSessionsOpen(false);
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
        resolve(data);
      });
      wsService.send('validate_api_key', { api_key: key, model: model });
      setTimeout(() => {
        unsubscribe();
        resolve({ valid: false, error: 'Validation timed out.' });
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
      const result = await validateApiKeyPromise(newGeminiKey.trim(), 'gemini-3.1-flash-lite');
      if (!result.valid) {
        setGeminiError(result.error || 'Invalid API key or model validation failed.');
        setIsSavingKey(false);
        return;
      }
      
      // Save key
      localStorage.setItem('gemini_api_key', newGeminiKey.trim());
      if (window.electron) {
        const encrypted = await window.electron.encryptString(newGeminiKey.trim());
        localStorage.setItem('gemini_api_key_encrypted', encrypted);
      } else {
        localStorage.setItem('gemini_api_key_encrypted', newGeminiKey.trim());
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

  const isAnyProcessing = !!activeJob || batchIsProcessing || splitterIsProcessing;

  return (
    <div 
      className="app-container"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {activationState === 'activated' && wsStatus !== 'connected' && (
        <StartupSplash wsStatus={wsStatus} />
      )}

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
         
        </div>

        <div className="navbar-center" style={{ display: 'flex', gap: '20px', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
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
          <div className="mode-select-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '170px' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '11px', whiteSpace: 'nowrap' }}>Mode:</span>
            <Select
              value={workspaceMode}
              onValueChange={(val) => setWorkspaceMode(val)}
              disabled={isAnyProcessing}
            >
              <SelectTrigger className="w-full h-8 text-xs bg-black/25 border border-white/10 rounded-md focus:ring-0 focus:ring-offset-0 focus:outline-none">
                <SelectValue placeholder="Select mode" />
              </SelectTrigger>
              <SelectContent className="bg-[#11141c] border border-white/10 text-gray-100">
                <SelectItem value="single">Single Video Mode</SelectItem>
                <SelectItem value="batch">Batch Dubbing Mode</SelectItem>
                <SelectItem value="splitter">Video Splitter Mode</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <button className="btn btn-secondary btn-sm" onClick={() => setNewProjectDialog(true)} disabled={isAnyProcessing}>
            <FilePlus size={14} />
            <span>New</span>
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setIsSessionsOpen(true)} disabled={isAnyProcessing}>
            <FolderOpen size={14} />
            <span>Sessions</span>
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleSaveProject} disabled={isAnyProcessing}>
            <Save size={14} />
            <span>Save Project</span>
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setIsSettingsOpen(true)} disabled={isAnyProcessing}>
            <SettingsIcon size={14} />
            <span>Settings</span>
          </button>
        </div>
      </header>

      {workspaceMode === 'batch' ? (
        <BatchWorkspace 
          customizerSettings={customizerSettings}
          inputs={batchInputs}
          setInputs={setBatchInputs}
          exportDir={batchExportDir}
          setExportDir={setBatchExportDir}
          isProcessing={batchIsProcessing}
          setIsProcessing={setBatchIsProcessing}
          logs={batchLogs}
          setLogs={setBatchLogs}
          showTerminal={batchShowTerminal}
          setShowTerminal={setBatchShowTerminal}
          startBatchFlag={startBatchFlag}
          setStartBatchFlag={setStartBatchFlag}
        />
      ) : workspaceMode === 'splitter' ? (
        <VideoSplitterWorkspace
          setBatchInputs={setBatchInputs}
          setWorkspaceMode={setWorkspaceMode}
          setStartBatchFlag={setStartBatchFlag}
          isProcessing={splitterIsProcessing}
          setIsProcessing={setSplitterIsProcessing}
        />
      ) : !projectData?.video_path ? (
        <div className="welcome-dashboard glass-panel">
          <div className="welcome-header">
            <h2 className="gradient-text" style={{ background: 'linear-gradient(to right, var(--primary), var(--secondary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', margin: 0 }}>Welcome to Khmer Dubber</h2>
            <p style={{ marginTop: '12px' }}>High-performance AI Dubbing & Translation. Upload a local file or paste a link to get started.</p>
          </div>
          
          <div className="dashboard-cards-grid">
            <div className="dashboard-card upload-card" onClick={handleImportLocal}>
              <Upload size={32} className="card-icon" />
              <h3>Upload Video</h3>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Loader2 size={14} className="button-spinner spinner" />
                      <span>{activeJob.progress || 0}%</span>
                    </div>
                  ) : (
                    'Import'
                  )}
                </button>
              </div>

              {activeButton === 'import_url' && activeJob && (
                <div style={{ marginTop: '12px', width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    <span>{activeJob.status || 'Downloading video from link...'}</span>
                    <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{activeJob.progress || 0}%</span>
                  </div>
                  <div style={{ width: '100%', height: '5px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${activeJob.progress || 0}%`, height: '100%', backgroundColor: 'var(--primary)', transition: 'width 0.2s ease-out' }} />
                  </div>
                </div>
              )}
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
                activeJob={activeJob}
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
        </>
      )}

      {!isBatchMode && projectData?.video_path && (
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
               <button className="btn btn-import" onClick={handleImportUrl} disabled={activeJob}>
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
                  : 'Upload Video'}
              </span>
            </button>
          </div>

          <div className="footer-right">
            {/* Step 1: Transcribe */}
            <button
              className="btn btn-transcribe step-btn"
              onClick={handleTranscribe}
              disabled={!projectData?.video_path || (activeJob && activeJob.stage !== 'transcribing' && activeJob.stage !== 'downloading_model')}
            >
              {activeJob && (activeJob.stage === 'transcribing' || activeJob.stage === 'downloading_model') ? (
                <>
                  <Pause size={13} className="button-spinner spinner" />
                  <span>1. Transcribing ({activeJob.progress}%)</span>
                </>
              ) : (
                <>
                  <FileText size={13} />
                  <span>1. Transcribe</span>
                </>
              )}
            </button>

            {/* Step 2: Translate */}
            <button
              className="btn btn-translate step-btn"
              onClick={handleTranslate}
              disabled={!projectData?.subtitles || projectData.subtitles.length === 0 || (activeJob && activeJob.stage !== 'translating')}
            >
              {activeJob && activeJob.stage === 'translating' ? (
                <>
                  <Pause size={13} className="button-spinner spinner" />
                  <span>2. Translating ({activeJob.progress}%)</span>
                </>
              ) : (
                <>
                  <Globe size={13} />
                  <span>2. Translate</span>
                </>
              )}
            </button>

            {/* Step 3: Isolate BGM (REMOVED - Now handled automatically by Transcribe step) */}

            {/* Step 4: Generate Khmer Audio (TTS) */}
            <button
              className="btn btn-generate step-btn"
              onClick={handleGenerateTTS}
              disabled={!projectData?.subtitles || projectData.subtitles.length === 0 || (activeJob && activeJob.stage !== 'generating_tts')}
            >
              {activeJob && activeJob.stage === 'generating_tts' ? (
                <>
                  <Pause size={13} className="button-spinner spinner" />
                  <span>3. Audio ({activeJob.progress}%)</span>
                </>
              ) : (
                <>
                  <VolumeX size={13} />
                  <span>3. Audio</span>
                </>
              )}
            </button>

            {/* Step 5: Export Video */}
            <button
              className="btn btn-primary step-btn"
              onClick={handleExportVideo}
              disabled={!projectData?.video_path || (activeJob && activeJob.stage !== 'exporting')}
            >
              {activeJob && activeJob.stage === 'exporting' ? (
                <>
                  <Pause size={13} className="button-spinner spinner" />
                  <span>4. Exporting ({activeJob.progress}%)</span>
                </>
              ) : (
                <>
                  <Download size={13} />
                  <span>4. Export</span>
                </>
              )}
            </button>

            {/* Export SRT */}
            <button
              className="btn btn-secondary step-btn"
              onClick={() => setIsExportSrtOpen(true)}
              disabled={!projectData?.subtitles || projectData.subtitles.length === 0}
            >
              <FileText size={13} />
              <span>Export SRT</span>
            </button>
          </div>
        </footer>
      )}

      {/* Settings Dialog Overlay */}
      <Settings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* Export Subtitles Dialog Overlay */}
      <ExportSubtitlesModal
        isOpen={isExportSrtOpen}
        onClose={() => setIsExportSrtOpen(false)}
        subtitles={projectData?.subtitles || []}
      />

      {/* Custom TTS Options Dialog Overlay */}
      {ttsDialog.isOpen && (
        <div className="custom-dialog-overlay" onClick={() => setTtsDialog(prev => ({ ...prev, isOpen: false }))}>
          <div className="custom-dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="custom-dialog-header">
              <h3>Generate Audio Options</h3>
            </div>
            <div className="custom-dialog-body">
              <p style={{ margin: '8px 0 16px 0', fontSize: '13.5px', color: 'var(--text-muted)' }}>
                You have partially generated audio ({ttsDialog.readyCount} ready
                {ttsDialog.failedCount > 0 ? `, ${ttsDialog.failedCount} failed` : ''}).
                What would you like to do?
              </p>
            </div>
            <div className="custom-dialog-footer">
              <button 
                className="btn btn-ghost" 
                onClick={() => setTtsDialog(prev => ({ ...prev, isOpen: false }))}
              >
                Cancel
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={() => {
                  setTtsDialog(prev => ({ ...prev, isOpen: false }));
                  handleResumeTTS();
                }}
              >
                Resume Failed Only
              </button>
              <button 
                className="btn btn-primary" 
                onClick={() => {
                  setTtsDialog(prev => ({ ...prev, isOpen: false }));
                  handleRegenerateAllTTS();
                }}
              >
                Whole Audio
              </button>
            </div>
          </div>
        </div>
      )}
      {/* New Project Confirmation Dialog */}
      {newProjectDialog && (
        <div className="custom-dialog-overlay premium-overlay" onClick={() => setNewProjectDialog(false)}>
          <div className="custom-dialog-content premium-dialog" onClick={e => e.stopPropagation()}>
            <div className="premium-dialog-header">
              <div className="premium-icon-wrapper danger-bg">
                <FilePlus className="dialog-icon-large" />
              </div>
              <h2 className="premium-dialog-title">Start a New Project?</h2>
            </div>
            <div className="premium-dialog-body">
              <p>Do you want to save the current project before creating a new one?</p>
              <p className="premium-dialog-subtitle">Any unsaved progress will be permanently lost.</p>
            </div>
            <div className="premium-dialog-footer">
              <button className="btn btn-outline premium-btn" onClick={() => setNewProjectDialog(false)}>
                Cancel
              </button>
              <button className="btn btn-danger premium-btn" onClick={handleNewProject}>
                Discard & Create
              </button>
              <button 
                className="btn btn-primary premium-btn" 
                onClick={() => {
                  pendingActionRef.current = 'new_project';
                  setNewProjectDialog(false);
                  handleSaveProject();
                }}
              >
                Save Project
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Audio Selection Dialog */}
      {exportDialog && (
        <div className="custom-dialog-overlay premium-overlay" onClick={() => setExportDialog(false)}>
          <div className="custom-dialog-content premium-dialog" onClick={e => e.stopPropagation()}>
            <div className="premium-dialog-header">
              <div className="premium-icon-wrapper primary-bg">
                <Download className="dialog-icon-large" />
              </div>
              <h2 className="premium-dialog-title">Export Audio Settings</h2>
            </div>
            <div className="premium-dialog-body">
              <p>Which audio track would you like to use for the exported video?</p>
              
              <div className="audio-choice-container">
                <label className={`audio-choice-card ${exportAudioMode === 'khmer' ? 'active' : ''}`}>
                  <input 
                    type="radio" 
                    name="audio_mode" 
                    value="khmer" 
                    checked={exportAudioMode === 'khmer'} 
                    onChange={() => setExportAudioMode('khmer')} 
                  />
                  <div className="audio-choice-info">
                    <h4>Khmer Dubbed (AI)</h4>
                    <p>Uses the translated Khmer voices and separated background music.</p>
                  </div>
                </label>

                <label className={`audio-choice-card ${exportAudioMode === 'original' ? 'active' : ''}`}>
                  <input 
                    type="radio" 
                    name="audio_mode" 
                    value="original" 
                    checked={exportAudioMode === 'original'} 
                    onChange={() => setExportAudioMode('original')} 
                  />
                  <div className="audio-choice-info">
                    <h4>Original Audio</h4>
                    <p>Uses the original video's raw audio. No AI voices or BGM changes.</p>
                  </div>
                </label>
              </div>
            </div>
            <div className="premium-dialog-footer">
              <button className="btn btn-outline premium-btn" onClick={() => setExportDialog(false)}>
                Cancel
              </button>
              <button className="btn btn-primary premium-btn" onClick={confirmExportVideo}>
                Start Export
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sessions Dialog Overlay */}
      {isSessionsOpen && (
        <div className="custom-dialog-overlay" onClick={() => setIsSessionsOpen(false)}>
          <div className="custom-dialog-box" style={{ width: '560px' }} onClick={(e) => e.stopPropagation()}>
            <div className="custom-dialog-header">
              <h3>Workspace Sessions</h3>
            </div>
            <div className="custom-dialog-body" style={{ maxHeight: '350px', overflowY: 'auto', padding: '0 4px' }}>
              {getActiveSessions().length === 0 ? (
                <p style={{ margin: '16px 0', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
                  No recent sessions found. They will automatically save when you open a project or modify a batch queue.
                </p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', textAlign: 'left' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '10.5px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Type</th>
                      <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '10.5px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Workspace / Project</th>
                      <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '10.5px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Saved Time</th>
                      <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '10.5px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getActiveSessions().map((sess, idx) => (
                      <tr 
                        key={sess.id} 
                        style={{
                          background: idx % 2 === 0 ? 'rgba(255, 255, 255, 0.01)' : 'transparent',
                          borderBottom: '1px solid rgba(255, 255, 255, 0.03)'
                        }}
                      >
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                          <span style={{ 
                            color: sess.type === 'single' ? '#3b82f6' : 'var(--primary)', 
                            fontSize: '10px', 
                            textTransform: 'uppercase', 
                            letterSpacing: '0.5px',
                            fontWeight: 'bold',
                            background: sess.type === 'single' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(168, 85, 247, 0.1)',
                            padding: '2px 6px',
                            borderRadius: '4px'
                          }}>
                            {sess.type}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: '500', color: 'var(--text)' }} title={sess.name}>
                          {sess.name}
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontSize: '11.5px', whiteSpace: 'nowrap' }}>
                          {new Date(sess.timestamp).toLocaleString()}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                            <button 
                              className="btn btn-primary btn-sm"
                              onClick={() => handleLoadSession(sess)}
                              style={{ padding: '4px 10px', fontSize: '11.5px' }}
                            >
                              Resume
                            </button>
                            <button 
                              onClick={() => {
                                if (window.confirm("Do you want to delete this session?")) {
                                  handleRemoveSession(sess.id);
                                  // force render
                                  setIsSessionsOpen(true);
                                }
                              }}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-muted)',
                                cursor: 'pointer',
                                padding: '4px 6px',
                                fontSize: '18px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                transition: 'color 0.2s'
                              }}
                            >
                              &times;
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="custom-dialog-footer" style={{ justifyContent: 'space-between' }}>
              <button 
                className="btn btn-danger btn-sm" 
                onClick={() => {
                  if (window.confirm("Are you sure you want to clear all sessions?")) {
                    handleClearAllSessions();
                    setIsSessionsOpen(false);
                  }
                }}
                disabled={getActiveSessions().length === 0}
              >
                Clear All
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
                {window.electron && (
                  <button 
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setIsSessionsOpen(false);
                      handleLoadProject();
                    }}
                  >
                    Browse Files...
                  </button>
                )}
                <button 
                  className="btn btn-ghost btn-sm" 
                  onClick={() => setIsSessionsOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
