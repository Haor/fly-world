/** Descending flight observations; these populations receive no motor input. */
export function flightPopulations(neurons) {
  const groups={giantFiber:[],forward:[],backwardPrep:[],backwardJump:[],steerLeft:[],steerRight:[],landing:[],muscleLeft:[],muscleRight:[]};
  neurons.forEach((row,i)=>{
    const type=row[1],side=row[3];
    const key={DNp01:'giantFiber',DNp11:'forward',DNp02:'backwardPrep',DNp04:'backwardJump',DNp07:'landing',DNp10:'landing'}[type];
    if(key)groups[key].push(i);
    if(/^(DLMn|DVMn) /.test(type)&&row[2]==='vnc_motor'&&['L','R'].includes(side))groups[side==='L'?'muscleLeft':'muscleRight'].push(i);
    // MaleCNS uses DNg02_a through DNg02_g, not the unsuffixed MANC name.
    if(/^DNg02(?:_[a-g])?$/.test(type)&&['L','R'].includes(side))groups[side==='L'?'steerLeft':'steerRight'].push(i);
  });
  return groups;
}
export class FlightReadout {
  constructor(neurons) {
    this.groups=flightPopulations(neurons);
    this.keys=Object.keys(this.groups);
    this.members=new Map(this.keys.flatMap(key=>this.groups[key].map(i=>[i,key])));
  }
  decode({firing,counts,steps}) {
    const spikes=Object.fromEntries(this.keys.map(key=>[key,0]));
    for(let j=0;j<firing.length;j++){
      const key=this.members.get(firing[j]);if(key)spikes[key]+=counts[j];
    }
    const hz=Object.fromEntries(this.keys.map(key=>[key,this.groups[key].length?spikes[key]*10000/(steps*this.groups[key].length):0]));
    return {spikes,hz};
  }
}
