"""Physical and afferent boundaries, independent of a trained locomotion policy."""
import gzip,json,sys,unittest,importlib.util
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'cloud/python'))
AVAILABLE=importlib.util.find_spec('mujoco') is not None and (ROOT/'cloud/assets/flybody/manifest.json').exists()
@unittest.skipUnless(AVAILABLE,'MuJoCo and pinned body assets are required')
class PhysicalBodyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from mujoco_body import NeuralBody,annotations
        from physical_senses import PhysicalSenses
        rows=json.loads(gzip.decompress((ROOT/'fly-host/public/data/neurons.json.gz').read_bytes()))
        cls.body=NeuralBody(ROOT/'cloud/assets/flybody',rows,annotations(ROOT/'fly-host/public/data/sensorimotor.json.gz'))
        cls.Senses=PhysicalSenses
    def setUp(self):self.body.reset();self.zero=np.zeros(self.body.n)
    def test_zero_output_has_no_actuator_force_or_altitude_controller(self):
        b=self.body;b.data.qpos[2]=.8;b.data.qvel[:]=0
        import mujoco
        mujoco.mj_forward(b.model,b.data);height=b.data.subtree_com[0,2]
        b.advance(self.zero,.01)
        self.assertTrue(np.all(b.data.ctrl==0));self.assertLess(b.data.subtree_com[0,2],height)
        self.assertTrue(np.all(b.model.actuator_biasprm==0))
    def test_motor_readout_and_ablation_are_causal(self):
        b=self.body;(actuator,sign),ids=next(iter(b.pools.items()));counts=self.zero.copy();counts[ids]=1
        b.advance(counts,.01);self.assertGreater(abs(b.data.ctrl[actuator]),0)
        b.advance(counts,.01,ablate_muscles=True);self.assertTrue(np.all(b.data.ctrl==0))
    def test_descending_escape_event_cannot_assign_a_jump(self):
        b=self.body;counts=self.zero.copy();counts[b.ids['10001']]=1
        b.advance(counts,.01);self.assertTrue(np.all(b.data.ctrl==0))
    def test_joint_motion_changes_afferents_without_driving_motor_indices(self):
        b=self.body;r0=self.zero.copy();b.proprioception(r0)
        group=next(g for g in b.feedback if g['indices'] and g['modality']=='mechanosensory_proprioceptive');j=group['joint']
        b.data.qpos[b.model.jnt_qposadr[j]]=b.model.jnt_range[j,0]
        r1=self.zero.copy();b.proprioception(r1)
        self.assertTrue(np.any(r1!=r0));self.assertFalse(r1[list(b.motor_indices)].any())
    def test_environment_changes_sensory_rates_not_body_commands(self):
        b=self.body;s=self.Senses(b);a=s.sample(.01);s.options['light']=0;c=s.sample(.01)
        self.assertTrue(np.any(a!=c));self.assertFalse(c[list(b.motor_indices)].any());self.assertTrue(np.all(b.data.ctrl==0))
        s.options['enabled']=False;self.assertFalse(s.sample(.01).any())
    def test_food_contact_snapshot_is_serializable(self):
        import mujoco
        b=self.body;s=self.Senses(b)
        b.data.qpos[:3]+=b.model.geom_pos[b.model.geom('food').id]-b.data.body('labrum_left').xpos
        mujoco.mj_forward(b.model,b.data);s.sample(0)
        self.assertTrue(s.snapshot()['contact']);json.dumps(s.snapshot(),allow_nan=False)
    def test_body_tilt_changes_retinal_input(self):
        import mujoco
        b=self.body;s=self.Senses(b);a=s.sample(0)
        b.data.qpos[3:7]=[np.cos(.3),0,np.sin(.3),0];mujoco.mj_forward(b.model,b.data)
        c=s.sample(0);retinal=np.concatenate([r['indices'] for r in s.retina])
        self.assertTrue(np.any(a[retinal]!=c[retinal]))
if __name__=='__main__':unittest.main()
