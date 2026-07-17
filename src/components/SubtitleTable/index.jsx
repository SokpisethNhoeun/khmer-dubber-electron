import React, { useState, useRef } from 'react';
import { Plus, Trash2, Edit2, Search, BarChart2, Check, X, Play, Pause, Sparkles } from 'lucide-react';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import './SubtitleTable.css';

export default function SubtitleTable({ subtitles, onUpdateSubtitles, onRowSelect, activeRowId, onAutoEmotion }) {
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [stats, setStats] = useState(null);

  const [playingAudioId, setPlayingAudioId] = useState(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const audioRef = useRef(null);

  const handlePlayAudioPreview = (subId, audioPath) => {
    if (playingAudioId === subId) {
      if (audioRef.current) {
        if (isPlayingAudio) {
          audioRef.current.pause();
          setIsPlayingAudio(false);
        } else {
          audioRef.current.play().catch(err => console.error(err));
          setIsPlayingAudio(true);
        }
      }
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const url = `http://127.0.0.1:9847/files/${audioPath}?t=${Date.now()}`;
      const audio = new Audio(url);
      audioRef.current = audio;
      setPlayingAudioId(subId);
      setIsPlayingAudio(true);
      audio.play().catch(err => {
        console.error("Failed to play audio preview:", err);
        alert("Could not load audio preview. Make sure backend is active and the audio file exists.");
        setPlayingAudioId(null);
        setIsPlayingAudio(false);
      });
      audio.onended = () => {
        setPlayingAudioId(null);
        setIsPlayingAudio(false);
      };
    }
  };

  const handleRowClick = (sub) => {
    if (onRowSelect) {
      onRowSelect(sub);
    }
  };

  const handleDoubleClick = (sub) => {
    setEditingId(sub.id);
    setEditValues({ ...sub });
  };

  const handleEditChange = (field, val) => {
    setEditValues(prev => ({ ...prev, [field]: val }));
  };

  const handleSaveEdit = () => {
    const updated = subtitles.map(sub => {
      if (sub.id === editingId) {
        // If Khmer text, voice, or emotion changed, reset audio status to not generated
        const status = (
          sub.khmer_text !== editValues.khmer_text || 
          sub.voice !== editValues.voice || 
          sub.emotion !== editValues.emotion
        ) ? 'not_generated' : sub.audio_status;
        return { ...editValues, audio_status: status };
      }
      return sub;
    });
    onUpdateSubtitles(updated);
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleAddRow = () => {
    let newId = 1;
    let newStart = "00:00.00";
    let newEnd = "00:02.00";

    if (subtitles.length > 0) {
      const last = subtitles[subtitles.length - 1];
      newId = last.id + 1;
      
      // Compute next start/end helper
      const parseTime = (str) => {
        const parts = str.split(':');
        return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
      };
      const formatTime = (sec) => {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m.toString().padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
      };
      
      const lastEndSec = parseTime(last.end);
      newStart = formatTime(lastEndSec + 0.5);
      newEnd = formatTime(lastEndSec + 2.5);
    }

    const newSub = {
      id: newId,
      start: newStart,
      end: newEnd,
      chinese_text: "新字幕",
      khmer_text: "អត្ថបទថ្មី",
      voice: "female",
      emotion: "normal",
      audio_status: "not_generated",
      audio_path: ""
    };

    onUpdateSubtitles([...subtitles, newSub]);
  };

  const handleDeleteRow = (id) => {
    const filtered = subtitles.filter(sub => sub.id !== id);
    // Re-index IDs
    const reindexed = filtered.map((sub, idx) => ({ ...sub, id: idx + 1 }));
    onUpdateSubtitles(reindexed);
  };

  const handleFindReplace = () => {
    if (!findText) return;
    const updated = subtitles.map(sub => {
      const text = sub.khmer_text || '';
      if (text.includes(findText)) {
        return {
          ...sub,
          khmer_text: text.replaceAll(findText, replaceText),
          audio_status: 'not_generated'
        };
      }
      return sub;
    });
    onUpdateSubtitles(updated);
    setShowFindReplace(false);
    setFindText('');
    setReplaceText('');
  };

  const handleScanCharacters = () => {
    if (stats) {
      setStats(null);
      return;
    }
    const totalLines = subtitles.length;
    const totalChars = subtitles.reduce((acc, sub) => acc + (sub.khmer_text || '').length, 0);
    const averageChars = totalLines > 0 ? (totalChars / totalLines).toFixed(1) : 0;
    
    // Voice distributions
    const maleCount = subtitles.filter(s => s.voice === 'male').length;
    const femaleCount = subtitles.filter(s => s.voice === 'female').length;
    
    setStats({ totalLines, totalChars, averageChars, maleCount, femaleCount });
  };

  return (
    <div className="subtitle-table-panel glass-panel">
      <div className="panel-header-table">
        <div className="table-title">
          <Edit2 size={16} className="panel-icon" />
          <h3>Subtitles Data Table</h3>
        </div>
        
        <div className="table-toolbar">
          <button className="toolbar-btn" onClick={handleAddRow} data-tooltip="Add Subtitle">
            <Plus size={14} />
            <span>Add Row</span>
          </button>
          <button className="toolbar-btn" onClick={() => setShowFindReplace(!showFindReplace)} data-tooltip="Find & Replace">
            <Search size={14} />
            <span>Find & Replace</span>
          </button>
          <button className="toolbar-btn" onClick={handleScanCharacters} data-tooltip="Scan Subtitle Data">
            <BarChart2 size={14} />
            <span>Scan Data</span>
          </button>
        </div>
      </div>

      {showFindReplace && (
        <div className="find-replace-banner glass-panel">
          <Input 
            type="text" 
            placeholder="Find Khmer text..." 
            className="banner-input"
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
          />
          <Input 
            type="text" 
            placeholder="Replace with..." 
            className="banner-input"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
          />
          <button className="btn btn-primary btn-sm" onClick={handleFindReplace}>Replace All</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowFindReplace(false)}>Cancel</button>
        </div>
      )}

      {stats && (
        <div className="stats-banner glass-panel">
          <div className="stats-grid">
            <div className="stat-item"><span className="stat-label">Lines:</span> <strong>{stats.totalLines}</strong></div>
            <div className="stat-item"><span className="stat-label">Total Chars:</span> <strong>{stats.totalChars}</strong></div>
            <div className="stat-item"><span className="stat-label">Avg Length:</span> <strong>{stats.averageChars}</strong></div>
            <div className="stat-item"><span className="stat-label">Male / Female:</span> <strong>{stats.maleCount} / {stats.femaleCount}</strong></div>
          </div>
          <button className="btn-close-banner" onClick={() => setStats(null)}>&times;</button>
        </div>
      )}

      <div className="table-container">
        <table className="subtitles-data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Start</th>
              <th>End</th>
              <th>Chinese Original</th>
              <th>Khmer Translation (Double Click to Edit)</th>
              <th>Voice</th>
              <th>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>Emotion</span>
                  <Sparkles 
                    size={12} 
                    style={{ color: 'var(--primary)', cursor: 'pointer', transition: 'transform 0.15s ease' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onAutoEmotion) onAutoEmotion();
                    }}
                    onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.2)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
                    title="Auto-classify all emotions using Gemini AI"
                  />
                </div>
              </th>
              <th>Audio</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {subtitles.map(sub => {
              const isEditing = sub.id === editingId;
              const isActive = sub.id === activeRowId;
              
              return (
                <tr 
                  key={sub.id} 
                  className={`${isActive ? 'active-row' : ''} ${isEditing ? 'editing-row' : ''}`}
                  onClick={() => handleRowClick(sub)}
                  onDoubleClick={() => handleDoubleClick(sub)}
                >
                  <td>{sub.id}</td>
                  <td>
                    {isEditing ? (
                      <Input 
                        type="text" 
                        value={editValues.start} 
                        className="table-input h-7 py-0.5 px-2 text-xs"
                        onChange={(e) => handleEditChange('start', e.target.value)}
                      />
                    ) : sub.start}
                  </td>
                  <td>
                    {isEditing ? (
                      <Input 
                        type="text" 
                        value={editValues.end} 
                        className="table-input h-7 py-0.5 px-2 text-xs"
                        onChange={(e) => handleEditChange('end', e.target.value)}
                      />
                    ) : sub.end}
                  </td>
                  <td className="chinese-cell" title={sub.chinese_text}>{sub.chinese_text}</td>
                  <td>
                    {isEditing ? (
                      <textarea
                        value={editValues.khmer_text} 
                        className="table-textarea"
                        onChange={(e) => handleEditChange('khmer_text', e.target.value)}
                      />
                    ) : (
                      <div className="khmer-text-cell" title={sub.khmer_text || "No Khmer translation yet."}>
                        {sub.khmer_text || <span className="placeholder-text">Not translated</span>}
                      </div>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <Select 
                        value={editValues.voice}
                        onValueChange={(val) => handleEditChange('voice', val)}
                      >
                        <SelectTrigger className="h-7 py-0.5 px-2 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="female">Female</SelectItem>
                          <SelectItem value="male">Male</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className={`voice-tag ${sub.voice}`}>{sub.voice}</span>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <Select 
                        value={editValues.emotion || 'normal'}
                        onValueChange={(val) => handleEditChange('emotion', val)}
                      >
                        <SelectTrigger className="h-7 py-0.5 px-2 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="normal">Normal</SelectItem>
                          <SelectItem value="excited">Excited</SelectItem>
                          <SelectItem value="sad">Sad</SelectItem>
                          <SelectItem value="fearful">Scared</SelectItem>
                          <SelectItem value="cheerful">Cheerful</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className={`emotion-tag ${sub.emotion || 'normal'}`} style={{
                        display: 'inline-block',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: '500',
                        textTransform: 'capitalize',
                        background: sub.emotion === 'excited' ? 'rgba(239, 68, 68, 0.15)' :
                                    sub.emotion === 'sad' ? 'rgba(59, 130, 246, 0.15)' :
                                    sub.emotion === 'fearful' ? 'rgba(168, 85, 247, 0.15)' :
                                    sub.emotion === 'cheerful' ? 'rgba(34, 197, 94, 0.15)' :
                                    'rgba(255, 255, 255, 0.08)',
                        color: sub.emotion === 'excited' ? '#ef4444' :
                               sub.emotion === 'sad' ? '#3b82f6' :
                               sub.emotion === 'fearful' ? '#a855f7' :
                               sub.emotion === 'cheerful' ? '#22c55e' :
                               'var(--text-muted)',
                        border: sub.emotion === 'excited' ? '1px solid rgba(239, 68, 68, 0.3)' :
                                sub.emotion === 'sad' ? '1px solid rgba(59, 130, 246, 0.3)' :
                                sub.emotion === 'fearful' ? '1px solid rgba(168, 85, 247, 0.3)' :
                                sub.emotion === 'cheerful' ? '1px solid rgba(34, 197, 94, 0.3)' :
                                '1px solid rgba(255, 255, 255, 0.1)'
                      }}>
                        {sub.emotion || 'normal'}
                      </span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className={`status-badge ${sub.audio_status}`} style={{ margin: 0 }}>
                        {sub.audio_status.replace('_', ' ')}
                      </span>
                       {sub.audio_status === 'ready' && sub.audio_path && (
                        <button
                          type="button"
                          className="row-action-btn play-audio-preview"
                          style={{
                            padding: '4px',
                            background: playingAudioId === sub.id && isPlayingAudio ? 'rgba(239, 68, 68, 0.15)' : 'var(--primary-glow)',
                            border: playingAudioId === sub.id && isPlayingAudio ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid var(--primary)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: playingAudioId === sub.id && isPlayingAudio ? '#ef4444' : 'var(--primary)'
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayAudioPreview(sub.id, sub.audio_path);
                          }}
                          title={playingAudioId === sub.id && isPlayingAudio ? "Pause Voice Preview" : "Play Voice Preview"}
                        >
                          {playingAudioId === sub.id && isPlayingAudio ? (
                            <Pause size={12} fill="currentColor" />
                          ) : (
                            <Play size={12} fill="currentColor" />
                          )}
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    {isEditing ? (
                      <div className="action-buttons">
                        <button className="row-action-btn save" onClick={handleSaveEdit} title="Save">
                          <Check size={14} />
                        </button>
                        <button className="row-action-btn cancel" onClick={handleCancelEdit} title="Cancel">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button className="row-action-btn delete" onClick={(e) => { e.stopPropagation(); handleDeleteRow(sub.id); }} title="Delete">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {subtitles.length === 0 && (
              <tr>
                <td colSpan="9" className="empty-table-cell">
                  No subtitle segments available. Please run transcription.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
