/** Local USB companion. The browser remains the only neural simulation owner. */
export function attachPassport(apply, onStatus = () => {}) {
  const client = crypto.randomUUID();
  const seen = new Map();
  let sample = null, sampleAt = 0, pending = false, connected = false;
  let transportError = null, controlConflict = false;
  const post = async (path, data) => {
    const response = await fetch(path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)});
    if (!response.ok) throw Object.assign(new Error(`Bridge ${response.status}`), {status:response.status});
  };
  const events = new EventSource('/api/events');
  events.onmessage = async ({data}) => {
    try {
      const command = JSON.parse(data);
      if (command.client !== client || typeof command.id !== 'string') return;
      if (!seen.has(command.id)) {
        if (!apply(command.action)) return;
        seen.set(command.id, Date.now());
      }
      for (const [id, at] of seen) if (Date.now() - at > 30000) seen.delete(id);
      await post('/api/ack', {id:command.id, client});
    } catch (error) {
      transportError = '设备动作未确认，请重试。';
    }
  };
  const sender = setInterval(async () => {
    if (!sample || pending || performance.now() - sampleAt > 5000) return;
    pending = true;
    try { await post('/api/state', sample); transportError = null; controlConflict = false; }
    catch (error) { controlConflict = error.status === 409; transportError = controlConflict ? '另一个页面正在控制卡片。可将控制权切换到本站。' : `状态同步未成功（${error.message}）`; }
    finally { pending = false; }
  }, 100);
  const poller = setInterval(async () => {
    try {
      const response = await fetch('/api/status', {cache:'no-store'});
      if (!response.ok) throw new Error('Bridge unavailable');
      const status = await response.json();
      connected = status.connected === true;
      onStatus({...status, transportError, controlConflict});
    } catch { connected = false; onStatus({connected:false, neural:false, message:'本地桥接服务不可用，请启动电脑伴侣。', transportError}); }
  }, 1000);
  const integer = (x, scale, low, high) => Math.max(low, Math.min(high, Math.round((Number.isFinite(x) ? x : 0) * scale)));
  return {
    get connected() { return connected; },
    async takeControl() {
      if (!sample) throw new Error('请先启动本地模拟。');
      await post('/api/takeover', sample); controlConflict = false; transportError = null;
    },
    stop() { sample = null; },
    dispose() { sample = null; clearInterval(sender); clearInterval(poller); events.close(); },
    sample(pose, rates, tick, running, epoch, world) {
      sampleAt = performance.now();
      sample = {
        world: 1, feeding: integer(world.feeding, 1000, 0, 1000),
        food: integer(1 - world.hunger, 100, 0, 100), energy: integer(world.energy, 100, 0, 100),
        // Reserved legacy display marker; browser shadows do not enter the neural state.
        shadow: 0,
        client, epoch: String(epoch), tick: integer(tick, 1, 0, 4294967295), running: running ? 1 : 0,
        x: integer(pose.x, 1000, -100000000, 100000000), z: integer(pose.z, 1000, -100000000, 100000000),
        heading: integer(Math.atan2(Math.sin(pose.yaw), Math.cos(pose.yaw)), 1000, -10000, 10000),
        height: integer(pose.y, 1000, 0, 10000), phase: integer(pose.phase % (Math.PI * 2), 1000, 0, 7000),
        walking: integer((rates[0] + rates[1]) / 2, 1, 0, 10000),
        turning: integer(pose.yawRate * 180 / Math.PI, 1, -10000, 10000), escape: integer(rates[5], 1, 0, 10000)
      };
    }
  };
}
