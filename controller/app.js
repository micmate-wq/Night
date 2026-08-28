let ws;
let mediaStream = null;
let activeRecorder = null;
let currentMode = null; // 'command' | 'audio'
let audioChunks = [];

const statusEl = document.getElementById('status');
const btnCommand = document.getElementById('btn-command');
const btnAudio = document.getElementById('btn-audio');
const transcriptBox = document.getElementById('transcript');
const ipInput = document.getElementById('ip-input');
const btnConnect = document.getElementById('btn-connect');

// Load saved IP or fall back to a sensible default
const DEFAULT_IP = '192.168.0.20';
if (ipInput) {
    ipInput.value = localStorage.getItem('wsServerIp') || DEFAULT_IP;
}

function initWebSocket(serverIp) {
    const wsHost = serverIp || localStorage.getItem('wsServerIp') || DEFAULT_IP;
    try {
        if (ws) {
            ws.close();
        }
    } catch (e) {}

    ws = new WebSocket(`ws://${wsHost}:8765`);

    ws.onopen = () => {
        console.log('WS Connected to ' + wsHost);
        statusEl.textContent = 'Connected';
        statusEl.className = 'status connected';
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'command_processed') {
                const cmd = data.command;
                const targetStr = cmd.target ? ` on ${cmd.target}` : '';
                const valStr = cmd.value !== undefined ? ` [${cmd.value}]` : '';
                transcriptBox.textContent = `⚡ ${cmd.action}${targetStr}${valStr}`;
            }
        } catch (e) {
            // Ignore non-JSON messages
        }
    };

    ws.onclose = (event) => {
        console.log('WS Disconnected: code=' + event.code + ', reason=' + event.reason);
        statusEl.textContent = 'Disconnected';
        statusEl.className = 'status disconnected';
        setTimeout(() => initWebSocket(), 3000);
    };

    ws.onerror = (error) => {
        console.log('WS Error: ' + JSON.stringify(error));
    };
}

async function getMediaStream() {
    if (mediaStream && mediaStream.active) {
        return mediaStream;
    }
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        return mediaStream;
    } catch (err) {
        console.error('Microphone access error:', err);
        transcriptBox.textContent = 'Mic Error: ' + err.message;
        return null;
    }
}

function getSupportedMimeType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus'];
    for (const t of types) {
        if (MediaRecorder.isTypeSupported(t)) {
            return t;
        }
    }
    return '';
}

async function startRecording(mode) {
    currentMode = mode;
    audioChunks = [];

    const stream = await getMediaStream();
    if (!stream) return;

    const mimeType = getSupportedMimeType();
    const options = mimeType ? { mimeType } : {};

    try {
        activeRecorder = new MediaRecorder(stream, options);
    } catch (e) {
        activeRecorder = new MediaRecorder(stream);
    }

    activeRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
            audioChunks.push(event.data);
        }
    };

    activeRecorder.onstop = async () => {
        const finalMime = activeRecorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(audioChunks, { type: finalMime });
        audioChunks = [];

        if (currentMode === 'command') {
            if (transcriptBox.textContent === 'Listening...') {
                transcriptBox.textContent = 'Analyzing voice command with Gemini...';
            }
            if (ws && ws.readyState === WebSocket.OPEN) {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64Data = reader.result.split(',')[1];
                    ws.send(JSON.stringify({
                        type: 'voice_command_audio',
                        mimeType: finalMime,
                        data: base64Data
                    }));
                };
                reader.readAsDataURL(blob);
            } else {
                transcriptBox.textContent = 'Error: WebSocket not connected.';
            }
        } else if (currentMode === 'audio') {
            if (ws && ws.readyState === WebSocket.OPEN) {
                const arrayBuffer = await blob.arrayBuffer();
                ws.send(arrayBuffer);
            }
        }
        currentMode = null;
    };

    activeRecorder.start();
}

function stopRecording() {
    if (activeRecorder && activeRecorder.state !== 'inactive') {
        activeRecorder.stop();
    }
}

// Event Listeners for Command PTT
function startCommand(e) {
    e.preventDefault();
    btnCommand.classList.add('active');
    transcriptBox.textContent = 'Listening...';
    startRecording('command');
}

function stopCommand(e) {
    e.preventDefault();
    btnCommand.classList.remove('active');
    stopRecording();
}

// Event Listeners for Audio PTT
function startAudio(e) {
    e.preventDefault();
    btnAudio.classList.add('active');
    startRecording('audio');
}

function stopAudio(e) {
    e.preventDefault();
    btnAudio.classList.remove('active');
    stopRecording();
}

// Connect button — save IP and (re)connect
if (btnConnect) {
    btnConnect.addEventListener('click', () => {
        const ip = (ipInput && ipInput.value.trim()) || DEFAULT_IP;
        localStorage.setItem('wsServerIp', ip);
        initWebSocket(ip);
    });
}

// Setup touch / mouse events
btnCommand.addEventListener('mousedown', startCommand);
btnCommand.addEventListener('touchstart', startCommand, {passive: false});
btnCommand.addEventListener('mouseup', stopCommand);
btnCommand.addEventListener('touchend', stopCommand);
btnCommand.addEventListener('mouseleave', stopCommand);

btnAudio.addEventListener('mousedown', startAudio);
btnAudio.addEventListener('touchstart', startAudio, {passive: false});
btnAudio.addEventListener('mouseup', stopAudio);
btnAudio.addEventListener('touchend', stopAudio);
btnAudio.addEventListener('mouseleave', stopAudio);

// Initialize
initWebSocket();
// Pre-request mic permission on first user interaction if needed
document.body.addEventListener('click', () => {
    if (!mediaStream) getMediaStream();
}, { once: true });
