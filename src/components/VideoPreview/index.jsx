import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Film } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import './VideoPreview.css';

// Utility to parse MM:SS.cc to seconds
const parseTimeToSeconds = (ts) => {
  if (!ts) return 0;
  const parts = ts.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(ts);
};

export default function VideoPreview({ videoUrl, subtitles, currentTime, onTimeUpdate, setPlayingState, displaySubtitles, setDisplaySubtitles, aspectRatio = 'original', setAspectRatio, customizerSettings }) {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeSub, setActiveSub] = useState('');
  const [previewMode, setPreviewMode] = useState('dubbed'); // 'original' | 'dubbed'

  const activeAudioRef = useRef(null);
  const activeAudioSubIdRef = useRef(null);

  // Handle external playhead adjustments (from Timeline)
  useEffect(() => {
    if (videoRef.current && Math.abs(videoRef.current.currentTime - currentTime) > 0.3) {
      videoRef.current.currentTime = currentTime;
    }
  }, [currentTime]);

  // Clean up active audio on unmount or mode switch
  useEffect(() => {
    return () => {
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      }
    };
  }, []);

  // Synchronize Khmer TTS Audio segments with player
  useEffect(() => {
    if (previewMode !== 'dubbed' || !subtitles || !videoUrl) {
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
        activeAudioSubIdRef.current = null;
      }
      return;
    }
    
    // Find active subtitle matching time
    const currentSub = subtitles.find(sub => {
      const start = parseTimeToSeconds(sub.start);
      const end = parseTimeToSeconds(sub.end);
      return currentTime >= start && currentTime <= end;
    });
    
    if (currentSub && currentSub.audio_status === 'ready' && currentSub.audio_path) {
      const subStart = parseTimeToSeconds(currentSub.start);
      const relativeTime = currentTime - subStart;
      
      if (activeAudioSubIdRef.current !== currentSub.id) {
        if (activeAudioRef.current) {
          activeAudioRef.current.pause();
        }
        
        const audioUrl = `http://127.0.0.1:9847/files/${currentSub.audio_path}?t=${Date.now()}`;
        const newAudio = new Audio(audioUrl);
        newAudio.currentTime = relativeTime >= 0 ? relativeTime : 0;
        
        if (isPlaying) {
          newAudio.play().catch(err => console.error("Dubbing preview play failed:", err));
        }
        
        activeAudioRef.current = newAudio;
        activeAudioSubIdRef.current = currentSub.id;
      } else {
        const audio = activeAudioRef.current;
        if (audio) {
          if (isPlaying && audio.paused) {
            audio.play().catch(err => console.error("Dubbing preview play failed:", err));
          } else if (!isPlaying && !audio.paused) {
            audio.pause();
          }
          
          if (Math.abs(audio.currentTime - relativeTime) > 0.3) {
            audio.currentTime = relativeTime >= 0 ? relativeTime : 0;
          }
        }
      }
    } else {
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
        activeAudioSubIdRef.current = null;
      }
    }
  }, [currentTime, isPlaying, previewMode, subtitles, videoUrl]);

  // Track active subtitle text based on time
  useEffect(() => {
    if (!subtitles) {
      setActiveSub('');
      return;
    }
    const current = subtitles.find(sub => {
      const start = parseTimeToSeconds(sub.start);
      const end = parseTimeToSeconds(sub.end);
      return currentTime >= start && currentTime <= end;
    });
    setActiveSub(current ? current.khmer_text || current.chinese_text : '');
  }, [currentTime, subtitles]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
  };

  const handlePlayStateChange = (playing) => {
    setIsPlaying(playing);
    if (setPlayingState) setPlayingState(playing);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const current = videoRef.current.currentTime;
    const duration = videoRef.current.duration || 1;
    setProgress((current / duration) * 100);
    if (onTimeUpdate) {
      onTimeUpdate(current);
    }
  };

  const handleProgressChange = (e) => {
    if (!videoRef.current) return;
    const duration = videoRef.current.duration || 0;
    const newTime = (parseFloat(e.target.value) / 100) * duration;
    videoRef.current.currentTime = newTime;
    if (onTimeUpdate) onTimeUpdate(newTime);
  };

  const handleFullScreen = () => {
    if (videoRef.current) {
      if (videoRef.current.requestFullscreen) {
        videoRef.current.requestFullscreen();
      }
    }
  };

  const getContainerStyle = () => {
    if (aspectRatio === 'original') return {};
    const ratioMap = {
      '16:9': '16/9',
      '9:16': '9/16',
      '1:1': '1/1',
      '4:3': '4/3'
    };
    return {
      aspectRatio: ratioMap[aspectRatio] || 'auto',
      maxHeight: '380px',
      width: 'auto',
      margin: '0 auto'
    };
  };

  const getVideoStyle = () => {
    if (aspectRatio === 'original') return { objectFit: 'contain' };
    return { objectFit: 'cover', width: '100%', height: '100%' };
  };

  const getOverlayPositionStyles = (pos) => {
    switch (pos) {
      case 'top_left':
        return { top: '15px', left: '15px' };
      case 'top_right':
        return { top: '15px', right: '15px' };
      case 'bottom_left':
        return { bottom: '15px', left: '15px' };
      case 'bottom_right':
        return { bottom: '15px', right: '15px' };
      case 'center':
        return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
      default:
        return { top: '15px', left: '15px' };
    }
  };

  const getOverlayAnimationClass = (effect) => {
    switch (effect) {
      case 'scroll_left':
        return { animation: 'preview-scroll-left 8s linear infinite', width: '100%', left: 0, right: 0, transform: 'none', textAlign: 'center' };
      case 'scroll_right':
        return { animation: 'preview-scroll-right 8s linear infinite', width: '100%', left: 0, right: 0, transform: 'none', textAlign: 'center' };
      case 'slide_up':
        return { animation: 'preview-slide-up 1.5s ease-out forwards' };
      case 'slide_down':
        return { animation: 'preview-slide-down 1.5s ease-out forwards' };
      case 'blink':
        return { animation: 'preview-blink 1.5s infinite' };
      default:
        return {};
    }
  };

  const isSponsorActive = () => {
    if (!customizerSettings || customizerSettings.sponsor_type === 'none') return false;
    const dur = parseInt(customizerSettings.sponsor_duration, 10) || 5;
    const pos = customizerSettings.sponsor_position || 'front';
    if (pos === 'front') {
      return currentTime >= 0 && currentTime < dur;
    } else if (pos === 'middle') {
      const start = parseFloat(customizerSettings.sponsor_time) || 0;
      return currentTime >= start && currentTime < (start + dur);
    } else if (pos === 'back') {
      const videoDuration = videoRef.current ? videoRef.current.duration : 0;
      return videoDuration > 0 && currentTime >= (videoDuration - dur);
    }
    return false;
  };

  return (
    <div className="video-preview-panel glass-panel">
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Film size={16} className="panel-icon" />
          <h3>Video Preview</h3>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
            <span>Ratio:</span>
            <Select
              value={aspectRatio}
              onValueChange={setAspectRatio}
            >
              <SelectTrigger className="h-6 py-0 px-2 text-xs w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="original">Original</SelectItem>
                <SelectItem value="16:9">16:9 Landscape</SelectItem>
                <SelectItem value="9:16">9:16 Portrait</SelectItem>
                <SelectItem value="1:1">1:1 Square</SelectItem>
                <SelectItem value="4:3">4:3 Standard</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <label className="subtitles-toggle-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--text-muted)' }} onClick={(e) => e.stopPropagation()}>
            <input 
              type="checkbox" 
              checked={displaySubtitles} 
              onChange={(e) => setDisplaySubtitles(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>Show Subtitles</span>
          </label>
        </div>
      </div>
      
      <div className="video-player-container" style={{ ...getContainerStyle(), position: 'relative' }}>
        {videoUrl ? (
          <>
            <video
              ref={videoRef}
              src={videoUrl}
              className="main-video-element"
              style={getVideoStyle()}
              onPlay={() => handlePlayStateChange(true)}
              onPause={() => handlePlayStateChange(false)}
              onTimeUpdate={handleTimeUpdate}
              muted={isMuted || previewMode === 'dubbed'}
            />
            
            {/* CSS Animation Keyframes for Realtime Video Preview Overlay Effects */}
            <style>
              {`
                @keyframes preview-scroll-left {
                  0% { transform: translate(100%, 0); }
                  100% { transform: translate(-100%, 0); }
                }
                @keyframes preview-scroll-right {
                  0% { transform: translate(-100%, 0); }
                  100% { transform: translate(100%, 0); }
                }
                @keyframes preview-slide-up {
                  0% { transform: translate(-50%, 100%); opacity: 0; }
                  100% { transform: translate(-50%, 0); opacity: 1; }
                }
                @keyframes preview-slide-down {
                  0% { transform: translate(-50%, -100%); opacity: 0; }
                  100% { transform: translate(-50%, 0); opacity: 1; }
                }
                @keyframes preview-blink {
                  0%, 100% { opacity: 1; }
                  50% { opacity: 0.15; }
                }
              `}
            </style>

            {/* Branding Logo Overlay */}
            {customizerSettings?.logo_path && (
              <img
                src={`http://127.0.0.1:9847/files/${customizerSettings.logo_path}`}
                alt="Logo Overlay"
                style={{
                  position: 'absolute',
                  width: '50px',
                  height: 'auto',
                  zIndex: 20,
                  pointerEvents: 'none',
                  opacity: customizerSettings.logo_opacity !== undefined ? customizerSettings.logo_opacity : 0.85,
                  ...getOverlayPositionStyles(customizerSettings.logo_position || 'top_left'),
                  ...getOverlayAnimationClass(customizerSettings.logo_effect || 'none')
                }}
              />
            )}
            
            {/* Branding Text Overlay */}
            {customizerSettings?.text_overlay && (
              <div
                style={{
                  position: 'absolute',
                  padding: '3px 8px',
                  background: `rgba(0,0,0,${customizerSettings.text_bg_opacity !== undefined ? customizerSettings.text_bg_opacity : 0.5})`,
                  border: customizerSettings.text_bg_opacity > 0.05 ? '1px solid rgba(255,255,255,0.15)' : 'none',
                  borderRadius: '4px',
                  color: 'white',
                  fontSize: '11px',
                  fontWeight: '500',
                  zIndex: 20,
                  pointerEvents: 'none',
                  maxWidth: '70%',
                  wordBreak: 'break-word',
                  fontFamily: 'Noto Sans Khmer, sans-serif',
                  opacity: customizerSettings.text_opacity !== undefined ? customizerSettings.text_opacity : 0.8,
                  ...getOverlayPositionStyles(customizerSettings.text_position || 'top_right'),
                  ...getOverlayAnimationClass(customizerSettings.text_effect || 'none')
                }}
              >
                {customizerSettings.text_overlay}
              </div>
            )}
            
            {/* Branding Footer Overlay */}
            {customizerSettings?.footer_text && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '8px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  padding: '3px 10px',
                  background: `rgba(0,0,0,${customizerSettings.footer_bg_opacity !== undefined ? customizerSettings.footer_bg_opacity : 0.6})`,
                  border: customizerSettings.footer_bg_opacity > 0.05 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                  borderRadius: '10px',
                  color: 'rgba(255,255,255,0.85)',
                  fontSize: '9px',
                  zIndex: 20,
                  pointerEvents: 'none',
                  maxWidth: '85%',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontFamily: 'Noto Sans Khmer, sans-serif',
                  opacity: customizerSettings.footer_opacity !== undefined ? customizerSettings.footer_opacity : 0.85,
                  ...getOverlayAnimationClass(customizerSettings.footer_effect || 'none')
                }}
              >
                {customizerSettings.footer_text}
              </div>
            )}

            {/* Timed Sponsor Overlay */}
            {isSponsorActive() && (
              <>
                {customizerSettings.sponsor_type === 'text' && (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    background: 'rgba(15, 23, 42, 0.95)',
                    border: '1.5px solid var(--primary)',
                    borderRadius: '6px',
                    padding: '10px 20px',
                    color: 'white',
                    zIndex: 25,
                    textAlign: 'center',
                    boxShadow: '0 8px 20px rgba(0,0,0,0.6)',
                  }}>
                    <div style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--primary)', fontWeight: 'bold', marginBottom: '3px' }}>Sponsor Ad</div>
                    <div style={{ fontSize: '13px', fontFamily: 'Noto Sans Khmer, sans-serif' }}>{customizerSettings.sponsor_asset}</div>
                  </div>
                )}
                
                {customizerSettings.sponsor_type === 'image' && customizerSettings.sponsor_asset && (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    background: 'rgba(0,0,0,0.8)',
                    padding: '8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    zIndex: 25,
                    maxWidth: '55%',
                    maxHeight: '55%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <img 
                      src={`http://127.0.0.1:9847/files/${customizerSettings.sponsor_asset}`} 
                      alt="Sponsor Logo"
                      style={{ width: '100%', height: 'auto', maxHeight: '100%', objectFit: 'contain' }}
                    />
                  </div>
                )}
                
                {customizerSettings.sponsor_type === 'video' && customizerSettings.sponsor_asset && (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    background: 'rgba(15, 23, 42, 0.95)',
                    border: '1.5px solid #8b5cf6',
                    borderRadius: '6px',
                    padding: '10px 20px',
                    color: 'white',
                    zIndex: 25,
                    textAlign: 'center',
                    boxShadow: '0 8px 20px rgba(0,0,0,0.6)'
                  }}>
                    <div style={{ fontSize: '9px', textTransform: 'uppercase', color: '#8b5cf6', fontWeight: 'bold', marginBottom: '3px' }}>Sponsor Video playing</div>
                    <div style={{ fontSize: '11px', opacity: 0.85 }}>{customizerSettings.sponsor_asset.split('/').pop()}</div>
                  </div>
                )}
              </>
            )}
            
            {activeSub && displaySubtitles && (
              <div className="subtitle-overlay">
                <span className="subtitle-text">{activeSub}</span>
              </div>
            )}
          </>
        ) : (
          <div className="video-placeholder">
            <Film size={48} className="placeholder-icon" />
            <p>No video loaded. Import a video or paste a URL below to start.</p>
          </div>
        )}
      </div>

      <div className="video-controls">
        <button className="control-btn" onClick={togglePlay} disabled={!videoUrl}>
          {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        
        {videoUrl && (
          <button 
            type="button"
            className={`control-btn ${previewMode === 'dubbed' ? 'active' : ''}`}
            onClick={() => setPreviewMode(prev => prev === 'original' ? 'dubbed' : 'original')}
            title={previewMode === 'original' ? "Switch to Khmer Dubbed Preview" : "Switch to Original Audio Preview"}
            style={{
              color: previewMode === 'dubbed' ? 'var(--primary)' : 'inherit',
              fontWeight: '600',
              fontSize: '11px',
              padding: '4px 8px',
              border: previewMode === 'dubbed' ? '1px solid var(--primary)' : '1px solid transparent',
              borderRadius: '4px',
              background: previewMode === 'dubbed' ? 'var(--primary-glow)' : 'transparent',
              whiteSpace: 'nowrap',
              height: '28px',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            {previewMode === 'original' ? "Original Audio" : "Khmer Dub Preview"}
          </button>
        )}
        
        <input
          type="range"
          min="0"
          max="100"
          value={progress}
          onChange={handleProgressChange}
          className="video-seek-bar"
          disabled={!videoUrl}
        />
        
        <button className="control-btn" onClick={toggleMute} disabled={!videoUrl}>
          {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        
        <button className="control-btn" onClick={handleFullScreen} disabled={!videoUrl}>
          <Maximize size={18} />
        </button>
      </div>
    </div>
  );
}
