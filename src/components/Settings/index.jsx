import React, { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, Save, Settings as SettingsIcon, AlertCircle, Send } from 'lucide-react';
import { wsService } from '../../services/websocket';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import './Settings.css';

// Helper Promise to make WebSocket key validation awaitable
const validateApiKeyPromise = (key, model) => {
  return new Promise((resolve) => {
    const unsubscribe = wsService.on('api_key_validated', (data) => {
      unsubscribe();
      resolve(data);
    });
    wsService.send('validate_api_key', { api_key: key, model: model });
    // Timeout safeguard (10 seconds)
    setTimeout(() => {
      unsubscribe();
      resolve({ valid: false, error: 'Validation timed out. Please check that the backend is running.' });
    }, 10000);
  });
};

export default function Settings({ isOpen, onClose }) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState('gemini-3.1-flash-lite');
  const [whisperModel, setWhisperModel] = useState('base');
  const [saveStatus, setSaveStatus] = useState('');
  
  const [isReadOnly, setIsReadOnly] = useState(true);
  const [validationError, setValidationError] = useState('');
  const [validationSuccess, setValidationSuccess] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  useEffect(() => {
    // Load saved settings
    const loadSettings = async () => {
      const savedModel = localStorage.getItem('gemini_model') || 'gemini-3.1-flash-lite';
      setModel(savedModel);

      const savedWhisperModel = localStorage.getItem('whisper_model') || 'base';
      setWhisperModel(savedWhisperModel);

      const encryptedKey = localStorage.getItem('gemini_api_key_encrypted');
      if (encryptedKey && window.electron) {
        try {
          const decrypted = await window.electron.decryptString(encryptedKey);
          setApiKey(decrypted);
          setIsReadOnly(true);
          setValidationError('');
          setValidationSuccess(localStorage.getItem('gemini_api_key_valid') === 'true');
        } catch (e) {
          console.error('Failed to decrypt saved API key', e);
          setIsReadOnly(false);
        }
      } else if (encryptedKey) {
        // Dev fallback if not inside Electron
        setApiKey(encryptedKey);
        setIsReadOnly(true);
        setValidationError('');
        setValidationSuccess(localStorage.getItem('gemini_api_key_valid') === 'true');
      } else {
        setIsReadOnly(false);
        setValidationError('');
        setValidationSuccess(false);
      }
    };
    if (isOpen) {
      loadSettings();
      setSaveStatus('');
    }
  }, [isOpen]);

  const handleManualValidate = async () => {
    if (!apiKey.trim()) {
      setValidationError('API Key is required.');
      setValidationSuccess(false);
      return;
    }
    setIsValidating(true);
    setValidationError('');
    setValidationSuccess(false);
    
    const result = await validateApiKeyPromise(apiKey.trim(), model);
    setIsValidating(false);
    if (result.valid) {
      setValidationError('');
      setValidationSuccess(true);
    } else {
      setValidationError(result.error || 'Invalid API Key.');
      setValidationSuccess(false);
    }
  };

  const handleSave = async () => {
    // If the key is already read-only, it has already been validated. We can save other settings.
    if (isReadOnly) {
      try {
        localStorage.setItem('gemini_model', model);
        localStorage.setItem('whisper_model', whisperModel);
        setSaveStatus('success');
        setTimeout(() => {
          setSaveStatus('');
          onClose();
        }, 1000);
      } catch (err) {
        console.error('Failed to save settings:', err);
        setSaveStatus('error');
      }
      return;
    }

    if (!apiKey.trim()) {
      setValidationError('API Key is required.');
      setValidationSuccess(false);
      return;
    }

    setIsValidating(true);
    setValidationError('');
    setValidationSuccess(false);

    const result = await validateApiKeyPromise(apiKey.trim(), model);
    setIsValidating(false);

    if (result.valid) {
      setValidationSuccess(true);
      try {
        localStorage.setItem('gemini_model', model);
        localStorage.setItem('whisper_model', whisperModel);
        localStorage.setItem('gemini_api_key_valid', 'true');
        
        if (window.electron) {
          const encrypted = await window.electron.encryptString(apiKey.trim());
          localStorage.setItem('gemini_api_key_encrypted', encrypted);
        } else {
          localStorage.setItem('gemini_api_key_encrypted', apiKey.trim());
        }
        
        setIsReadOnly(true);
        setSaveStatus('success');
        setTimeout(() => {
          setSaveStatus('');
          onClose();
        }, 1000);
      } catch (err) {
        console.error('Failed to save settings:', err);
        setSaveStatus('error');
      }
    } else {
      setValidationError(result.error || 'Invalid API Key.');
      setValidationSuccess(false);
      alert(`Validation Failed: ${result.error || 'Invalid API Key.'}`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="settings-overlay">
      <div className="settings-modal glass-panel">
        <div className="settings-header">
          <div className="header-title">
            <SettingsIcon className="header-icon" />
            <h2>Settings Configuration</h2>
          </div>
          <button className="btn-close" onClick={onClose}>&times;</button>
        </div>

        <div className="settings-body">
          <div className="settings-group">
            <label className="settings-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Key className="icon-label" />
                Gemini API Key
              </span>
              <a 
                href="https://aistudio.google.com/" 
                onClick={(e) => {
                  if (window.electron) {
                    e.preventDefault();
                    window.electron.openExternal('https://aistudio.google.com/');
                  }
                }}
                target="_blank" 
                rel="noopener noreferrer" 
                style={{ color: 'var(--primary)', textDecoration: 'none', fontSize: '11px', fontWeight: '500' }}
              >
                Get API Key
              </a>
            </label>
            <div className="api-key-input-wrapper" style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%', position: 'relative' }}>
              <div style={{ position: 'relative', flexGrow: 1, display: 'flex', alignItems: 'center' }}>
                <Input
                  type={showKey ? "text" : "password"}
                  className="api-key-input"
                  placeholder="Enter your Gemini API key..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  readOnly={isReadOnly}
                  style={isReadOnly ? { opacity: 0.7, cursor: 'not-allowed', width: '100%', paddingRight: '40px' } : { width: '100%', paddingRight: '40px' }}
                />
                <button 
                  type="button" 
                  className="btn-toggle-visibility"
                  onClick={() => setShowKey(!showKey)}
                  style={{ position: 'absolute', right: '12px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              
              {isReadOnly ? (
                <button 
                  type="button" 
                  className="btn btn-secondary btn-sm"
                  style={{ whiteSpace: 'nowrap', padding: '6px 12px' }}
                  onClick={() => {
                    setIsReadOnly(false);
                    setValidationSuccess(false);
                    setValidationError('');
                  }}
                >
                  Change
                </button>
              ) : (
                <button 
                  type="button" 
                  className="btn btn-secondary btn-sm"
                  style={{ whiteSpace: 'nowrap', padding: '6px 12px' }}
                  onClick={handleManualValidate}
                  disabled={isValidating || !apiKey.trim()}
                >
                  {isValidating ? 'Validating...' : 'Validate'}
                </button>
              )}
            </div>
            {isValidating && (
              <p className="settings-hint" style={{ color: 'var(--primary)', marginTop: '4px' }}>
                Validating key with Google AI Studio...
              </p>
            )}
            {validationSuccess && (
              <p className="settings-hint" style={{ color: '#10b981', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                ✓ API Key is valid and active.
              </p>
            )}
            {validationError && (
              <p className="settings-hint" style={{ color: '#ef4444', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                ⚠ Validation Failed: {validationError.length > 80 ? validationError.substring(0, 80) + '...' : validationError}
              </p>
            )}
            <p className="settings-hint" style={{ marginTop: '8px' }}>
              Your API key is encrypted locally using Windows DPAPI/OS credentials and is never sent to any external server other than Google's Gemini API endpoints.
            </p>
          </div>

          <div className="settings-group">
            <label className="settings-label">Gemini Model Selection</label>
            <Select 
              value={model} 
              onValueChange={(newModel) => {
                setModel(newModel);
                if (!isReadOnly && apiKey.trim()) {
                  setIsValidating(true);
                  setValidationError('');
                  setValidationSuccess(false);
                  wsService.send('validate_api_key', { api_key: apiKey.trim(), model: newModel });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Default - Fast & Lightweight)</SelectItem>
                <SelectItem value="gemini-2.5-flash">gemini-2.5-flash (Balanced)</SelectItem>
                <SelectItem value="gemini-2.5-pro">gemini-2.5-pro (High Quality)</SelectItem>
                <SelectItem value="gemini-1.5-flash">gemini-1.5-flash</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="settings-group">
            <label className="settings-label">Whisper Transcription Model</label>
            <Select 
              value={whisperModel} 
              onValueChange={setWhisperModel}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="base">Base (~140MB - Default, balanced and fast)</SelectItem>
                <SelectItem value="large">Large (~3.0GB - Maximum accuracy, downloaded on demand)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="settings-group" style={{ borderTop: '1px solid var(--border)', paddingTop: '16px', marginTop: '16px' }}>
            <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              Support & Contact
            </label>
            <p className="settings-hint" style={{ marginTop: '4px', marginBottom: '8px' }}>
              If you have questions, need license key assistance, or encountered issues, please contact the developer on Telegram.
            </p>
            <a 
              href="https://t.me/nhoeunsokpiseth" 
              onClick={(e) => {
                e.preventDefault();
                if (window.electron && window.electron.openExternal) {
                  window.electron.openExternal('https://t.me/nhoeunsokpiseth');
                } else {
                  window.open('https://t.me/nhoeunsokpiseth', '_blank');
                }
              }}
              style={{ 
                display: 'inline-flex', 
                alignItems: 'center', 
                gap: '8px', 
                color: 'var(--primary)', 
                textDecoration: 'none', 
                fontWeight: '500',
                fontSize: '14px',
                padding: '6px 12px',
                borderRadius: '6px',
                background: 'rgba(var(--primary-rgb), 0.1)',
                border: '1px solid rgba(var(--primary-rgb), 0.2)',
                transition: 'all 0.2s ease',
                width: 'fit-content'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(var(--primary-rgb), 0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(var(--primary-rgb), 0.1)';
              }}
            >
              <Send size={14} />
              Contact me on Telegram (@nhoeunsokpiseth)
            </a>
          </div>

          {saveStatus === 'error' && (
            <div className="settings-alert alert-error">
              <AlertCircle size={16} />
              <span>Failed to encrypt and save key.</span>
            </div>
          )}
        </div>

        <div className="settings-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button 
            className="btn btn-primary" 
            onClick={handleSave}
            disabled={isValidating}
            style={isValidating ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
          >
            <Save size={16} />
            {saveStatus === 'success' ? 'Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
