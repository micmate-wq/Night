/* Lightweight native Web Audio master chain. No automatic normalization.
   Final guard bounds sample peaks, not reconstructed true peaks or acoustic SPL. */
(function(root){
 const ceiling = Math.pow(10, -1 / 20);
 function safetyCurve(){
  const curve=new Float32Array(65537),knee=.70;
  for(let i=0;i<curve.length;i++){
   const x=i/(curve.length-1)*2-1,a=Math.abs(x);
   const y=a<=knee?a:knee+(ceiling-knee)*(1-Math.exp(-(a-knee)/(ceiling-knee)));
   curve[i]=Math.sign(x)*y;
  }
  return curve;
 }
 function create(ctx){
  const compressor=ctx.createDynamicsCompressor();
  compressor.threshold.value=-18;compressor.knee.value=18;compressor.ratio.value=2;
  compressor.attack.value=.025;compressor.release.value=.25;
  const makeup=ctx.createGain();makeup.gain.value=Math.pow(10,2/20);
  const peakControl=ctx.createDynamicsCompressor();
  peakControl.threshold.value=-3;peakControl.knee.value=0;peakControl.ratio.value=20;
  peakControl.attack.value=.001;peakControl.release.value=.12;
  const output=ctx.createWaveShaper();output.curve=safetyCurve();output.oversample='none';
  compressor.connect(makeup);makeup.connect(peakControl);peakControl.connect(output);
  return {input:compressor,output,compressor,makeup,peakControl};
 }
 root.AetherMasterOutput={create,safetyCurve,ceiling};
})(globalThis);
