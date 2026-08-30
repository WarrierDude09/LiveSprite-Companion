use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, SampleRate, Stream, StreamConfig, SupportedStreamConfig};
use nnnoiseless::{DenoiseState, FRAME_SIZE};
use serde::{Deserialize, Serialize};
use std::sync::{atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering}, mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceConfig {
    pub device_name: Option<String>, pub noise_gate_db: f32, pub talking_threshold_db: f32,
    pub yelling_threshold_db: f32, #[serde(default = "default_true")] pub noise_suppression_enabled: bool,
    #[serde(default = "default_strength")] pub suppression_strength: String,
    #[serde(default = "default_smoothing")] pub smoothing: f32,
    #[serde(default = "default_sensitivity")] pub sensitivity: f32,
    #[serde(default = "attack")] pub activation_ms: u64, #[serde(default = "release")] pub release_ms: u64,
}
fn default_true() -> bool { true }
fn default_strength() -> String { "medium".into() }
fn default_smoothing() -> f32 { 0.72 }
fn default_sensitivity() -> f32 { 1.0 }
fn attack() -> u64 { 80 }
fn release() -> u64 { 220 }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStatus {
    pub running: bool, pub level_db: f32, pub raw_level_db: f32, pub processed_level_db: f32,
    pub voice_state: &'static str, pub device_name: String, pub noise_suppression_enabled: bool,
    pub suppression_strength: String,
}

struct Detector {
    current: u8, candidate: u8, since: Instant, config: VoiceConfig, denoiser: Box<DenoiseState<'static>>,
    pending: Vec<f32>, smoothed_db: f32,
}

pub struct AudioEngine {
    stop: Mutex<Option<mpsc::Sender<()>>>, running: Arc<AtomicBool>, raw_level: Arc<AtomicU32>,
    processed_level: Arc<AtomicU32>, voice: Arc<AtomicU8>, device_name: Arc<Mutex<String>>,
    suppression_enabled: Arc<AtomicBool>, suppression_strength: Arc<Mutex<String>>,
}
impl Default for AudioEngine {
    fn default() -> Self { Self {
        stop: Mutex::new(None), running: Arc::new(AtomicBool::new(false)),
        raw_level: Arc::new(AtomicU32::new((-100.0f32).to_bits())),
        processed_level: Arc::new(AtomicU32::new((-100.0f32).to_bits())), voice: Arc::new(AtomicU8::new(0)),
        device_name: Arc::new(Mutex::new(String::new())), suppression_enabled: Arc::new(AtomicBool::new(false)),
        suppression_strength: Arc::new(Mutex::new("off".into())),
    }}
}

impl AudioEngine {
    pub fn devices(&self) -> Result<Vec<String>, String> {
        let host = cpal::default_host();
        let mut values = host.input_devices().map_err(|e| e.to_string())?.filter_map(|d| d.name().ok()).collect::<Vec<_>>();
        values.sort(); values.dedup(); Ok(values)
    }
    pub fn start(&self, mut config: VoiceConfig, app: AppHandle) -> Result<(), String> {
        validate_config(&mut config)?; self.stop();
        let (stop_tx, stop_rx) = mpsc::channel(); let (init_tx, init_rx) = mpsc::sync_channel(1);
        let raw = self.raw_level.clone(); let processed = self.processed_level.clone(); let voice = self.voice.clone();
        let running = self.running.clone(); let device_name = self.device_name.clone();
        let suppression_enabled = self.suppression_enabled.clone(); let suppression_strength = self.suppression_strength.clone();
        let configured_suppression = config.noise_suppression_enabled; let configured_strength = config.suppression_strength.clone();
        std::thread::Builder::new().name("livesprite-audio".into()).spawn(move || {
            let result = initialize_stream(config, app, raw.clone(), processed.clone(), voice.clone(), running.clone());
            match result {
                Ok((stream, name)) => {
                    if let Ok(mut stored) = device_name.lock() { *stored = name; }
                    if let Ok(mut stored) = suppression_strength.lock() { *stored = configured_strength; }
                    suppression_enabled.store(configured_suppression, Ordering::Release);
                    running.store(true, Ordering::Release); let _ = init_tx.send(Ok(())); let _ = stop_rx.recv(); drop(stream)
                }
                Err(error) => { let _ = init_tx.send(Err(error)); return; }
            }
            running.store(false, Ordering::Release); voice.store(0, Ordering::Release);
            raw.store((-100.0f32).to_bits(), Ordering::Relaxed); processed.store((-100.0f32).to_bits(), Ordering::Relaxed);
        }).map_err(|e| e.to_string())?;
        match init_rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "Microphone initialization timed out.".to_string())? {
            Ok(()) => { *self.stop.lock().map_err(|_| "Audio engine unavailable")? = Some(stop_tx); Ok(()) }, Err(error) => Err(error)
        }
    }
    pub fn stop(&self) {
        if let Ok(mut stop) = self.stop.lock() { if let Some(sender) = stop.take() { let _ = sender.send(()); } }
        self.running.store(false, Ordering::Release); self.voice.store(0, Ordering::Release);
        self.raw_level.store((-100.0f32).to_bits(), Ordering::Relaxed);
        self.processed_level.store((-100.0f32).to_bits(), Ordering::Relaxed);
    }
    pub fn status(&self) -> AudioStatus {
        let processed = f32::from_bits(self.processed_level.load(Ordering::Relaxed));
        AudioStatus { running: self.running.load(Ordering::Acquire), level_db: processed,
            raw_level_db: f32::from_bits(self.raw_level.load(Ordering::Relaxed)), processed_level_db: processed,
            voice_state: state_name(self.voice.load(Ordering::Acquire)),
            device_name: self.device_name.lock().map(|v| v.clone()).unwrap_or_default(),
            noise_suppression_enabled: self.suppression_enabled.load(Ordering::Acquire),
            suppression_strength: self.suppression_strength.lock().map(|v| v.clone()).unwrap_or_else(|_| "unknown".into()) }
    }
}

