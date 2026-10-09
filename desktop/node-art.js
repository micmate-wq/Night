/* Experimental renderers shared by the playground and optional node manifests. */
(function(root){
const types=['contour','bloom','corona','constellation','cinders','ribbons','filaments','shards','sticky','pulse_wave','luminous_orb'];
function draw(ctx,{x,y,radius,color,time,settings={}}){
 const type=settings.family||'contour';
 const bounded=(k,d,lo,hi)=>Number.isFinite(Number(settings[k]))?Math.max(lo,Math.min(hi,Number(settings[k]))):d;
 const energy=bounded('energy',.55,0,1),spread=bounded('spread',1,0.3,1.8),detail=bounded('detail',.5,0,1),speed=bounded('speed',.6,0,3.5);
 const t=time*.001*speed,R=radius;
 ctx.save();ctx.translate(x,y);// A radial tint/fade stays behind the opaque host orb; no canvas erasing.
 const hue=bounded('hue',0,-180,180),fade=bounded('fade',0,0,1);
 const safeColor=(typeof color==='string'&&color)?color:'#fc4037';
 const hexParts=safeColor.length===4
  ?[safeColor[1]+safeColor[1],safeColor[2]+safeColor[2],safeColor[3]+safeColor[3]]
  :(safeColor.match(/[a-f0-9]{2}/gi)||['fc','40','37']);
 const rgb=(hexParts.length>=3?hexParts:['fc','40','37']).slice(0,3).map(v=>parseInt(v,16)/255);
 const hi=Math.max(...rgb),lo=Math.min(...rgb),delta=hi-lo,l=(hi+lo)/2;
 let h=0;if(delta){h=(hi===rgb[0]?(rgb[1]-rgb[2])/delta+(rgb[1]<rgb[2]?6:0):hi===rgb[1]?(rgb[2]-rgb[0])/delta+2:(rgb[0]-rgb[1])/delta+4)*60;}
 const sat=delta?delta/(1-Math.abs(2*l-1)):0;
 const ink=ctx.createRadialGradient(0,0,R*.72,0,0,R*(1.25+spread*1.25));
 for(let i=0;i<=8;i++){
  const f=i/8;
  const finalHue=((h+hue*f)%360+360)%360;
  ink.addColorStop(f,`hsla(${finalHue.toFixed(1)},${(sat*100).toFixed(1)}%,${(l*100).toFixed(1)}%,${Math.max(0,1-fade*Math.pow(f,.8)).toFixed(3)})`);
 }
 ctx.strokeStyle=ink;ctx.fillStyle=ink;ctx.lineCap='round';ctx.lineJoin='round';
 if(type==='contour'){
  for(let j=0;j<4;j++){
   ctx.beginPath();for(let k=0;k<=240;k++){const a=k/240*Math.PI*2;
    const wave=Math.sin(a*(2+Math.round(detail*2))+t*.8+j*.12)*.45+Math.sin(a*(3+Math.round(detail*4))-t*.55+j*.16)*.23+Math.sin(a*2+t*.3)*.32;
    const rr=R*(1.07+spread*(.16+j*.16)+wave*(.1+energy*.35)*spread);
    const xx=Math.cos(a)*rr+Math.sin(t*.6)*R*.09*j/3,yy=Math.sin(a)*rr;
    k?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);
   }ctx.closePath();ctx.lineWidth=R*[.105,.045,.018,.009][j];ctx.globalAlpha=1-j*.14;ctx.stroke();
  }
 }else if(type==='bloom'){
  const n=5+Math.round(detail*7);
  for(let layer=0;layer<2;layer++){
   ctx.save();ctx.rotate(t*(layer?-.13:.09));
   for(let j=0;j<n;j++){
    const a=j/n*Math.PI*2,breath=.5+.5*Math.sin(t*1.5+j*.8+layer);
    ctx.save();ctx.rotate(a);const tip=R*(1.4+spread*(.35+breath*energy*.6)),w=R*(.16+detail*.15);
    ctx.beginPath();ctx.moveTo(R*.8,0);ctx.bezierCurveTo(R*1.1,-w*2,tip,-w,tip,0);ctx.bezierCurveTo(tip,w,R*1.1,w*2,R*.8,0);
    ctx.globalAlpha=layer?.55:.95;ctx.lineWidth=R*.024;
    if(layer)ctx.stroke();else {ctx.moveTo(R*1.54,0);ctx.ellipse(R*1.37,0,R*.17,R*.055,0,0,Math.PI*2);ctx.fill('evenodd');}
    ctx.restore();
   }ctx.restore();
  }
 }else if(type==='corona'){
  const n=45+Math.round(detail*65);
  for(let j=0;j<n;j++){
   const a=j/n*Math.PI*2,travel=.5+.5*Math.sin(a*4-t*1.8),rough=Math.sin(j*73.13)*.5+.5;
   const start=R*(1.16+.06*Math.sin(a*3+t)),end=start+R*spread*(.15+rough*.14+travel*energy*.52);
   ctx.globalAlpha=.5+rough*.5;ctx.lineWidth=R*(.013+rough*.018);
   ctx.beginPath();ctx.moveTo(Math.cos(a)*start,Math.sin(a)*start);ctx.lineTo(Math.cos(a+.025*Math.sin(t+j))*end,Math.sin(a+.025*Math.sin(t+j))*end);ctx.stroke();
  }
  for(let j=0;j<18;j++){const a=j*2.399+t*.12,rr=R*(1.25+spread*.65)+Math.sin(t+j)*R*.04;ctx.beginPath();ctx.arc(Math.cos(a)*rr,Math.sin(a)*rr,R*(.009+.012*(.5+.5*Math.sin(t*2+j))),0,Math.PI*2);ctx.fill();}
 }else if(type==='constellation'){
  const grid=R*.11,n=16;
  for(let iy=-n;iy<=n;iy++)for(let ix=-n;ix<=n;ix++){
   const d=Math.hypot(ix,iy),a=Math.atan2(iy,ix);if(d<7.5||d>10+spread*6)continue;
   const h=(Math.sin(ix*127.1+iy*311.7)*43758.5453)%1;
   const gate=Math.sin(a*5+t+d*.45)+Math.cos(ix*.65-t*.7)*.5;
   if(Math.abs(h)>(.18+detail*.62)||gate<-.15)continue;
   const brightness=.5+.5*Math.sin(t*(1+energy*3)+d*.8+a*3);
   ctx.globalAlpha=.2+brightness*.8;const size=grid*(.25+brightness*.5);
   ctx.fillRect(ix*grid-size/2,iy*grid-size/2,size,size);
   if(brightness>.97&&Math.abs(h)<.15){ctx.globalAlpha=.8;ctx.fillRect(ix*grid-grid,iy*grid-1,grid*2,2);ctx.fillRect(ix*grid-1,iy*grid-grid,2,grid*2);}
  }
 }
 if(type==='cinders'){
  const n=55+Math.round(detail*100);
  for(let j=0;j<n;j++){
   const seed=(Math.sin(j*91.7)*437.1)%1,phase=((t*(.12+energy*.12)+j*.618)%1+1)%1;
   const a=j*2.399+Math.sin(t*.24)*.6+phase*(.3+energy),rr=R*(.68+phase*spread*1.65);
   const xx=Math.cos(a)*rr+phase*phase*R*.45,yy=Math.sin(a)*rr;
   ctx.globalAlpha=Math.sin(phase*Math.PI)*(.3+Math.abs(seed)*.7);
   const size=R*(.009+Math.abs(seed)*.025)*(1-phase*.6);
   ctx.beginPath();ctx.ellipse(xx,yy,size*(1+energy*2),size,a+phase,0,Math.PI*2);ctx.fill();
   if(j%7===0){ctx.lineWidth=R*.009;ctx.beginPath();ctx.moveTo(xx,yy);ctx.lineTo(xx-Math.cos(a)*R*.12*phase,yy-Math.sin(a)*R*.12*phase);ctx.stroke();}
  }
 }else if(type==='ribbons'){
  const n=3+Math.round(detail*5);
  for(let j=0;j<n;j++){
   ctx.beginPath();for(let k=0;k<=220;k++){
    const a=k/220*Math.PI*2,rot=t*.15+j*.43;
    const u=Math.cos(a)*R*(1.2+spread*.6),v=Math.sin(a)*R*(.4+energy*.45)+Math.sin(a*3+t+j)*R*.12;
    const xx=u*Math.cos(rot)-v*Math.sin(rot),yy=u*Math.sin(rot)+v*Math.cos(rot);
    k?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);
   }ctx.closePath();ctx.lineWidth=R*(j%3===0?.035:.012);ctx.globalAlpha=.3+j/n*.65;ctx.stroke();
  }
 }else if(type==='filaments'){
  const n=24+Math.round(detail*42);
  for(let j=0;j<n;j++){
   const a=j*2.399,reach=R*(1.1+spread*(.25+.4*(1+Math.sin(j*17.2))));
   const sway=Math.sin(t*.9+j*.8)*(.12+energy*.5);
   ctx.beginPath();ctx.moveTo(Math.cos(a)*R*.72,Math.sin(a)*R*.72);
   const end=a+sway;ctx.bezierCurveTo(Math.cos(a-.3)*R*1.3,Math.sin(a-.3)*R*1.3,Math.cos(end+.2)*reach,Math.sin(end+.2)*reach,Math.cos(end)*reach,Math.sin(end)*reach);
   ctx.lineWidth=R*(.008+(j%4)*.003);ctx.globalAlpha=.3+(j%7)/10;ctx.stroke();
   ctx.beginPath();ctx.arc(Math.cos(end)*reach,Math.sin(end)*reach,R*(.012+.009*(.5+.5*Math.sin(t*2+j))),0,Math.PI*2);ctx.fill();
  }
 }else if(type==='shards'){
  const n=18+Math.round(detail*28);
  for(let j=0;j<n;j++){
   const band=j%4,a=j*2.399+t*(band%2?-.16:.12),pulse=.5+.5*Math.sin(t*(.7+energy)+j);
   const rr=R*(.8+band*.22*spread+pulse*.22*energy),length=.08+.23*((j%5)/4);
   ctx.beginPath();ctx.arc(0,0,rr,a,a+length);ctx.lineWidth=R*(.015+(j%3)*.025);ctx.globalAlpha=.35+pulse*.65;ctx.stroke();
   if(j%3===0){const d=rr+R*.22*spread;ctx.save();ctx.translate(Math.cos(a)*d,Math.sin(a)*d);ctx.rotate(a+t*.1);ctx.fillRect(-R*.025,-R*.025,R*.05,R*.05);ctx.restore();}
  }
 }else if(type==='sticky'){
  // Outer chrome only — host orb fills canary + draws telemetry face.
  const ink=settings.ink||'#0A0A0A';
  ctx.save();ctx.globalAlpha=.55;ctx.strokeStyle=ink;ctx.fillStyle=ink;ctx.lineWidth=Math.max(1,R*.02);
  for(let i=0;i<4;i++){const a=i*Math.PI/2+t*.05;ctx.beginPath();ctx.moveTo(Math.cos(a)*R*1.05,Math.sin(a)*R*1.05);ctx.lineTo(Math.cos(a)*R*(1.22+spread*.12),Math.sin(a)*R*(1.22+spread*.12));ctx.stroke();
   ctx.beginPath();ctx.arc(Math.cos(a)*R*(1.28+spread*.1),Math.sin(a)*R*(1.28+spread*.1),R*.03,0,Math.PI*2);ctx.fill();}
  ctx.restore();
 }else if(type==='pulse_wave'||type==='pulse-wave'){
    const slowT=t*0.25;
    const cycleFreq=0.45+energy*0.55;
    const expansion=Math.sin(slowT*cycleFreq)*(0.15+0.55*energy)*(R/3.6);
    const baseR=R+8+expansion;
    const halfThick=Math.max(2.4,(0.05+detail*0.20)*(R/3.6)*1.8);
    const segs=200;
    const inner=[],outer=[];
    for(let i=0;i<=segs;i++){
      const theta=(i/segs)*Math.PI*2;
      const looseWave=Math.sin(theta*2.0-slowT*0.8)*(0.08+0.18*detail)*(R/3.6);
      const chewSag=Math.sin(theta*3.0+slowT*0.6)*Math.cos(theta*1.0-slowT*0.3)*(0.18*(0.35+energy*1.5))*(R/3.6);
      const tapeFold=Math.cos(theta*4.0-slowT*0.5)*detail*0.3*(R/3.6);
      const rIn=baseR-halfThick+looseWave+chewSag+tapeFold;
      const rOut=baseR+halfThick+looseWave+chewSag+tapeFold;
      inner.push([Math.cos(theta)*rIn,Math.sin(theta)*rIn]);
      outer.push([Math.cos(theta)*rOut,Math.sin(theta)*rOut]);
    }
    ctx.beginPath();
    for(let i=0;i<=segs;i++)i?ctx.lineTo(outer[i][0],outer[i][1]):ctx.moveTo(outer[i][0],outer[i][1]);
    for(let i=segs;i>=0;i--)ctx.lineTo(inner[i][0],inner[i][1]);
    ctx.closePath();ctx.globalAlpha=0.24+energy*0.22;ctx.fill();
    ctx.beginPath();
    for(let i=0;i<=segs;i++)i?ctx.lineTo(outer[i][0],outer[i][1]):ctx.moveTo(outer[i][0],outer[i][1]);
    ctx.lineWidth=1.6;ctx.globalAlpha=0.70;ctx.stroke();
    ctx.beginPath();
    for(let i=0;i<=segs;i++)i?ctx.lineTo(inner[i][0],inner[i][1]):ctx.moveTo(inner[i][0],inner[i][1]);
    ctx.lineWidth=1.0;ctx.globalAlpha=0.42;ctx.stroke();

    // Magnetic tape center dashed track
    ctx.beginPath();
    ctx.setLineDash([6,5]);
    for(let i=0;i<=segs;i++){
      const mx=(inner[i][0]+outer[i][0])*0.5,my=(inner[i][1]+outer[i][1])*0.5;
      i?ctx.lineTo(mx,my):ctx.moveTo(mx,my);
    }
    ctx.lineWidth=1.0;ctx.globalAlpha=0.35;ctx.stroke();
    ctx.setLineDash([]);

    // 3 rotating tape reel spokes with guide rollers (slow, gentle)
    const reelAngle=slowT*0.35;
    for(let s=0;s<3;s++){
      const spokeA=reelAngle+(s*Math.PI*2/3);
      const cosA=Math.cos(spokeA),sinA=Math.sin(spokeA);
      const inR=R*0.85,outR=baseR+halfThick*0.9;
      ctx.beginPath();ctx.moveTo(cosA*inR,sinA*inR);ctx.lineTo(cosA*outR,sinA*outR);
      ctx.lineWidth=1.2;ctx.globalAlpha=0.32;ctx.stroke();
      ctx.beginPath();ctx.arc(cosA*(inR+outR)*0.55,sinA*(inR+outR)*0.55,2.0,0,Math.PI*2);
      ctx.globalAlpha=0.55;ctx.fill();
    }
 }else if(type==='luminous_orb'||type==='luminous-orb'||type==='orb'){
    const slowT=t*0.75;
    const segs=140;
    const pts=[];

    // Harmonic undulating fluid perimeter
    for(let k=0;k<=segs;k++){
      const a=(k/segs)*Math.PI*2;
      const w1=Math.sin(a*2.0-slowT*0.85)*0.08*(0.6+energy*0.7);
      const w2=Math.cos(a*3.0+slowT*0.65)*0.05*(0.5+detail*0.8);
      const w3=Math.sin(a*1.0+slowT*0.35)*0.04;
      const rBlob=R*(0.96+spread*0.36+(w1+w2+w3)*spread);
      pts.push([Math.cos(a)*rBlob,Math.sin(a)*rBlob]);
    }

    // Harmonized palette kept close to desired node track color
    const baseH=((h+hue)%360+360)%360;
    const sPct=Math.max(50,Math.min(95,sat*100));
    const lPct=Math.max(40,Math.min(68,l*100));
    const h0=((baseH-10)%360+360)%360;
    const h1=((baseH+10)%360+360)%360;

    // 1. Morphing atmospheric outer shadow/aura matching fluid perimeter and base hue
    // Edge fade smoothly blurs and dissolves the boundaries between layers
    ctx.save();
    const auraColor=`hsla(${baseH.toFixed(1)},${sPct}%,${lPct.toFixed(1)}%,${(0.26+energy*0.18).toFixed(3)})`;
    ctx.shadowColor=auraColor;
    ctx.shadowBlur=R*(0.25+spread*0.35+fade*1.40);
    const numAuraLayers=Math.round(4+fade*4);
    for(let layer=numAuraLayers;layer>=1;layer--){
      const tLayer=layer/numAuraLayers;
      const scale=1.0+tLayer*(0.16+spread*0.22);
      const alpha=((0.18+energy*0.14)/numAuraLayers)*(1.0-tLayer*(0.65-fade*0.35));
      ctx.beginPath();
      for(let k=0;k<=segs;k++){
        const xk=pts[k][0]*scale;
        const yk=pts[k][1]*scale;
        k===0?ctx.moveTo(xk,yk):ctx.lineTo(xk,yk);
      }
      ctx.closePath();
      ctx.fillStyle=`hsla(${baseH.toFixed(1)},${sPct}%,${lPct.toFixed(1)}%,${Math.max(0,alpha).toFixed(3)})`;
      ctx.fill();
    }
    ctx.restore();

    // 2. Translucent undulating fluid body
    ctx.save();
    if(fade>0.02){
      ctx.shadowColor=`hsla(${baseH.toFixed(1)},${sPct}%,${lPct.toFixed(1)}%,${(fade*0.55).toFixed(3)})`;
      ctx.shadowBlur=R*(fade*0.75);
    }
    ctx.beginPath();
    for(let k=0;k<=segs;k++){
      k===0?ctx.moveTo(pts[k][0],pts[k][1]):ctx.lineTo(pts[k][0],pts[k][1]);
    }
    ctx.closePath();

    // Body gradient: subtle analogous depth closely hugging base hue
    const bodyGrad=ctx.createLinearGradient(-R*0.8,R*0.8,R*0.8,-R*0.8);
    bodyGrad.addColorStop(0,`hsla(${h0.toFixed(1)},${sPct}%,${(lPct*0.92).toFixed(1)}%,${(0.80+energy*0.18).toFixed(3)})`);
    bodyGrad.addColorStop(0.45,`hsla(${baseH.toFixed(1)},${sPct}%,${lPct.toFixed(1)}%,${(0.84+energy*0.15).toFixed(3)})`);
    bodyGrad.addColorStop(1,`hsla(${h1.toFixed(1)},${Math.min(100,sPct*1.08).toFixed(1)}%,${Math.min(82,lPct*1.12).toFixed(1)}%,${(0.86+energy*0.12).toFixed(3)})`);
    ctx.fillStyle=bodyGrad;
    ctx.fill();

    // Subtle luminous Fresnel edge stroke (softens and blurs into aura as fade increases)
    const rimAlpha=Math.max(0,(0.50+energy*0.35)*(1.0-fade*0.85));
    if(rimAlpha>0.01){
      ctx.strokeStyle=`hsla(${h1.toFixed(1)},90%,80%,${rimAlpha.toFixed(3)})`;
      ctx.lineWidth=Math.max(0.8,R*0.035*(1.0-fade*0.5));
      ctx.stroke();
    }

    // Scanlines inside fluid perimeter
    if(detail>0.15){
      ctx.save();
      ctx.clip();
      ctx.lineWidth=1;
      ctx.strokeStyle='rgba(255,255,255,0.06)';
      const step=Math.max(3,Math.round(5-detail*2));
      for(let sy=-R*1.5;sy<=R*1.5;sy+=step){
        ctx.beginPath();
        ctx.moveTo(-R*1.5,sy);
        ctx.lineTo(R*1.5,sy);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();

    // 3. Three radiant focal emitters (zenith crown, right accent, lower-left accent) closely tuned to base hue
    const eSpread=0.85+spread*0.25;

    // Emitter 1: Zenith Crown Flare (blooms across the top boundary into space)
    const hZenith=((baseH+8)%360+360)%360;
    const x1=Math.sin(slowT*0.75)*R*0.12;
    const y1=-R*(0.82+Math.sin(slowT*1.1)*0.08)*eSpread;
    const r1=R*(0.68+energy*0.48);
    const grad1=ctx.createRadialGradient(x1,y1,0,x1,y1,r1);
    grad1.addColorStop(0,'rgba(255,255,255,1.0)');
    grad1.addColorStop(0.18,`hsla(${hZenith.toFixed(1)},95%,88%,0.95)`);
    grad1.addColorStop(0.48,`hsla(${hZenith.toFixed(1)},90%,70%,0.48)`);
    grad1.addColorStop(1,`hsla(${hZenith.toFixed(1)},90%,55%,0)`);
    ctx.save();
    ctx.fillStyle=grad1;
    ctx.beginPath();
    ctx.arc(x1,y1,r1,0,Math.PI*2);
    ctx.fill();
    ctx.restore();

    // Emitter 2: Mid-Right Accent Flare
    const hRight=((baseH-15)%360+360)%360;
    const x2=R*(0.50+Math.cos(slowT*0.85)*0.08)*eSpread;
    const y2=-R*(0.14+Math.sin(slowT*0.95)*0.08)*eSpread;
    const r2=R*(0.56+energy*0.36);
    const grad2=ctx.createRadialGradient(x2,y2,0,x2,y2,r2);
    grad2.addColorStop(0,'rgba(255,255,255,0.98)');
    grad2.addColorStop(0.2,`hsla(${hRight.toFixed(1)},95%,80%,0.90)`);
    grad2.addColorStop(0.52,`hsla(${hRight.toFixed(1)},90%,55%,0.42)`);
    grad2.addColorStop(1,`hsla(${hRight.toFixed(1)},90%,50%,0)`);
    ctx.save();
    ctx.fillStyle=grad2;
    ctx.beginPath();
    ctx.arc(x2,y2,r2,0,Math.PI*2);
    ctx.fill();
    ctx.restore();

    // Emitter 3: Lower-Left Accent Flare
    const hLeft=((baseH+15)%360+360)%360;
    const x3=-R*(0.48+Math.cos(slowT*0.7+1.2)*0.08)*eSpread;
    const y3=R*(0.28+Math.sin(slowT*0.85+0.4)*0.08)*eSpread;
    const r3=R*(0.54+energy*0.36);
    const grad3=ctx.createRadialGradient(x3,y3,0,x3,y3,r3);
    grad3.addColorStop(0,'rgba(255,255,255,0.96)');
    grad3.addColorStop(0.24,`hsla(${hLeft.toFixed(1)},100%,75%,0.88)`);
    grad3.addColorStop(0.58,`hsla(${hLeft.toFixed(1)},100%,50%,0.40)`);
    grad3.addColorStop(1,`hsla(${hLeft.toFixed(1)},100%,40%,0)`);
    ctx.save();
    ctx.fillStyle=grad3;
    ctx.beginPath();
    ctx.arc(x3,y3,r3,0,Math.PI*2);
    ctx.fill();
    ctx.restore();

    // Bright intense core dots for the 3 focal lights
    const drawPip=(cx,cy,radius,glowCol)=>{
      ctx.save();
      ctx.shadowColor=glowCol;
      ctx.shadowBlur=12;
      ctx.fillStyle='#ffffff';
      ctx.beginPath();
      ctx.arc(cx,cy,radius,0,Math.PI*2);
      ctx.fill();
      ctx.restore();
    };
    drawPip(x1,y1,Math.max(2.5,R*0.075),`hsla(${hZenith.toFixed(1)},95%,85%,1)`);
    drawPip(x2,y2,Math.max(2.0,R*0.055),`hsla(${hRight.toFixed(1)},100%,70%,1)`);
    drawPip(x3,y3,Math.max(2.0,R*0.055),`hsla(${hLeft.toFixed(1)},100%,70%,1)`);
 }
 ctx.restore();
}
root.AetherNodeArt={types,draw};
})(globalThis);
