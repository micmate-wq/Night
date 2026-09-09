const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync(__dirname+'/../index.html','utf8');
const source=fs.readFileSync(__dirname+'/../motion-loop.js','utf8');
assert(app.includes('AetherMotionLoop.updateMotionPlayback.call(this)'), 'Main app must use shared playback');
let now=1000;const context={performance:{now:()=>now}};vm.createContext(context);vm.runInContext(source,context);
const {makeLoop,updateMotionPlayback}=context.AetherMotionLoop;
let checks=0;
for(const end of [{x:.98,y:.02},{x:.50001,y:.50001},{x:.5,y:.5}])for(const d of [.0001,.01,1,20])for(const r of [0,.0001,.01,1,5])for(const speed of [.0001,.25,1,2]){
 const input=[{t:0,x:.5,y:.5,z:0},{t:d/2,x:.3,y:.7,z:0},{t:d,...end,z:0}],before=JSON.stringify(input),path=makeLoop(input,r);
 assert.equal(JSON.stringify(input),before);assert.equal(JSON.stringify(path.slice(0,3)),before);
 assert.equal(path.at(-1).t,d+r);assert.equal(JSON.stringify(makeLoop(input,r,false)),before);
 for(const p of path){assert(p.x>=.02&&p.x<=.98&&p.y>=.02&&p.y<=.98)}
 if(r){assert.equal(path.at(-1).x,input[0].x);assert.equal(path.at(-1).y,input[0].y)}
 const state={motionPath:path,isPlayingMotion:true,motionSpeed:speed,motionAccumulatedTime:0,lastMotionFrameTime:now,updateAudioParamsFromPosition(){}};
 for(const phase of [0,d/4,d/2,d,d+r/2,d+r-1e-10,d+r]){state.motionAccumulatedTime=Math.max(0,phase);updateMotionPlayback.call(state);assert(Number.isFinite(state.x)&&Number.isFinite(state.y));assert(state.x>=.02&&state.x<=.98);if(phase===d/4){assert(Math.abs(state.x-.4)<1e-9)}}
 state.motionAccumulatedTime=0;state.lastMotionFrameTime=now;now+=10;updateMotionPlayback.call(state);assert(Math.abs(state.motionAccumulatedTime-.01*speed)<1e-9);
 state.isPlayingMotion=false;const held=state.x;now+=50;updateMotionPlayback.call(state);assert.equal(state.x,held);checks++;
}
assert.equal(makeLoop([],1).length,0);assert.equal(makeLoop([{t:0,x:.5,y:.5}],1).length,1);
const html=fs.readFileSync(__dirname+'/../motion-playground.html','utf8');for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
console.log(`PASS: ${checks} duration/endpoint/return/speed combinations; source parity, timing preservation, bounds, joins, pause, empty/single points, script syntax.`);
const estimate=context.AetherMotionLoop.estimateReturnTime;
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const fast=[{t:0,x:0,y:0},{t:3,x:.1,y:0},{t:4,x:.9,y:0}];
const slow=[{t:0,x:0,y:0},{t:3,x:.8,y:0},{t:4,x:.9,y:0}];
near(estimate(fast),1.125);near(estimate(slow),9);
near(estimate(fast.map(p=>({...p,t:p.t*4}))),4.5);
near(estimate([{t:0,x:0,y:0},{t:4,x:.8,y:0}]),4); // interpolated quarter boundary
near(estimate([{t:0,x:0,y:0},{t:3,x:.8,y:0},{t:4,x:.8,y:0}]),4); // held ending
assert.equal(estimate([{t:0,x:.5,y:.5},{t:10,x:.5,y:.5}]),0);
assert.equal(estimate([{t:0,x:.5,y:.5},{t:10,x:.50000001,y:.5}]),0);
assert.equal(estimate([]),0);assert.equal(estimate([{t:0,x:0,y:0}]),0);
assert.equal(estimate([{t:0,x:0,y:0},{t:0,x:1,y:0}]),0);
near(estimate([{t:0,x:0,y:0},{t:.001,x:1,y:0}]),.04);
near(estimate([{t:0,x:0,y:0},{t:100,x:1,y:0}]),30);
near(estimate([{t:0,x:0,y:0,z:0},{t:4,x:0,y:0,z:50}]),4);
const reversing=[{t:0,x:0,y:0},{t:3,x:.5,y:0},{t:3.5,x:.9,y:0},{t:4,x:.5,y:0}];
near(estimate(reversing),.625); // travel, not net displacement
const sampled=[{t:0,x:0,y:0},{t:1,x:.2,y:0},{t:2,x:.4,y:0},{t:3,x:.6,y:0},{t:4,x:.8,y:0}];
near(estimate(sampled),estimate([{t:0,x:0,y:0},{t:4,x:.8,y:0}]));
const adaptive=makeLoop(fast);near(adaptive.at(-1).t,5.125);
assert.equal(JSON.stringify(adaptive.slice(0,fast.length)),JSON.stringify(fast));
for(const match of app.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
console.log('PASS: adaptive fast/slow tails, time scaling, partial segments, pause fallback, closed paths, limits, depth, reversals, sampling invariance and main-app syntax.');
