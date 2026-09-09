/** Authored transduction of local light into bilateral early-visual input. */
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
export function sensoryGain(value, gain = 1) {
  // Saturation prevents a brighter lamp from creating an unbounded neural drive.
  const intensity = Math.max(0, value);
  return 80 * clamp(gain, 0, 3) * intensity / (intensity + .5);
}
export function lightSamples(pose, {light = 1, lightAngle = 0}, rock, occlusion = 0) {
  const angle = lightAngle * Math.PI / 180;
  const lamp = {x: 18 * Math.sin(angle), z: 18 * Math.cos(angle)};
  const dx = lamp.x - pose.x, dz = lamp.z - pose.z;
  const distance = Math.max(.1, Math.hypot(dx, dz));
  const toRockX = rock.x - pose.x, toRockZ = rock.z - pose.z;
  const along = (toRockX * dx + toRockZ * dz) / distance;
  const cross = Math.abs(toRockX * dz - toRockZ * dx) / distance;
  const visibility = along > 0 && along < distance && cross < rock.radius ? .15 : 1;
  const local = Math.max(0, light) * visibility / (1 + (distance / 20) ** 2) * (1 - clamp(occlusion, 0, 1));
  const bearing = Math.atan2(dx, dz) - pose.yaw;
  return {left: local * (.15 + .85 * Math.max(0, Math.cos(bearing - Math.PI / 4))),
    right: local * (.15 + .85 * Math.max(0, Math.cos(bearing + Math.PI / 4)))};
}
