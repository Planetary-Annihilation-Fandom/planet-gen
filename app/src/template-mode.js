import neighbors from "./templates/neighbor_fronts.json";
import shared from "./templates/shared_regions.json";
import { validateTemplate, applyTemplate, cleanBasePlanet } from "./template-engine.js";
import { createTemplateGraph } from "./template-graph.js";
import { iconSVG } from "./icons.js";
import { connectNodes, disconnectNodes } from "./graph-model.js";
import { setupGraphPanel } from "./graph-panel.js";
import { NODE_TYPES, createNode, setField } from "./node-types.js";
import { createNodeInspector } from "./node-inspector.js";
const $=id=>document.getElementById(id), STORAGE="planet-gen.templates.v1";
export function createTemplateMode(scene,toast) {
 let templates=[validateTemplate(neighbors),validateTemplate(shared)],base=null,applied=null,selected=null,active=false,timer;
 const histories=new Map();
 const source={name:"Основа шаблона",planet:{seed:42,radius:500,heightRange:18,waterHeight:0,waterDepth:0,biomeScale:65,temperature:80,metalDensity:0,metalClusters:0,metalSpotLimit:0,biome:"desert",symmetryType:"none",symmetricalMetal:false,mass:10000},planetCSG:[]};
 try {
   const saved=JSON.parse(localStorage.getItem(STORAGE)??"[]");
   if(!Array.isArray(saved)||saved.length>52)throw new Error("Некорректный список шаблонов");
   for(const raw of saved) {
     const t=validateTemplate(raw),i=templates.findIndex(v=>v.id===t.id);
     if(i<0)templates.push(t);else templates[i]=t;
   }
 }catch(e){toast("Сохранённые шаблоны не загружены: "+e.message,true);}
 const template=()=>templates.find(t=>t.id===$("templateSelect").value)??templates[0];
 const params=()=>({players:Number($("players").value),seed:Number($("templateSeed").value),metalScale:Number($("metalScale").value)});
 const safely=fn=>{try{return fn();}catch(e){toast(e.message,true);}};
 const graph=createTemplateGraph($("nodeCanvas"),select,{
   connect:(from,to)=>commit(connectNodes(template(),from,to)),
   remove:(from,to)=>safely(()=>commit(disconnectNodes(template(),from,to))),
   move:(id,canvas)=>safely(()=>{const t=structuredClone(template());t.nodes.find(n=>n.id===id).canvas=canvas;commit(t,{generate:false});}),
   create:(kind,canvas)=>safely(()=>addNode(kind,canvas,false)),
   error:message=>toast(message,true),
 });
 const inspector=createNodeInspector($("nodeFields"),{
   change(id,path,value){const t=structuredClone(template()),n=t.nodes.find(n=>n.id===id);setField(n,path,value);if(path==="pattern"&&value==="gate")n.chain.step=Math.min(n.chain.step,n.radius*1.8);commit(t);},
   remove:id=>safely(()=>{const t=structuredClone(template());t.nodes=t.nodes.filter(n=>n.id!==id);t.links=t.links.filter(l=>l.from!==id&&l.to!==id);commit(t);select(null);}),
   duplicate:id=>safely(()=>{
     const t=structuredClone(template()),original=t.nodes.find(n=>n.id===id),fresh=createNode(original.kind,t.nodes);
     const copy={...structuredClone(original),id:fresh.id,name:(original.name+" копия").slice(0,100),canvas:graph.suggest(id)};
     t.nodes.push(copy);commit(t);select(copy.id);graph.reveal(copy.id);
   }),
 });
 setupGraphPanel($("templateCard"),$("graphSplitter"));
 for(const kind of Object.keys(NODE_TYPES)) {
   $("newNodeType").add(new Option(NODE_TYPES[kind].title,kind));
   const checkbox=document.querySelector('[data-applied-layer="'+kind+'"]');
   if(checkbox){const label=checkbox.closest("label");label.insertBefore(iconSVG(kind),label.childNodes[1]);}
 }
 function history(){if(!histories.has(template().id))histories.set(template().id,{past:[],future:[]});return histories.get(template().id);}
 function updateHistory(){const h=history();$("undoGraph").disabled=!h.past.length;$("redoGraph").disabled=!h.future.length;}
 function save(next){const updated=templates.map(t=>t.id===next.id?next:t);localStorage.setItem(STORAGE,JSON.stringify(updated));templates=updated;}
 function compile(t) {
   try{return applyTemplate(t,params());}
   catch(e){return {template:t,parameters:params(),zones:[],links:[],debug:{rules:t.nodes.length,inactiveNodes:t.nodes.map(n=>n.id),metal:0,warnings:[e.message],error:e.message,balance:"Генерация не выполнена. Исправьте параметры или связи."}};}
 }
 function commit(raw,{generate=true,remember=true}={}) {
   const next=validateTemplate(raw),old=template();
   if(JSON.stringify(old)===JSON.stringify(next))return;
   const nextApplied=generate?compile(next):{...applied,template:next};
   save(next);
   if(remember){const h=history();h.past.push(structuredClone(old));if(h.past.length>50)h.past.shift();h.future=[];}
   if(selected&&!next.nodes.some(n=>n.id===selected))selected=null;
   applied=nextApplied;render(generate);updateHistory();
 }
 function travel(direction) {
   const h=history(),from=direction==="undo"?h.past:h.future,to=direction==="undo"?h.future:h.past;
   if(!from.length)return;
   const old=structuredClone(template());commit(from.at(-1),{remember:false});from.pop();to.push(old);updateHistory();
 }
 function addNode(kind,canvas,attach=true) {
   const t=structuredClone(template()),n=createNode(kind,t.nodes,canvas??graph.suggest(selected));
   t.nodes.push(n);
   if(attach&&selected&&kind!=="spawn")t.links.push({from:selected,to:n.id});
   commit(t);select(n.id);graph.reveal(n.id);
 }
 function fillList(id=templates[0].id){$("templateSelect").replaceChildren(...templates.map(t=>new Option(t.name,t.id)));$("templateSelect").value=id;}
 function syncTemplate(reset=true) {
   const t=template();$("templateDescription").textContent=t.description??"";$("templateId").textContent=t.id;
   $("players").min=t.players.min;$("players").max=t.players.max;
   $("players").value=reset?t.players.default:Math.max(t.players.min,Math.min(t.players.max,Number($("players").value)));
   selected=null;regenerate();updateHistory();
 }
 function layers(){const o={};for(const el of document.querySelectorAll("[data-applied-layer]"))o[el.dataset.appliedLayer]=el.checked;scene.toggleApplied(o);}
 function select(id){
   selected=id;graph.select(id);if(active)scene.selectNode(id);
   const node=applied?.template.nodes.find(n=>n.id===id);
   inspector.show(node,applied?.zones.filter(z=>z.nodeId===id)??[]);
 }
 function render(showPlanet=true) {
   if(base&&active&&showPlanet){applied.result=scene.setApplied(applied,select);layers();}
   graph.show(applied);select(selected);
   $("appliedStats").textContent=applied.parameters.players+" игроков   "+applied.zones.length+" областей   "+applied.debug.metal+" металла";
   const count=applied.debug.inactiveNodes.length;
   $("templateNotice").textContent=(base?applied.debug.balance:"Сгенерируйте основу, чтобы увидеть шаблон.")+(count?" Без результата нод: "+count+".":"")+(applied.debug.warnings.length?" "+applied.debug.warnings.join(". "):"");
   $("exportResult").disabled=!base||!!applied.debug.error;
 }
 function regenerate(){
   clearTimeout(timer);
   try{applied=compile(template());render();}
   catch(e){$("templateNotice").textContent=e.message;}
 }
 function download(name,object){const url=URL.createObjectURL(new Blob([JSON.stringify(object,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function addTemplate(raw) {
   const t=validateTemplate(raw);
   if(templates.some(v=>v.id===t.id))throw new Error("Шаблон "+t.id+" уже существует; используйте другой id");
   if(templates.length>=52)throw new Error("Сохранено слишком много шаблонов");
   const next=[...templates,t];localStorage.setItem(STORAGE,JSON.stringify(next));templates=next;fillList(t.id);syncTemplate();
 }
 fillList();syncTemplate();
 $("templateSelect").onchange=()=>syncTemplate();
 for(const id of ["players","templateSeed","metalScale"])$(id).addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(regenerate,120);});
 $("rerollTemplate").onclick=()=>{$("templateSeed").value=crypto.getRandomValues(new Uint32Array(1))[0];regenerate();};
 $("fitGraph").onclick=graph.fit;$("clearSelection").onclick=()=>select(null);
 $("addNode").onclick=()=>safely(()=>addNode($("newNodeType").value));
 $("arrangeGraph").onclick=()=>safely(()=>{const t=structuredClone(template());for(const n of t.nodes)delete n.canvas;commit(t,{generate:false});graph.fit();});
 $("undoGraph").onclick=()=>safely(()=>travel("undo"));$("redoGraph").onclick=()=>safely(()=>travel("redo"));
 document.addEventListener("keydown",e=>{
   if(!active||e.target.closest("input,select,textarea,[contenteditable=true]"))return;
   if((e.ctrlKey||e.metaKey)&&["z","y"].includes(e.key.toLowerCase())){e.preventDefault();safely(()=>travel(e.key.toLowerCase()==="y"||e.shiftKey?"redo":"undo"));}
   if(e.key==="Delete"&&selected&&!e.target.closest("[data-edge]")){e.preventDefault();$("deleteNode").click();}
 });
 for(const el of document.querySelectorAll("[data-applied-layer]"))el.onchange=layers;
 $("exportTemplate").onclick=()=>download(template().id+".json",template());
 $("exportResult").onclick=()=>download(template().id+"-result.json",{base,applied});
 $("importTemplate").onchange=async e=>{
   const f=e.target.files?.[0];if(!f)return;
   try{if(f.size>256000)throw new Error("JSON должен быть меньше 256 КБ");addTemplate(JSON.parse((await f.text()).replace(/^\uFEFF/,"")));}catch(err){toast(err.message,true);}e.target.value="";
 };
 $("newTemplate").onclick=()=>{$("newTemplateError").textContent="";$("newTemplateDialog").showModal();$("newTemplateId").focus();};
 $("cancelTemplate").onclick=()=>$("newTemplateDialog").close();
 $("newTemplateForm").onsubmit=e=>{
   e.preventDefault();
   try {
     const t=$("newTemplateMode").value==="copy"?structuredClone(template()):{version:2,players:{min:3,max:12,default:4},nodes:[{...createNode("spawn"),id:"starts"}],links:[]};
     t.id=$("newTemplateId").value.trim();t.name=$("newTemplateName").value.trim();
     addTemplate(t);$("newTemplateDialog").close();
   }catch(err){$("newTemplateError").textContent=err.message;}
 };
 return {source,
   enter(){active=true;regenerate();},
   leave(){active=false;clearTimeout(timer);scene.setApplied(null);},
   async accept(result,parameters){base=cleanBasePlanet(result,parameters);source.planet={...parameters};await scene.show(base.result,{template:true});regenerate();return base.result;},
   async restore(){if(base){await scene.show(base.result,{template:true});regenerate();return base.result;}return null;},
 };
}
