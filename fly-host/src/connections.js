/** Incoming anatomical edges, independent of simulated rates or causal claims. */
export function incomingConnections(graph,bodyId,limit=32) {
  const target=graph.neurons.findIndex(row=>String(row[0])===String(bodyId));
  if(target<0)throw Error('Unknown body ID');
  const items=[];
  for(let e=graph.offsets[target];e<graph.offsets[target+1];e++)items.push({bodyId:String(graph.neurons[graph.sources[e]][0]),weight:graph.counts[e]});
  items.sort((a,b)=>b.weight-a.weight);
  return {type:'connections',bodyId:String(bodyId),direction:'incoming',total:items.length,items:items.slice(0,limit)};
}
