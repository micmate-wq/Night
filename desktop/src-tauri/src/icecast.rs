//! Icecast 2.4 outbound source: master PCM → MP3 → HTTP PUT /matt.
//!
//! Credentials are KEY=value from ~/.icecast-matt. Never log, emit, or
//! return the password or the Authorization secret.

use base64::prelude::*;
use mp3lame_encoder::{Bitrate, Builder, DualPcm, Encoder, FlushNoGap, Mode, Quality, VbrMode};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeBody, Request};
use tauri::State;

const REQUIRED_HOST: &str = "macmini.tail32e87c.ts.net";
const REQUIRED_PORT: u16 = 4250;
const REQUIRED_MOUNT: &str = "/matt";
const DEFAULT_USER: &str = "source";
const BITRATE_KBPS: u32 = 128;
const BYTES_PER_SEC: f64 = (BITRATE_KBPS as f64 * 1000.0) / 8.0;
const PCM_QUEUE_CAP: usize = 6;
const PREROLL_BYTES: f64 = 8000.0;
const CREDS_FILE: &str = ".icecast-matt";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum IcecastEvent {
    Connecting { host: String, mount: String },
    Connected { host: String, mount: String },
    Status { bytes: u64, dropped: u64 },
    Error { message: String },
    Disconnected,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IcecastInfo {
    pub host: String,
    pub port: u16,
    pub mount: String,
    pub connected: bool,
}

enum PcmMsg {
    Dual { left: Vec<f32>, right: Vec<f32> },
    Stop,
}

struct Live {
    tx: SyncSender<PcmMsg>,
}

pub struct IcecastState {
    live: Mutex<Option<Live>>,
    stop: Arc<AtomicBool>,
    connected: Arc<AtomicBool>,
    bytes: Arc<AtomicU64>,
    dropped: Arc<AtomicU64>,
}

impl IcecastState {
    pub fn new() -> Self {
        Self {
            live: Mutex::new(None),
            stop: Arc::new(AtomicBool::new(false)),
            connected: Arc::new(AtomicBool::new(false)),
            bytes: Arc::new(AtomicU64::new(0)),
            dropped: Arc::new(AtomicU64::new(0)),
        }
    }
}

struct Creds {
    host: String,
    port: u16,
    mount: String,
    user: String,
    password: String,
}

impl Creds {
    fn basic_token(&self) -> String {
        BASE64_STANDARD.encode(format!("{}:{}", self.user, self.password))
    }

    fn redact(&self, s: &str) -> String {
        let mut out = s.to_string();
        if !self.password.is_empty() {
            out = out.replace(&self.password, "***");
        }
        let token = self.basic_token();
        if !token.is_empty() {
            out = out.replace(&token, "***");
        }
        out
    }
}

fn creds_path() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(CREDS_FILE)
    } else {
        PathBuf::from("/Users/matt").join(CREDS_FILE)
    }
}

fn parse_kv(text: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let key = k.trim();
        if key.is_empty() {
            continue;
        }
        let mut val = v.trim().to_string();
        if val.len() >= 2 {
            let b = val.as_bytes();
            if (b[0] == b'"' && b[val.len() - 1] == b'"')
                || (b[0] == b'\'' && b[val.len() - 1] == b'\'')
            {
                val = val[1..val.len() - 1].to_string();
            }
        }
        map.insert(key.to_string(), val);
    }
    map
}

fn load_creds() -> Result<Creds, String> {
    let path = creds_path();
    let text = std::fs::read_to_string(&path)
        .map_err(|_| format!("missing Icecast creds file {}", path.display()))?;
    let map = parse_kv(&text);
    let password = map
        .get("ICECAST_PASSWORD")
        .cloned()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "missing ICECAST_PASSWORD in ~/.icecast-matt".to_string())?;
    let user = map
        .get("ICECAST_USER")
        .cloned()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_USER.to_string());
    if let Some(h) = map.get("ICECAST_HOST") {
        if h != REQUIRED_HOST {
            eprintln!("ICECAST_HOST was not the required source FQDN; using {REQUIRED_HOST}");
        }
    }
    if let Some(p) = map.get("ICECAST_PORT") {
        if p.parse::<u16>().ok() != Some(REQUIRED_PORT) {
            eprintln!("ICECAST_PORT overridden to {REQUIRED_PORT}");
        }
    }
    if let Some(m) = map.get("ICECAST_MOUNT") {
        if m != REQUIRED_MOUNT {
            eprintln!("ICECAST_MOUNT overridden to {REQUIRED_MOUNT}");
        }
    }
    Ok(Creds {
        host: REQUIRED_HOST.to_string(),
        port: REQUIRED_PORT,
        mount: REQUIRED_MOUNT.to_string(),
        user,
        password,
    })
}

