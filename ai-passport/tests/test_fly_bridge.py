#!/usr/bin/env python3
import importlib.util
import io
import json
import queue
import sys
import time
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('fly_bridge', Path(__file__).resolve().parents[1] / 'tools/fly_bridge/bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def state(**kwargs):
    data = dict(client='test-client', epoch='1', tick=100, running=1, x=0, z=0, heading=0,
                height=0, phase=0, walking=20, turning=-30, escape=0)
    data.update(kwargs)
    return data


class BridgeTests(unittest.TestCase):
    def test_explicit_takeover_replaces_lease_and_rejects_old_owner(self):
        b=bridge.Bridge();b.publish(state());session=b.session
        b.commands['old-command']={'acked':False}
        b.publish(state(client='new-station'),takeover=True)
        self.assertNotEqual(b.session,session);self.assertFalse(b.commands)
        with self.assertRaises(bridge.ControlConflict):b.publish(state())
        b.publish(state(client='new-station',tick=200))
        with self.assertRaises(ValueError):b.publish(state(client='third',x=float('nan')),takeover=True)
        self.assertEqual(b.latest['client'],'new-station')

    def test_bounds_and_nonfinite(self):
        self.assertEqual(bridge.validate_state(state())['walking'], 20)
        for invalid in [state(running=2), state(x=float('nan')), state(x=True), state(phase=-1), state(client='')]:
            with self.assertRaises(ValueError): bridge.validate_state(invalid)

    def test_lease_and_reset(self):
        b=bridge.Bridge();b.publish(state());session=b.session
        b.publish(state(tick=200));self.assertEqual(b.session, session)
        with self.assertRaises(ValueError):b.publish(state(client='other'))
        b.publish(state(epoch='2',tick=0));self.assertNotEqual(b.session, session)
        b.updated=time.monotonic()-4;b.publish(state(client='other'))

    def test_command_ack_after_browser_execution(self):
        b=bridge.Bridge();b.publish(state());q=queue.Queue(16);b.events.add(q);wire=io.BytesIO()
        b.line('F1 KEY 123 1 WALK',wire)
        event=q.get_nowait();self.assertEqual(event['action'],'WALK');self.assertEqual(wire.getvalue(),b'')
        b.line('F1 KEY 123 1 WALK',wire);self.assertTrue(q.empty())
        with self.assertRaises(ValueError):b.acknowledge(event['id'],'wrong')
        b.acknowledge(event['id'],'test-client');b.line('F1 KEY 123 1 WALK',wire)
        self.assertEqual(wire.getvalue(),b'F1 ACK 123 1\n')
        b.line('F1 KEY 123 1 RESET',wire);self.assertTrue(q.empty())

    def test_no_stale_stimuli(self):
        b=bridge.Bridge();b.publish(state());b.updated-=3;q=queue.Queue(16);b.events.add(q)
        b.line('F1 KEY 123 1 WALK',io.BytesIO());self.assertTrue(q.empty());self.assertFalse(b.snapshot()['neural'])

    def test_status(self):
        b=bridge.Bridge();b.line('F1 READY 123 1',io.BytesIO())
        self.assertTrue(b.snapshot()['connected'])
        b.line('F1 STATUS 123 0 1 75 90 120000 80000 1234 0',io.BytesIO())
        self.assertEqual(b.snapshot()['device']['freeHeap'],120000)
        b.line('F1 STATUS 123 1 1 75 90 120000 80000 1234 0 1000 4000 500 1 22',io.BytesIO())
        self.assertEqual(b.snapshot()['device']['u'], 1000)
        self.assertEqual(b.snapshot()['device']['feeding'], 500)

    def test_world_protocol_and_validation(self):
        data=bridge.validate_state(state(world=1,feeding=800,food=50,energy=90,shadow=1))
        wire=bridge.state_frame(123,1,data)
        self.assertEqual(wire,b'F1 WORLD 123 1 100 1 0 0 0 0 0 20 -30 0 800 50 90 1\n')
        self.assertTrue(bridge.state_frame(123,2,bridge.validate_state(state())).startswith(b'F1 STATE '))
        for field, value in [('feeding',1001), ('energy',-1), ('shadow',2), ('food',True)]:
            with self.assertRaises(ValueError): bridge.validate_state(dict(data,**{field:value}))


if __name__=='__main__':unittest.main()
