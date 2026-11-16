import { analyzeGraph } from "./graph-model.js";
import { KINDS, validateNode, upgradeTemplate } from "./node-types.js";
export { KINDS } from "./node-types.js";
const ident=/^[a-zA-Z][a-zA-Z0-9_-]*$/;
const finite=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
export function validateTemplate(raw) {
  const t=upgradeTemplate(raw);
  if (!ident.test(t.id??"") || typeof t.name!=="string" || !t.name.trim() || t.name.length>100) throw new Error("Нужны id на латинице и название до 100 символов");
  if (![t.players?.min,t.players?.max,t.players?.default].every(Number.isInteger) || !finite(t.players.min,3,12) || !finite(t.players.max,t.players.min,12) || !finite(t.players.default,t.players.min,t.players.max)) throw new Error("Диапазон игроков должен быть внутри 3-12");
  if (!Array.isArray(t.nodes)||!t.nodes.length||t.nodes.length>60||!Array.isArray(t.links)||t.links.length>200) throw new Error("Допустимо 1-60 нод и до 200 связей");
  const ids=new Set();
  for (const n of t.nodes) {
    if (!ident.test(n?.id??"")||ids.has(n.id)) throw new Error("Нужны уникальные id нод на латинице");
    ids.add(n.id); validateNode(n);
  }
  if (!t.nodes.some(n=>n.kind==="spawn")) throw new Error("Нужна хотя бы одна стартовая нода spawn");
  analyzeGraph(t); return t;
}
function hash(text) { let h=2166136261; for(const c of text) h=Math.imul(h^c.charCodeAt(0),16777619); return h>>>0; }
function random(seed) { let s=seed>>>0; return()=>{s+=0x6d2b79f5;let n=Math.imul(s^s>>>15,1|s);n^=n+Math.imul(n^n>>>7,61|n);return((n^n>>>14)>>>0)/4294967296;}; }
const add=(a,b)=>a.map((v,i)=>v+b[i]), mul=(a,k)=>a.map(v=>v*k);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=a=>Math.hypot(...a);
const norm=a=>mul(a,1/length(a));
function frame(direction, preferred=[0,0,1]) {
  let forward=add(preferred,mul(direction,-dot(direction,preferred)));
  if(length(forward)<1e-8) forward=cross(direction,Math.abs(direction[0])<0.9?[1,0,0]:[0,1,0]);
  forward=norm(forward);return {forward,right:norm(cross(forward,direction))};
}
function move(direction,basis,distance,bearing) {
  const tangent=add(mul(basis.forward,Math.cos(bearing)),mul(basis.right,Math.sin(bearing)));
  return norm(add(mul(direction,Math.cos(distance)),mul(tangent,Math.sin(distance))));
}
function average(sources) {
  const sum=sources.reduce((v,s)=>add(v,s.direction),[0,0,0]);
  if(length(sum)<1e-7) throw new Error("У симметричных входов нет общего центра. Выберите два направления от кольца входов");
  return norm(sum);
}
export function applyTemplate(raw,{players,seed,metalScale=1}) {
  const template=validateTemplate(raw);
  if(!Number.isInteger(players)||!finite(players,template.players.min,template.players.max)||!Number.isInteger(seed)||!finite(seed,0,4294967295)||!finite(metalScale,.25,3)) throw new Error("Неверные число игроков, seed или множитель металла");
  const rng=random(seed^hash("orientation")), z=rng()*2-1,a=rng()*Math.PI*2;
  const pole=[Math.sqrt(1-z*z)*Math.cos(a),Math.sqrt(1-z*z)*Math.sin(a),z];
  const east=norm(cross(pole,Math.abs(z)<.9?[0,0,1]:[1,0,0])), north=cross(pole,east), phase=rng()*Math.PI*2;
  const rotate=d=>add(add(mul(east,d[0]),mul(north,d[1])),mul(pole,d[2]));
  const graph=analyzeGraph(template),zones=[],links=[],byNode=new Map(template.nodes.map(n=>[n.id,[]])),warnings=[];
  let metalCount=0;
  for(const n of graph.order) {
    const inputs=graph.parents.get(n.id).map(id=>byNode.get(id)).filter(group=>group.length);
    const all=[...new Map(inputs.flat().map(s=>[s.id,s])).values()];
    const bases=[];
    const base=(direction,sources,key,owner)=>({direction,sources,key,owner,basis:frame(direction,sources[0]?.basis.forward??pole)});
    if(n.kind==="spawn") {
      const count=n.count||players;
      for(let i=0;i<count;i++) {
        const phi=phase+n.phase+(hash(n.id)%1000)/1000*Math.PI*2+(n.layout==="sphere"?i*Math.PI*(3-Math.sqrt(5)):i*Math.PI*2/count);
        const lat=n.layout==="sphere"?Math.asin(1-2*(i+.5)/count):n.latitude;
        const d=rotate([Math.cos(phi)*Math.cos(lat),Math.sin(phi)*Math.cos(lat),Math.sin(lat)]);
        const nr=random(seed^hash(n.id+":"+i));
        const dir=move(d,frame(d,pole),n.jitter*Math.sqrt(nr()),nr()*Math.PI*2);
        bases.push(base(dir,[],"spawn:"+i,i));
      }
    } else if(all.length) {
      const mode=n.placement.mode;
      if(mode==="each") for(const s of all) bases.push(base(s.direction,[s],s.id,s.owner));
      if(mode==="centroid") bases.push(base(average(all),all,"center",all.every(s=>s.owner===all[0].owner)?all[0].owner:null));
      if(mode==="between") {
        let groups=[];
        if(inputs.length===1) {
          const ordered=[...all].sort((a,b)=>(a.owner??0)-(b.owner??0)||a.id.localeCompare(b.id));
          if(ordered.length>=2) groups=ordered.map((s,i)=>[s,ordered[(i+1)%ordered.length]]).filter((_,i)=>ordered.length!==2||i===0);
        } else {
          groups=inputs[0].map(first=>{
            const group=[first];
            for(const candidates of inputs.slice(1)) {
              const compatible=n.placement.pairing==="owner"&&first.owner!==null?candidates.filter(s=>s.owner===first.owner):candidates;
              const found=[...compatible].sort((a,b)=>dot(first.direction,b.direction)-dot(first.direction,a.direction)||a.id.localeCompare(b.id))[0];
              if(!found)return null;group.push(found);
            }
            return group;
          }).filter(Boolean);
        }
        for(const ss of groups) {
          // Антиподальные точки задают дугу через локальное направление первого входа.
          const sum=ss.reduce((v,s)=>add(v,s.direction),[0,0,0]);
          const dir=length(sum)>1e-7?norm(sum):ss[0].basis.forward;
          bases.push(base(dir,ss,ss.map(s=>s.id).sort().join("+"),ss.every(s=>s.owner===ss[0].owner)?ss[0].owner:null));
        }
        if(!groups.length)warnings.push(n.name+": недостаточно совместимых входов");
      }
      if(mode==="hubs") {
        const ordered=[...all].sort((a,b)=>(a.owner??0)-(b.owner??0)||a.id.localeCompare(b.id));
        let axis=[0,0,0];
        for(let i=0;i<ordered.length;i++)axis=add(axis,cross(ordered[i].direction,ordered[(i+1)%ordered.length].direction));
        if(length(axis)<1e-7) {
          axis=all.reduce((s,v)=>add(s,v.basis.forward),[0,0,0]);
          if(length(axis)<1e-7)axis=all[0].basis.forward;
        }
        axis=norm(axis);
        const signs=n.placement.side==="positive"?[1]:n.placement.side==="negative"?[-1]:[1,-1];
        for(const sign of signs)bases.push(base(mul(axis,sign),all,"hub:"+sign,null));
      }
    }
    for(const b of bases) {
      // Отдельное зерно экземпляра сохраняет остальные ветви при правке этой ноды.
      const nr=random(seed^hash(n.id+":"+b.key));
      let direction=n.kind==="spawn"?b.direction:move(b.direction,b.basis,n.placement.distance,n.placement.bearing);
      if(n.kind!=="spawn"&&n.placement.jitter)direction=move(direction,frame(direction,b.basis.forward),n.placement.jitter*Math.sqrt(nr()),nr()*Math.PI*2);
      const basis=frame(direction,b.basis.forward);
      const placements=n.kind==="blocker"&&n.pattern==="gate"?Array.from({length:n.chain.count*2},(_,k)=>{
        const side=k<n.chain.count?-1:1;
        return move(direction,basis,n.chain.gap+(k%n.chain.count)*n.chain.step,side*Math.PI/2);
      }):[direction];
      placements.forEach((dir,k)=>{
        if(zones.length>=600)throw new Error("Слишком много областей (максимум 600). Уменьшите число входов или длину цепочек");
        const zone={id:n.id+":"+hash(b.key).toString(36)+":"+k,nodeId:n.id,kind:n.kind,name:n.name,owner:b.owner,direction:dir,basis:frame(dir,basis.forward),radius:n.radius,height:n.height??0,points:[],inputs:b.sources.map(s=>s.id)};
        if(n.kind==="metal") {
          const count=Math.max(1,Math.round(n.spots*metalScale));metalCount+=count;
          if(metalCount>10000)throw new Error("Слишком много точек металла (максимум 10000)");
          const mr=random(seed^hash(zone.id+":metal"));
          for(let j=0;j<count;j++) zone.points.push(move(dir,zone.basis,n.radius*.82*Math.sqrt((j+.5)/count),mr()*Math.PI*2));
        }
        for(const s of b.sources) {
          if(links.length>=4000)throw new Error("Слишком много связей между областями (максимум 4000)");
          links.push({id:s.id+">"+zone.id,from:s.id,to:zone.id,fromNode:s.nodeId,toNode:n.id});
        }
        zones.push(zone);byNode.get(n.id).push(zone);
      });
    }
  }
  return {template,parameters:{players,seed,metalScale},zones,links,debug:{rules:template.nodes.length,inactiveNodes:template.nodes.filter(n=>!byNode.get(n.id).length).map(n=>n.id),zones:zones.length,metal:metalCount,warnings,balance:"Демонстрация структуры; проходимость и баланс не проверяются."}};
}
export function cleanBasePlanet(result,parameters) {
 return {parameters:structuredClone(parameters),postprocessing:{removeCSG:true,removeMetal:true,removeSpawns:true,dry:true},result:{...result,water_radius:null,lava_radius:null,planetCSG:[],landing_zones:[],csg:{brushes:[],skipped:[]},metal:{...result.metal,spots:[],candidates:[],limit_is_random:false}}};
}
