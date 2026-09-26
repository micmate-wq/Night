/* Approximate gated stereo RMS matching, not LUFS. Fixed trim preserves fades.
   Target is measured before the existing master protection; boost is bounded. */
(function(root){
 function measure(powers){
  if(powers.length<50) return null;
  const mean=powers.reduce((a,b)=>a+b,0)/powers.length;
  const active=powers.filter(p=>p>=mean/10);
  if(!active.length) return null;
  const rmsDb=10*Math.log10(active.reduce((a,b)=>a+b,0)/active.length);
  return Math.max(-18,Math.min(12,-18-rmsDb));
 }
 root.AetherLoudness={measure};
})(globalThis);