fn build_encoder(in_rate: u32) -> Result<Encoder, String> {
    let mut builder = Builder::new().ok_or_else(|| "failed to allocate LAME encoder".to_string())?;
    builder
        .set_num_channels(2)
        .map_err(|e| format!("lame channels: {e}"))?;
    builder
        .set_sample_rate(in_rate)
        .map_err(|e| format!("lame in-rate: {e}"))?;
    if in_rate != 44_100 {
        builder
            .set_output_sample_rate(std::num::NonZeroU32::new(44_100))
            .map_err(|e| format!("lame out-rate: {e}"))?;
    }
    builder
        .set_brate(Bitrate::Kbps128)
        .map_err(|e| format!("lame bitrate: {e}"))?;
    builder
        .set_quality(Quality::Good)
        .map_err(|e| format!("lame quality: {e}"))?;
    builder
        .set_mode(Mode::Stereo)
        .map_err(|e| format!("lame mode: {e}"))?;
    let _ = builder.set_vbr_mode(VbrMode::Off);
    let _ = builder.set_to_write_vbr_tag(false);
    builder.build().map_err(|e| format!("lame init: {e}"))
}

fn encode_dual(encoder: &mut Encoder, left: &[f32], right: &[f32]) -> Result<Vec<u8>, String> {
    let n = left.len().min(right.len());
    if n == 0 {
        return Ok(Vec::new());
    }
    let mut out = Vec::with_capacity(mp3lame_encoder::max_required_buffer_size(n));
    let written = encoder
        .encode(
            DualPcm {
                left: &left[..n],
                right: &right[..n],
            },
            out.spare_capacity_mut(),
        )
        .map_err(|e| format!("mp3 encode failed: {e}"))?;
    unsafe {
        out.set_len(written);
    }
    Ok(out)
}

fn flush_encoder(encoder: &mut Encoder) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(mp3lame_encoder::max_required_buffer_size(0));
    let written = encoder
        .flush::<FlushNoGap>(out.spare_capacity_mut())
        .map_err(|e| format!("mp3 flush failed: {e}"))?;
    unsafe {
        out.set_len(written);
    }
    Ok(out)
}

fn read_http_head(stream: &mut TcpStream, timeout: Duration) -> Result<(u16, String), String> {
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|e| e.to_string())?;
    let mut buf = Vec::with_capacity(1024);
    let mut tmp = [0u8; 512];
    loop {
        match stream.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&tmp[..n]);
                if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.windows(2).any(|w| w == b"\n\n") {
                    break;
                }
                if buf.len() > 16_384 {
                    return Err("HTTP response too large".into());
                }
            }
            Err(e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                if buf.is_empty() {
                    return Err("timed out waiting for Icecast response".into());
                }
                break;
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    let text = String::from_utf8_lossy(&buf);
    let status_line = text.lines().next().unwrap_or("").trim();
    let code = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| format!("bad Icecast status line: {status_line}"))?;
    Ok((code, text.into_owned()))
}

fn content_type_of(head: &str) -> String {
    for line in head.lines() {
        let lower = line.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("content-type:") {
            return rest.trim().to_string();
        }
    }
    String::new()
}

