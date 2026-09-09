/* Experimental renderers shared by the playground and optional node manifests. */
(function(root){
const types=['contour','bloom','corona','constellation','cinders','ribbons','filaments','shards'];
function draw(ctx,{x,y,radius,color,time,settings={}}){
 const type=settings.family||'contour';
 const bounded=(k,d,lo,hi)=>Number.isFinite(Number(settings[k]))?Math.max(lo,Math.min(hi,Number(settings[k]))):d;
 const energy=bounded('energy',.55,0,1),spread=bounded('spread',1,0.3,1.8),detail=bounded('detail',.5,0,1),speed=bounded('speed',.6,0,2);
 const t=time*.001*speed,R=radius;
 ctx.save();ctx.translate(x,y);// A radial tint/fade stays behind the opaque host orb; no canvas erasing.
 const hue=bounded('hue',0,-90,90),fade=bounded('fade',0,0,1);
 const rgb=(color.match(/[a-f0-9]{2}/gi)||['fc','40','37']).slice(0,3).map(v=>parseInt(v,16)/255);
 const hi=Math.max(...rgb),lo=Math.min(...rgb),delta=hi-lo,l=(hi+lo)/2;
 let h=0;if(delta){h=(hi===rgb[0]?(rgb[1]-rgb[2])/delta+(rgb[1]<rgb[2]?6:0):hi===rgb[1]?(rgb[2]-rgb[0])/delta+2:(rgb[0]-rgb[1])/delta+4)*60;}
 const sat=delta?delta/(1-Math.abs(2*l-1)):0;
 const ink=ctx.createRadialGradient(0,0,R*.72,0,0,R*(1.25+spread*1.25));
 for(let i=0;i<=8;i++){const f=i/8;ink.addColorStop(f,`hsla(${h+hue*f},${sat*100}%,${l*100}%,${Math.max(0,1-fade*Math.pow(f,.8))})`);}
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
 }
 ctx.restore();
}
root.AetherNodeArt={types,draw};
})(globalThis);
