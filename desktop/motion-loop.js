// Shared by AudioTrack and the motion playground. Legacy playback interpolation is unchanged.
(function(root){
const playback = {
  updateMotionPlayback() {
    if (!this.isPlayingMotion || this.isRecordingMotion || this.motionPath.length <= 1) return;

    const totalPathDuration = this.motionPath[this.motionPath.length - 1].t;
    if (totalPathDuration <= 0) return;

    const now = performance.now();
    if (!this.lastMotionFrameTime) {
      this.lastMotionFrameTime = now;
    }
    const dtReal = Math.min((now - this.lastMotionFrameTime) / 1000, 0.25);
    this.lastMotionFrameTime = now;

    this.motionAccumulatedTime = (this.motionAccumulatedTime || 0) + dtReal * this.motionSpeed;
    const elapsedScaled = this.motionAccumulatedTime % totalPathDuration;

    let p1 = this.motionPath[0];
    let p2 = this.motionPath[this.motionPath.length - 1];

    for (let i = 0; i < this.motionPath.length - 1; i++) {
      if (elapsedScaled >= this.motionPath[i].t && elapsedScaled <= this.motionPath[i + 1].t) {
        p1 = this.motionPath[i];
        p2 = this.motionPath[i + 1];
        break;
      }
    }

    const dt = p2.t - p1.t;
    const factor = dt > 0 ? (elapsedScaled - p1.t) / dt : 0;
    const interpX = p1.x + (p2.x - p1.x) * factor;
    const interpY = p1.y + (p2.y - p1.y) * factor;
    const p1Z = p1.z !== undefined ? p1.z : 0;
    const p2Z = p2.z !== undefined ? p2.z : 0;
    const interpZ = p1Z + (p2Z - p1Z) * factor;

    this.x = Math.max(0, Math.min(1, interpX));
    this.y = Math.max(0, Math.min(1, interpY));
    this.z = Math.max(0, Math.min(50, interpZ));
    this.updateAudioParamsFromPosition();
  }
};
// Estimate speed over the final quarter of recording TIME, including partial
// segments and holds. Sum travelled distance (not endpoint displacement).
// Depth is normalized to its 0..50 range alongside normalized canvas x/y.
function estimateReturnTime(recorded) {
  if (recorded.length < 2) return 0;
  const first=recorded[0], last=recorded[recorded.length-1];
  const distance=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y,((b.z||0)-(a.z||0))/50);
  const gap=distance(first,last), duration=last.t-first.t;
  if (gap <= 1e-6 || duration <= 0) return 0;
  const cutoff=last.t-duration*.25;
  let tailDistance=0, totalDistance=0;
  for(let i=1;i<recorded.length;i++) {
    const a=recorded[i-1], b=recorded[i], dt=b.t-a.t;
    if(dt<=0) continue;
    const length=distance(a,b);
    totalDistance+=length;
    if(b.t>cutoff) tailDistance+=length*Math.min(1,(b.t-cutoff)/dt);
  }
  // A stationary ending has no usable travel speed: use the whole gesture's
  // average instead of dividing by zero or assigning an arbitrary long dwell.
  const speed=tailDistance>1e-6?tailDistance/(duration*.25):totalDistance/duration;
  if(!Number.isFinite(speed) || speed<=0) return 0;
  // Match average return speed; smoothstep still eases at both joins.
  return Math.max(.04,Math.min(30,gap/speed));
}
function makeLoop(recorded, seconds=estimateReturnTime(recorded), smooth=true) {
  const path=recorded.map(p=>({...p}));
  if (!smooth || seconds<=0 || path.length<2) return path;
  const first=path[0], last=path[path.length-1];
  // Bounded smoothstep sampled into Aether's native timestamped path format.
  // 128 return segments, independent of frame rate or return duration.
  for(let i=1;i<=128;i++) {
    const u=i/128, f=u*u*(3-2*u);
    path.push({generatedReturn:true,t:last.t+seconds*u,
      x:i===128?first.x:last.x+(first.x-last.x)*f,
      y:i===128?first.y:last.y+(first.y-last.y)*f,
      z:i===128?(first.z||0):(last.z||0)+((first.z||0)-(last.z||0))*f});
  }
  return path;
}
root.AetherMotionLoop={estimateReturnTime,makeLoop,updateMotionPlayback:playback.updateMotionPlayback};
})(globalThis);
