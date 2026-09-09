/** Official SWC geometry. Coordinates use the same 8 nm space as soma metadata. */
export const SKELETON_SOURCE='https://storage.googleapis.com/flyem-male-cns/v1.0/segmentation/skeletons-malecns/skeletons-swc/';
export function attachAnatomy(neurons,anatomy) {
  return neurons.map(row=>row[6] ? [...row.slice(0,7),row[7]||{positionSource:'soma'}] : anatomy?.positions?.[String(row[0])] ?
    [...row.slice(0,6),anatomy.positions[String(row[0])],{positionSource:'skeleton-centroid'}] :
    [...row.slice(0,7),{positionSource:anatomy?.unresolved?.[String(row[0])]||'not-loaded'}]);
}
export function parseSkeleton(text) {
  const vertices=new Map(),segments=[];
  for(const line of text.split('\n')) {
    if(!line.trim()||line.startsWith('#'))continue;
    const fields=line.trim().split(/\s+/).map(Number);
    if(fields.length!==7 || !fields.every(Number.isFinite))throw Error('Invalid SWC row');
    const[id,,x,y,z,,parent]=fields;
    if(vertices.has(id))throw Error('Duplicate SWC vertex');
    vertices.set(id,{position:[x,y,z],parent});
  }
  for(const vertex of vertices.values())if(vertex.parent!==-1) {
    const parent=vertices.get(vertex.parent);if(!parent)throw Error('Missing SWC parent');
    segments.push([vertex.position,parent.position]);
  }
  return {vertices:vertices.size,segments};
}
export async function fetchSkeleton(bodyId,{signal}={}) {
  if(!/^\d{1,20}$/.test(String(bodyId)))throw Error('Invalid body ID');
  // The JSON download endpoint supplies CORS headers for the same public object.
  const object=encodeURIComponent(`v1.0/segmentation/skeletons-malecns/skeletons-swc/${bodyId}.swc`);
  const response=await fetch(`https://storage.googleapis.com/download/storage/v1/b/flyem-male-cns/o/${object}?alt=media`,{signal,credentials:'omit'});
  if(!response.ok)throw Error(`官方骨架暂不可用（HTTP ${response.status}）`);
  const reader=response.body.getReader(),parts=[];let length=0;
  while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;
    if(length>32*1024*1024){await reader.cancel();throw Error('骨架超过单次显示限制');}parts.push(value);}
  return parseSkeleton(await new Blob(parts).text());
}
