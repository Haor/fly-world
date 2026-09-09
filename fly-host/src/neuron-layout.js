/** Real anatomical positions only. Missing geometry is reported, never placed in a fake grid. */
export function fullLayout(neurons,width,height) {
  const located=neurons.map((r,i)=>({i,p:r[6]})).filter(({p})=>p && p.length===3 && p.every(Number.isFinite));
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const {p} of located){minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minZ=Math.min(minZ,p[2]);maxZ=Math.max(maxZ,p[2]);}
  const scale=Math.min(Math.max(1,width-24)/Math.max(1,maxX-minX),Math.max(1,height-40)/Math.max(1,maxZ-minZ));
  const project=p=>({x:width/2-(p[0]-(minX+maxX)/2)*scale,y:height/2+(p[2]-(minZ+maxZ)/2)*scale});
  return {points:located.map(({i,p})=>({i,...project(p),located:true})),unlocated:neurons.length-located.length,project};
}
