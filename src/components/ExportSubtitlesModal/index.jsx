import React, { useState } from 'react';
import { FileText, Download, Layers, Globe, MessageSquare } from 'lucide-react';
import './ExportSubtitlesModal.css';

export default function ExportSubtitlesModal({ isOpen, onClose, subtitles }) {
  const [exportMode, setExportMode] = useState('bilingual'); // 'chinese' | 'khmer' | 'bilingual'

  if (!isOpen) return null;

  const formatSrtTime = (timeStr) => {
    const parts = timeStr.split(':');
    let h = 0, m = 0, s = 0, ms = 0;
    
    if (parts.length === 3) {
      h = parseInt(parts[0], 10);
      m = parseInt(parts[1], 10);
      const secFloat = parseFloat(parts[2]);
      s = Math.floor(secFloat);
      ms = Math.round((secFloat - s) * 1000);
    } else if (parts.length === 2) {
      m = parseInt(parts[0], 10);
      const secFloat = parseFloat(parts[1]);
      s = Math.floor(secFloat);
      ms = Math.round((secFloat - s) * 1000);
      h = Math.floor(m / 60);
      m = m % 60;
    } else {
      const secFloat = parseFloat(timeStr);
      s = Math.floor(secFloat);
      ms = Math.round((secFloat - s) * 1000);
      m = Math.floor(s / 60);
      s = s % 60;
      h = Math.floor(m / 60);
      m = m % 60;
    }
    
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
  };

  const handleExport = async () => {
    if (!subtitles || subtitles.length === 0) {
      alert("No subtitles available to export.");
      return;
    }

    // Format content based on selection
    const content = subtitles.map((sub, idx) => {
      let text = '';
      const cn = (sub.chinese_text || '').trim();
      const kh = (sub.khmer_text || '').trim();
      
      if (exportMode === 'chinese') {
        text = cn;
      } else if (exportMode === 'khmer') {
        text = kh;
      } else {
        // Bilingual
        text = cn && kh ? `${cn}\n${kh}` : (cn || kh);
      }
      
      const start = formatSrtTime(sub.start);
      const end = formatSrtTime(sub.end);
      
      return `${idx + 1}\n${start} --> ${end}\n${text}\n`;
    }).join('\n');

    let defaultName = 'subtitles_bilingual.srt';
    if (exportMode === 'chinese') defaultName = 'subtitles_chinese.srt';
    else if (exportMode === 'khmer') defaultName = 'subtitles_khmer.srt';

    if (window.electron && typeof window.electron.exportSrt === 'function') {
      try {
        // Let's use the new IPC handler to show save dialog and write file
        const filePath = await window.electron.exportSrt({ content, defaultName });
        if (filePath) {
          alert(`Subtitles exported successfully to:\n${filePath}`);
          onClose();
        }
      } catch (err) {
        console.error("Export SRT failed:", err);
        alert(`Export failed: ${err.message}`);
      }
    } else {
      // Browser fallback (download link)
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = defaultName;
      link.click();
      URL.revokeObjectURL(url);
      onClose();
    }
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal glass-panel" style={{ width: '420px' }} onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <div className="header-title">
            <FileText className="header-icon" />
            <h2>Export Subtitles (SRT)</h2>
          </div>
          <button className="btn-close" onClick={onClose}>&times;</button>
        </div>

        <div className="settings-body">
          <p className="settings-hint" style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
            Select the subtitle format you wish to export:
          </p>

          <div className="export-modes-grid">
            <div 
              className={`export-mode-card ${exportMode === 'bilingual' ? 'active' : ''}`}
              onClick={() => setExportMode('bilingual')}
            >
              <Layers className="mode-icon text-primary" />
              <div className="mode-details">
                <h4>Bilingual (China + Khmer)</h4>
                <p>Combines original Chinese and translated Khmer lines</p>
              </div>
            </div>

            <div 
              className={`export-mode-card ${exportMode === 'khmer' ? 'active' : ''}`}
              onClick={() => setExportMode('khmer')}
            >
              <Globe className="mode-icon text-emerald" />
              <div className="mode-details">
                <h4>Khmer Only</h4>
                <p>Export only the translated Khmer subtitles</p>
              </div>
            </div>

            <div 
              className={`export-mode-card ${exportMode === 'chinese' ? 'active' : ''}`}
              onClick={() => setExportMode('chinese')}
            >
              <MessageSquare className="mode-icon text-amber" />
              <div className="mode-details">
                <h4>Chinese Only</h4>
                <p>Export only the original Chinese (China) subtitles</p>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleExport}>
            <Download size={14} className="mr-1" />
            Export SRT
          </button>
        </div>
      </div>
    </div>
  );
}
