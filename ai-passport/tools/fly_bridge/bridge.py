#!/usr/bin/env python3
"""Serve the neural app and relay bounded state over the Passport USB channel."""
from __future__ import annotations

import argparse
import json
import mimetypes
import queue
import secrets
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ACTIONS = {'WALK', 'LEFT', 'RIGHT', 'FLY', 'PAUSE', 'RESET'}
LIMITS = {'tick': (0, 4294967295), 'running': (0, 1), 'x': (-100000000, 100000000),
          'z': (-100000000, 100000000), 'heading': (-10000, 10000), 'height': (0, 10000),
          'phase': (0, 7000), 'walking': (0, 10000), 'turning': (-10000, 10000), 'escape': (0, 10000)}
WORLD_LIMITS = {'feeding': (0, 1000), 'food': (0, 100), 'energy': (0, 100), 'shadow': (0, 1)}


def validate_state(data):
    if not isinstance(data, dict):
        raise ValueError('Expected an object')
    result = {}
    for key, (low, high) in LIMITS.items():
        value = data.get(key)
        if type(value) is not int or not low <= value <= high:
            raise ValueError('Invalid ' + key)
        result[key] = value
    if data.get('world') == 1:
        result['world'] = 1
        if abs(result['x']) > 13438 or abs(result['z']) > 13438:
            raise ValueError('Position outside habitat')
        for key, (low, high) in WORLD_LIMITS.items():
            value = data.get(key)
            if type(value) is not int or not low <= value <= high:
                raise ValueError('Invalid ' + key)
            result[key] = value
    for key in ['client', 'epoch']:
        value = data.get(key)
        if not isinstance(value, str) or not 1 <= len(value) <= 80 or not value.isascii():
            raise ValueError('Invalid ' + key)
        result[key] = value
    return result


def state_frame(session, sequence, state):
    world = state.get('world') == 1
    keys = list(LIMITS) + (list(WORLD_LIMITS) if world else [])
    values = [session, sequence] + [state[k] for k in keys]
    return (('F1 WORLD ' if world else 'F1 STATE ') + ' '.join(map(str, values)) + '\n').encode()


class ControlConflict(ValueError):
    """A different active browser owns the device lease."""


class Bridge:
    def __init__(self, port=None):
        self.requested_port = port
        self.lock = threading.RLock()
        self.session = secrets.randbelow(4294967294) + 1
        self.sequence = 0
        self.latest = None
        self.updated = 0.0
        self.events = set()
        self.commands = {}
        self.device = None
        self.device_seen = 0.0
        self.status = {'port': None, 'connected': False, 'message': 'Waiting for AI Passport'}
        self.stop = threading.Event()

    def publish(self, data, takeover=False):
        data = validate_state(data)
        with self.lock:
            now = time.monotonic()
            if not takeover and self.latest and data['client'] != self.latest['client'] and now - self.updated < 3:
                raise ControlConflict('Another neural tab controls this device')
            if not self.latest or (data['client'], data['epoch']) != (self.latest['client'], self.latest['epoch']):
                self.session = secrets.randbelow(4294967294) + 1
                self.sequence = 0
                self.commands.clear()
            self.latest = data
            self.updated = now

    def snapshot(self):
        with self.lock:
            result = dict(self.status)
            result['neural'] = self.latest is not None and time.monotonic() - self.updated < 2
            result['device'] = self.device
            if result['neural']:
                result['world'] = {k: self.latest[k] for k in ['tick', 'x', 'z', 'heading', 'feeding', 'food', 'energy', 'shadow'] if k in self.latest}
            return result

    def emit(self, event):
        for client in tuple(self.events):
            try:
                client.put_nowait(event)
            except queue.Full:
                # Slow clients reconnect; state telemetry never queues behind them.
                self.events.discard(client)

    def acknowledge(self, command, client):
        with self.lock:
            if not self.latest or client != self.latest['client']:
                raise ValueError('Inactive neural client')
            if command in self.commands:
                self.commands[command]['acked'] = True

    def line(self, text, link):
        fields = text.split()
        if len(fields) == 4 and fields[:2] == ['F1', 'READY'] and fields[2].isdigit() and fields[3] == '1':
            self.device_seen = time.monotonic()
            self.status.update(connected=True, message='AI Passport connected')
        elif len(fields) in (11, 16) and fields[:2] == ['F1', 'STATUS']:
            try:
                values = [int(v) for v in fields[2:]]
            except ValueError:
                return
            self.device_seen = time.monotonic()
            self.device = dict(zip(['boot', 'mode', 'selected', 'food', 'energy', 'freeHeap', 'largestBlock', 'frames', 'droppedKeys', 'u', 'v', 'feeding', 'world', 'sequence'], values))
        elif len(fields) == 5 and fields[:2] == ['F1', 'KEY'] and fields[4] in ACTIONS:
            if not fields[2].isdigit() or not fields[3].isdigit():
                return
            key = fields[2] + ':' + fields[3]
            now = time.monotonic()
            if not self.latest or now - self.updated >= 2:
                return
            for old in list(self.commands):
                if now - self.commands[old]['created'] > 15:
                    del self.commands[old]
            item = self.commands.get(key)
            if item is None:
                if len(self.commands) >= 64:
                    return
                item = self.commands[key] = {'acked': False, 'created': now, 'sent': 0, 'action': fields[4]}
            if item['action'] != fields[4]:
                return
            if item['acked']:
                link.write(('F1 ACK ' + fields[2] + ' ' + fields[3] + '\n').encode())
            elif now - item['sent'] > 0.25:
                self.emit({'id': key, 'action': fields[4], 'client': self.latest['client']})
                item['sent'] = now

    def serial_loop(self):
        import serial
        from serial.tools import list_ports
        while not self.stop.is_set():
            candidates = [p.device for p in list_ports.comports() if p.vid == 0x303A and p.pid == 0x1001]
            port = self.requested_port or (candidates[0] if len(candidates) == 1 else None)
            if not port:
                with self.lock:
                    self.status.update(connected=False, port=None, message='Connect one AI Passport with a data USB cable')
                self.stop.wait(1)
                continue
            try:
                link = serial.Serial(port=None, baudrate=115200, timeout=0.02, write_timeout=0.2, exclusive=True)
                link.dtr = False
                link.rts = False
                link.port = port
                link.open()
                with link:
                    with self.lock:
                        self.status.update(port=port, connected=False, message='Checking device firmware')
                    partial = bytearray()
                    hello_at = send_at = 0
                    sent_session = None
                    while not self.stop.is_set():
                        chunk = link.read(512)
                        partial.extend(chunk)
                        while b'\n' in partial:
                            raw, _, partial = partial.partition(b'\n')
                            if len(raw) < 256:
                                with self.lock:
                                    self.line(raw.decode('ascii', errors='replace').strip(), link)
                        if len(partial) > 512:
                            partial.clear()
                        now = time.monotonic()
                        with self.lock:
                            if now - hello_at >= 1 or sent_session != self.session:
                                link.write(f'F1 HELLO {self.session}\n'.encode())
                                hello_at = now
                                sent_session = self.session
                            if self.latest and now - self.updated < 2 and now - send_at >= 0.05:
                                self.sequence += 1
                                link.write(state_frame(self.session, self.sequence, self.latest))
                                send_at = now
                            if self.status['connected'] and now - self.device_seen > 3:
                                self.status.update(connected=False, message='Device stopped responding')
            except (serial.SerialException, OSError) as error:
                with self.lock:
                    self.status.update(connected=False, message='USB unavailable: ' + type(error).__name__)
                self.stop.wait(1)


