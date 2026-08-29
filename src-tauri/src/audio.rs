use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream, StreamConfig};
use serde::{Deserialize, Serialize};
use std::sync::{atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering}, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceConfig { pub device_name: Option<String>, pub noise_gate_db:f32, pub talking_threshold_db:f32, pub yelling_threshold_db:f32, #[serde(default="attack")] pub activation_ms:u64, #[serde(default="release")] pub release_ms:u64 }
fn attack()->u64{80} fn release()->u64{220}
#[derive(Serialize)] #[serde(rename_all="camelCase")]
pub struct AudioStatus { pub running:bool, pub level_db:f32, pub voice_state:&'static str, pub device_name:String }
struct Detector { current:u8, candidate:u8, since:Instant, config:VoiceConfig }

pub struct AudioEngine { stream:Mutex<Option<Stream>>, running:AtomicBool, level:Arc<AtomicU32>, voice:Arc<AtomicU8>, device_name:Mutex<String> }
impl Default for AudioEngine { fn default()->Self{Self{stream:Mutex::new(None),running:AtomicBool::new(false),level:Arc::new(AtomicU32::new((-100.0f32).to_bits())),voice:Arc::new(AtomicU8::new(0)),device_name:Mutex::new(String::new())}} }

impl AudioEngine {
 pub fn devices(&self)->Result<Vec<String>,String>{let host=cpal::default_host();let mut values=host.input_devices().map_err(|e|e.to_string())?.filter_map(|d|d.name().ok()).collect::<Vec<_>>();values.sort();values.dedup();Ok(values)}
 pub fn start(&self,config:VoiceConfig,app:AppHandle)->Result<(),String>{
  if !(config.noise_gate_db<config.talking_threshold_db&&config.talking_threshold_db<config.yelling_threshold_db){return Err("Noise Gate must be below Talking, and Talking must be below Yelling.".into())}
  self.stop();let host=cpal::default_host();let device=if let Some(name)=config.device_name.as_deref().filter(|v|!v.is_empty()){host.input_devices().map_err(|e|e.to_string())?.find(|d|d.name().ok().as_deref()==Some(name)).ok_or("The selected microphone is no longer available.")?}else{host.default_input_device().ok_or("No microphone input device is available.")?};
  let name=device.name().unwrap_or_else(|_|"Default microphone".into());let supported=device.default_input_config().map_err(|e|format!("Unable to open microphone: {e}"))?;let stream_config:StreamConfig=supported.clone().into();let detector=Arc::new(Mutex::new(Detector{current:0,candidate:0,since:Instant::now(),config}));
  let stream=match supported.sample_format(){SampleFormat::F32=>self.build::<f32>(&device,&stream_config,detector,app),SampleFormat::I16=>self.build::<i16>(&device,&stream_config,detector,app),SampleFormat::U16=>self.build::<u16>(&device,&stream_config,detector,app),other=>return Err(format!("Unsupported microphone format: {other:?}"))}?;
  stream.play().map_err(|e|e.to_string())?;*self.stream.lock().map_err(|_|"Audio engine unavailable")?=Some(stream);*self.device_name.lock().map_err(|_|"Audio device unavailable")?=name;self.running.store(true,Ordering::Release);Ok(())
 }
 fn build<T>(&self,device:&Device,config:&StreamConfig,detector:Arc<Mutex<Detector>>,app:AppHandle)->Result<Stream,String> where T:cpal::SizedSample+ToLevel {
  let level=self.level.clone();let voice=self.voice.clone();device.build_input_stream(config,move|data:&[T],_|{if data.is_empty(){return}let sum=data.iter().map(|s|{let v=s.level();v*v}).sum::<f32>();let db=(sum/data.len() as f32).sqrt().max(.00001).log10()*20.0;level.store(db.to_bits(),Ordering::Relaxed);if let Ok(mut d)=detector.lock(){let target=classify(db,d.current,&d.config);if target!=d.candidate{d.candidate=target;d.since=Instant::now()}let delay=if target>d.current{d.config.activation_ms}else{d.config.release_ms};if target!=d.current&&d.since.elapsed()>=Duration::from_millis(delay){d.current=target;voice.store(target,Ordering::Release);let _=app.emit("audio-state",match target{2=>"yelling",1=>"talking",_=>"idle"});}}},move|_|{},None).map_err(|e|e.to_string())
 }
 pub fn stop(&self){if let Ok(mut stream)=self.stream.lock(){*stream=None}self.running.store(false,Ordering::Release);self.voice.store(0,Ordering::Release);self.level.store((-100.0f32).to_bits(),Ordering::Relaxed)}
 pub fn status(&self)->AudioStatus{AudioStatus{running:self.running.load(Ordering::Acquire),level_db:f32::from_bits(self.level.load(Ordering::Relaxed)),voice_state:match self.voice.load(Ordering::Acquire){2=>"yelling",1=>"talking",_=>"idle"},device_name:self.device_name.lock().map(|v|v.clone()).unwrap_or_default()}}
}
fn classify(db:f32,current:u8,c:&VoiceConfig)->u8{let h=3.0;if current==2&&db>=c.yelling_threshold_db-h{return 2}if db>=c.yelling_threshold_db{return 2}if current>=1&&db>=c.talking_threshold_db-h{return 1}if db>=c.talking_threshold_db{return 1}0}
trait ToLevel{fn level(&self)->f32;}impl ToLevel for f32{fn level(&self)->f32{*self}}impl ToLevel for i16{fn level(&self)->f32{*self as f32/i16::MAX as f32}}impl ToLevel for u16{fn level(&self)->f32{(*self as f32/u16::MAX as f32)*2.0-1.0}}
#[cfg(test)]mod tests{use super::*;#[test]fn thresholds(){let c=VoiceConfig{device_name:None,noise_gate_db:-55.0,talking_threshold_db:-38.0,yelling_threshold_db:-18.0,activation_ms:80,release_ms:220};assert_eq!(classify(-60.0,0,&c),0);assert_eq!(classify(-30.0,0,&c),1);assert_eq!(classify(-10.0,1,&c),2)}}
