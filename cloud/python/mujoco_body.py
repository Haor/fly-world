"""Physical integration and explicit anatomical motor/afferent correspondences.

No descending-neuron action decoder, gait policy, position servo, takeoff impulse,
altitude target, or generated wingbeat is used. Unmapped actuators stay inactive.
"""
import gzip,hashlib,json,math
from pathlib import Path
import xml.etree.ElementTree as ET
import numpy as np
import mujoco

BODY_ENCODING='flybody-mujoco/1'
# Signs refer to the named flybody joint axis; moment arms remain uncalibrated.
LEG_MUSCLES={
 'Ti extensor MN':('tibia',1),'Ti flexor MN':('tibia',-1),'Acc. ti flexor MN':('tibia',-1),
 'Tr extensor MN':('femur',1),'Tr flexor MN':('femur',-1),'Acc. tr flexor MN':('femur',-1),
 'Sternal anterior rotator MN':('coxa_twist',1),'Sternal posterior rotator MN':('coxa_twist',-1),
 'Pleural remotor/abductor MN':('coxa_abduct',1),'Tergopleural/Pleural promotor MN':('coxa_abduct',-1),
 'Ta levator MN':('tarsus',1),'Ta depressor MN':('tarsus',-1),
}
NERVES={'ProLN':'T1','MesoLN':'T2','MetaLN':'T3'}

def annotations(path):
    document=json.loads(gzip.decompress(Path(path).read_bytes()))
    if document['schema']!='sensorimotor-annotations/1':raise ValueError('INVALID_SENSORIMOTOR_METADATA')
    return [dict(zip(document['fields'],r)) for r in document['rows']]