def make_handler(bridge, directory, port):
    class Handler(SimpleHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(directory), **kwargs)

        def log_message(self, *_args):
            pass

        def json_reply(self, status, data):
            body = json.dumps(data).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == '/api/status':
                self.json_reply(200, bridge.snapshot())
            elif self.path == '/api/events':
                client = queue.Queue(maxsize=16)
                with bridge.lock:
                    if len(bridge.events) >= 4:
                        self.json_reply(503, {'error': 'Too many clients'})
                        return
                    bridge.events.add(client)
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Cache-Control', 'no-cache')
                self.send_header('Connection', 'close')
                self.end_headers()
                try:
                    while not bridge.stop.is_set():
                        try:
                            message = client.get(timeout=1)
                            payload = 'data: ' + json.dumps(message) + '\n\n'
                        except queue.Empty:
                            payload = ': heartbeat\n\n'
                        self.wfile.write(payload.encode())
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass
                finally:
                    with bridge.lock:
                        bridge.events.discard(client)
                    self.close_connection = True
            else:
                super().do_GET()

        def do_POST(self):
            # Only the local app can mutate the device; no permissive CORS endpoint.
            origin = self.headers.get('Origin')
            if origin not in {f'http://127.0.0.1:{port}', f'http://localhost:{port}'}:
                self.close_connection = True
                self.json_reply(403, {'error': 'Invalid origin'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 2048:
                    self.close_connection = True
                    raise ValueError('Invalid length')
                data = json.loads(self.rfile.read(length))
                if self.path == '/api/state':
                    bridge.publish(data)
                elif self.path == '/api/takeover':
                    bridge.publish(data, takeover=True)
                elif self.path == '/api/ack' and isinstance(data, dict):
                    bridge.acknowledge(str(data.get('id', '')), data.get('client'))
                else:
                    raise ValueError('Unknown command')
                self.json_reply(200, {'ok': True})
            except ControlConflict:
                self.json_reply(409, {'error': 'Another browser controls this device'})
            except (ValueError, TypeError):
                self.json_reply(400, {'error': 'Invalid request or inactive client'})
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--web', type=Path, required=True)
    parser.add_argument('--port')
    parser.add_argument('--http-port', type=int, default=8768)
    args = parser.parse_args()
    try:
        import serial  # Supplied by the ESP-IDF Python environment.
    except ImportError:
        parser.error("Run with the ESP-IDF Python environment (pySerial required)")
    if not (args.web / 'index.html').is_file():
        parser.error('--web must contain the built neural app')
    bridge = Bridge(args.port)
    server = ThreadingHTTPServer(('127.0.0.1', args.http_port), make_handler(bridge, args.web, args.http_port))
    threading.Thread(target=bridge.serial_loop, daemon=True).start()
    print(f'Fly World: http://127.0.0.1:{args.http_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        bridge.stop.set()
        server.server_close()


if __name__ == '__main__':
    main()
