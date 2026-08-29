use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream, StreamConfig};
use serde::{Deserialize, Serialize};
use std::sync::{atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering}, mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceConfig { pub device_name:Option<String>, pub noise_gate_db:f32, pub talking_threshold_db:f32, pub yelling_threshold_db:f32, #[serde(default="attack")] pub activation_ms:u64, #[serde(default="release")] pub release_ms:u64 }
fn attack()->u64{80} fn release()->u64{220}
#[derive(Serialize)] #[serde(rename_all="camelCase")]
pub struct AudioStatus { pub running:bool, pub level_db:f32, pub voice_state:&'static str, pub device_name:String }
struct Detector { current:u8, candidate:u8, since:Instant, config:VoiceConfig }

pub struct AudioEngine { stop:Mutex<Option<mpsc::Sender<()>>>, running:Arc<AtomicBool>, level:Arc<AtomicU32>, voice:Arc<AtomicU8>, device_name:Arc<Mutex<String>> }
impl Default for AudioEngine { fn default()->Self{Self{stop:Mutex::new(None),running:Arc::new(AtomicBool::new(false)),level:Arc::new(AtomicU32::new((-100.0f32).to_bits())),voice:Arc::new(AtomicU8::new(0)),device_name:Arc::new(Mutex::new(String::new()))}} }

impl AudioEngine {
 pub fn devices(&self)->Result<Vec<String>,String>{let host=cpal::default_host();let mut values=host.input_devices().map_err(|e|e.to_string())?.filter_map(|d|d.name().ok()).collect::<Vec<_>>();values.sort();values.dedup();Ok(values)}
 pub fn start(&self,config:VoiceConfig,app:AppHandle)->Result<(),String>{
  if !(config.noise_gate_db<config.talking_threshold_db&&config.talking_threshold_db<config.yelling_threshold_db){return Err("Noise Gate must be below Talking, and Talking must be below Yelling.".into())}
  self.stop();let(stop_tx,stop_rx)=mpsc::channel();let(init_tx,init_rx)=mpsc::sync_channel(1);let level=self.level.clone();let voice=self.voice.clone();let running=self.running.clone();let device_name=self.device_name.clone();
  std::thread::Builder::new().name("livesprite-audio".into()).spawn(move||{
   let result=initialize_stream(config,app,level.clone(),voice.clone());
   match result { Ok((stream,name))=>{if let Ok(mut stored)=device_name.lock(){*stored=name}running.store(true,Ordering::Release);let _=init_tx.send(Ok(()));let _=stop_rx.recv();drop(stream)},Err(error)=>{let _=init_tx.send(Err(error));return} }
   running.store(false,Ordering::Release);voice.store(0,Ordering::Release);level.store((-100.0f32).to_bits(),Ordering::Relaxed);
  }).map_err(|e|e.to_string())?;
  match init_rx.recv_timeout(Duration::from_secs(5)).map_err(|_|"Microphone initialization timed out.".to_string())? { Ok(())=>{*self.stop.lock().map_err(|_|"Audio engine unavailable")?=Some(stop_tx);Ok(())},Err(error)=>Err(error) }
 }
 pub fn stop(&self){if let Ok(mut stop)=self.stop.lock(){if let Some(sender)=stop.take(){let _=sender.send(());}}self.running.store(false,Ordering::Release);self.voice.store(0,Ordering::Release);self.level.store((-100.0f32).to_bits(),Ordering::Relaxed)}
 pub fn status(&self)->AudioStatus{AudioStatus{running:self.running.load(Ordering::Acquire),level_db:f32::from_bits(self.level.load(Ordering::Relaxed)),voice_state:state_name(self.voice.load(Ordering::Acquire)),device_name:self.device_name.lock().map(|v|v.clone()).unwrap_or_default()}}
}

fn initialize_stream(config:VoiceConfig,app:AppHandle,level:Arc<AtomicU32>,voice:Arc<AtomicU8>)->Result<(Stream,String),String>{
 let host=cpal::default_host();let device=if let Some(name)=config.device_name.as_deref().filter(|v|!v.is_empty()){host.input_devices().map_err(|e|e.to_string())?.find(|d|d.name().ok().as_deref()==Some(name)).ok_or("The selected microphone is no longer available.")?}else{host.default_input_device().ok_or("No microphone input device is available.")?};
 let name=device.name().unwrap_or_else(|_|"Default microphone".into());let supported=device.default_input_config().map_err(|e|format!("Unable to open microphone: {e}"))?;let stream_config:StreamConfig=supported.clone().into();let detector=Arc::new(Mutex::new(Detector{current:0,candidate:0,since:Instant::now(),config}));
 let stream=match supported.sample_format(){SampleFormat::F32=>build::<f32>(&device,&stream_config,detector,app,level,voice),SampleFormat::I16=>build::<i16>(&device,&stream_config,detector,app,level,voice),SampleFormat::U16=>build::<u16>(&device,&stream_config,detector,app,level,voice),other=>return Err(format!("Unsupported microphone format: {other:?}"))}?;stream.play().map_err(|e|e.to_string())?;Ok((stream,name))
}
fn build<T>(device:&Device,config:&StreamConfig,detector:Arc<Mutex<Detector>>,app:AppHandle,level:Arc<AtomicU32>,voice:Arc<AtomicU8>)->Result<Stream,String> where T:cpal::SizedSample+ToLevel {
 device.build_input_stream(config,move|data:&[T],_|{if data.is_empty(){return}let sum=data.iter().map(|s|{let v=s.level();v*v}).sum::<f32>();let db=(sum/data.len() as f32).sqrt().max(.00001).log10()*20.0;level.store(db.to_bits(),Ordering::Relaxed);if let Ok(mut d)=detector.lock(){let target=classify(db,d.current,&d.config);if target!=d.candidate{d.candidate=target;d.since=Instant::now()}let delay=if target>d.current{d.config.activation_ms}else{d.config.release_ms};if target!=d.current&&d.since.elapsed()>=Duration::from_millis(delay){d.current=target;voice.store(target,Ordering::Release);let _=app.emit("audio-state",state_name(target));}}},move|_|{},None).map_err(|e|e.to_string())
}
fn classify(db:f32,current:u8,c:&VoiceConfig)->u8{let h=3.0;if current==2&&db>=c.yelling_threshold_db-h{return 2}if db>=c.yelling_threshold_db{return 2}if current>=1&&db>=c.talking_threshold_db-h{return 1}if db>=c.talking_threshold_db{return 1}0}
fn state_name(state:u8)->&'static str{match state{2=>"yelling",1=>"talking",_=>"idle"}}
trait ToLevel{fn level(&self)->f32;}impl ToLevel for f32{fn level(&self)->f32{*self}}impl ToLevel for i16{fn level(&self)->f32{*self as f32/i16::MAX as f32}}impl ToLevel for u16{fn level(&self)->f32{(*self as f32/u16::MAX as f32)*2.0-1.0}}
#[cfg(test)]mod tests{use super::*;#[test]fn thresholds(){let c=VoiceConfig{device_name:None,noise_gate_db:-55.0,talking_threshold_db:-38.0,yelling_threshold_db:-18.0,activation_ms:80,release_ms:220};assert_eq!(classify(-60.0,0,&c),0);assert_eq!(classify(-30.0,0,&c),1);assert_eq!(classify(-10.0,1,&c),2)}}