class NeuralBody:
    def __init__(self,asset_dir,neurons,annotation_rows,physics_dt=.0001):
        asset_dir=Path(asset_dir)
        manifest=json.loads((asset_dir/'manifest.json').read_text())
        for name,digest in manifest['files'].items():
            if Path(name).name!=name or hashlib.sha256((asset_dir/name).read_bytes()).hexdigest()!=digest:raise ValueError('BODY_CHECKSUM')
        root=ET.parse(asset_dir/'fruitfly.xml').getroot()
        root.find('compiler').set('meshdir',str(asset_dir.resolve()))
        root.find('option').set('timestep',str(physics_dt))
        # Retain the asset's Euler integrator and original 0.1 ms timestep.
        # Larger steps change MuJoCo's contact regularization for this asset.
        world=root.find('worldbody')
        ET.SubElement(world,'geom',name='habitat_floor',type='plane',size='2 2 .1',pos='0 0 -.132',friction='.6 .005 .0001',rgba='.12 .17 .13 1')
        for axis in range(2):
            for sign in [-1,1]:
                pos=[0.,0.,.4];pos[axis]=sign*1.4
                size=[1.45,1.45,.55];size[axis]=.04
                ET.SubElement(world,'geom',name=f'wall_{axis}_{sign}',type='box',pos=' '.join(map(str,pos)),size=' '.join(map(str,size)),rgba='.3 .35 .3 1')
        ET.SubElement(world,'geom',name='food',type='cylinder',pos='.9375 -.9375 -.112',size='.14 .02',rgba='.7 .3 .1 1')
        ET.SubElement(world,'geom',name='rock',type='cylinder',pos='-.3125 1.5625 -.112',size='.22 .02',rgba='.4 .4 .4 1')
        for geom in root.iter('geom'):
            if 'fluid' in geom.get('name',''):
                geom.set('fluidshape','ellipsoid');geom.set('fluidcoef','1 .5 1.5 1.7 1')
        self.model=mujoco.MjModel.from_xml_string(ET.tostring(root,encoding='unicode'))
        self.data=mujoco.MjData(self.model);self.n=len(neurons);self.physics_dt=physics_dt
        self.ids={str(r[0]):i for i,r in enumerate(neurons)}
        self.rows=[dict(r,index=self.ids[str(r['bodyId'])]) for r in annotation_rows if str(r['bodyId']) in self.ids]
        self.pools={};self.motor_indices=set()
        for r in self.rows:
            if r['superclass']!='vnc_motor':continue
            side={'L':'left','R':'right'}.get(r['somaSide']);segment=r['somaNeuromere'];typ=r['type'] or ''
            if not side:continue
            if typ in LEG_MUSCLES and segment in ['T1','T2','T3']:
                joint,sign=LEG_MUSCLES[typ];self._pool(f'{joint}_{segment}_{side}',sign,r['index'])
            elif typ=='TTMn':self._pool(f'femur_T2_{side}',1,r['index'])
            elif typ.startswith('DLMn '):self._pool(f'wing_roll_{side}',-1,r['index'])
            elif typ.startswith('DVMn '):self._pool(f'wing_roll_{side}',1,r['index'])
            elif typ in ['b1 MN','b2 MN']:self._pool(f'wing_pitch_{side}',1 if typ=='b1 MN' else -1,r['index'])
            elif typ in ['i1 MN','i2 MN']:self._pool(f'wing_yaw_{side}',1 if typ=='i1 MN' else -1,r['index'])
        self.mapped_actuators=sorted(set(k[0] for k in self.pools))
        # Disable active position-servo bias and adhesion. Passive joint springs remain.
        self.model.actuator_biasprm[:]=0
        self.model.actuator_biastype[:]=mujoco.mjtBias.mjBIAS_NONE
        self.model.actuator_ctrllimited[:]=1;self.model.actuator_ctrlrange[:]=[-1,1]
        self.feedback=[]
        for segment in ['T1','T2','T3']:
            for side,word in [('L','left'),('R','right')]:
                joint=self.model.joint(f'tibia_{segment}_{word}').id
                for modality in ['mechanosensory_proprioceptive','mechanosensory_tactile']:
                    ids=[r['index'] for r in self.rows if r['superclass']=='vnc_sensory' and r['rootSide']==side and NERVES.get(r['entryNerve'])==segment and r['class']==modality]
                    self.feedback.append({'joint':joint,'sensor':self.model.sensor(f'touch_claw_{segment}_{word}').id,'modality':modality,'indices':ids})
        self.motor_rate=np.zeros(self.n);self.reset()

    def _pool(self,name,sign,index):
        actuator=mujoco.mj_name2id(self.model,mujoco.mjtObj.mjOBJ_ACTUATOR,name)
        if actuator<0:raise ValueError('UNKNOWN_MOTOR_ACTUATOR')
        self.pools.setdefault((actuator,sign),[]).append(index);self.motor_indices.add(index)

    def reset(self,spawn=None):
        mujoco.mj_resetData(self.model,self.data);self.model.opt.wind.fill(0);self.motor_rate.fill(0)
        self.data.ctrl[:]=0
        # Settle the passive body before resetting experiment time.
        mujoco.mj_step(self.model,self.data,nstep=round(.15/self.physics_dt))
        self.data.qvel[:]=0;self.data.time=0
        x,z,yaw=(-9.375,1.25,0.) if spawn is None else (spawn['x'],spawn['z'],spawn['yaw'])
        self.data.qpos[:2]=[z/10,x/10];self.data.qpos[3:7]=[math.cos(yaw/2),0,0,math.sin(yaw/2)]
        mujoco.mj_forward(self.model,self.data)
        self.previous=np.array([x,z]);self.distance=0.;self.takeoffs=0;self.was_contact=True

    def advance(self,counts,dt,wind=(0.,0.),ablate_muscles=False):
        rates=np.asarray(counts)/dt
        self.motor_rate+=(rates-self.motor_rate)*(1-math.exp(-dt/.02))
        self.data.ctrl[:]=0
        if not ablate_muscles:
            for (actuator,sign),ids in self.pools.items():
                activity=self.motor_rate[ids].mean()
                self.data.ctrl[actuator]+=sign*activity/(activity+20.)
        np.clip(self.data.ctrl,-1,1,out=self.data.ctrl)
        self.model.opt.wind[:]=[wind[1]/10,wind[0]/10,0.]
        mujoco.mj_step(self.model,self.data,nstep=round(dt/self.physics_dt))
        if not np.isfinite(self.data.qpos).all() or not np.isfinite(self.data.qvel).all():raise ValueError('PHYSICS_DIVERGED')
        position=self.data.qpos[[1,0]]*10;self.distance+=float(np.linalg.norm(position-self.previous));self.previous=position.copy()
        contact=self.contact_count()>0
        if self.was_contact and not contact and self.data.qvel[2]>0:self.takeoffs+=1
        self.was_contact=contact

    def contact_count(self):
        floor=self.model.geom('habitat_floor').id;food=self.model.geom('food').id
        return sum(1 for c in self.data.contact if c.geom1 in [floor,food] or c.geom2 in [floor,food])

    def proprioception(self,rates):
        totals={'proprioceptive':0.,'tactile':0.}
        for group in self.feedback:
            if not group['indices']:continue
            j=group['joint'];q=self.data.qpos[self.model.jnt_qposadr[j]];v=self.data.qvel[self.model.jnt_dofadr[j]]
            if group['modality']=='mechanosensory_proprioceptive':
                low,high=self.model.jnt_range[j];value=min(100.,20.*abs(v)+40.*np.clip((q-low)/(high-low),0,1));key='proprioceptive'
            else:
                s=group['sensor'];force=float(self.data.sensordata[self.model.sensor_adr[s]])
                value=100.*force/(abs(force)+.01) if force>0 else 0.;key='tactile'
            rates[group['indices']]=np.maximum(rates[group['indices']],value);totals[key]+=float(value)/6
        return totals

    def snapshot(self,tick):
        d=self.data;r=d.xmat[1].reshape(3,3);yaw=math.atan2(r[1,0],r[0,0]);contact=self.contact_count()
        speed=float(np.linalg.norm(d.qvel[:2])*10)
        height=float((d.qpos[2]+.132)*10)
        behavior='At rest' if speed<.15 else 'Surface motion'
        if not contact:behavior='Airborne' if d.qvel[2]>=0 else 'Falling'
        pose={'x':float(d.qpos[1]*10),'z':float(d.qpos[0]*10),'y':height,'yaw':yaw,'velocity':speed,'yawRate':float(d.qvel[5]),'phase':0.,'time':tick*.0001,
              'pitch':float(math.asin(np.clip(-r[2,0],-1,1))),'bank':float(math.atan2(r[2,1],r[2,2])),'wingOpen':0.,'flightBlend':float(not contact),'launch':0.,'landing':float(not contact and d.qvel[2]<0),'behavior':behavior,
              'physical':True,'contacts':contact,'takeoffs':self.takeoffs,'actuation':float(np.linalg.norm(d.ctrl)),
              'rigid':np.column_stack([d.xpos[1:]*10,d.xquat[1:]]).round(7).tolist()}
        return pose

    def render_definition(self):
        m=self.model;geoms=[]
        for g in range(m.ngeom):
            mesh=m.geom_dataid[g]
            if m.geom_group[g]!=1 or mesh<0 or m.geom_bodyid[g]==0:continue
            v=m.mesh_vert[m.mesh_vertadr[mesh]:m.mesh_vertadr[mesh]+m.mesh_vertnum[mesh]].copy()
            f=m.mesh_face[m.mesh_faceadr[mesh]:m.mesh_faceadr[mesh]+m.mesh_facenum[mesh]].copy()
            if len(v)>800:
                scale=np.maximum(np.ptp(v,axis=0)/32,1e-7)
                _,inverse=np.unique(np.round(v/scale).astype(np.int32),axis=0,return_inverse=True)
                count=np.bincount(inverse);v=np.column_stack([np.bincount(inverse,weights=v[:,k])/count for k in range(3)])
                f=inverse[f];f=f[(f[:,0]!=f[:,1])&(f[:,1]!=f[:,2])&(f[:,0]!=f[:,2])]
            color=m.mat_rgba[m.geom_matid[g]] if m.geom_matid[g]>=0 else m.geom_rgba[g]
            geoms.append({'body':int(m.geom_bodyid[g]-1),'position':(m.geom_pos[g]*10).tolist(),'quaternion':m.geom_quat[g].tolist(),'vertices':(v*10).round(6).reshape(-1).tolist(),'indices':f.reshape(-1).tolist(),'rgba':color.tolist()})
        return {'encoding':BODY_ENCODING,'bodies':m.nbody-1,'geoms':geoms,'mappedMotorNeurons':len(self.motor_indices),'mappedActuators':len(self.mapped_actuators),'actuators':m.nu,'physicsDt':self.physics_dt}
