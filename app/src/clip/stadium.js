// Ported from Duck Jam, design/sound/stadium.mjs at 2d35443b, trimmed to what
// soundtrack.js uses: `renderStadium`, the standalone offline-buffer helper,
// has no caller here — soundtrack.js does its own offline render — and is
// dropped.
// Synthesizer extracted from stadium-crowd-source.html: sawtooth/breath formants,
// independent voices, overlapping applause and filtered stereo echoes.
import { stadiumDirection } from './direction.js';

function seededRandom(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
// Original vocal source and formant filters, with independent phrase clocks.
// Intentions drive expression; there is no musical clock or pitch grid.
const DENSITY=80;
const DEFAULTS={volume:50,echo:45,echoDelay:220};
const RANGES={volume:[0,100],echo:[0,100],echoDelay:[90,500]};
const formantPresets={HA:[800,1200,2500],HO:[570,840,2400],HE:[530,1840,2480],OU:[300,870,2240]};
const phonemes={YE:[430,2100,2800],AA:[800,1200,2500],BOO:[300,870,2240]};
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
function validate(changes,ranges=RANGES){
  if(!changes||typeof changes!=='object'||Array.isArray(changes))throw Error('Expected a settings object');
  const result={};for(const [key,value] of Object.entries(changes)){
    if(!Object.hasOwn(ranges,key)||!Number.isFinite(value))throw Error('Invalid parameter: '+key);
    result[key]=clamp(value,...ranges[key]);
  }return result;
}
function expression({action:a,joy:j,encouragement:e}){
  // Reserve the extra projection for strong joy; ordinary ambience stays gentle.
  const celebration=smooth((j-.45)/.55);
  return {celebration,pitch:100+20*a+42*j+12*e,
    level:(.05+.035*a+.07*j+.075*e)*(1+1.5*celebration),
    durationMin:.45-.15*a+.1*e,durationSpan:.5-.18*a+.15*e,
    gap:(.16-.08*a-.045*e)*(1-.6*celebration),callChance:Math.min(.85+.13*celebration,.06*a+.5*j+.65*e+.35*celebration),
    vowels:{HA:.2+.4*j+.25*e+.3*celebration,HO:.7-.3*j+.12*a,HE:.06+.32*a+.15*e,OU:.25*(1-j)}};
}
function applauseAt(state){
  const activity=clamp((.9*state.joy**2+.85*state.encouragement**2)*(1-state.sadness)**2);
  return {activity,force:.45+.55*Math.sqrt(activity)};
}
// Render the approved sawtooth / breath / six-filter timbre once, not 80 times
// per audio block. Short, non-looping textures keep every spoken envelope free.
let audioBank=null,bankPromise=null;
export async function prepareStadium(Ctor){
  if(audioBank)return audioBank;
  if(bankPromise)return bankPromise;
  if(!Ctor)throw Error('Preparing voices requires OfflineAudioContext');
  bankPromise=(async()=>{
    const bank={voices:[],claps:[]},rate=24000,frames=rate*2.4,warmup=1920;
    let seed=31987;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const weights=expression({action:.5,joy:.5,encouragement:.4}).vowels,names=Object.keys(formantPresets),total=names.reduce((s,k)=>s+weights[k],0);
    const base=[0,1,2].map(i=>names.reduce((s,k)=>s+formantPresets[k][i]*weights[k],0)/total),specs=[];
    for(const q of [9,6.8])for(const name of names)for(const pitch of [72,96,128,171,228,304])specs.push({kind:'neutral',q,pitch,formants:base.map((f,i)=>.6*f+.4*formantPresets[name][i])});
    for(const kind of Object.keys(phonemes))for(const q of [9,6.8])for(const pitch of [72,96,128,171,228,304])specs.push({kind,q,pitch,formants:phonemes[kind]});
    for(let first=0;first<specs.length;first+=8){
      const batch=specs.slice(first,first+8),c=new Ctor(batch.length,frames+warmup,rate),merger=c.createChannelMerger(batch.length);
      merger.connect(c.destination);
      const noise=c.createBuffer(1,rate*3,rate),samples=new Float32Array(noise.length);for(let i=0;i<samples.length;i++)samples[i]=random()*2-1;noise.copyToChannel(samples,0);
      for(let channel=0;channel<batch.length;channel++){
        const spec=batch[channel],buzz=c.createOscillator(),jitter=c.createOscillator(),jitterGain=c.createGain(),breath=c.createBufferSource(),breathGain=c.createGain(),mix=c.createGain(),out=c.createGain();
        buzz.type='sawtooth';buzz.frequency.value=spec.pitch;jitter.frequency.value=6+random()*4;jitterGain.gain.value=8+random()*4;
        jitter.connect(jitterGain);jitterGain.connect(buzz.frequency);buzz.connect(mix);
        breath.buffer=noise;breath.loop=true;breathGain.gain.value=.08;breath.connect(breathGain);breathGain.connect(mix);out.gain.value=.28;
        for(const frequency of spec.formants){const a=c.createBiquadFilter(),b=c.createBiquadFilter();a.type=b.type='bandpass';a.frequency.value=b.frequency.value=frequency;a.Q.value=b.Q.value=spec.q;mix.connect(a);a.connect(b);b.connect(out);}
        out.connect(merger,0,channel);buzz.start();jitter.start();breath.start(0,random()*.4);
      }
      const rendered=await c.startRendering();
      for(let channel=0;channel<batch.length;channel++){const buffer=c.createBuffer(1,frames,rate),data=new Float32Array(frames);rendered.copyFromChannel(data,channel,warmup);buffer.copyToChannel(data,0);bank.voices.push({...batch[channel],buffer});}
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    // Each grain is a section of spectators: hundreds of soft, overlapping
    // broadband palm impacts. Precompute the density, not hundreds of live nodes.
    const c=new Ctor(1,rate,rate);
    for(let variant=0;variant<8;variant++){
      const data=new Float32Array(rate);
      for(let hit=0;hit<900;hit++){
        const start=Math.floor(random()*rate),length=Math.floor(rate*(.07+random()*.07)),force=.65+random()*.35;
        let low=0,low2=0,body=0,soft=0;
        for(let i=0;i<length;i++){
          const noise=random()*2-1;low+=.16*(noise-low);
          const high=noise-low;low2+=.16*(high-low2);
          body+=.38*(high-low2-body);soft+=.38*(body-soft);
          // Rounded contact and a complete fade: no exposed sharp grains.
          const attack=smooth(i/(rate*.012)),tail=1-smooth((i/length-.55)/.45);
          const envelope=attack*Math.exp(-i/(length*.4))*tail;
          data[(start+i)%rate]+=soft*envelope*force;
        }
      }
      let sum=0,peak=0;for(const sample of data){sum+=sample*sample;peak=Math.max(peak,Math.abs(sample));}
      const gain=Math.min(.11/Math.sqrt(sum/data.length),.55/peak);
      for(let i=0;i<data.length;i++)data[i]*=gain;
      const buffer=c.createBuffer(1,rate,rate);buffer.copyToChannel(data,0);bank.claps.push(buffer);
    }
    audioBank=bank;return bank;
  })().catch(error=>{bankPromise=null;throw error;});
  return bankPromise;
}
/** Call prepareStadium once, then scheduleUntil(currentTime + .45) every ~40 ms.
 * Direction takes replay seconds; offset maps a new engine to a seek position.
 * Keep this instance across mood changes so phrases and room tails finish.
 * Stop/dispose the previous engine on pause or seek. Destination may be a mixer.
 * Both offline and realtime scheduling use the same chronological random stream.
 */
export class StadiumAmbience {
  constructor(context,{direction=stadiumDirection(),seed=31987,startTime=context.currentTime,offset=0,destination=context.destination,...params}={}){
    if (!Number.isInteger(seed) || !Number.isFinite(startTime) || startTime < 0 || !Number.isFinite(offset)) throw new RangeError('Invalid engine timing or seed');
    const random=seededRandom(seed);
    this.direction=direction;this.startTime=startTime;this.offset=offset;
    this.ctx=context;this.params={...DEFAULTS,...validate(params)};this.random=random;this.groups=new Set();this.retiring=false;
    if(!audioBank)throw Error('Call prepareStadium before constructing the engine');this.bank=audioBank;
    params=this.params;this.talkers=null;this.nextClap=startTime+.025;
    this.applauseLevel=0;this.applauseTime=startTime;
    const c=context;
    const impulse=c.createBuffer(2,c.sampleRate*3,c.sampleRate);
    for(let ch=0;ch<2;ch++){const d=new Float32Array(impulse.length);for(let i=0;i<d.length;i++)d[i]=(random()*2-1)*Math.pow(1-i/d.length,2.2);impulse.copyToChannel(d,ch);}
    this.convolver=c.createConvolver();this.convolver.buffer=impulse;
    this.voices=c.createGain();this.voices.gain.value=.35;
    this.foreground=c.createGain();this.foreground.gain.value=.35;
    this.claps=c.createGain();this.claps.gain.value=0;
    this.mix=c.createGain();this.wet=c.createGain();this.wet.gain.value=.65;
    this.master=c.createGain();this.master.gain.value=2*params.volume/100;
    this.foreground.connect(this.master);
    this.protection=c.createDynamicsCompressor();this.protection.threshold.value=-9;this.protection.knee.value=6;this.protection.ratio.value=12;this.protection.attack.value=.002;this.protection.release.value=.18;
    this.headroom=c.createGain();this.headroom.gain.value=.5;
    this.transport=c.createGain();this.transport.gain.value=1;
    this.voices.connect(this.mix);this.claps.connect(this.mix);
    this.mix.connect(this.master);this.mix.connect(this.convolver);this.convolver.connect(this.wet);this.wet.connect(this.master);
    this.master.connect(this.protection);this.protection.connect(this.headroom);this.headroom.connect(this.transport);this.transport.connect(destination);
    this.fixedNodes=[this.voices,this.foreground,this.claps,this.mix,this.convolver,this.wet,this.master,this.protection,this.headroom,this.transport];
    // Finite, filtered stereo reflections. No feedback loop or gain accumulation.
    this.echoSend=c.createGain();this.echoSend.gain.value=params.echo/100*.9;this.mix.connect(this.echoSend);
    this.echoTaps=[];this.fixedNodes.push(this.echoSend);
    const times=[1,1.7,2.6],levels=[.6,.3,.15],pans=[-.6,.6,-.2],cutoffs=[3200,2200,1500];
    for(let i=0;i<3;i++){
      const delay=c.createDelay(2),filter=c.createBiquadFilter(),gain=c.createGain(),pan=c.createStereoPanner();
      delay.delayTime.value=params.echoDelay/1000*times[i];filter.type='lowpass';filter.frequency.value=cutoffs[i];filter.Q.value=.5;
      gain.gain.value=levels[i];pan.pan.value=pans[i];
      this.echoSend.connect(delay);delay.connect(filter);filter.connect(gain);gain.connect(pan);pan.connect(this.master);
      this.echoTaps.push({delay,ratio:times[i]});this.fixedNodes.push(delay,filter,gain,pan);
    }
  }
  intentionAt(time){return this.direction(time-this.startTime+this.offset);}
  update(changes){
    const p={...this.params,...validate(changes)},t=this.ctx.currentTime;
    this.master.gain.setTargetAtTime(2*p.volume/100,t,.02);
    this.echoSend.gain.setTargetAtTime(p.echo/100*.9,t,.04);
    if(p.echoDelay!==this.params.echoDelay)for(const tap of this.echoTaps)tap.delay.delayTime.setTargetAtTime(p.echoDelay/1000*tap.ratio,t,.12);
    this.params=p;
  }
  track(nodes,sources,end){
    const group={nodes,sources,end};this.groups.add(group);
    sources[0].onended=()=>this.release(group);
  }
  release(group){
    if(!this.groups.delete(group))return;
    for(const node of group.nodes){try{node.disconnect();}catch{}}for(const s of group.sources)s.onended=null;
  }
  reap(time){for(const g of this.groups)if(g.end<time-.1)this.release(g);}
  clap(time){
    if(this.groups.size>=384)return;
    const c=this.ctx,r=this.random,s=c.createBufferSource(),env=c.createGain(),pan=c.createStereoPanner();
    s.buffer=this.bank.claps[Math.floor(r()*this.bank.claps.length)];pan.pan.value=(r()*2-1)*.85;
    s.playbackRate.value=.98+r()*.04;
    const duration=.8;
    // Eight overlapping Hann windows have constant total weight. Randomness
    // changes the crowd texture, never the loudness of individual sections.
    env.gain.setValueAtTime(0,time);
    for(let i=1;i<=8;i++)env.gain.linearRampToValueAtTime(Math.sin(Math.PI*i/8)**2,time+i*.1);
    s.connect(env);env.connect(pan);pan.connect(this.claps);
    this.track([s,env,pan],[s],time+duration);s.start(time);s.stop(time+duration);
  }
  texture(pitch,formants,q,kind='neutral'){
    let best=null,cost=Infinity;
    for(const grain of this.bank.voices){
      if(grain.q!==q||grain.kind!==kind)continue;const ratio=pitch/grain.pitch;if(ratio<.8||ratio>1.25)continue;
      let error=3*Math.log(ratio)**2;for(let i=0;i<3;i++)error+=Math.log(grain.formants[i]*ratio/formants[i])**2;
      if(error<cost){cost=error;best=grain;}
    }
    return best||this.bank.voices.find(g=>g.kind===kind&&g.q===q);
  }
  voice(time,speech){
    const c=this.ctx,r=this.random,{formants,duration,pitch}=speech,q=r()<speech.celebration?6.8:9;
    const cheer=speech.articulation==='cheer',boo=speech.articulation==='boo';
    const best=this.texture(pitch,cheer?phonemes.AA:boo?phonemes.BOO:formants,q,cheer?'AA':boo?'BOO':'neutral');
    const envelope=c.createGain(),pan=c.createStereoPanner(),sources=[],nodes=[envelope,pan];
    const level=speech.level*(1+3*(1-speech.celebration))*(cheer?1.25:1)*(speech.foreground?2.1:.75);
    envelope.gain.setValueAtTime(0,time);
    if(boo){
      // A brief voiced closure/release gives the B onset, followed by a held OU.
      envelope.gain.linearRampToValueAtTime(level*.5,time+.015);envelope.gain.linearRampToValueAtTime(level*.12,time+.045);
      envelope.gain.linearRampToValueAtTime(level,time+.11);envelope.gain.linearRampToValueAtTime(level*.85,time+duration*.7);
    }else{
      envelope.gain.linearRampToValueAtTime(level,time+duration*(speech.call?.12-.08*speech.celebration:.18));
      envelope.gain.linearRampToValueAtTime(level*(speech.call?.8+.15*speech.celebration:.35+r()*.2),time+duration*.43);
      envelope.gain.linearRampToValueAtTime(level*(.75+.15*speech.celebration),time+duration*(.64+.12*speech.celebration));
    }
    envelope.gain.linearRampToValueAtTime(0,time+duration);pan.pan.value=speech.pan;
    envelope.connect(pan);pan.connect(speech.foreground?this.foreground:this.voices);
    const add=(grain,destination,length,closed=false)=>{
      const s=c.createBufferSource(),ratio=pitch/grain.pitch;s.buffer=grain.buffer;
      s.playbackRate.setValueAtTime(ratio*(closed?.84:1),time);
      if(closed)s.playbackRate.linearRampToValueAtTime(ratio,time+.07);
      s.playbackRate.linearRampToValueAtTime(ratio*speech.drift,time+duration*.8);s.connect(destination);
      const available=Math.max(0,grain.buffer.duration-length*ratio*Math.max(1,speech.drift)-.01);
      sources.push(s);nodes.push(s);s.start(time,r()*available);s.stop(time+length);
    };
    if(cheer){
      const prefix=c.createGain(),body=c.createGain(),cross=Math.min(.25,duration*.3);nodes.push(prefix,body);
      prefix.gain.setValueAtTime(1,time);prefix.gain.setValueAtTime(1,time+.035);prefix.gain.linearRampToValueAtTime(0,time+cross);
      body.gain.setValueAtTime(0,time);body.gain.setValueAtTime(0,time+.035);body.gain.linearRampToValueAtTime(1,time+cross);
      prefix.connect(envelope);body.connect(envelope);
      add(best,body,duration); // Full-length AA owns cleanup; the YE ends earlier.
      add(this.texture(pitch,phonemes.YE,q,'YE'),prefix,cross+.01);
    }else add(best,envelope,duration,boo);
    this.track(nodes,sources,time+duration);
  }
  murmur(time,talker){
    const r=this.random,state=this.intentionAt(time),x=expression(state);
    const sad=state.sadness>0&&r()<state.sadness**2/Math.max(.001,state.sadness+state.joy),call=sad||r()<x.callChance;
    const duration=sad?Math.min(1.8,.9+.6*state.sadness+r()*.25):Math.min(1.2+.3*x.celebration,(x.durationMin+r()*x.durationSpan)*(call?1.15+.3*x.celebration:1));
    if(this.groups.size<384){
      const names=Object.keys(formantPresets),total=names.reduce((sum,k)=>sum+x.vowels[k],0);
      let pick=r()*total,chosen='HO';for(const name of names){pick-=x.vowels[name];if(pick<0){chosen=name;break;}}
      const base=[0,1,2].map(i=>names.reduce((sum,k)=>sum+formantPresets[k][i]*x.vowels[k],0)/total);
      const scale=talker.formantScale*(.96+r()*.08),formants=base.map((f,i)=>(f*.6+formantPresets[chosen][i]*.4)*scale);
      this.voice(time,{duration,formants,call,foreground:talker.foreground,articulation:sad?'boo':call&&x.celebration>.35?'cheer':'neutral',celebration:sad?0:x.celebration,
        pitch:(sad?118+12*state.action+8*state.encouragement:x.pitch)*talker.pitch*(.94+r()*.12),
        drift:sad?.96+r()*.03:.92+r()*.16+state.joy*.08,
        level:(sad?.045+.03*state.sadness+.015*state.action:x.level)*(.8+r()*.4)*(call?1.3:1)*(1+.65*(state.impact??0)),pan:talker.pan});
    }
    return duration+.025+r()*x.gap;
  }
  scheduleUntil(end){
    if(!Number.isFinite(end))throw new RangeError('Invalid scheduling horizon');
    if(this.retiring)return;
    const now=this.ctx.currentTime;this.reap(now);
    const r=this.random;
    if(!this.talkers)this.talkers=Array.from({length:DENSITY},(_,i)=>({foreground:i<8,next:this.startTime+.035+r()*.7,pitch:.75+r()*.95,formantScale:.9+r()*.2,pan:(r()*2-1)*.75}));
    // Event order, rather than caller batch size, owns random-number consumption.
    // A late realtime pump skips missed events without queuing voices in the past.
    for(const talker of this.talkers)if(talker.next<now)talker.next=now+.02+r()*.08;
    if(this.nextClap<now)this.nextClap=now+.025;
    while(true){
      const talker=this.talkers.reduce((a,b)=>a.next<=b.next?a:b);
      const time=Math.min(talker.next,this.nextClap);
      if(time>=end)break;
      if(talker.next<=this.nextClap){talker.next+=this.murmur(time,talker);continue;}
      const {activity,force}=applauseAt(this.intentionAt(time)),target=.24*Math.sqrt(activity)*force;
      const dt=Math.max(0,time-this.applauseTime),tau=target>this.applauseLevel?1.8:3;
      const previousLevel=this.applauseLevel;
      this.applauseLevel+=(target-this.applauseLevel)*(1-Math.exp(-dt/tau));
      this.applauseTime=time;
      // Ramp forward from this observation. A ramp ending here would rewrite
      // audio before the observation, depending on the scheduler's batch size.
      this.claps.gain.setValueAtTime(previousLevel,time);
      this.claps.gain.linearRampToValueAtTime(this.applauseLevel,time+.1);
      if(this.applauseLevel>.0001)this.clap(time);
      this.nextClap+=.1;
    }
  }
  stop(at=this.ctx.currentTime){
    if(this.retiring)return;this.retiring=true;
    this.transport.gain.cancelScheduledValues(at);this.transport.gain.setValueAtTime(1,at);this.transport.gain.linearRampToValueAtTime(0,at+.09);
    // This includes sources that were scheduled ahead and have not started yet.
    for(const group of this.groups)for(const source of group.sources){try{source.stop(at+.09);}catch{}}
  }
  dispose(){this.stop();for(const group of [...this.groups])this.release(group);for(const node of this.fixedNodes){try{node.disconnect();}catch{}}this.fixedNodes.length=0;}
}
