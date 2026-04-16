// src/dashboard/server.ts — Real-time Web Dashboard with WebSocket
// v5.0.1 — Infinite Intelligence Edition
// 8-panel layout: Health, Insights, AI Tools, Memory Tiers, Modules, Fixes, Controls, Activity

import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Orchestrator } from '../brain/orchestrator.js';
import { BrainInsight } from '../types.js';

export interface DashboardOptions {
  port?: number;
  host?: string;
  openBrowser?: boolean;
}

// ── Embedded HTML Client ──────────────────────────────────────────────────────
const HTML_CLIENT = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Shadow Brain v5.0.1 — Dashboard</title>
<style>
  :root {
    --bg:#0a0e14;--bg2:#131820;--bg3:#1a2030;--bg4:#232d3f;
    --border:#2a3550;--text:#d4dce8;--text2:#6b7d99;
    --green:#00e676;--yellow:#ffca28;--red:#ff5252;
    --blue:#42a5f5;--purple:#b388ff;--orange:#ffab40;
    --cyan:#18ffff;--pink:#ff4081;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,-apple-system,monospace;font-size:13px;height:100vh;overflow:hidden;display:flex;flex-direction:column}

  /* Header */
  header{background:linear-gradient(180deg,var(--bg2),var(--bg));border-bottom:1px solid var(--border);padding:10px 20px;display:flex;align-items:center;gap:12px;flex-shrink:0}
  header h1{font-size:16px;font-weight:800;letter-spacing:-.5px}
  header h1 .v{color:var(--cyan);font-size:11px;font-weight:500;margin-left:4px}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--red);transition:.3s}
  .dot.on{background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
  .pill{background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:2px 10px;font-size:11px;color:var(--text2)}
  .pill.score{font-weight:700;border-color:var(--green);color:var(--green)}
  .pill.grade{font-weight:800}
  .pill.gA{color:var(--green);border-color:var(--green)}
  .pill.gB{color:var(--yellow);border-color:var(--yellow)}
  .pill.gC{color:var(--orange);border-color:var(--orange)}
  .pill.gD,.pill.gF{color:var(--red);border-color:var(--red)}
  .trend{font-size:14px}
  .trend.up{color:var(--green)}.trend.down{color:var(--red)}.trend.flat{color:var(--text2)}
  .controls{margin-left:auto;display:flex;gap:6px}
  .btn{background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:4px 12px;font-size:11px;color:var(--text);cursor:pointer;transition:.2s;font-weight:600}
  .btn:hover{background:var(--bg4);border-color:var(--blue)}
  .btn.danger{color:var(--red);border-color:var(--red)}
  .btn.danger:hover{background:rgba(255,82,82,.15)}
  .btn.primary{color:var(--green);border-color:var(--green)}
  .btn.primary:hover{background:rgba(0,230,118,.15)}

  /* Layout */
  .grid{display:grid;grid-template-columns:280px 1fr 280px;grid-template-rows:auto 1fr 1fr;gap:1px;background:var(--border);flex:1;overflow:hidden}
  .pnl{background:var(--bg);overflow:hidden;display:flex;flex-direction:column}
  .pnl-h{background:var(--bg2);padding:7px 12px;font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
  .pnl-b{flex:1;overflow-y:auto;padding:8px}
  .pnl-b::-webkit-scrollbar{width:3px}.pnl-b::-webkit-scrollbar-thumb{background:var(--border)}
  .cnt{background:var(--bg4);border-radius:10px;padding:1px 7px;font-size:10px;color:var(--text2)}

  /* Row 1: top bar */
  .topbar{grid-column:1/-1;background:var(--bg2);padding:6px 14px;display:flex;gap:16px;align-items:center;flex-shrink:0;overflow-x:auto}
  .stat{display:flex;flex-direction:column;align-items:center;min-width:80px}
  .stat .val{font-size:20px;font-weight:900;line-height:1}
  .stat .lbl{font-size:9px;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-top:2px}

  /* Health */
  .health-big{text-align:center;padding:12px;background:var(--bg2);border-radius:8px;border:1px solid var(--border);margin-bottom:10px}
  .health-big .num{font-size:48px;font-weight:900;line-height:1}
  .health-big .lbl{font-size:11px;color:var(--text2);margin-top:3px}
  .dim{background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:8px;margin-bottom:6px}
  .dim .name{font-size:10px;color:var(--text2);margin-bottom:4px}
  .dim .bw{background:var(--bg4);border-radius:3px;height:5px;overflow:hidden;margin-bottom:3px}
  .dim .bf{height:100%;border-radius:3px;transition:width .6s}
  .dim .sv{font-size:12px;font-weight:700}

  /* AI Tools */
  .tool{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:5px;margin-bottom:4px;background:var(--bg2);border:1px solid var(--border)}
  .tool .icon{font-size:16px;width:24px;text-align:center}
  .tool .info{flex:1;min-width:0}
  .tool .tname{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tool .tstat{font-size:10px;color:var(--text2)}
  .tool .tdot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
  .tool .tdot.active{background:var(--green)}.tool .tdot.inactive{background:var(--text2)}.tool .tdot.error{background:var(--red)}

  /* Memory tiers */
  .tier{background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:8px;margin-bottom:5px}
  .tier .th{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
  .tier .tname{font-size:11px;font-weight:600}
  .tier .tcount{font-size:11px;font-weight:700;color:var(--cyan)}
  .tier .bw{background:var(--bg4);border-radius:3px;height:4px;overflow:hidden;margin-bottom:3px}
  .tier .bf{height:100%;border-radius:3px;transition:width .5s}
  .tier .tmeta{font-size:9px;color:var(--text2)}
  .tier.t0 .tname{color:var(--green)}.tier.t1 .tname{color:var(--blue)}.tier.t2 .tname{color:var(--purple)}.tier.t3 .tname{color:var(--orange)}

  /* Modules */
  .mod{display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:4px;margin-bottom:3px;background:var(--bg2);border:1px solid var(--border);font-size:11px}
  .mod .mdot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
  .mod .mdot.active{background:var(--green)}.mod .mdot.idle{background:var(--text2)}.mod .mdot.error{background:var(--red)}
  .mod .mname{flex:1;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mod .mstat{font-size:9px;color:var(--text2);flex-shrink:0}

  /* Insights */
  .ins{background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:8px 10px;margin-bottom:6px;border-left:3px solid var(--border);animation:fadeIn .25s}
  @keyframes fadeIn{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
  .ins.critical{border-left-color:var(--red)}.ins.high{border-left-color:var(--orange)}.ins.medium{border-left-color:var(--yellow)}.ins.low{border-left-color:var(--text2)}
  .ins-t{font-weight:600;font-size:12px;margin-bottom:2px}
  .ins-m{font-size:10px;color:var(--text2);display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px}
  .ins-c{font-size:11px;color:var(--text2);line-height:1.45}
  .tag{background:var(--bg4);border-radius:8px;padding:1px 6px;font-size:9px}
  .tag.critical{background:rgba(255,82,82,.15);color:var(--red)}
  .tag.high{background:rgba(255,171,64,.15);color:var(--orange)}
  .tag.medium{background:rgba(255,202,40,.15);color:var(--yellow)}
  .tag.low{background:rgba(107,125,153,.15);color:var(--text2)}
  .tag.security{background:rgba(255,82,82,.12);color:var(--red)}
  .tag.performance{background:rgba(24,255,255,.12);color:var(--cyan)}
  .tag.quality{background:rgba(66,165,245,.12);color:var(--blue)}

  /* Fixes */
  .fix{background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:8px 10px;margin-bottom:6px;animation:fadeIn .25s}
  .fix-t{font-weight:600;font-size:12px;margin-bottom:4px}
  .fix-f{font-size:10px;color:var(--text2);margin-bottom:6px}
  .cb{background:var(--bg4);border:1px solid var(--border);border-radius:3px;padding:6px 8px;font-family:'Cascadia Code','Fira Code',monospace;font-size:10px;line-height:1.5;overflow-x:auto}
  .cb.bef{border-left:3px solid var(--red)}.cb.aft{border-left:3px solid var(--green)}
  .fl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}
  .fl.bef{color:var(--red)}.fl.aft{color:var(--green)}
  .fix-x{font-size:10px;color:var(--text2);margin-top:6px;line-height:1.4}

  /* Log */
  .log{font-family:monospace;font-size:11px;padding:2px 0;border-bottom:1px solid var(--bg2);display:flex;gap:8px}
  .log-t{color:var(--text2);flex-shrink:0;font-size:10px}
  .log-m{flex:1;word-break:break-all}
  .log-m.info{color:var(--blue)}.log-m.success{color:var(--green)}.log-m.warning{color:var(--yellow)}.log-m.error{color:var(--red)}

  .empty{text-align:center;color:var(--text2);padding:30px 16px;font-size:12px}
  .empty .ic{font-size:28px;margin-bottom:8px}
  .spin{display:inline-block;animation:spin 1s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<header>
  <div class="dot" id="dot"></div>
  <h1>\u{1F9E0} Shadow Brain <span class="v">v5.0.1</span></h1>
  <span class="pill score" id="pScore">\u2014/100</span>
  <span class="pill grade" id="pGrade">\u2014</span>
  <span class="trend flat" id="pTrend">\u2192</span>
  <span class="pill" id="pAgents">No agents</span>
  <span class="pill" id="pModules" style="color:var(--cyan)">0 modules</span>
  <div class="controls">
    <button class="btn primary" id="btnAnalyze" onclick="triggerAnalysis()">Analyze</button>
    <button class="btn" id="btnRefresh" onclick="refreshAll()">Refresh</button>
  </div>
</header>

<div class="grid">
  <!-- Row 1: stats bar -->
  <div class="topbar">
    <div class="stat"><div class="val" id="sInsights" style="color:var(--blue)">0</div><div class="lbl">Insights</div></div>
    <div class="stat"><div class="val" id="sFixes" style="color:var(--green)">0</div><div class="lbl">Fixes</div></div>
    <div class="stat"><div class="val" id="sMemory" style="color:var(--purple)">0</div><div class="lbl">Memory KB</div></div>
    <div class="stat"><div class="val" id="sModules" style="color:var(--cyan)">0</div><div class="lbl">Modules</div></div>
    <div class="stat"><div class="val" id="sTools" style="color:var(--orange)">0</div><div class="lbl">AI Tools</div></div>
    <div class="stat"><div class="val" id="sEvol" style="color:var(--pink)">0</div><div class="lbl">Evolution Gen</div></div>
    <div class="stat"><div class="val" id="sSwarm" style="color:var(--yellow)">0%</div><div class="lbl">Swarm Conv</div></div>
    <div class="stat"><div class="val" id="sTurbo" style="color:var(--green)">0x</div><div class="lbl">Turbo Comp</div></div>
    <span style="flex:1"></span>
    <span style="font-size:10px;color:var(--text2)" id="pProject">Connecting\u2026</span>
  </div>

  <!-- Col 1: Health + Memory -->
  <div class="pnl" style="grid-row:2/4">
    <div class="pnl-h">\u2B22 Health Score</div>
    <div class="pnl-b" id="healthPnl"><div class="empty"><div class="ic"><span class="spin">\u27F3</span></div>Waiting\u2026</div></div>
    <div class="pnl-h">\u{1F4BE} Memory Tiers</div>
    <div class="pnl-b" id="memoryPnl"><div class="empty"><div class="ic">\u{1F4BE}</div>No memory data</div></div>
  </div>

  <!-- Col 2: Insights + Fixes -->
  <div class="pnl" style="grid-row:2">
    <div class="pnl-h">\u{1F4A1} Live Insights <span class="cnt" id="iCnt">0</span></div>
    <div class="pnl-b" id="insPnl"><div class="empty"><div class="ic">\u{1F4A1}</div>Insights will appear\u2026</div></div>
  </div>
  <div class="pnl" style="grid-row:3">
    <div class="pnl-h">\u{1F527} Smart Fixes <span class="cnt" id="fCnt">0</span></div>
    <div class="pnl-b" id="fixPnl"><div class="empty"><div class="ic">\u{1F527}</div>Fix suggestions\u2026</div></div>
  </div>

  <!-- Col 3: AI Tools + Modules + Log -->
  <div class="pnl" style="grid-row:2">
    <div class="pnl-h">\u{1F916} AI Tools</div>
    <div class="pnl-b" id="toolsPnl"><div class="empty"><div class="ic">\u{1F916}</div>Detecting tools\u2026</div></div>
  </div>
  <div class="pnl" style="grid-row:3">
    <div class="pnl-h">\u2699 Brain Modules</div>
    <div class="pnl-b" id="modPnl"><div class="empty"><div class="ic">\u2699</div>Loading modules\u2026</div></div>
  </div>
</div>

<script>
const MAX_INS=50,MAX_LOG=80;
let insCnt=0,fixCnt=0,allIns=[];

const $=id=>document.getElementById(id);
const dot=$('dot'),pScore=$('pScore'),pGrade=$('pGrade'),pTrend=$('pTrend');
const pAgents=$('pAgents'),pModules=$('pModules'),pProject=$('pProject');
const healthPnl=$('healthPnl'),memoryPnl=$('memoryPnl');
const insPnl=$('insPnl'),fixPnl=$('fixPnl');
const toolsPnl=$('toolsPnl'),modPnl=$('modPnl');

function ts(){return new Date().toLocaleTimeString('en-US',{hour12:false})}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function sc(v){return v>=85?'var(--green)':v>=70?'var(--yellow)':v>=50?'var(--orange)':'var(--red)'}

// Log to insights panel feedback via activity
function logActivity(msg,type){
  // We no longer have a dedicated log panel, so we use a minimal approach
}

function renderHealth(s){
  if(!s)return;
  const c=sc(s.overall);
  const ti=s.trend==='improving'?'\u2191':s.trend==='declining'?'\u2193':'\u2192';
  const tc=s.trend==='improving'?'up':s.trend==='declining'?'down':'flat';
  pScore.textContent=s.overall+'/100';pScore.style.color=c;pScore.style.borderColor=c;
  pGrade.textContent=s.grade;
  const gc=s.grade.replace('+','').charAt(0);
  pGrade.className='pill grade g'+gc;
  pTrend.textContent=ti;pTrend.className='trend '+tc;
  const dh=s.dimensions.map(d=>{
    const col=sc(d.score);
    const det=d.details.map(x=>'<div style="font-size:9px;color:var(--text2);margin-top:1px">\u2022 '+esc(x)+'</div>').join('');
    return '<div class="dim"><div class="name">'+esc(d.name)+'</div><div class="bw"><div class="bf" style="width:'+d.score+'%;background:'+col+'"></div></div><div class="sv" style="color:'+col+'">'+d.score+'%</div>'+det+'</div>';
  }).join('');
  const ti2=s.topIssues.length>0?'<div style="margin-top:8px;padding:6px;background:var(--bg2);border-radius:5px;border:1px solid var(--border)"><div style="font-size:10px;color:var(--red);font-weight:700;margin-bottom:4px">\u{1F525} Top Issues</div>'+s.topIssues.map(i=>'<div style="font-size:10px;color:var(--text2);margin-bottom:2px">\u2022 '+esc(i)+'</div>').join('')+'</div>':'';
  healthPnl.innerHTML='<div class="health-big"><div class="num" style="color:'+c+'">'+s.overall+'</div><div class="lbl">Health / 100 \u2014 Grade '+s.grade+' '+ti+'</div></div>'+dh+ti2;
}

function renderMemory(mem){
  if(!mem)return;
  const tiers=[
    {key:'raw',name:'Raw',cls:'t0',color:'var(--green)',desc:'Full content'},
    {key:'summary',name:'Summary',cls:'t1',color:'var(--blue)',desc:'Compressed summary'},
    {key:'pattern',name:'Pattern',cls:'t2',color:'var(--purple)',desc:'Extracted patterns'},
    {key:'principle',name:'Principle',cls:'t3',color:'var(--orange)',desc:'Core principles'},
  ];
  const max=Math.max(1,...tiers.map(t=>mem[t.key]||0));
  let html='';
  let total=0;
  for(const t of tiers){
    const v=mem[t.key]||0;total+=v;
    const pct=max>0?Math.round(v/max*100):0;
    html+='<div class="tier '+t.cls+'"><div class="th"><span class="tname">'+t.name+'</span><span class="tcount">'+v+'</span></div><div class="bw"><div class="bf" style="width:'+pct+'%;background:'+t.color+'"></div></div><div class="tmeta">'+t.desc+'</div></div>';
  }
  const turbo=mem.turboCompression||0;
  const turboLine=turbo>0?'<div style="margin-top:6px;padding:6px;background:var(--bg2);border-radius:5px;border:1px solid var(--border);font-size:10px;color:var(--cyan)">\u26A1 TurboQuant compression: '+turbo+'x &mdash; '+total+' total entries</div>':'<div style="margin-top:6px;font-size:10px;color:var(--text2);text-align:center">'+total+' total memory entries</div>';
  memoryPnl.innerHTML=html+turboLine;
  $('sMemory').textContent=Math.round(total/10);
}

function renderTools(tools){
  if(!tools||!tools.length){
    toolsPnl.innerHTML='<div class="empty"><div class="ic">\u{1F916}</div>No AI tools detected</div>';
    $('sTools').textContent='0';
    return;
  }
  const icons={claude_code:'\u{1F9E0}',cursor:'\u2702\uFE0F',kilo_code:'\u2699\uFE0F',cline:'\u{1F4BB}',opencode:'\u{1F517}',codex:'\u{1F4DA}',roo:'\u{1F418}',aider:'\u{1F91D}'};
  toolsPnl.innerHTML=tools.map(t=>{
    const ic=icons[t.id]||'\u{1F916}';
    const cls=t.connected?'active':t.detected?'inactive':'error';
    const label=t.connected?'Connected':t.detected?'Detected':'Not found';
    return '<div class="tool"><div class="icon">'+ic+'</div><div class="info"><div class="tname">'+esc(t.name)+'</div><div class="tstat">'+label+(t.version?' v'+t.version:'')+'</div></div><div class="tdot '+cls+'"></div></div>';
  }).join('');
  $('sTools').textContent=tools.length;
}

function renderModules(mods){
  if(!mods||!mods.length){
    modPnl.innerHTML='<div class="empty"><div class="ic">\u2699</div>No module data</div>';
    return;
  }
  modPnl.innerHTML=mods.map(m=>{
    const cls=m.active?'active':m.error?'error':'idle';
    const label=m.active?'Active':m.error?'Error':'Idle';
    const extra=m.stats?' ('+m.stats+')':'';
    return '<div class="mod"><div class="mdot '+cls+'"></div><span class="mname">'+esc(m.name)+'</span><span class="mstat">'+label+extra+'</span></div>';
  }).join('');
  const active=mods.filter(m=>m.active).length;
  pModules.textContent=active+'/'+mods.length+' modules';
  $('sModules').textContent=active;
}

function ptag(p){return '<span class="tag '+p+'">'+p.toUpperCase()+'</span>'}
function ttag(t){const c={warning:'var(--red)',suggestion:'var(--blue)',review:'var(--purple)',insight:'var(--cyan)'};return '<span class="tag" style="color:'+(c[t]||'var(--text2)')+'">'+t+'</span>'}

function renderIns(ins){
  const files=(ins.files||[]).map(f=>'<code style="font-size:9px;background:var(--bg4);padding:1px 4px;border-radius:2px">'+esc(f)+'</code>').join(' ');
  return '<div class="ins '+ins.priority+'"><div class="ins-t">'+esc(ins.title)+'</div><div class="ins-m">'+ptag(ins.priority)+' '+ttag(ins.type)+' '+files+'</div><div class="ins-c">'+esc(ins.content)+'</div></div>';
}

function addInsights(ins){
  if(!ins||!ins.length)return;
  if(insPnl.querySelector('.empty'))insPnl.innerHTML='';
  allIns=[...ins,...allIns].slice(0,MAX_INS);
  insPnl.innerHTML=allIns.map(renderIns).join('');
  insCnt+=ins.length;
  $('iCnt').textContent=insCnt;
  $('sInsights').textContent=insCnt;
}

function renderFixes(fixes){
  if(!fixes||!fixes.length)return;
  if(fixPnl.querySelector('.empty'))fixPnl.innerHTML='';
  fixPnl.innerHTML=fixes.map(f=>'<div class="fix"><div class="fix-t">'+esc(f.issue)+'</div><div class="fix-f">\u{1F4C4} '+esc(f.file)+' &nbsp;<span class="tag">'+f.confidence+'</span></div><div class="fl bef">Before</div><pre class="cb bef">'+esc(f.before)+'</pre><div class="fl aft" style="margin-top:6px">After</div><pre class="cb aft">'+esc(f.after)+'</pre><div class="fix-x">\u{1F4A1} '+esc(f.explanation)+'</div></div>').join('');
  fixCnt=fixes.length;
  $('fCnt').textContent=fixCnt;
  $('sFixes').textContent=fixCnt;
}

function triggerAnalysis(){
  fetch('/api/trigger-analysis',{method:'POST'}).then(r=>r.json()).then(d=>{
    // acknowledged
  }).catch(()=>{});
}

function refreshAll(){
  fetch('/api/status').then(r=>r.json()).then(d=>{
    if(d.agents)pAgents.textContent=d.agents.join(', ');
    if(d.projectDir)pProject.textContent=d.projectDir;
    if(d.turboMemoryStats){
      const ts=d.turboMemoryStats;
      $('sTurbo').textContent=(ts.compressionRatio||0).toFixed(1)+'x';
    }
    if(d.evolutionGeneration!==undefined)$('sEvol').textContent=d.evolutionGeneration;
    if(d.swarmConvergence!==undefined)$('sSwarm').textContent=Math.round(d.swarmConvergence*100)+'%';
  }).catch(()=>{});
  fetch('/api/modules').then(r=>r.json()).then(renderModules).catch(()=>{});
  fetch('/api/memory').then(r=>r.json()).then(renderMemory).catch(()=>{});
  fetch('/api/tools').then(r=>r.json()).then(renderTools).catch(()=>{});
}

function connect(){
  const proto=location.protocol==='https:'?'wss:':'ws:';
  const ws=new WebSocket(proto+'//'+location.host);
  ws.onopen=()=>{dot.classList.add('on');refreshAll()};
  ws.onclose=()=>{dot.classList.remove('on');setTimeout(connect,3000)};
  ws.onerror=()=>{};
  ws.onmessage=ev=>{
    let m;try{m=JSON.parse(ev.data)}catch{return}
    switch(m.type){
      case 'init':
        if(m.projectDir)pProject.textContent=m.projectDir;
        if(m.agents&&m.agents.length)pAgents.textContent=m.agents.join(', ');
        break;
      case 'agents-detected':
        if(m.agents&&m.agents.length)pAgents.textContent=m.agents.join(', ');
        break;
      case 'analysis-start':break;
      case 'insights':addInsights(m.insights);break;
      case 'health-score':renderHealth(m.score);break;
      case 'fixes':renderFixes(m.fixes);break;
      case 'injection':break;
      case 'modules':renderModules(m.modules);break;
      case 'memory':renderMemory(m.memory);break;
      case 'tools':renderTools(m.tools);break;
      case 'stats':
        if(m.turboCompression)$('sTurbo').textContent=m.turboCompression.toFixed(1)+'x';
        if(m.evolutionGen!==undefined)$('sEvol').textContent=m.evolutionGen;
        if(m.swarmConv!==undefined)$('sSwarm').textContent=Math.round(m.swarmConv*100)+'%';
        break;
      case 'info':break;
      case 'error':break;
    }
  };
}
connect();
</script>
</body>
</html>`;

// ── Dashboard Server ──────────────────────────────────────────────────────────
export class DashboardServer {
  private server: http.Server;
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private orchestrator: Orchestrator;
  private options: Required<DashboardOptions>;

  constructor(orchestrator: Orchestrator, options: DashboardOptions = {}) {
    this.orchestrator = orchestrator;
    this.options = {
      port: options.port ?? 7341,
      host: options.host ?? 'localhost',
      openBrowser: options.openBrowser ?? false,
    };

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.wss = new WebSocketServer({ server: this.server });
    this.setupWebSocket();
    this.subscribeToOrchestrator();
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url || '/';
    const send = (data: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data, null, 2));
    };

    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(HTML_CLIENT);
    } else if (url === '/api/status') {
      send(this.orchestrator.getStatus());
    } else if (url === '/api/health') {
      send(this.orchestrator.getLastHealthScore());
    } else if (url === '/api/fixes') {
      send(this.orchestrator.getLastFixes());
    } else if (url === '/api/modules') {
      send(this.getModulesData());
    } else if (url === '/api/memory') {
      send(this.getMemoryData());
    } else if (url === '/api/tools') {
      send(this.getToolsData());
    } else if (url === '/api/trigger-analysis' && req.method === 'POST') {
      // Trigger a fresh analysis
      this.orchestrator.reviewOnce().then(() => {
        send({ triggered: true });
      }).catch((err: Error) => {
        send({ triggered: false, error: err.message }, 500);
      });
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  }

  private getModulesData(): Array<{ name: string; active: boolean; error: boolean; stats?: string }> {
    const status = this.orchestrator.getStatus() as Record<string, unknown>;
    const modules: Array<{ name: string; active: boolean; error: boolean; stats?: string }> = [];

    const moduleList = [
      'hierarchicalMemory', 'patternMemory', 'learningEngine', 'neuralMesh',
      'consensusState', 'recallState', 'collectiveRules', 'turboMemory',
      'knowledgeGraph', 'swarmState', 'evolutionState', 'adversarialDefense',
      'crossAgentProtocol',
    ];

    const moduleNames: Record<string, string> = {
      hierarchicalMemory: 'Hierarchical Memory (4-tier)',
      patternMemory: 'Pattern Memory',
      learningEngine: 'Learning Engine',
      neuralMesh: 'Neural Mesh (SSSP)',
      consensusState: 'Consensus Protocol',
      recallState: 'Context Recall',
      collectiveRules: 'Collective Learning',
      turboMemory: 'TurboQuant Memory',
      knowledgeGraph: 'Knowledge Graph (PageRank)',
      swarmState: 'Swarm Intelligence (ACO)',
      evolutionState: 'Self-Evolution (Genetic)',
      adversarialDefense: 'Adversarial Defense',
      crossAgentProtocol: 'Cross-Agent (CAIP)',
    };

    for (const key of moduleList) {
      const active = status[key] !== null && status[key] !== undefined;
      let stats: string | undefined;
      const val = status[key] as Record<string, unknown> | undefined;
      if (val && typeof val === 'object') {
        if (typeof val.count === 'number') stats = String(val.count) + ' entries';
        else if (typeof val.size === 'number') stats = String(val.size) + ' items';
        else if (typeof val.entityCount === 'number') stats = String(val.entityCount) + ' entities';
      }
      modules.push({
        name: moduleNames[key] || key,
        active,
        error: false,
        stats,
      });
    }

    return modules;
  }

  private getMemoryData(): Record<string, unknown> {
    try {
      const status = this.orchestrator.getStatus() as Record<string, unknown>;
      const hm = status.hierarchicalMemory as Record<string, unknown> | undefined;
      return {
        raw: hm?.rawCount ?? 0,
        summary: hm?.summaryCount ?? 0,
        pattern: hm?.patternCount ?? 0,
        principle: hm?.principleCount ?? 0,
        turboCompression: (status.turboMemoryStats as Record<string, unknown>)?.compressionRatio ?? 0,
      };
    } catch {
      return { raw: 0, summary: 0, pattern: 0, principle: 0, turboCompression: 0 };
    }
  }

  private getToolsData(): Array<{ id: string; name: string; connected: boolean; detected: boolean; version?: string }> {
    try {
      const status = this.orchestrator.getStatus() as Record<string, unknown>;
      const agents = (status.agents as string[]) || [];
      const knownTools = [
        { id: 'claude_code', name: 'Claude Code', configDir: '.claude' },
        { id: 'cursor', name: 'Cursor', configDir: '.cursor' },
        { id: 'kilo_code', name: 'Kilo Code', configDir: '.kilocode' },
        { id: 'cline', name: 'Cline', configDir: '.cline' },
        { id: 'opencode', name: 'OpenCode', configDir: '.opencode' },
        { id: 'codex', name: 'Codex', configDir: '.codex' },
        { id: 'roo', name: 'Roo Code', configDir: '.roo' },
        { id: 'aider', name: 'Aider', configDir: '.aider' },
      ];

      return knownTools.map(t => ({
        id: t.id,
        name: t.name,
        connected: agents.some(a => a.toLowerCase().includes(t.name.toLowerCase())),
        detected: agents.some(a => a.toLowerCase().includes(t.name.toLowerCase())),
      }));
    } catch {
      return [];
    }
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      const status = this.orchestrator.getStatus() as Record<string, unknown>;
      this.send(ws, {
        type: 'init',
        projectDir: status.projectDir,
        agents: status.agents,
        personality: status.personality,
        provider: status.provider,
        model: status.model,
      });

      const health = this.orchestrator.getLastHealthScore();
      if (health) this.send(ws, { type: 'health-score', score: health });

      const fixes = this.orchestrator.getLastFixes();
      if (fixes.length > 0) this.send(ws, { type: 'fixes', fixes });

      // Send module/memory/tools data
      this.send(ws, { type: 'modules', modules: this.getModulesData() });
      this.send(ws, { type: 'memory', memory: this.getMemoryData() });
      this.send(ws, { type: 'tools', tools: this.getToolsData() });

      // Send stats
      this.send(ws, {
        type: 'stats',
        turboCompression: (status.turboMemoryStats as Record<string, unknown>)?.compressionRatio ?? 0,
        evolutionGen: (status.evolutionGeneration as number) ?? 0,
        swarmConv: (status.swarmConvergence as number) ?? 0,
      });

      ws.on('close', () => { this.clients.delete(ws); });
      ws.on('error', () => { this.clients.delete(ws); });
    });
  }

  private subscribeToOrchestrator(): void {
    this.orchestrator.on('agents-detected', ({ adapters }: any) => {
      this.broadcast({
        type: 'agents-detected',
        agents: adapters.map((a: any) => `${a.displayName} (${a.name})`),
      });
      this.broadcast({ type: 'tools', tools: this.getToolsData() });
    });

    this.orchestrator.on('analysis-start', ({ changeCount }: any) => {
      this.broadcast({ type: 'analysis-start', changeCount });
    });

    this.orchestrator.on('insights', ({ insights }: any) => {
      this.broadcast({ type: 'insights', insights });
      // Update modules after insights
      this.broadcast({ type: 'modules', modules: this.getModulesData() });
      this.broadcast({ type: 'memory', memory: this.getMemoryData() });
    });

    this.orchestrator.on('health-score', ({ score }: any) => {
      this.broadcast({ type: 'health-score', score });
    });

    this.orchestrator.on('fixes', ({ fixes }: any) => {
      this.broadcast({ type: 'fixes', fixes });
    });

    this.orchestrator.on('injection', ({ adapter, insight, success }: any) => {
      this.broadcast({ type: 'injection', adapter, insightTitle: insight?.title || '', success });
    });

    this.orchestrator.on('info', (message: string) => {
      this.broadcast({ type: 'info', message });
    });

    this.orchestrator.on('error', ({ error }: any) => {
      this.broadcast({ type: 'error', error: String(error?.message || error) });
    });
  }

  private send(ws: WebSocket, data: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  private broadcast(data: object): void {
    const msg = JSON.stringify(data);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server.on('error', reject);
      this.server.listen(this.options.port, this.options.host, () => {
        const url = `http://${this.options.host}:${this.options.port}`;
        resolve(url);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const client of this.clients) {
        try { client.close(); } catch { /* ignore */ }
      }
      this.clients.clear();
      this.wss.close(() => {
        this.server.close(() => resolve());
      });
    });
  }

  get port(): number {
    return this.options.port;
  }
}