fn validate_config(config: &mut VoiceConfig) -> Result<(), String> {
    if !(config.noise_gate_db < config.talking_threshold_db && config.talking_threshold_db < config.yelling_threshold_db) {
        return Err("Noise Gate must be below Talking, and Talking must be below Yelling.".into());
    }
    if !config.smoothing.is_finite() || !(0.0..=0.98).contains(&config.smoothing) { return Err("Smoothing must be between 0 and 0.98.".into()); }
    if !config.sensitivity.is_finite() || !(0.25..=4.0).contains(&config.sensitivity) { return Err("Sensitivity must be between 0.25 and 4.0.".into()); }
    config.suppression_strength = match config.suppression_strength.to_ascii_lowercase().as_str() {
        "low" => "low", "medium" => "medium", "high" => "high", "very_high" | "very high" | "veryhigh" => "very_high",
        other => return Err(format!("Unsupported noise suppression strength: {other}")),
    }.into(); Ok(())
}

fn initialize_stream(config: VoiceConfig, app: AppHandle, raw: Arc<AtomicU32>, processed: Arc<AtomicU32>, voice: Arc<AtomicU8>, running: Arc<AtomicBool>) -> Result<(Stream, String), String> {
    let host = cpal::default_host();
    let device = if let Some(name) = config.device_name.as_deref().filter(|v| !v.is_empty()) {
        host.input_devices().map_err(|e| e.to_string())?.find(|d| d.name().ok().as_deref() == Some(name)).ok_or("The selected microphone is no longer available.")?
    } else { host.default_input_device().ok_or("No microphone input device is available.")? };
    let name = device.name().unwrap_or_else(|_| "Default microphone".into());
    let supported = select_stream_config(&device, config.noise_suppression_enabled)?; let stream_config: StreamConfig = supported.clone().into();
    let detector = Arc::new(Mutex::new(Detector { current: 0, candidate: 0, since: Instant::now(), config,
        denoiser: DenoiseState::new(), pending: Vec::with_capacity(FRAME_SIZE * 2), smoothed_db: -100.0 }));
    let stream = match supported.sample_format() {
        SampleFormat::F32 => build::<f32>(&device, &stream_config, detector, app, raw, processed, voice, running),
        SampleFormat::I16 => build::<i16>(&device, &stream_config, detector, app, raw, processed, voice, running),
        SampleFormat::U16 => build::<u16>(&device, &stream_config, detector, app, raw, processed, voice, running),
        other => return Err(format!("Unsupported microphone format: {other:?}")),
    }?; stream.play().map_err(|e| e.to_string())?; Ok((stream, name))
}

fn select_stream_config(device: &Device, suppression: bool) -> Result<SupportedStreamConfig, String> {
    if !suppression { return device.default_input_config().map_err(|e| format!("Unable to open microphone: {e}")); }
    device.supported_input_configs().map_err(|e| format!("Unable to inspect microphone formats: {e}"))?
        .filter(|range| range.min_sample_rate().0 <= 48_000 && range.max_sample_rate().0 >= 48_000)
        .min_by_key(|range| range.channels()).map(|range| range.with_sample_rate(SampleRate(48_000)))
        .ok_or_else(|| "Noise suppression requires a microphone mode that supports 48 kHz. Disable suppression or select another device.".into())
}

#[allow(clippy::too_many_arguments)]
fn build<T>(device: &Device, config: &StreamConfig, detector: Arc<Mutex<Detector>>, app: AppHandle,
    raw: Arc<AtomicU32>, processed: Arc<AtomicU32>, voice: Arc<AtomicU8>, running: Arc<AtomicBool>) -> Result<Stream, String>
