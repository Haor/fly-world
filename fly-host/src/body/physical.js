import * as THREE from 'three';
/** Render MuJoCo rigid-body transforms; no gait or wing animation policy. */
export class PhysicalBodyView {
  constructor(scene,definition) {
    if(definition?.encoding!=='flybody-mujoco/1'||!Number.isInteger(definition.bodies)||definition.bodies<1||definition.bodies>256||!Array.isArray(definition.geoms)||definition.geoms.length>512)throw Error('Invalid physical body definition');
    this.group=new THREE.Group();this.bodies=Array.from({length:definition.bodies},()=>new THREE.Group());
    this.bodies.forEach(body=>this.group.add(body));this.geometry=[];this.materials=[];
    let vertices=0;
    for(const item of definition.geoms) {
      if(!Number.isInteger(item.body)||!this.bodies[item.body]||!Array.isArray(item.vertices)||item.vertices.length%3||!Array.isArray(item.indices)||item.indices.length%3||!item.vertices.every(Number.isFinite)||item.indices.some(i=>!Number.isInteger(i)||i<0||i>=item.vertices.length/3))throw Error('Invalid physical mesh');
      vertices+=item.vertices.length;if(vertices>3000000)throw Error('Physical body mesh too large');
      if(item.position?.length!==3||!item.position.every(Number.isFinite)||item.quaternion?.length!==4||!item.quaternion.every(Number.isFinite)||item.rgba?.length!==4||!item.rgba.every(x=>Number.isFinite(x)&&x>=0&&x<=1))throw Error('Invalid physical material');
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(item.vertices,3));geometry.setIndex(item.indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
      const material=new THREE.MeshStandardMaterial({color:new THREE.Color(...item.rgba.slice(0,3)),roughness:.55,metalness:.08,transparent:item.rgba[3]<1,opacity:item.rgba[3],side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(geometry,material);mesh.position.fromArray(item.position);const [w,x,y,z]=item.quaternion;mesh.quaternion.set(x,y,z,w);mesh.castShadow=true;mesh.receiveShadow=true;
      this.bodies[item.body].add(mesh);this.geometry.push(geometry);this.materials.push(material);
    }
    scene.add(this.group);this.group.visible=false;
    this.a=new THREE.Quaternion();this.b=new THREE.Quaternion();
  }
  update(previous,next,fraction) {
    if(!Array.isArray(next)||next.length!==this.bodies.length)throw Error('Invalid rigid body frame');
    this.group.visible=true;
    for(let i=0;i<next.length;i++){
      const p=previous?.[i]||next[i],q=next[i],body=this.bodies[i];
      body.position.set(p[0]+(q[0]-p[0])*fraction,p[1]+(q[1]-p[1])*fraction,p[2]+(q[2]-p[2])*fraction+1.32);
      this.a.set(p[4],p[5],p[6],p[3]);this.b.set(q[4],q[5],q[6],q[3]);body.quaternion.copy(this.a).slerp(this.b,fraction);
    }
  }
  dispose(){this.group.removeFromParent();this.geometry.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());}
}
