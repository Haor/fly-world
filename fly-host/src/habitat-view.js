import { mmToTile, tileToMM, odorRateAt } from './habitat.js';

/** Project-specific pixel world; its tile coordinates match the physical Passport. */
export class HabitatView {
  constructor(canvas, habitat) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.habitat = habitat;
    this.trail = []; this.showTrail = true; this.showOdor = false; this.showShadows = true;
  }
  reset() { this.trail = []; }
  update(pose) {
    const c = this.ctx, s = this.habitat.snapshot();
    const last = this.trail.at(-1);
    if (!last || Math.hypot(last.x-pose.x,last.z-pose.z) > .25) {
      this.trail.push({x:pose.x,z:pose.z}); if (this.trail.length > 400) this.trail.shift();
    }
    const rect = (x,y,w,h,color) => {c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),w,h);};
    const diamond = (x,y,r,color) => {
      for (let j=-Math.floor(r/2);j<=Math.floor(r/2);j++) {
        const half=r-Math.abs(j)*2;rect(x-half,y+j,half*2+1,1,color);
      }
    };
    const block = (x,y,r,h,top,left,right) => {
      for (let dx=-r;dx<=r;dx++) rect(x+dx,y+Math.floor((r-Math.abs(dx))/2),1,h,dx<=0?left:right);
      diamond(x,y,r,top);
    };
    const project = (x,z) => {const u=mmToTile(x),v=mmToTile(z);return [120+(u-v)*16,83+(u+v)*8];};
    c.imageSmoothingEnabled=false;
    rect(0,0,360,260,'#111e18');
    for(let y=10;y<260;y+=12)for(let x=12;x<360;x+=12)rect(x,y,1,1,'#26362b');
    c.save();c.translate(60,8);
    if(this.showShadows){c.fillStyle='#0b140e';c.beginPath();c.ellipse(120,184,112,23,0,0,Math.PI*2);c.fill();}
    // A floating cutaway exposes soil layers beneath the living surface.
    for(let sum=0;sum<=10;sum++)for(let u=0;u<6;u++){
      const v=sum-u;if(v<0||v>5)continue;
      const x=120+(u-v)*16,y=83+(u+v)*8;
      const water=(u===3||u===4)&&v<2;
      block(x,y,16,19,water?'#648d87':sum%3?'#829756':'#a4b866','#77664a','#4f4e35');
      if(!water){rect(x+(u*7+v*3)%9-5,y,2,1,'#c1c67b');rect(x+4,y+12,2,2,'#958461');}
      else rect(x-4,y,7,1,'#a0beb0');
    }
    if(s.mode==='sensory') {
      const direction=(s.lightAngle||0)*Math.PI/180;
      const[lightX,lightY]=project(18*Math.sin(direction),18*Math.cos(direction));
      diamond(lightX,lightY-15,4,'#e3d89b');
      c.globalAlpha=Math.max(0,Math.min(.8,(1-(s.light??1)/2)*.45+(s.occlusion||0)*.45));
      diamond(120,123,98,'#09150e');c.globalAlpha=1;
    }
    if(this.showOdor){
      for(let u=.25;u<5.4;u+=.35)for(let v=.25;v<5.4;v+=.35){
        const hz=odorRateAt(tileToMM(u),tileToMM(v));
        if(hz>1){c.globalAlpha=hz/25*.65;diamond(120+(u-v)*16,83+(u+v)*8,4,'#bbe0c6');}
      }
      c.globalAlpha=1;
    }
    if(this.showTrail){
      c.strokeStyle='#ebd38e';c.lineWidth=.65;c.setLineDash([1.5,2]);c.beginPath();
      this.trail.forEach((p,i)=>{const[x,y]=project(p.x,p.z);i?c.lineTo(x,y):c.moveTo(x,y);});c.stroke();c.setLineDash([]);
    }
    // All landmarks use the firmware's tile positions.
    rect(118,58,4,25,'#706245');block(120,53,14,11,'#b7c876','#7e9c53','#476b43');block(115,46,10,8,'#c9d68a','#8aa856','#547445');
    let x=120+(1-4)*16,y=83+(1+4)*8;
    block(x,y-2,5,4,'#e3b76b','#ab8052','#786043');rect(x,y-7,1,3,'#3e5b38');
    x=120+(5-2)*16;y=83+(5+2)*8;block(x,y-4,7,6,'#a0b4a4','#738b7c','#4d6053');
    x=120-3*16;y=83+3*8;rect(x,y-7,1,7,'#3d613a');rect(x-2,y-10,5,3,'#e7c279');
    x=120+(4-5)*16;y=83+9*8;rect(x,y-5,2,5,'#d8d8ba');rect(x-3,y-8,8,3,'#b27854');
    const[px,ground]=project(pose.x,pose.z);x=Math.round(px);y=Math.round(ground-pose.y*11-3);
    if(this.showShadows)rect(x-5,ground+3,11,2,'#4f6538');
    const du=Math.sin(pose.yaw),dv=Math.cos(pose.yaw),angle=Math.atan2((du+dv)*.5,du-dv);
    c.save();c.translate(x,y);c.rotate(angle);
    const gait=Math.sin(pose.phase)>0?1:-1;
    for(const side of[-1,1])for(const leg of[-1,0,1])rect(leg*3+gait,side*4,3,1,'#19271d');
    rect(-4,-2,8,4,'#263026');for(const side of[-1,1])rect(-4,side*(pose.y>.1?5:2),6,2,'#d9e4bb');
    rect(2,-2,3,4,'#18281d');rect(4,-2,1,1,'#bd7751');if(s.feeding)rect(5,0,4,1,'#b27854');
    c.restore();c.restore();
  }
}
