import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { ZoomIn, ZoomOut, Maximize2, Music, Type, Mic } from 'lucide-react';
import './TimelineEditor.css';

// Utility to parse MM:SS.cc to seconds
const parseTimeToSeconds = (ts) => {
  if (!ts) return 0;
  const parts = ts.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(ts);
};

export default function TimelineEditor({ 
  subtitles, 
  bgmPath, 
  currentTime, 
  onTimeUpdate, 
  isPlaying,
  activeRowId,
  onRowSelect 
}) {
  const bgmWaveformRef = useRef(null);
  const timelineScrollRef = useRef(null);
  const wavesurferRef = useRef(null);
  
  const [zoom, setZoom] = useState(50); // Pixels per second
  const [duration, setDuration] = useState(60); // Default total timeline duration (seconds)

  // Find the maximum end timestamp to scale the timeline duration
  useEffect(() => {
    if (subtitles && subtitles.length > 0) {
      const maxEnd = Math.max(...subtitles.map(s => parseTimeToSeconds(s.end)));
      setDuration(Math.max(60, maxEnd + 10)); // Ensure at least 60 seconds or max end + padding
    }
  }, [subtitles]);

  // Load and initialize WaveSurfer for BGM
  useEffect(() => {
    if (!bgmWaveformRef.current || !bgmPath) {
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
        wavesurferRef.current = null;
      }
      return;
    }

    // Initialize WaveSurfer
    const ws = WaveSurfer.create({
      container: bgmWaveformRef.current,
      waveColor: 'rgba(168, 85, 247, 0.4)',
      progressColor: 'var(--secondary)',
      cursorColor: 'transparent',
      height: 60,
      barWidth: 2,
      barGap: 3,
      responsive: true,
      interact: false, // Managed by timeline click handlers
    });

    // Load from dynamic dynamic static serving
    ws.load(`http://127.0.0.1:9847/files/${bgmPath}`).catch(err => {
      if (err.name !== 'AbortError') {
        console.warn('WaveSurfer load error:', err);
      }
    });
    wavesurferRef.current = ws;

    return () => {
      ws.destroy();
      wavesurferRef.current = null;
    };
  }, [bgmPath]);

  // Sync WaveSurfer audio playback and seek
  useEffect(() => {
    if (wavesurferRef.current) {
      try {
        wavesurferRef.current.zoom(zoom);
        // Sync time
        const wsDuration = wavesurferRef.current.getDuration() || duration;
        const progress = currentTime / wsDuration;
        if (progress >= 0 && progress <= 1) {
          wavesurferRef.current.setTime(currentTime);
        }
      } catch (err) {
        // Suppress wavesurfer errors if audio has not fully loaded/initialized yet
        console.warn("WaveSurfer sync ignored:", err);
      }
    }
  }, [currentTime, zoom, duration]);

  // Sync WaveSurfer play state with global playing state
  useEffect(() => {
    if (wavesurferRef.current) {
      // Note: Video is master, BGM is muted/slave to video sync in main renderer,
      // but showing WaveSurfer progress bar movement is great.
      // We don't actually play BGM audio from WaveSurfer here because the video exporter/muxer
      // combines them, and video player already contains original audio.
      // But we can let wavesurfer just move its playhead.
    }
  }, [isPlaying]);

  const handleTimelineClick = (e) => {
    if (!timelineScrollRef.current) return;
    const rect = timelineScrollRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left + timelineScrollRef.current.scrollLeft;
    // Account for ruler spacer offset (100px)
    const relativeX = Math.max(0, clickX - 100);
    const newTime = relativeX / zoom;
    if (newTime <= duration && onTimeUpdate) {
      onTimeUpdate(newTime);
    }
  };

  // Generate ruler tick marks
  const renderRuler = () => {
    const ticks = [];
    const step = zoom < 20 ? 10 : zoom < 50 ? 5 : 2; // seconds between ticks
    const totalTicks = Math.ceil(duration / step);
    
    for (let i = 0; i <= totalTicks; i++) {
      const time = i * step;
      const left = time * zoom;
      const min = Math.floor(time / 60);
      const sec = Math.floor(time % 60);
      ticks.push(
        <div key={i} className="ruler-tick" style={{ left: `${left}px` }}>
          <span className="tick-label">{`${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`}</span>
        </div>
      );
    }
    return ticks;
  };

  return (
    <div className="timeline-editor-panel glass-panel">
      <div className="timeline-toolbar">
        <div className="toolbar-section">
          <Type size={14} className="track-icon" />
          <span>Timeline Editor</span>
        </div>
        
        <div className="toolbar-controls">
          <button className="zoom-btn" onClick={() => setZoom(Math.max(10, zoom - 10))}>
            <ZoomOut size={14} />
          </button>
          <span className="zoom-value">{zoom}px/s</span>
          <button className="zoom-btn" onClick={() => setZoom(Math.min(150, zoom + 10))}>
            <ZoomIn size={14} />
          </button>
          <button className="zoom-btn" onClick={() => setZoom(50)} title="Fit timeline">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      <div 
        className="timeline-tracks-container" 
        ref={timelineScrollRef}
        onClick={handleTimelineClick}
      >
        {/* Playhead */}
        <div 
          className="timeline-playhead" 
          style={{ left: `${currentTime * zoom + 100}px` }}
        >
          <div className="playhead-handle"></div>
          <div className="playhead-line"></div>
        </div>

        {/* Ruler */}
        <div className="timeline-ruler">
          <div className="track-header-spacer">TIME</div>
          <div className="ruler-ticks-wrapper">
            {renderRuler()}
          </div>
        </div>

        {/* Track 1: Subtitle Text Blocks */}
        <div className="timeline-track text-track">
          <div className="track-header">
            <Type size={12} />
            <span>SUBTITLES</span>
          </div>
          <div className="track-content">
            {subtitles.map(sub => {
              const start = parseTimeToSeconds(sub.start);
              const end = parseTimeToSeconds(sub.end);
              const left = start * zoom;
              const width = (end - start) * zoom;
              const isActive = sub.id === activeRowId;
              
              return (
                <div 
                  key={sub.id}
                  className={`timeline-block text-block ${isActive ? 'active-block' : ''}`}
                  style={{ left: `${left}px`, width: `${width}px` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onRowSelect) onRowSelect(sub);
                    if (onTimeUpdate) onTimeUpdate(start);
                  }}
                >
                  <span className="block-label">{sub.khmer_text || sub.chinese_text}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Track 2: Voice Audio (TTS) */}
        <div className="timeline-track voice-track">
          <div className="track-header">
            <Mic size={12} />
            <span>TTS AUDIO</span>
          </div>
          <div className="track-content">
            {subtitles.map(sub => {
              if (sub.audio_status !== 'ready') return null;
              const start = parseTimeToSeconds(sub.start);
              const end = parseTimeToSeconds(sub.end);
              const left = start * zoom;
              const width = (end - start) * zoom;
              
              return (
                <div 
                  key={sub.id}
                  className={`timeline-block audio-block ${sub.voice}`}
                  style={{ left: `${left}px`, width: `${width}px` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onRowSelect) onRowSelect(sub);
                    if (onTimeUpdate) onTimeUpdate(start);
                  }}
                >
                  {/* Waveform SVG mock */}
                  <svg className="audio-wave-svg" viewBox="0 0 100 20" preserveAspectRatio="none">
                    <path 
                      d="M0 10 Q10 2 20 10 T40 10 T60 10 T80 10 T100 10" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="1" 
                    />
                    <path 
                      d="M0 10 Q10 18 20 10 T40 10 T60 10 T80 10 T100 10" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="1" 
                    />
                  </svg>
                </div>
              );
            })}
          </div>
        </div>

        {/* Track 3: BGM Track */}
        <div className="timeline-track bgm-track">
          <div className="track-header">
            <Music size={12} />
            <span>BGM TRACK</span>
          </div>
          <div className="track-content">
            {bgmPath ? (
              <div 
                className="wavesurfer-waveform-container" 
                ref={bgmWaveformRef}
                style={{ width: `${duration * zoom}px` }}
              ></div>
            ) : (
              <div className="no-bgm-placeholder">
                BGM not isolated. Click "Isolate BGM" in the footer to split vocals and music.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