fn probe_mount_live(host: &str, port: u16, mount: &str) -> Result<bool, String> {
    let mut stream = TcpStream::connect((host, port))
        .map_err(|e| format!("cannot reach {host}:{port} ({e})"))?;
    stream.set_nodelay(true).map_err(|e| e.to_string())?;
    let req = format!(
        "GET {mount} HTTP/1.0\r\nHost: {host}:{port}\r\nUser-Agent: Aether/4.2\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let (code, head) = read_http_head(&mut stream, Duration::from_secs(4))?;
    let ctype = content_type_of(&head);
    Ok(code == 200
        && (ctype.starts_with("audio/") || ctype.contains("mpeg") || ctype.contains("ogg")))
}

fn status_json_has_mount(host: &str, port: u16, mount: &str) -> Result<bool, String> {
    let mut stream = TcpStream::connect((host, port)).map_err(|e| e.to_string())?;
    stream.set_nodelay(true).ok();
    let req = format!(
        "GET /status-json.xsl HTTP/1.0\r\nHost: {host}:{port}\r\nUser-Agent: Aether/4.2\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut body = Vec::new();
    stream.set_read_timeout(Some(Duration::from_secs(4))).ok();
    let _ = stream.read_to_end(&mut body);
    let text = String::from_utf8_lossy(&body);
    let slug = mount.trim_start_matches('/');
    Ok(text.contains(&format!("/{slug}\"")) || text.contains(&format!("/{slug}?")))
}

fn put_headers(creds: &Creds) -> String {
    let token = creds.basic_token();
    format!(
        "PUT {mount} HTTP/1.1\r\n\
         Host: {host}:{port}\r\n\
         Authorization: Basic {token}\r\n\
         User-Agent: Aether/4.2\r\n\
         Content-Type: audio/mpeg\r\n\
         Ice-Name: Aether\r\n\
         Ice-Public: 0\r\n\
         Ice-Audio-Info: ice-samplerate=44100;ice-bitrate=128;ice-channels=2\r\n\
         Accept: */*\r\n\
         Expect: 100-continue\r\n\
         \r\n",
        mount = creds.mount,
        host = creds.host,
        port = creds.port,
        token = token
    )
}

fn source_headers(creds: &Creds) -> String {
    let token = creds.basic_token();
    format!(
        "SOURCE {mount} ICE/1.0\r\n\
         Host: {host}:{port}\r\n\
         Authorization: Basic {token}\r\n\
         User-Agent: Aether/4.2\r\n\
         Content-Type: audio/mpeg\r\n\
         Ice-Name: Aether\r\n\
         Ice-Public: 0\r\n\
         Ice-Audio-Info: ice-samplerate=44100;ice-bitrate=128;ice-channels=2\r\n\
         \r\n",
        mount = creds.mount,
        host = creds.host,
        port = creds.port,
        token = token
    )
}

fn connect_source(creds: &Creds) -> Result<TcpStream, String> {
    let addr = (creds.host.as_str(), creds.port);
    let mut stream = TcpStream::connect(addr)
        .map_err(|e| format!("TCP connect {}:{} failed: {e}", creds.host, creds.port))?;
    stream.set_nodelay(true).map_err(|e| e.to_string())?;
    stream.set_write_timeout(Some(Duration::from_secs(8))).ok();
    stream
        .write_all(put_headers(creds).as_bytes())
        .map_err(|e| creds.redact(&e.to_string()))?;

    match read_http_head(&mut stream, Duration::from_secs(6)) {
        Ok((100, _)) | Ok((200, _)) => return Ok(stream),
        Ok((code, head)) => {
            if code == 401 || code == 403 {
                return Err("Icecast rejected source credentials".into());
            }
            if code == 409 {
                return Err("Icecast mount /matt already has a source".into());
            }
            let snippet = creds.redact(&head.lines().take(4).collect::<Vec<_>>().join(" | "));
            eprintln!("PUT returned {code} ({snippet}); falling back to SOURCE ICE/1.0");
        }
        Err(e) => {
            eprintln!(
                "PUT 100-continue: {}; falling back to SOURCE ICE/1.0",
                creds.redact(&e)
            );
        }
    }

    drop(stream);
    let mut stream = TcpStream::connect(addr)
        .map_err(|e| format!("TCP reconnect {}:{} failed: {e}", creds.host, creds.port))?;
    stream.set_nodelay(true).map_err(|e| e.to_string())?;
    stream.set_write_timeout(Some(Duration::from_secs(8))).ok();
    stream
        .write_all(source_headers(creds).as_bytes())
        .map_err(|e| creds.redact(&e.to_string()))?;
    let (code, head) = read_http_head(&mut stream, Duration::from_secs(6))?;
    if code == 200 || code == 100 {
        return Ok(stream);
    }
    if code == 401 || code == 403 {
        return Err("Icecast rejected source credentials".into());
    }
    if code == 409 {
        return Err("Icecast mount /matt already has a source".into());
    }
    let snippet = creds.redact(&head.lines().take(3).collect::<Vec<_>>().join(" | "));
    Err(format!("Icecast SOURCE failed ({code}): {snippet}"))
}

fn pace_write(
    stream: &mut TcpStream,
    data: &[u8],
    start: Instant,
    bytes_sent: &mut u64,
) -> Result<bool, String> {
    if data.is_empty() {
        return Ok(true);
    }
    let elapsed = start.elapsed().as_secs_f64();
    let allowed = elapsed * BYTES_PER_SEC + PREROLL_BYTES;
    if (*bytes_sent as f64) > allowed {
        return Ok(false);
    }
    let target = *bytes_sent as f64 / BYTES_PER_SEC;
    if target > elapsed {
        let sleep_s = (target - elapsed).min(0.08);
        if sleep_s > 0.0004 {
            thread::sleep(Duration::from_secs_f64(sleep_s));
        }
    }
    stream.write_all(data).map_err(|e| e.to_string())?;
    *bytes_sent += data.len() as u64;
    Ok(true)
}

fn run_loop(
    mut stream: TcpStream,
    creds: Creds,
    rx: mpsc::Receiver<PcmMsg>,
    on_event: Channel<IcecastEvent>,
    stop: Arc<AtomicBool>,
    connected: Arc<AtomicBool>,
    bytes_at: Arc<AtomicU64>,
    dropped_at: Arc<AtomicU64>,
    in_rate: u32,
) {
    let send_ev = |ev: IcecastEvent| {
        let _ = on_event.send(ev);
    };

    let mut encoder = match build_encoder(in_rate) {
        Ok(e) => e,
        Err(e) => {
            send_ev(IcecastEvent::Error { message: e });
            connected.store(false, Ordering::SeqCst);
            send_ev(IcecastEvent::Disconnected);
            return;
        }
    };

    connected.store(true, Ordering::SeqCst);
    send_ev(IcecastEvent::Connected {
        host: creds.host.clone(),
        mount: creds.mount.clone(),
    });

    let start = Instant::now();
    let mut bytes_sent: u64 = 0;
    let mut last_status = Instant::now();

    while !stop.load(Ordering::SeqCst) {
        let msg = match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(m) => m,
            Err(RecvTimeoutError::Timeout) => {
                if last_status.elapsed() > Duration::from_secs(2) {
                    send_ev(IcecastEvent::Status {
                        bytes: bytes_sent,
                        dropped: dropped_at.load(Ordering::Relaxed),
                    });
                    last_status = Instant::now();
                }
                continue;
            }
            Err(RecvTimeoutError::Disconnected) => break,
        };
        match msg {
            PcmMsg::Stop => break,
            PcmMsg::Dual { left, right } => match encode_dual(&mut encoder, &left, &right) {
                Ok(mp3) => match pace_write(&mut stream, &mp3, start, &mut bytes_sent) {
                    Ok(true) => bytes_at.store(bytes_sent, Ordering::Relaxed),
                    Ok(false) => {
                        dropped_at.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(e) => {
                        send_ev(IcecastEvent::Error {
                            message: creds.redact(&e),
                        });
                        break;
                    }
                },
                Err(e) => {
                    send_ev(IcecastEvent::Error { message: e });
                    break;
                }
            },
        }
    }

    if let Ok(tail) = flush_encoder(&mut encoder) {
        let _ = pace_write(&mut stream, &tail, start, &mut bytes_sent);
    }
    let _ = stream.shutdown(std::net::Shutdown::Write);
    connected.store(false, Ordering::SeqCst);
    bytes_at.store(bytes_sent, Ordering::Relaxed);
    send_ev(IcecastEvent::Disconnected);
}

fn deinterleave(bytes: &[u8]) -> Result<(Vec<f32>, Vec<f32>), String> {
    if bytes.len() % 8 != 0 {
        return Err("pcm body must be interleaved f32 stereo".into());
    }
    let n = bytes.len() / 8;
    let mut left = Vec::with_capacity(n);
    let mut right = Vec::with_capacity(n);
    for i in 0..n {
        let lo = i * 8;
        let l = f32::from_le_bytes(bytes[lo..lo + 4].try_into().unwrap());
        let r = f32::from_le_bytes(bytes[lo + 4..lo + 8].try_into().unwrap());
        left.push(l);
        right.push(r);
    }
    Ok((left, right))
}

#[tauri::command]
pub fn icecast_connect(
    state: State<'_, IcecastState>,
    on_event: Channel<IcecastEvent>,
    sample_rate: u32,
) -> Result<IcecastInfo, String> {
    if state.connected.load(Ordering::SeqCst) {
        return Err("Icecast outbound already connected".into());
    }
    let creds = load_creds()?;
    let in_rate = if (8000..=192_000).contains(&sample_rate) {
        sample_rate
    } else {
        44_100
    };

    match probe_mount_live(&creds.host, creds.port, &creds.mount) {
        Ok(true) => {
            return Err(
                "mount /matt is already live (HTTP 200 audio); not connecting a second source"
                    .into(),
            );
        }
        Ok(false) => {}
        Err(e) => return Err(format!("cannot probe Icecast /matt: {}", creds.redact(&e))),
    }
    if let Ok(true) = status_json_has_mount(&creds.host, creds.port, &creds.mount) {
        return Err(
            "mount /matt is already listed as a live source; not connecting a second source".into(),
        );
    }

    let _ = on_event.send(IcecastEvent::Connecting {
        host: creds.host.clone(),
        mount: creds.mount.clone(),
    });

    let (tx, rx) = mpsc::sync_channel::<PcmMsg>(PCM_QUEUE_CAP);
    {
        let mut guard = state.live.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("Icecast outbound already connected".into());
        }
        *guard = Some(Live { tx });
    }

    state.stop.store(false, Ordering::SeqCst);
    state.bytes.store(0, Ordering::SeqCst);
    state.dropped.store(0, Ordering::SeqCst);

    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let stop = Arc::clone(&state.stop);
    let connected = Arc::clone(&state.connected);
    let bytes_at = Arc::clone(&state.bytes);
    let dropped_at = Arc::clone(&state.dropped);
    let creds_thread = creds;

    thread::Builder::new()
        .name("aether-icecast-out".into())
        .spawn(move || match connect_source(&creds_thread) {
            Ok(stream) => {
                let _ = ready_tx.send(Ok(()));
                run_loop(
                    stream,
                    creds_thread,
                    rx,
                    on_event,
                    stop,
                    connected,
                    bytes_at,
                    dropped_at,
                    in_rate,
                );
            }
            Err(e) => {
                let _ = ready_tx.send(Err(e));
            }
        })
        .map_err(|e| e.to_string())?;

    match ready_rx.recv_timeout(Duration::from_secs(12)) {
        Ok(Ok(())) => {
            state.connected.store(true, Ordering::SeqCst);
            Ok(IcecastInfo {
                host: REQUIRED_HOST.to_string(),
                port: REQUIRED_PORT,
                mount: REQUIRED_MOUNT.to_string(),
                connected: true,
            })
        }
        Ok(Err(e)) => {
            if let Ok(mut guard) = state.live.lock() {
                *guard = None;
            }
            state.connected.store(false, Ordering::SeqCst);
            Err(e)
        }
        Err(_) => {
            state.stop.store(true, Ordering::SeqCst);
            if let Ok(mut guard) = state.live.lock() {
                *guard = None;
            }
            state.connected.store(false, Ordering::SeqCst);
            Err("timed out connecting Icecast source".into())
        }
    }
}

#[tauri::command]
pub fn icecast_disconnect(state: State<'_, IcecastState>) -> Result<(), String> {
    state.stop.store(true, Ordering::SeqCst);
    let tx = {
        let mut guard = state.live.lock().map_err(|e| e.to_string())?;
        guard.take().map(|l| l.tx)
    };
    if let Some(tx) = tx {
        let _ = tx.try_send(PcmMsg::Stop);
    }
    state.connected.store(false, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn icecast_push_pcm(state: State<'_, IcecastState>, request: Request) -> Result<(), String> {
    if !state.connected.load(Ordering::SeqCst) {
        return Ok(());
    }
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("pcm body must be raw interleaved f32".into());
    };
    let (left, right) = deinterleave(bytes)?;
    let tx = {
        let guard = state.live.lock().map_err(|e| e.to_string())?;
        guard.as_ref().map(|l| l.tx.clone())
    };
    let Some(tx) = tx else {
        return Ok(());
    };
    match tx.try_send(PcmMsg::Dual { left, right }) {
        Ok(()) => Ok(()),
        Err(TrySendError::Full(_)) => {
            state.dropped.fetch_add(1, Ordering::Relaxed);
            Ok(())
        }
        Err(TrySendError::Disconnected(_)) => {
            state.connected.store(false, Ordering::SeqCst);
            Ok(())
        }
    }
}

#[tauri::command]
pub fn icecast_status(state: State<'_, IcecastState>) -> Result<IcecastInfo, String> {
    Ok(IcecastInfo {
        host: REQUIRED_HOST.to_string(),
        port: REQUIRED_PORT,
        mount: REQUIRED_MOUNT.to_string(),
        connected: state.connected.load(Ordering::SeqCst),
    })
}

/// Unit-level PUT of a few seconds of sine. Used by `cargo test` only.
#[cfg(test)]
pub fn put_sine_briefly(seconds: f32) -> Result<u64, String> {
    let creds = load_creds()?;
    if probe_mount_live(&creds.host, creds.port, &creds.mount)? {
        return Err("mount /matt already live; refusing test source".into());
    }
    if let Ok(true) = status_json_has_mount(&creds.host, creds.port, &creds.mount) {
        return Err("mount /matt already listed live; refusing test source".into());
    }
    let mut stream = connect_source(&creds)?;
    let mut encoder = build_encoder(44_100)?;
    let start = Instant::now();
    let mut bytes_sent: u64 = 0;
    let total = (seconds.max(0.2) * 44_100.0) as usize;
    let chunk = 1152usize;
    let mut left = vec![0f32; chunk];
    let mut right = vec![0f32; chunk];
    let mut pos = 0usize;
    while pos < total {
        let n = (total - pos).min(chunk);
        for i in 0..n {
            let t = (pos + i) as f32 / 44_100.0;
            let s = (2.0 * std::f32::consts::PI * 440.0 * t).sin() * 0.2;
            left[i] = s;
            right[i] = s * 0.85;
        }
        let mp3 = encode_dual(&mut encoder, &left[..n], &right[..n])?;
        let _ = pace_write(&mut stream, &mp3, start, &mut bytes_sent)?;
        pos += n;
    }
    if let Ok(tail) = flush_encoder(&mut encoder) {
        let _ = pace_write(&mut stream, &tail, start, &mut bytes_sent)?;
    }
    let _ = stream.shutdown(std::net::Shutdown::Write);
    drop(stream);
    Ok(bytes_sent)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_kv_does_not_treat_whole_file_as_password() {
        let text = "ICECAST_HOST=macmini.tail32e87c.ts.net\nICECAST_PASSWORD=dummy-secret\nICECAST_USER=source\n";
        let map = parse_kv(text);
        assert_eq!(map.get("ICECAST_PASSWORD").unwrap(), "dummy-secret");
        assert_eq!(
            map.get("ICECAST_HOST").unwrap(),
            "macmini.tail32e87c.ts.net"
        );
        assert_ne!(map.get("ICECAST_PASSWORD").unwrap(), text);
        assert!(!parse_kv("not a kv line\n# comment\n").contains_key("ICECAST_PASSWORD"));
    }

    #[test]
    fn deinterleave_roundtrip() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0.5f32.to_le_bytes());
        bytes.extend_from_slice(&(-0.25f32).to_le_bytes());
        bytes.extend_from_slice(&1.0f32.to_le_bytes());
        bytes.extend_from_slice(&(-1.0f32).to_le_bytes());
        let (l, r) = deinterleave(&bytes).unwrap();
        assert_eq!(l, vec![0.5, 1.0]);
        assert_eq!(r, vec![-0.25, -1.0]);
    }

    #[test]
    #[ignore]
    fn put_sine_then_disconnect() {
        let probe = thread::spawn(|| {
            thread::sleep(Duration::from_millis(900));
            probe_mount_live(REQUIRED_HOST, REQUIRED_PORT, REQUIRED_MOUNT)
        });
        let bytes = put_sine_briefly(3.5).expect("sine PUT");
        assert!(bytes > 0, "expected some MP3 bytes on the wire");
        let mid = probe.join().expect("probe thread");
        match mid {
            Ok(true) => {}
            Ok(false) => eprintln!("mid-stream GET was not yet 200 (Icecast may need a frame)"),
            Err(e) => eprintln!("mid-stream probe error: {e}"),
        }
        thread::sleep(Duration::from_millis(500));
        let live = probe_mount_live(REQUIRED_HOST, REQUIRED_PORT, REQUIRED_MOUNT)
            .expect("probe after disconnect");
        assert!(!live, "test source must not stay hanging on /matt");
    }
}
