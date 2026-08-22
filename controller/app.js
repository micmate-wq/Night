let ws;
let mediaRecorder;
let audioChunks = [];
let recognition;

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
    ws = new WebSocket(`ws://${wsHost}:8765`);

    ws.onopen = () => {
        console.log('WS Connected to ' + wsHost);
        statusEl.textContent = 'Connected';
        statusEl.className = 'status connected';
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

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        
        recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';
            
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            
            transcriptBox.textContent = finalTranscript || interimTranscript;
            
            if (finalTranscript && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'voice_command',
                    text: finalTranscript
                }));
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error', event.error);
            transcriptBox.textContent = 'Error: ' + event.error;
        };
    } else {
        transcriptBox.textContent = "Speech Recognition not supported in this browser.";
    }
}

async function initMediaRecorder() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = async () => {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            audioChunks = [];
            if (ws.readyState === WebSocket.OPEN) {
                const arrayBuffer = await blob.arrayBuffer();
                ws.send(arrayBuffer);
            }
        };
    } catch (err) {
        console.error("Microphone access denied for MediaRecorder", err);
    }
}

// Event Listeners for Command PTT
function startCommand(e) {
    e.preventDefault();
    if (!recognition) return;
    btnCommand.classList.add('active');
    transcriptBox.textContent = 'Listening...';
    try {
        recognition.start();
    } catch (e) {}
}

function stopCommand(e) {
    e.preventDefault();
    btnCommand.classList.remove('active');
    if (recognition) {
        recognition.stop();
    }
}

// Event Listeners for Audio PTT
function startAudio(e) {
    e.preventDefault();
    if (!mediaRecorder) return;
    btnAudio.classList.add('active');
    audioChunks = [];
    mediaRecorder.start();
}

function stopAudio(e) {
    e.preventDefault();
    btnAudio.classList.remove('active');
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}

// Connect button — save IP and (re)connect
if (btnConnect) {
    btnConnect.addEventListener('click', () => {
        const ip = (ipInput && ipInput.value.trim()) || DEFAULT_IP;
        localStorage.setItem('wsServerIp', ip);
        if (ws) ws.close();
        initWebSocket(ip);
    });
}

// Setup events
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
initSpeechRecognition();
initMediaRecorder();
