"""Environment-to-afferent transduction, with explicit uncalibrated gains.

Retinal hex coordinates are official. Mapping columns to viewing angles and
L1/L2 ON/OFF spike proxies are approximations, not fitted retinal physiology.
"""
import math
import numpy as np
import mujoco

DEFAULTS={'enabled':True,'vision':True,'taste':True,'odor':True,'light':1.,'lightAngle':0.,'sensoryGain':1.,'odorStrength':1.,'odorX':-9.375,'odorZ':9.375,'windSpeed':0.,'windAngle':0.,'patternSpeed':0.,'patternContrast':0.,'proprioception':True}
class PhysicalSenses:
    def __init__(self,body,options=None):
        self.body=body;self.options={**DEFAULTS,**(options or {})}
        head_rest=np.empty(9)
        mujoco.mju_quat2Mat(head_rest,body.model.body('head').quat)
        self.head_rest=head_rest.reshape(3,3)
        self.retina=[];self.groups={key:[] for key in ['odorLeft','odorRight','sugar','windLeft','windRight']}
        for side,word in [('L','Left'),('R','Right')]:
            rows=[r for r in body.rows if r['type'] in ['L1','L2'] and r['somaSide']==side and r['assignedOlHex1'] is not None and r['assignedOlHex2'] is not None]
            if rows:
                q=np.array([r['assignedOlHex1'] for r in rows]);v=np.array([r['assignedOlHex2'] for r in rows]);u=q+v*.5
                az=(u-u.min())/max(1,np.ptp(u))*math.radians(150)-math.radians(75)
                az=az+(math.radians(70) if side=='L' else -math.radians(70))
                elevation=((v-v.min())/max(1,np.ptp(v))-.5)*math.radians(100)
                self.retina.append({'indices':np.array([r['index'] for r in rows]),'az':az,'elevation':elevation,'on':np.array([r['type']=='L1' for r in rows]),'baseline':np.zeros(len(rows))})
            for r in body.rows:
                actual=r['somaSide'] or r['rootSide']
                if r['superclass']!='cb_sensory' or actual!=side:continue
                typ=r['type'] or ''
                if typ=='ORN_DM1':self.groups['odor'+word].append(r['index'])
                if typ.startswith(('JO-EV','JO-ED')):self.groups['wind'+word].append(r['index'])
                if typ in ['LB3b','LB3c']:self.groups['sugar'].append(r['index'])
        self.reset()
    def reset(self):
        self.time=0.;self.odor_baseline=np.zeros(2);self.loom=None;self.signals={}
        for r in self.retina:r['baseline'].fill(0)
    def stimulus(self,name):
        if name not in ['occlusion','looming']:raise ValueError('INVALID_STIMULUS')
        p=self.body.snapshot(round(self.time*10000))
        self.loom={'kind':name,'began':self.time,'x':p['x'],'z':p['z'],'y':p['y'],'yaw':p['yaw']}
    def wind(self):
        a=math.radians(self.options['windAngle']);speed=self.options['windSpeed']
        return speed*math.sin(a),speed*math.cos(a)
    def sample(self,dt):
        b=self.body;p=b.snapshot(round(self.time*10000));o=self.options
        rates=np.zeros(b.n,dtype=np.float32)
        s={'walk':0.,'left':0.,'right':0.,'looming':0.,'sugar':0.,'odorLeft':0.,'odorRight':0.,'odor':0.,'rawLeft':0.,'rawRight':0.,'odorTrend':0.,'visualLeft':0.,'visualRight':0.,'windLeft':0.,'windRight':0.,'proprioceptive':0.,'tactile':0.,'contact':False,'forageState':'inactive'}
        if not o['enabled']:self.signals=s;return rates
        if o['vision']:
            rotation=b.data.body('head').xmat.reshape(3,3)@self.head_rest.T
            for side,r in enumerate(self.retina):
                local=np.column_stack([np.cos(r['az'])*np.cos(r['elevation']),np.sin(r['az'])*np.cos(r['elevation']),np.sin(r['elevation'])])
                rays=local@rotation.T
                az=np.arctan2(rays[:,1],rays[:,0]);elevation=np.arcsin(np.clip(rays[:,2],-1,1));lamp=math.radians(o['lightAngle'])
                luminance=o['light']*(.3+.7*np.maximum(0,np.cos(az-lamp))*np.cos(elevation)**2)
                if o['patternContrast']:
                    # A cylindrical laboratory panorama, sampled in world coordinates.
                    dx,dz=np.sin(az),np.cos(az);dot=p['x']*dx+p['z']*dz
                    distance=-dot+np.sqrt(np.maximum(0,dot**2+20**2-p['x']**2-p['z']**2))
                    panorama=np.arctan2(p['x']+distance*dx,p['z']+distance*dz)
                    luminance*=1-o['patternContrast']*.5*(1+np.cos(12*(panorama-math.radians(o['patternSpeed'])*self.time)))
                if self.loom and self.time-self.loom['began']<.65:
                    age=self.time-self.loom['began']
                    if self.loom['kind']=='occlusion':luminance*=1-.85*math.sin(math.pi*age/.65)
                    else:
                        forward=max(.5,20.-30.*age);heading=self.loom['yaw']
                        dx=self.loom['x']+forward*math.sin(heading)-p['x'];dz=self.loom['z']+forward*math.cos(heading)-p['z'];dy=self.loom['y']-p['y']
                        horizontal=math.hypot(dx,dz);radius=math.atan2(2.,math.hypot(horizontal,dy))
                        center=math.atan2(dx,dz);vertical=math.atan2(dy,horizontal)
                        bearing=np.arctan2(np.sin(az-center),np.cos(az-center))
                        luminance=np.where(bearing**2+(elevation-vertical)**2<radius**2,luminance*.05,luminance)
                delta=luminance-r['baseline']
                polarity=np.where(r['on'],delta,-delta)
                hz=np.clip((5.+100.*polarity)*o['sensoryGain'],0,150)
                r['baseline']+=(luminance-r['baseline'])*(1-math.exp(-dt/.05))
                rates[r['indices']]=hz;s['visualLeft' if side==0 else 'visualRight']=float(hz.mean())
        if o['odor']:
            raw=[];wind=self.wind()
            for side,word in enumerate(['left','right']):
                antenna=b.data.body('antenna_'+word).xpos
                x,z,height=antenna[1]*10,antenna[0]*10,(antenna[2]+.132)*10
                dx=x-o['odorX'];dz=z-o['odorZ'];distance=math.sqrt(dx*dx+dz*dz+height**2)
                value=25.*o['odorStrength']*math.exp(-distance/7.)
                if o['windSpeed']>0:
                    angle=math.radians(o['windAngle']);along=dx*math.sin(angle)+dz*math.cos(angle);cross=dx*math.cos(angle)-dz*math.sin(angle)
                    value*=math.exp(-cross*cross/(2*(1.+max(0,along)*.15)**2))*(1. if along>=0 else math.exp(along/2.))
                raw.append(value)
            self.odor_baseline+=(np.array(raw)-self.odor_baseline)*(1-math.exp(-dt/2.))
            for k,(word,value) in enumerate(zip(['Left','Right'],raw)):
                hz=max(0,value-.6*self.odor_baseline[k]);rates[self.groups['odor'+word]]=hz;s['odor'+word]=hz;s['raw'+word]=value
            s['odor']=(s['odorLeft']+s['odorRight'])/2
        if o['taste']:
            mouth=b.data.body('labrum_left').xpos
            food=b.model.geom_pos[b.model.geom('food').id]
            contact=bool(math.hypot((mouth[0]-food[0])*10,(mouth[1]-food[1])*10)<1.4 and (mouth[2]+.132)*10<.5)
            s['contact']=contact;s['sugar']=100. if contact else 0.;rates[self.groups['sugar']]=s['sugar']
        wind=np.array(self.wind());velocity=np.array([b.data.qvel[1],b.data.qvel[0]])*10;relative=wind-velocity
        for word,offset in [('Left',math.pi/4),('Right',-math.pi/4)]:
            a=p['yaw']+offset;deflection=abs(float(relative@np.array([math.sin(a),math.cos(a)])))
            hz=100.*deflection/(deflection+20.);rates[self.groups['wind'+word]]=hz;s['wind'+word]=hz
        if o['proprioception']:s.update(b.proprioception(rates))
        if b.motor_indices and rates[list(b.motor_indices)].any():raise ValueError('SENSORY_MOTOR_OVERLAP')
        self.signals=s;return rates
    def advance(self,dt):self.time+=dt
    def snapshot(self):
        active=self.loom is not None and self.time-self.loom['began']<.65
        occlusion=.85*math.sin(math.pi*(self.time-self.loom['began'])/.65) if active and self.loom['kind']=='occlusion' else 0.
        return {**self.signals,'time':self.time,'options':dict(self.options),'mode':'sensory','physical':True,'hunger':None,'energy':None,'feeding':0.,'feedSeconds':0.,'light':self.options['light'],'lightAngle':self.options['lightAngle'],'occlusion':occlusion,'loomingStimulus':active}