where T: cpal::SizedSample + ToLevel {
    let channels = usize::from(config.channels); let sample_rate = config.sample_rate.0;
    let error_app = app.clone(); let error_raw = raw.clone(); let error_processed = processed.clone(); let error_voice = voice.clone();
    device.build_input_stream(config, move |data: &[T], _| {
        if data.is_empty() || channels == 0 { return; }
        let mono = data.chunks(channels).map(|frame| frame.iter().map(ToLevel::level).sum::<f32>() / frame.len() as f32).collect::<Vec<_>>();
        let raw_db = rms_db(&mono); raw.store(raw_db.to_bits(), Ordering::Relaxed);
        if let Ok(mut detector) = detector.lock() {
            let processed_db = process_level(&mut detector, &mono, sample_rate); processed.store(processed_db.to_bits(), Ordering::Relaxed);
            let target = classify(processed_db, detector.current, &detector.config);
            if target != detector.candidate { detector.candidate = target; detector.since = Instant::now(); }
            let delay = if target > detector.current { detector.config.activation_ms } else { detector.config.release_ms };
            if target != detector.current && detector.since.elapsed() >= Duration::from_millis(delay) {
                detector.current = target; voice.store(target, Ordering::Release); let _ = app.emit("audio-state", state_name(target));
            }
        }
    }, move |error| {
        running.store(false, Ordering::Release); error_voice.store(0, Ordering::Release);
        error_raw.store((-100.0f32).to_bits(), Ordering::Relaxed); error_processed.store((-100.0f32).to_bits(), Ordering::Relaxed);
        let _ = error_app.emit("native-error", format!("Microphone disconnected: {error}. Select Reconnect Microphone after restoring the device."));
    }, None).map_err(|e| e.to_string())
}

fn process_level(detector: &mut Detector, mono: &[f32], sample_rate: u32) -> f32 {
    let mut measured = rms_db(mono);
    if detector.config.noise_suppression_enabled {
        if sample_rate != 48_000 { return -100.0; }
        detector.pending.extend(mono.iter().map(|sample| sample.clamp(-1.0, 1.0) * 32_768.0));
        while detector.pending.len() >= FRAME_SIZE {
            let input = detector.pending.drain(..FRAME_SIZE).collect::<Vec<_>>(); let mut output = [0.0f32; FRAME_SIZE];
            detector.denoiser.process_frame(&mut output, &input); let wet = suppression_mix(&detector.config.suppression_strength);
            let mixed = input.iter().zip(output.iter()).map(|(dry, clean)| ((dry * (1.0 - wet)) + (clean * wet)) / 32_768.0).collect::<Vec<_>>();
            measured = rms_db(&mixed);
        }
    }
    measured = (measured + 20.0 * detector.config.sensitivity.log10()).clamp(-100.0, 0.0);
    let smoothing = detector.config.smoothing;
    detector.smoothed_db = if detector.smoothed_db <= -99.0 { measured } else { detector.smoothed_db * smoothing + measured * (1.0 - smoothing) };
    detector.smoothed_db
}
fn suppression_mix(strength: &str) -> f32 { match strength { "low" => 0.35, "high" => 0.82, "very_high" => 1.0, _ => 0.60 } }
fn rms_db(samples: &[f32]) -> f32 { if samples.is_empty() { return -100.0; } let sum = samples.iter().map(|s| s * s).sum::<f32>(); (sum / samples.len() as f32).sqrt().max(0.00001).log10() * 20.0 }
fn classify(db: f32, current: u8, c: &VoiceConfig) -> u8 { if db < c.noise_gate_db { return 0; } let h = 3.0; if current == 2 && db >= c.yelling_threshold_db - h { return 2; } if db >= c.yelling_threshold_db { return 2; } if current >= 1 && db >= c.talking_threshold_db - h { return 1; } if db >= c.talking_threshold_db { return 1; } 0 }
fn state_name(state: u8) -> &'static str { match state { 2 => "yelling", 1 => "talking", _ => "idle" } }
trait ToLevel { fn level(&self) -> f32; }
impl ToLevel for f32 { fn level(&self) -> f32 { *self } }
impl ToLevel for i16 { fn level(&self) -> f32 { *self as f32 / i16::MAX as f32 } }
impl ToLevel for u16 { fn level(&self) -> f32 { (*self as f32 / u16::MAX as f32) * 2.0 - 1.0 } }

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> VoiceConfig { VoiceConfig { device_name: None, noise_gate_db: -55.0, talking_threshold_db: -38.0,
        yelling_threshold_db: -18.0, noise_suppression_enabled: true, suppression_strength: "medium".into(),
        smoothing: 0.72, sensitivity: 1.0, activation_ms: 80, release_ms: 220 } }
    #[test] fn thresholds() { let c = config(); assert_eq!(classify(-60.0, 0, &c), 0); assert_eq!(classify(-50.0, 0, &c), 0); assert_eq!(classify(-30.0, 0, &c), 1); assert_eq!(classify(-10.0, 1, &c), 2); }
    #[test] fn controls() { let mut c = config(); assert!(validate_config(&mut c).is_ok()); c.smoothing = 1.2; assert!(validate_config(&mut c).is_err()); }
    #[test] fn strengths() { assert!(suppression_mix("low") < suppression_mix("medium")); assert!(suppression_mix("medium") < suppression_mix("high")); assert!(suppression_mix("high") < suppression_mix("very_high")); }
}
