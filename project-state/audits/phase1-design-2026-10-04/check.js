// Throwaway design-check validator (NOT S1 code). Encodes the proposed v1 rules.
const fs=require('fs');const crypto=require('crypto');
const ID={wv:/^wv_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/};
for(const p of ['th','sc','ed']) ID[p]=new RegExp(ID.wv.source.replace('wv_',p+'_'));
const ASSET=/^sha256:[0-9a-f]{64}$/;
function validate(d,{checkBytes=true}={}){
 const E=[];const err=m=>E.push(m);
 const fin=(v,lo,hi)=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
 const keys=(o,allowed,where)=>{for(const k of Object.keys(o||{})) if(!allowed.includes(k)) err(`${where}: unknown field ${k}`)};
 if(!d||d.type!=='aether_weave') return ['type'];
 if(d.schemaVersion!==1) return ['schemaVersion'];
 keys(d,['type','schemaVersion','id','name','createdAt','modifiedAt','writer','tempo','master','assets','threads','scenes','order','edges','ending'],'doc');
 if(!ID.wv.test(d.id)) err('doc.id');
 if(!d.tempo||!fin(d.tempo.bpm,20,400)||!Number.isInteger(d.tempo.beatsPerBar)||!fin(d.tempo.beatsPerBar,1,16)) err('tempo');
 if(!d.master||!fin(d.master.volume,0,1)||!fin(d.master.loudnessDb,-18,12)) err('master');
 if(d.ending!==null) err('ending must be null in v1');
 const used=new Set();
 for(const [k,a] of Object.entries(d.assets||{})){
  if(!ASSET.test(k)) {err('asset id '+k);continue;}
  if(!['audio','node-bundle'].includes(a.kind)) err('asset kind '+k);
  if(!a.storage||a.storage.kind!=='inline-base64'||typeof a.storage.data!=='string') {err('asset storage '+k);continue;}
  if(checkBytes){const b=Buffer.from(a.storage.data,'base64');
   if(b.toString('base64')!==a.storage.data) err('asset base64 '+k);
   if(b.length!==a.bytes) err('asset bytes '+k);
   if('sha256:'+crypto.createHash('sha256').update(b).digest('hex')!==k) err('asset hash '+k);}
 }
 const th=new Map();
 for(const t of d.threads||[]){ if(!ID.th.test(t.id)||th.has(t.id)) err('thread id'); if(!/^track-[1-4]$/.test(t.color)) err('thread color'); th.set(t.id,t);}
 const sc=d.scenes||{};
 const ordered=new Set();
 for(const id of d.order||[]){ if(!sc[id]) err('order→missing scene '+id); if(ordered.has(id)) err('order duplicate'); ordered.add(id);}
 for(const id of Object.keys(sc)) if(!ordered.has(id)) err('scene not in order '+id);
 const ref=(id)=>{ if(!d.assets[id]) err('missing asset '+id); else used.add(id); return d.assets[id]; };
 for(const [id,s] of Object.entries(sc)){
  if(!ID.sc.test(id)||s.id!==id) err('scene id '+id);
  if(typeof s.name!=='string'||!s.name.length||s.name.length>80) err('scene name');
  const du=s.duration||{};
  if(du.mode!=='beats') err(`scene ${id}: duration mode ${du.mode} unsupported in v1`);
  else if(!fin(du.beats,0.25,1e6)) err('duration beats');
  const slots=new Set();
  for(const [tid,ts] of Object.entries(s.threadStates||{})){
   if(!th.has(tid)) err('unknown thread '+tid);
   if(ts.slot!==undefined){ if(!Number.isInteger(ts.slot)||ts.slot<0||ts.slot>3) err('slot range'); if(slots.has(ts.slot)) err('duplicate slot'); slots.add(ts.slot);}
   const src=ts.source||{}; const members=['sample','playlist','node','external'].filter(m=>src[m]!==undefined);
   const want={empty:[],sample:['sample'],playlist:['playlist'],node:['node'],'live-input':['external'],stream:['external']}[src.kind];
   if(!want||want.join()!==members.join()) err('source kind exclusivity '+src.kind);
   if(src.kind==='playlist'){const p=src.playlist; if(!Array.isArray(p.items)||!p.items.length) err('playlist items'); p.items.forEach(a=>{const x=ref(a); if(x&&x.kind!=='audio') err('playlist item kind');}); if(!Number.isInteger(p.index)||p.index<0||p.index>=p.items.length) err('playlist index'); if(typeof p.shuffle!=='boolean'||typeof p.repeat!=='boolean') err('playlist flags');}
   if(src.kind==='sample'){const x=ref(src.sample.assetId); if(x&&x.kind!=='audio') err('sample kind');}
   if(src.kind==='node'){const n=src.node; const x=ref(n.bundleAssetId); if(x&&(x.kind!=='node-bundle'||x.manifestId!==n.manifestId||x.version!==n.version)) err('node bundle mismatch'); if(n.tapeAssetId) ref(n.tapeAssetId); for(const v of Object.values(n.params||{})) if(!(typeof v==='boolean'||(typeof v==='number'&&Number.isFinite(v)))) err('param value');}
   if(src.override){const x=ref(src.override.assetId); if(x&&x.kind!=='audio') err('override kind');}
   const c=ts.channel||{}; if(!fin(c.gainDb,-24,6)||!c.eq||!['low','mid','high'].every(k=>fin(c.eq[k],-15,15))||typeof c.mute!=='boolean'||typeof c.solo!=='boolean') err('channel');
   const sp=ts.spatial||{}; if(!fin(sp.x,0,1)||!fin(sp.y,0,1)||(sp.z!==undefined&&!fin(sp.z,0,50))) err('spatial');
   if(ts.motion!==null){const m=ts.motion||{}; if(m.timeBase!=='seconds-free'||!fin(m.speed,0.0001,2)||typeof m.playing!=='boolean'||!Array.isArray(m.points)||m.points.length<2) err('motion');
     else m.points.forEach((p,i)=>{ if(!['t','x','y'].every(k=>Number.isFinite(p[k]))||(p.z!==undefined&&!Number.isFinite(p.z))||(i&&p.t<m.points[i-1].t)) err('motion point '+i);});}
  }
 }
 const ord=d.order||[]; const pairs=new Set(); const eids=new Set();
 for(const e of d.edges||[]){ if(!ID.ed.test(e.id)||eids.has(e.id)) err('edge id'); eids.add(e.id);
  const i=ord.indexOf(e.from); if(i<0||ord[i+1]!==e.to) err('edge not adjacent '+e.id); pairs.add(e.from+'>'+e.to);
  if(!fin(e.overlapBeats,0,1e6)||!['lin','ease','late'].includes(e.curve)||!['jump','morph','fade'].includes(e.mode)) err('edge values');}
 for(let i=0;i+1<ord.length;i++) if(!pairs.has(ord[i]+'>'+ord[i+1])) err('missing edge '+i);
 for(const k of Object.keys(d.assets||{})) if(!used.has(k)) err('unreferenced asset '+k);
 return E;
}
const doc=JSON.parse(fs.readFileSync('weave-v1-two-scenes.json','utf8'));
console.log('fixture errors:',validate(doc));
const clone=()=>JSON.parse(JSON.stringify(doc));
const S=Object.keys(doc.scenes), T=doc.threads.map(t=>t.id), A=Object.keys(doc.assets);
const muts={
 badHash:d=>{d.assets[A[0]].storage.data=Buffer.from('x').toString('base64')},
 missingAsset:d=>{delete d.assets[A[2]]},
 orderMissing:d=>{d.order.push('sc_00000000-0000-4000-8000-000000000000')},
 dupSlot:d=>{d.scenes[S[1]].threadStates[T[3]].slot=0},
 kindMix:d=>{d.scenes[S[0]].threadStates[T[1]].source.playlist={items:[],index:0}},
 nonAdjacentEdge:d=>{d.edges[0].to=d.edges[0].from},
 zeroDuration:d=>{d.scenes[S[0]].duration.beats=0},
 sourceMode:d=>{d.scenes[S[0]].duration={mode:'source'}},
 badX:d=>{d.scenes[S[0]].threadStates[T[0]].spatial.x=NaN},
 tooNew:d=>{d.schemaVersion=2},
 badId:d=>{d.id='wv_123'},
 unknownThread:d=>{d.scenes[S[0]].threadStates['th_00000000-0000-4000-8000-000000000000']=d.scenes[S[0]].threadStates[T[0]]},
 playlistIdx:d=>{d.scenes[S[0]].threadStates[T[0]].source.playlist.index=2},
};
for(const [n,f] of Object.entries(muts)){const d=clone();f(d);const e=validate(d);console.log(n.padEnd(16),e.length?'rejected: '+e[0]:'ACCEPTED (bad)');}
