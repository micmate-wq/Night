import React, { useState } from 'react';

export default function DropZone() {
  const [isRecording, setIsRecording] = useState(false);
  const [clips, setClips] = useState([
    { id: 1, name: 'Sample A.wav', duration: '0:04' },
    { id: 2, name: 'Vocal Loop.wav', duration: '0:08' },
    { id: 3, name: 'Synth Hit.wav', duration: '0:02' },
  ]);

  const handleStartRecord = (e) => {
    e.preventDefault();
    setIsRecording(true);
  };

  const handleEndRecord = (e) => {
    e.preventDefault();
    if (isRecording) {
      setIsRecording(false);
    }
  };

  return (
    <div className="drop-zone-container">
      <div className="record-section">
        <button
          className={`record-button ${isRecording ? 'recording' : ''}`}
          onPointerDown={handleStartRecord}
          onPointerUp={handleEndRecord}
          onPointerLeave={handleEndRecord}
        >
          <span className="record-inner">
            {isRecording ? 'Recording...' : 'Hold to Record'}
          </span>
        </button>
      </div>

      <div className="audio-clips-container">
        {clips.map((clip) => (
          <div key={clip.id} className="audio-clip-card">
            <span className="clip-name">{clip.name}</span>
            <span className="clip-duration">{clip.duration}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
