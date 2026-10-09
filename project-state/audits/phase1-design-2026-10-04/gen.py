import struct, math, io, zipfile, hashlib, base64, json
def wav(freq, frames=16, sr=8000):
    data=b''.join(struct.pack('<h', int(12000*math.sin(2*math.pi*freq*i/sr))) for i in range(frames))
    hdr=b'RIFF'+struct.pack('<I',36+len(data))+b'WAVEfmt '+struct.pack('<IHHIIHH',16,1,1,sr,sr*2,2,16)+b'data'+struct.pack('<I',len(data))
    return hdr+data
def bundle():
    manifest={"id":"com.aether.test.fixture-pulse","name":"Fixture Pulse","version":"0.0.1","role":"instrument","inputs":0,"outputs":2,"entry":{"dsp":"dsp.js"},"inspector":"host","parameters":[{"id":"level","type":"float","min":0,"max":1,"default":0.5},{"id":"steps","type":"int","min":1,"max":8,"default":4}]}
    dsp="class FixturePulse{constructor(){this.params={level:0.5,steps:4}}setParameter(id,v){this.params[id]=v}start(){}stop(){}}\n"
    b=io.BytesIO()
    with zipfile.ZipFile(b,'w',zipfile.ZIP_STORED) as z:
        for name,content in (("manifest.json",json.dumps(manifest,separators=(',',':'))),("dsp.js",dsp)):
            zi=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0)); zi.external_attr=0o644<<16
            z.writestr(zi,content)
    return b.getvalue()
def asset(kind,name,mime,data,origin,extra=None):
    h='sha256:'+hashlib.sha256(data).hexdigest()
    a={"kind":kind,"name":name,"mime":mime,"bytes":len(data),"origin":origin}
    if extra: a.update(extra)
    a["storage"]={"kind":"inline-base64","data":base64.b64encode(data).decode()}
    return h,a
A=wav(440); B=wav(660); N=bundle()
ha,aa=asset("audio","fixture-a440.wav","audio/wav",A,"original-file")
hb,ab=asset("audio","fixture-a660.wav","audio/wav",B,"original-file")
hn,an=asset("node-bundle","Fixture Pulse","application/zip",N,"aethernode-zip",{"manifestId":"com.aether.test.fixture-pulse","version":"0.0.1"})
W="wv_0b6f2c1e-7d4a-4e8b-9c31-5a2f8e6d4b10"
T=["th_3c9e1a52-8f04-4b7d-a6e2-91d05c7f3b28","th_7a14d6e0-2b9c-4f53-8e71-c4a8b3f2d690","th_c5e82f17-4a63-4d09-b1f8-6e2a97d3c541","th_e91b4d38-6c27-4a85-9f0e-3d7c52a1b864"]
S1="sc_4f2a8c61-9e3b-4d70-a5c8-1b6e09f7d322"; S2="sc_8d17e3b5-0c42-4a96-b8f1-7e5c2a3d9064"
E="ed_2e6b9f40-5d18-4c7a-9a3e-8f1c64b07d25"
ch=lambda g=0,l=0,m=0,h=0:{"gainDb":g,"eq":{"low":l,"mid":m,"high":h},"mute":False,"solo":False}
pl=lambda idx:{"kind":"playlist","playlist":{"items":[ha,hb],"index":idx,"shuffle":False,"repeat":True}}
node=lambda lvl,st:{"kind":"node","node":{"bundleAssetId":hn,"manifestId":"com.aether.test.fixture-pulse","version":"0.0.1","params":{"level":lvl,"steps":st}}}
doc={"type":"aether_weave","schemaVersion":1,"id":W,"name":"Fixture two-Scene Weave",
 "createdAt":"2026-10-05T19:00:00.000Z","modifiedAt":"2026-10-05T19:10:00.000Z",
 "writer":{"app":"Aether Weave v0.1 Lab","version":"weave-model/1"},
 "tempo":{"bpm":120,"beatsPerBar":4,"source":"host-fixed"},
 "master":{"volume":0.8,"loudnessDb":0},
 "assets":{ha:aa,hb:ab,hn:an},
 "threads":[{"id":T[0],"label":"T1","color":"track-1"},{"id":T[1],"label":"T2","color":"track-2"},{"id":T[2],"label":"T3","color":"track-3"},{"id":T[3],"label":"T4","color":"track-4"}],
 "scenes":{
  S1:{"id":S1,"name":"Open water","duration":{"mode":"beats","beats":64},"createdAt":"2026-10-05T19:02:00.000Z","modifiedAt":"2026-10-05T19:02:00.000Z",
      "provenance":{"kind":"capture","capturedAt":"2026-10-05T19:02:00.000Z"},"completeness":{"status":"complete","reasons":[]},
      "threadStates":{
        T[0]:{"slot":0,"source":pl(0),"channel":ch(),"spatial":{"x":0.21,"y":0.87,"z":0},
              "motion":{"points":[{"t":0,"x":0.21,"y":0.87,"z":0},{"t":0.5,"x":0.4,"y":0.7,"z":0},{"t":1.0,"x":0.21,"y":0.87,"z":0,"generatedReturn":True}],"timeBase":"seconds-free","speed":1,"playing":True,"captureBpm":120},
              "unsupported":[]},
        T[1]:{"slot":1,"source":node(0.5,4),"channel":ch(-3,0,2,-1),"spatial":{"x":0.25,"y":0.5,"z":0},"motion":None,"unsupported":["node-private-state"]}}},
  S2:{"id":S2,"name":"Afterglow","duration":{"mode":"beats","beats":32},"createdAt":"2026-10-05T19:08:00.000Z","modifiedAt":"2026-10-05T19:10:00.000Z",
      "provenance":{"kind":"capture","capturedAt":"2026-10-05T19:08:00.000Z"},"completeness":{"status":"complete","reasons":[]},
      "threadStates":{
        T[0]:{"slot":0,"source":pl(1),"channel":ch(-2,1,0,-2),"spatial":{"x":0.5,"y":0.3,"z":4},"motion":None,"unsupported":[]},
        T[3]:{"slot":3,"source":node(0.8,6),"channel":ch(),"spatial":{"x":0.75,"y":0.4},"motion":None,"unsupported":["node-private-state"]}}}},
 "order":[S1,S2],
 "edges":[{"id":E,"from":S1,"to":S2,"overlapBeats":32,"curve":"ease","mode":"morph"}],
 "ending":None}
open('weave-v1-two-scenes.json','w').write(json.dumps(doc,indent=2)+"\n")
print(len(json.dumps(doc)), ha, hb, hn, len(N))
