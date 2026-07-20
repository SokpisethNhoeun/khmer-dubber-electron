import React from 'react';
import { AlignLeft } from 'lucide-react';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

export default function VideoCustomizer({ settings, onChange }) {
  const handleLogoSelect = async () => {
    if (!window.electron) return;
    const file = await window.electron.selectFile({
      title: 'Select Logo Image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    });
    if (file) {
      onChange('logo_path', file);
    }
  };

  const handleSponsorAssetSelect = async (type) => {
    if (!window.electron) return;
    let filters = [];
    if (type === 'image') {
      filters = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }];
    } else if (type === 'video') {
      filters = [{ name: 'Videos', extensions: ['mp4', 'mkv', 'avi', 'mov'] }];
    }
    
    const file = await window.electron.selectFile({
      title: `Select Sponsor ${type.toUpperCase()}`,
      filters
    });
    if (file) {
      onChange('sponsor_asset', file);
    }
  };

  return (
    <div className="customizer-panel glass-panel" style={{ marginTop: '15px', padding: '15px' }}>
      <div className="panel-header-customizer" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
        <AlignLeft size={16} className="panel-icon" />
        <h3 style={{ margin: 0, fontSize: '13px', color: 'var(--text-main)' }}>Video Branding & Sponsors</h3>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
        {/* Left column: Brand Overlays */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h4 style={{ margin: 0, fontSize: '11px', textTransform: 'uppercase', color: 'var(--primary)', letterSpacing: '0.5px' }}>Logo & Text Overlays</h4>
          
          {/* Logo overlay */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Overlay Logo Image</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <Input 
                type="text" 
                value={settings.logo_path} 
                readOnly 
                placeholder="No logo image selected..."
                style={{ fontSize: '11px', flexGrow: 1, padding: '4px 8px' }}
              />
              <button className="btn btn-secondary btn-sm" onClick={handleLogoSelect} style={{ padding: '4px 8px', fontSize: '11px' }}>Browse</button>
              {settings.logo_path && (
                <button className="btn btn-secondary btn-sm" onClick={() => onChange('logo_path', '')} style={{ padding: '4px 8px', color: '#ef4444' }}>Clear</button>
              )}
            </div>
            {settings.logo_path && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '4px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Position:</span>
                  <Select 
                    value={settings.logo_position} 
                    onValueChange={(val) => onChange('logo_position', val)}
                  >
                    <SelectTrigger className="h-7 py-0.5 px-2 text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="top_left">Top Left</SelectItem>
                      <SelectItem value="top_right">Top Right</SelectItem>
                      <SelectItem value="bottom_left">Bottom Left</SelectItem>
                      <SelectItem value="bottom_right">Bottom Right</SelectItem>
                      <SelectItem value="center">Center</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Opacity ({Math.round(settings.logo_opacity * 100)}%):</span>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="1.0" 
                    step="0.05"
                    value={settings.logo_opacity || 0.85}
                    onChange={(e) => onChange('logo_opacity', parseFloat(e.target.value))}
                    style={{ width: '100%', height: '14px', cursor: 'pointer' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Effect:</span>
                  <Select 
                    value={settings.logo_effect || 'none'} 
                    onValueChange={(val) => onChange('logo_effect', val)}
                  >
                    <SelectTrigger className="h-7 py-0.5 px-2 text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Static</SelectItem>
                      <SelectItem value="blink">Blink Blink</SelectItem>
                      <SelectItem value="scroll_left">Scroll Left</SelectItem>
                      <SelectItem value="scroll_right">Scroll Right</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
          
          {/* Text overlay */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Overlay Banner Text</label>
            <Input 
              type="text" 
              value={settings.text_overlay} 
              onChange={(e) => onChange('text_overlay', e.target.value)}
              placeholder="Enter overlay text..."
              style={{ fontSize: '11px', padding: '4px 8px' }}
            />
            {settings.text_overlay && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '4px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Position:</span>
                    <Select 
                      value={settings.text_position} 
                      onValueChange={(val) => onChange('text_position', val)}
                    >
                      <SelectTrigger className="h-7 py-0.5 px-2 text-[10px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="top_left">Top Left</SelectItem>
                        <SelectItem value="top_right">Top Right</SelectItem>
                        <SelectItem value="bottom_left">Bottom Left</SelectItem>
                        <SelectItem value="bottom_right">Bottom Right</SelectItem>
                        <SelectItem value="center">Center</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Text Opacity ({Math.round(settings.text_opacity * 100)}%):</span>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="1.0" 
                      step="0.05"
                      value={settings.text_opacity || 0.8}
                      onChange={(e) => onChange('text_opacity', parseFloat(e.target.value))}
                      style={{ width: '100%', height: '14px', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Effect:</span>
                    <Select 
                      value={settings.text_effect || 'none'} 
                      onValueChange={(val) => onChange('text_effect', val)}
                    >
                      <SelectTrigger className="h-7 py-0.5 px-2 text-[10px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Static</SelectItem>
                        <SelectItem value="blink">Blink Blink</SelectItem>
                        <SelectItem value="scroll_left">Scroll Left</SelectItem>
                        <SelectItem value="scroll_right">Scroll Right</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '4px', marginTop: '4px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Background Transparency ({Math.round((1 - (settings.text_bg_opacity ?? 0.5)) * 100)}% transparent):</span>
                    <input 
                      type="range" 
                      min="0" 
                      max="1.0" 
                      step="0.05"
                      value={settings.text_bg_opacity ?? 0.5}
                      onChange={(e) => onChange('text_bg_opacity', parseFloat(e.target.value))}
                      style={{ width: '100%', height: '14px', cursor: 'pointer' }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer Text */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Footer Credit Text</label>
            <Input 
              type="text" 
              value={settings.footer_text} 
              onChange={(e) => onChange('footer_text', e.target.value)}
              placeholder="e.g. © 2026 Khmer Dubber. All Rights Reserved."
              style={{ fontSize: '11px', padding: '4px 8px' }}
            />
            {settings.footer_text && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Text Opacity ({Math.round(settings.footer_opacity * 100)}%):</span>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="1.0" 
                      step="0.05"
                      value={settings.footer_opacity || 0.85}
                      onChange={(e) => onChange('footer_opacity', parseFloat(e.target.value))}
                      style={{ width: '100%', height: '14px', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Effect:</span>
                    <Select 
                      value={settings.footer_effect || 'none'} 
                      onValueChange={(val) => onChange('footer_effect', val)}
                    >
                      <SelectTrigger className="h-7 py-0.5 px-2 text-[10px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Static</SelectItem>
                        <SelectItem value="blink">Blink Blink</SelectItem>
                        <SelectItem value="scroll_left">Scroll Left</SelectItem>
                        <SelectItem value="scroll_right">Scroll Right</SelectItem>
                        <SelectItem value="slide_up">Slide Up (Bottom-Top)</SelectItem>
                        <SelectItem value="slide_down">Slide Down (Top-Bottom)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '4px', marginTop: '4px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Background Transparency ({Math.round((1 - (settings.footer_bg_opacity ?? 0.6)) * 100)}% transparent):</span>
                    <input 
                      type="range" 
                      min="0" 
                      max="1.0" 
                      step="0.05"
                      value={settings.footer_bg_opacity ?? 0.6}
                      onChange={(e) => onChange('footer_bg_opacity', parseFloat(e.target.value))}
                      style={{ width: '100%', height: '14px', cursor: 'pointer' }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
          {/* Subtitle Background Style */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '5px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Subtitle Background Style</label>
            <Select 
              value={settings.subtitle_bg_style || 'black'} 
              onValueChange={(val) => onChange('subtitle_bg_style', val)}
            >
              <SelectTrigger className="h-8 py-1 px-3 text-[11px] w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="black">Black Opaque (Default)</SelectItem>
                <SelectItem value="blur">Modern Blurred Glass</SelectItem>
                <SelectItem value="transparent">Transparent (Outline Text)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        {/* Right column: Sponsor settings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h4 style={{ margin: 0, fontSize: '11px', textTransform: 'uppercase', color: 'var(--primary)', letterSpacing: '0.5px' }}>Sponsor Ads Insertion</h4>
          
          {/* Sponsor Type */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Sponsor Type</label>
            <Select 
              value={settings.sponsor_type} 
              onValueChange={(val) => {
                onChange('sponsor_type', val);
                onChange('sponsor_asset', ''); 
              }}
            >
              <SelectTrigger className="h-8 py-1 px-3 text-[11px] w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Sponsor Ad</SelectItem>
                <SelectItem value="text">Text Sponsor</SelectItem>
                <SelectItem value="image">Image Sponsor</SelectItem>
                <SelectItem value="video">Video Sponsor Clip</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {settings.sponsor_type !== 'none' && (
            <>
              {/* Sponsor Asset selection */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {settings.sponsor_type === 'text' ? 'Sponsor Ad Message' : `Select Sponsor ${settings.sponsor_type}`}
                </label>
                {settings.sponsor_type === 'text' ? (
                  <Input 
                    type="text" 
                    value={settings.sponsor_asset}
                    onChange={(e) => onChange('sponsor_asset', e.target.value)}
                    placeholder="Enter sponsor text..."
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                  />
                ) : (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <Input 
                      type="text" 
                      value={settings.sponsor_asset} 
                      readOnly 
                      placeholder={`No ${settings.sponsor_type} file selected...`}
                      style={{ fontSize: '11px', flexGrow: 1, padding: '4px 8px' }}
                    />
                    <button className="btn btn-secondary btn-sm" onClick={() => handleSponsorAssetSelect(settings.sponsor_type)} style={{ padding: '4px 8px', fontSize: '11px' }}>Browse</button>
                  </div>
                )}
              </div>
              
              {/* Sponsor settings (Time & Duration) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Show Sponsor at</label>
                  <Select 
                    value={settings.sponsor_position} 
                    onValueChange={(val) => onChange('sponsor_position', val)}
                  >
                    <SelectTrigger className="h-8 py-1 px-3 text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="front">Front (Pre-roll)</SelectItem>
                      <SelectItem value="middle">Middle (Mid-roll)</SelectItem>
                      <SelectItem value="back">Back (Post-roll)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {settings.sponsor_type !== 'video' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Duration (sec)</label>
                    <Input 
                      type="number" 
                      value={settings.sponsor_duration}
                      onChange={(e) => onChange('sponsor_duration', e.target.value)}
                      min="1"
                      max="60"
                      style={{ fontSize: '11px', padding: '4px 8px' }}
                    />
                  </div>
                )}
                {settings.sponsor_type === 'video' && (
                  <div style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic' }}>⏱ Full video length</span>
                  </div>
                )}
              </div>

              {settings.sponsor_position === 'middle' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Insert Time (seconds)</label>
                  <Input 
                    type="number" 
                    value={settings.sponsor_time}
                    onChange={(e) => onChange('sponsor_time', e.target.value)}
                    min="0"
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                  />
                </div>
              )}
            </>
          )}

          {/* Copyright-Safe Protection */}
          <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span>🛡️ Copyright-Safe Protection</span>
              </div>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>
                Disrupts Content ID fingerprinting using micro-vignette and color shifts
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '6px' }}>
              <input
                type="checkbox"
                checked={!!settings.enable_copyright_safe}
                onChange={(e) => onChange('enable_copyright_safe', e.target.checked)}
                style={{ cursor: 'pointer', accentColor: 'var(--primary)' }}
              />
              <span style={{ fontSize: '10px', color: settings.enable_copyright_safe ? '#10b981' : 'var(--text-muted)', fontWeight: 600 }}>
                {settings.enable_copyright_safe ? 'ON' : 'OFF'}
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
