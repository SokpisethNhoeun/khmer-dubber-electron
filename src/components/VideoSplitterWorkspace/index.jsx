import React, { useState, useEffect } from 'react';
import { Upload, Video, HelpCircle, Loader2 } from 'lucide-react';
import { wsService } from '../../services/websocket';

export default function VideoSplitterWorkspace({
  setBatchInputs,
  setWorkspaceMode,
  setStartBatchFlag,
  isProcessing,
  setIsProcessing
}) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [segmentMinutes, setSegmentMinutes] = useState(5);
  const [videoDuration, setVideoDuration] = useState(0); // in seconds
  const [progressMsg, setProgressMsg] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [splitParts, setSplitParts] = useState([]);
  const [showResultModal, setShowResultModal] = useState(false);

  // Bind WebSockets
  useEffect(() => {
    const handleProgress = (data) => {
      if (data.stage === 'splitting') {
        setIsProcessing(true);
        setProgressMsg(data.status);
        setProgressPct(data.progress || 0);
      }
    };

    const handleSplitCompleted = (data) => {
      setIsProcessing(false);
      setProgressPct(100);
      setSplitParts(data.parts || []);
      setShowResultModal(true);
    };

    const handleDurationRetrieved = (data) => {
      setVideoDuration(data.duration || 0);
    };

    const handleError = (data) => {
      if (data.message && data.message.includes('Split')) {
        setIsProcessing(false);
        alert(`Split video error: ${data.message}`);
      }
    };

    wsService.on('progress', handleProgress);
    wsService.on('video_split_completed', handleSplitCompleted);
    wsService.on('video_duration_retrieved', handleDurationRetrieved);
    wsService.on('error', handleError);

    return () => {
      wsService.off('progress', handleProgress);
      wsService.off('video_split_completed', handleSplitCompleted);
      wsService.off('video_duration_retrieved', handleDurationRetrieved);
      wsService.off('error', handleError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectFile = async () => {
    if (!window.electron) {
      alert("Local file selection is only supported in the Desktop Electron App.");
      return;
    }
    try {
      const filePaths = await window.electron.selectFile({
        title: 'Select Video to Split',
        multiple: false,
        filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'avi', 'mov'] }]
      });

      if (filePaths) {
        const path = Array.isArray(filePaths) ? filePaths[0] : filePaths;
        setSelectedFile({
          path,
          name: path.split(/[\\/]/).pop()
        });
        setVideoDuration(0); // Reset
        wsService.send('get_video_duration', { video_path: path });
      }
    } catch (e) {
      console.error("Select file failed", e);
    }
  };

  const handleStartSplit = () => {
    if (!selectedFile) {
      alert("Please select a video file first.");
      return;
    }
    if (segmentMinutes <= 0) {
      alert("Please enter a valid segment duration greater than 0.");
      return;
    }

    const segmentSeconds = segmentMinutes * 60;
    if (videoDuration > 0 && segmentSeconds > videoDuration) {
      const totalMinutes = Math.ceil(videoDuration / 60);
      alert(`Segment duration (${segmentMinutes} minutes) cannot be more than the total video duration (${totalMinutes} minutes).`);
      return;
    }

    setIsProcessing(true);
    setProgressMsg("Starting split operation...");
    setProgressPct(0);

    wsService.send('split_video', {
      video_path: selectedFile.path,
      segment_time: segmentSeconds
    });
  };

  const handleReviewParts = () => {
    setBatchInputs(splitParts);
    setShowResultModal(false);
    setWorkspaceMode('batch');
  };

  const handleAutoStartBatch = () => {
    setBatchInputs(splitParts);
    setStartBatchFlag(true);
    setShowResultModal(false);
    setWorkspaceMode('batch');
  };

  return (
    <div className="batch-container" style={{ maxWidth: '800px', margin: '40px auto 0 auto' }}>
      <div className="batch-panel">
        <div className="batch-panel-header">
          <h3>Video Splitter & Dubbing Mode</h3>
        </div>
        
        <div className="batch-panel-body" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <p className="text-sm text-muted" style={{ margin: 0, lineHeight: '1.5' }}>
            Upload a long video (e.g. 60 minutes) to automatically split it into consecutive parts (e.g. 5 minutes each).
            The generated parts will be loaded into the batch workspace queue to be dubbed and exported automatically.
          </p>

          {/* Upload Box */}
          <div 
            onClick={!isProcessing ? handleSelectFile : null}
            className="upload-dropzone"
            style={{
              border: '2px dashed var(--border-color)',
              borderRadius: '12px',
              padding: '40px 20px',
              textAlign: 'center',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              background: 'rgba(255,255,255,0.02)',
              transition: 'all 0.2s',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px'
            }}
          >
            <Upload size={36} className="text-primary" />
            {selectedFile ? (
              <div>
                <h4 style={{ margin: '0 0 4px 0', color: 'var(--text)' }}>{selectedFile.name}</h4>
                <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-muted)' }}>{selectedFile.path}</p>
                {videoDuration > 0 && (
                  <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: 'var(--primary)', fontWeight: '600' }}>
                    Total Duration: {Math.ceil(videoDuration / 60)} minutes ({Math.round(videoDuration)}s)
                  </p>
                )}
              </div>
            ) : (
              <div>
                <h4 style={{ margin: '0 0 4px 0', color: 'var(--text)' }}>Choose Video File</h4>
                <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-muted)' }}>Click to browse and upload video</p>
              </div>
            )}
          </div>

          {/* Settings Box */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', padding: '16px', borderRadius: '8px' }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '600', color: 'var(--text)', marginBottom: '8px' }}>
                Segment Duration (minutes)
                <HelpCircle size={13} className="text-muted" title="The duration of each split part in minutes" />
              </label>
              <input
                type="number"
                min="1"
                disabled={isProcessing}
                value={segmentMinutes}
                onChange={(e) => setSegmentMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                style={{
                  width: '100%',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text)',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  outline: 'none',
                  fontSize: '13px'
                }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              {!isProcessing ? (
                <button
                  className="btn btn-primary"
                  onClick={handleStartSplit}
                  disabled={!selectedFile}
                  style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '10px' }}
                >
                  <Video size={16} />
                  Split Video
                </button>
              ) : (
                <button
                  className="btn btn-secondary"
                  disabled
                  style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '10px' }}
                >
                  <Loader2 size={16} className="spinner" />
                  Splitting...
                </button>
              )}
            </div>
          </div>

          {/* Progress Display */}
          {isProcessing && (
            <div style={{ marginTop: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                <span style={{ color: 'var(--text-muted)' }}>{progressMsg}</span>
                <span style={{ fontWeight: 'bold' }}>{progressPct}%</span>
              </div>
              <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${progressPct}%`, height: '100%', background: 'var(--primary)', transition: 'width 0.2s' }}></div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Split Result Dialog */}
      {showResultModal && (
        <div className="custom-dialog-overlay" onClick={() => setShowResultModal(false)}>
          <div className="custom-dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="custom-dialog-header">
              <h3>Split Successful!</h3>
            </div>
            <div className="custom-dialog-body">
              <p style={{ margin: '8px 0 16px 0', fontSize: '13.5px', color: 'var(--text-muted)' }}>
                Your video has been split into <strong>{splitParts.length} parts</strong>.
                How would you like to proceed?
              </p>
            </div>
            <div className="custom-dialog-footer">
              <button 
                className="btn btn-ghost" 
                onClick={() => setShowResultModal(false)}
              >
                Cancel
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={handleReviewParts}
              >
                Review Split Parts
              </button>
              <button 
                className="btn btn-primary" 
                onClick={handleAutoStartBatch}
              >
                Auto-Start Processing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
