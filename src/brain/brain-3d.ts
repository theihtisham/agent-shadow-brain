// src/brain/brain-3d.ts — Three.js scene-data exporter (viral feature)
// v6.0.2
//
// Emit JSON that any Three.js renderer can ingest to display a rotatable 3D
// brain graph. Includes a self-contained HTML viewer that pulls Three.js from
// a CDN (or a local file path) plus a minimal glTF exporter.
//
// Pure stdlib + dynamic imports only. Layouts are computed in-process — no
// external physics libs, no native modules.

import * as path from 'path';
import * as crypto from 'crypto';
import { GlobalBrain, getGlobalBrain } from './global-brain.js';
import { BrainReplay, getBrainReplay, ReplayEvent } from './brain-replay.js';
import { GlobalEntry } from '../types.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type LayoutKind = 'force-directed' | 'sphere' | 'helix' | 'galaxy';

export interface SceneNode {
  id: string;
  label: string;
  group: string;
  position: [number, number, number];
  size: number;
  color: string;
  importance: number; // 0..1
  metadata: Record<string, unknown>;
}

export interface SceneEdge {
  source: string;
  target: string;
  weight: number; // 0..1
  kind: 'similarity' | 'causal' | 'temporal' | 'agent-handoff';
}

export interface CameraSpec {
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
  near: number;
  far: number;
}

export interface LightSpec {
  type: 'ambient' | 'directional' | 'point';
  color: string;
  intensity: number;
  position?: [number, number, number];
}

export interface ThemeSpec {
  background: string;
  backgroundGradient: [string, string];
  primary: string;
  secondary: string;
  accent: string;
  edgeColor: string;
}

export interface SceneData {
  version: '1.0';
  generatedAt: string;
  layout: LayoutKind;
  nodes: SceneNode[];
  edges: SceneEdge[];
  camera: CameraSpec;
  lights: LightSpec[];
  theme: ThemeSpec;
  meta: {
    project: string;
    nodeCount: number;
    edgeCount: number;
    empty: boolean;
  };
}

// ── Constants ────────────────────────────────────────────────────────────────

const THEME: ThemeSpec = {
  background: '#030509',
  backgroundGradient: ['#030509', '#10152a'],
  primary: '#18ffff',
  secondary: '#a855f7',
  accent: '#ec4899',
  edgeColor: '#3a4870',
};

const GROUP_COLOR: Record<string, string> = {
  memory: '#18ffff',
  pattern: '#a855f7',
  decision: '#ec4899',
  entity: '#7dd3fc',
  agent: '#fbbf24',
  other: '#94a3b8',
};

const DEFAULT_NODE_LIMIT = 300;

// ── Class ────────────────────────────────────────────────────────────────────

export class Brain3d {
  private brain: GlobalBrain;
  private replay: BrainReplay;

  constructor(brain?: GlobalBrain, replay?: BrainReplay) {
    this.brain = brain ?? getGlobalBrain();
    this.replay = replay ?? getBrainReplay();
  }

  /** Build a scene-data object ready for any Three.js renderer. */
  async exportScene(
    project: string,
    opts: { layout?: LayoutKind; nodeLimit?: number } = {},
  ): Promise<SceneData> {
    const layout = opts.layout ?? 'force-directed';
    const nodeLimit = opts.nodeLimit ?? DEFAULT_NODE_LIMIT;

    this.safeInit();
    const projectId = this.resolveProjectId(project);
    const entries = this.brain.recall({ projectId, limit: Math.max(nodeLimit * 2, 200) });

    let events: ReplayEvent[] = [];
    try { events = this.replay.listEvents(project); } catch { /* empty */ }

    // Empty-state — return a single "Hello Brain" node so any renderer has something to draw.
    if (entries.length === 0 && events.length === 0) {
      return this.emptyScene(project, layout);
    }

    const nodes = this.buildNodes(entries, events, nodeLimit);
    const edges = await this.buildEdges(nodes, entries, events);
    this.applyLayout(nodes, layout);

    return {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      layout,
      nodes,
      edges,
      camera: { position: [0, 0, 120], lookAt: [0, 0, 0], fov: 55, near: 0.1, far: 2000 },
      lights: [
        { type: 'ambient', color: '#404060', intensity: 0.6 },
        { type: 'directional', color: '#ffffff', intensity: 0.8, position: [50, 80, 50] },
        { type: 'point', color: THEME.primary, intensity: 0.4, position: [0, 0, 80] },
      ],
      theme: THEME,
      meta: { project: path.basename(path.resolve(project)) || 'brain', nodeCount: nodes.length, edgeCount: edges.length, empty: false },
    };
  }

  /** Self-contained HTML viewer — open in any browser and the brain rotates. */
  htmlViewer(scene: SceneData): string {
    const json = JSON.stringify(scene).replace(/</g, '\\u003c');
    const title = `Brain 3D — ${scene.meta.project}`;
    // Three.js orbit-controls re-implemented inline (drag-to-rotate, wheel-to-zoom)
    // so the page works offline once the unpkg URL is swapped for a local copy.
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>
  html,body{margin:0;padding:0;height:100%;background:linear-gradient(135deg,${scene.theme.backgroundGradient[0]} 0%,${scene.theme.backgroundGradient[1]} 100%);color:#cfe9ff;font-family:ui-sans-serif,system-ui,sans-serif;overflow:hidden}
  #hud{position:absolute;top:14px;left:18px;z-index:10;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${scene.theme.primary};opacity:0.85}
  #subhud{position:absolute;top:34px;left:18px;z-index:10;font-size:11px;color:#7dd3fc;opacity:0.6}
  #footer{position:absolute;bottom:12px;left:18px;z-index:10;font-size:10px;color:#7dd3fc;opacity:0.5;font-family:ui-monospace,monospace}
  canvas{display:block}
</style>
</head>
<body>
<div id="hud">Brain 3D &middot; ${esc(scene.meta.project)} &middot; ${scene.layout}</div>
<div id="subhud">${scene.meta.nodeCount} nodes &middot; ${scene.meta.edgeCount} edges &middot; drag to rotate &middot; wheel to zoom</div>
<div id="footer">@shadow-brain v6.0.2</div>
<script src="https://unpkg.com/three@0.166.0/build/three.min.js"></script>
<script>
const SCENE_DATA = ${json};
(function(){
  const data = SCENE_DATA;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(data.camera.fov, window.innerWidth/window.innerHeight, data.camera.near, data.camera.far);
  camera.position.set.apply(camera.position, data.camera.position);
  camera.lookAt.apply(camera, data.camera.lookAt);
  const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  document.body.appendChild(renderer.domElement);
  for (const L of data.lights) {
    let light;
    if (L.type === 'ambient') light = new THREE.AmbientLight(L.color, L.intensity);
    else if (L.type === 'directional') { light = new THREE.DirectionalLight(L.color, L.intensity); if (L.position) light.position.set.apply(light.position, L.position); }
    else { light = new THREE.PointLight(L.color, L.intensity); if (L.position) light.position.set.apply(light.position, L.position); }
    scene.add(light);
  }
  const nodeMeshes = {};
  for (const n of data.nodes) {
    const geom = new THREE.SphereGeometry(Math.max(0.5, n.size), 16, 16);
    const mat = new THREE.MeshStandardMaterial({color:n.color, emissive:n.color, emissiveIntensity:0.35*n.importance+0.05, roughness:0.4, metalness:0.2});
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(n.position[0], n.position[1], n.position[2]);
    mesh.userData = {id:n.id, label:n.label, group:n.group};
    scene.add(mesh);
    nodeMeshes[n.id] = mesh;
  }
  const edgeMat = new THREE.LineBasicMaterial({color:data.theme.edgeColor, transparent:true, opacity:0.45});
  for (const e of data.edges) {
    const a = nodeMeshes[e.source]; const b = nodeMeshes[e.target];
    if (!a || !b) continue;
    const geom = new THREE.BufferGeometry().setFromPoints([a.position, b.position]);
    scene.add(new THREE.Line(geom, edgeMat));
  }
  // Inline orbit controls: spherical coordinates around origin
  let theta = 0, phi = Math.PI/2.4, radius = Math.hypot(data.camera.position[0], data.camera.position[1], data.camera.position[2]) || 120;
  let dragging = false, lastX = 0, lastY = 0;
  function applyCamera(){ camera.position.set(radius*Math.sin(phi)*Math.cos(theta), radius*Math.cos(phi), radius*Math.sin(phi)*Math.sin(theta)); camera.lookAt(0,0,0); }
  renderer.domElement.addEventListener('mousedown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', e => { if (!dragging) return; theta += (e.clientX - lastX)*0.005; phi = Math.max(0.1, Math.min(Math.PI-0.1, phi - (e.clientY - lastY)*0.005)); lastX = e.clientX; lastY = e.clientY; applyCamera(); });
  renderer.domElement.addEventListener('wheel', e => { e.preventDefault(); radius = Math.max(20, Math.min(800, radius * (1 + e.deltaY*0.001))); applyCamera(); }, {passive:false});
  window.addEventListener('resize', () => { camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
  applyCamera();
  let t = 0;
  function tick(){ t += 0.002; if (!dragging) { theta += 0.0015; applyCamera(); } renderer.render(scene, camera); requestAnimationFrame(tick); }
  tick();
})();
</script>
</body>
</html>`;
  }

  /** Minimal glTF JSON. Embeds node positions inline; no binary buffers. */
  glTfExport(scene: SceneData): string {
    const gltf = {
      asset: { version: '2.0', generator: 'shadow-brain brain-3d v6.0.2' },
      scene: 0,
      scenes: [{ name: scene.meta.project, nodes: scene.nodes.map((_, i) => i) }],
      nodes: scene.nodes.map(n => ({
        name: n.label,
        translation: n.position,
        scale: [n.size, n.size, n.size],
        extras: {
          id: n.id,
          group: n.group,
          color: n.color,
          importance: n.importance,
          metadata: n.metadata,
        },
      })),
      extras: {
        layout: scene.layout,
        generatedAt: scene.generatedAt,
        edges: scene.edges,
        theme: scene.theme,
        camera: scene.camera,
        lights: scene.lights,
      },
    };
    return JSON.stringify(gltf, null, 2);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private emptyScene(project: string, layout: LayoutKind): SceneData {
    return {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      layout,
      nodes: [{
        id: 'hello',
        label: 'Hello Brain',
        group: 'memory',
        position: [0, 0, 0],
        size: 6,
        color: THEME.primary,
        importance: 1,
        metadata: { empty: true, project },
      }],
      edges: [],
      camera: { position: [0, 0, 80], lookAt: [0, 0, 0], fov: 55, near: 0.1, far: 2000 },
      lights: [
        { type: 'ambient', color: '#404060', intensity: 0.7 },
        { type: 'point', color: THEME.primary, intensity: 0.6, position: [0, 0, 50] },
      ],
      theme: THEME,
      meta: { project: path.basename(path.resolve(project)) || 'brain', nodeCount: 1, edgeCount: 0, empty: true },
    };
  }

  private safeInit(): void {
    try { void this.brain.getStats(); } catch { /* swallow */ }
  }

  private resolveProjectId(project: string): string {
    try { return GlobalBrain.projectIdFor(project); } catch { return ''; }
  }

  private buildNodes(entries: GlobalEntry[], events: ReplayEvent[], limit: number): SceneNode[] {
    const nodes: SceneNode[] = [];
    const seen = new Set<string>();
    const maxImp = Math.max(0.001, ...entries.map(e => e.importance));

    for (const e of entries) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      const group = classifyGroup(e.category);
      const norm = Math.min(1, e.importance / maxImp);
      nodes.push({
        id: e.id,
        label: shortLabel(e.content),
        group,
        position: [0, 0, 0],
        size: 1 + norm * 4,
        color: GROUP_COLOR[group] ?? GROUP_COLOR.other,
        importance: norm,
        metadata: { category: e.category, agent: e.agentTool, accessCount: e.accessCount },
      });
      if (nodes.length >= limit) break;
    }

    // Add agent nodes (smaller, golden) for distinct agents observed in events.
    const agentSet = new Set<string>();
    for (const ev of events) { if (ev.agent) agentSet.add(ev.agent); }
    for (const agent of agentSet) {
      const id = `agent:${agent}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (nodes.length >= limit) break;
      nodes.push({
        id, label: agent, group: 'agent',
        position: [0, 0, 0],
        size: 2.5,
        color: GROUP_COLOR.agent,
        importance: 0.5,
        metadata: { kind: 'agent-marker' },
      });
    }

    return nodes;
  }

  private async buildEdges(
    nodes: SceneNode[],
    entries: GlobalEntry[],
    events: ReplayEvent[],
  ): Promise<SceneEdge[]> {
    const edges: SceneEdge[] = [];
    const nodeIds = new Set(nodes.map(n => n.id));

    // Temporal: chain entries within the same agent in time order (lightweight).
    const byAgent = new Map<string, GlobalEntry[]>();
    for (const e of entries) {
      if (!nodeIds.has(e.id)) continue;
      const arr = byAgent.get(e.agentTool) ?? [];
      arr.push(e);
      byAgent.set(e.agentTool, arr);
    }
    for (const [, arr] of byAgent) {
      arr.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      for (let i = 1; i < arr.length && edges.length < 800; i++) {
        edges.push({ source: arr[i - 1].id, target: arr[i].id, weight: 0.4, kind: 'temporal' });
      }
    }

    // Agent-handoff: connect each entry to its agent marker.
    for (const e of entries) {
      const agentId = `agent:${e.agentTool}`;
      if (nodeIds.has(agentId) && nodeIds.has(e.id) && edges.length < 1200) {
        edges.push({ source: agentId, target: e.id, weight: 0.2, kind: 'agent-handoff' });
      }
    }

    // Causal: scan replay events for explicit cause-effect pairs.
    for (const ev of events) {
      const p = ev.payload as { cause?: string; effect?: string } | null;
      if (!p?.cause || !p?.effect) continue;
      if (nodeIds.has(p.cause) && nodeIds.has(p.effect) && edges.length < 1500) {
        edges.push({ source: p.cause, target: p.effect, weight: 0.7, kind: 'causal' });
      }
    }

    // Similarity (optional, defensive): only attempt if embeddings module is importable.
    try {
      const mod = await import('./embeddings.js').catch(() => null);
      const Embeddings = (mod as { Embeddings?: { cosine: (a: number[], b: number[]) => number } } | null)?.Embeddings;
      const getEmb = (mod as { getEmbeddings?: () => { embed: (s: string) => Promise<number[]> } } | null)?.getEmbeddings;
      if (Embeddings && getEmb) {
        const emb = getEmb();
        const top = entries.slice(0, Math.min(40, entries.length));
        const vecs: Array<{ id: string; v: number[] }> = [];
        for (const e of top) {
          try { vecs.push({ id: e.id, v: await emb.embed(shortLabel(e.content)) }); }
          catch { /* skip */ }
        }
        for (let i = 0; i < vecs.length; i++) {
          for (let j = i + 1; j < vecs.length; j++) {
            const s = Embeddings.cosine(vecs[i].v, vecs[j].v);
            if (s >= 0.65 && edges.length < 1500) {
              edges.push({ source: vecs[i].id, target: vecs[j].id, weight: Math.min(1, s), kind: 'similarity' });
            }
          }
        }
      }
    } catch { /* embeddings unavailable; skip silently */ }

    return edges;
  }

  private applyLayout(nodes: SceneNode[], layout: LayoutKind): void {
    if (nodes.length === 0) return;
    switch (layout) {
      case 'sphere':   return layoutSphere(nodes);
      case 'helix':    return layoutHelix(nodes);
      case 'galaxy':   return layoutGalaxy(nodes);
      case 'force-directed':
      default:         return layoutForceDirected(nodes);
    }
  }
}

// ── Layout algorithms ────────────────────────────────────────────────────────

function layoutSphere(nodes: SceneNode[]): void {
  // Fibonacci sphere distribution
  const phi = Math.PI * (Math.sqrt(5) - 1);
  const radius = 40 + Math.sqrt(nodes.length) * 4;
  for (let i = 0; i < nodes.length; i++) {
    const y = 1 - (i / Math.max(1, nodes.length - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    nodes[i].position = [radius * Math.cos(theta) * r, radius * y, radius * Math.sin(theta) * r];
  }
}

function layoutHelix(nodes: SceneNode[]): void {
  // Y is temporal axis (index order). Angular position by entity hash.
  const heightPerNode = 1.4;
  const total = nodes.length * heightPerNode;
  const radius = 30 + Math.sqrt(nodes.length) * 2;
  for (let i = 0; i < nodes.length; i++) {
    const y = -total / 2 + i * heightPerNode;
    const h = hash32(nodes[i].id);
    const angle = (h / 0xffffffff) * Math.PI * 2 + i * 0.3;
    nodes[i].position = [radius * Math.cos(angle), y, radius * Math.sin(angle)];
  }
}

function layoutGalaxy(nodes: SceneNode[]): void {
  // Multi-arm logarithmic spiral, 3 arms.
  const arms = 3;
  const a = 5;
  const b = 0.25;
  for (let i = 0; i < nodes.length; i++) {
    const arm = i % arms;
    const idx = Math.floor(i / arms);
    const t = idx * 0.25;
    const r = a * Math.exp(b * t);
    const theta = t + (arm * (Math.PI * 2 / arms));
    const wobble = (hash32(nodes[i].id) / 0xffffffff - 0.5) * 6;
    nodes[i].position = [r * Math.cos(theta), wobble, r * Math.sin(theta)];
  }
}

function layoutForceDirected(nodes: SceneNode[]): void {
  // Simple Barnes-Hut-flavoured force layout: 200 iterations, O(n^2) per step
  // (we keep it simple since nodeLimit caps total nodes; for n<=300 this is fast).
  const n = nodes.length;
  // Seed positions on a small sphere
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n);
    nodes[i].position = [
      Math.cos(t * Math.PI * 2 * 3) * (10 + t * 30),
      (t - 0.5) * 60,
      Math.sin(t * Math.PI * 2 * 3) * (10 + t * 30),
    ];
  }
  const k = Math.cbrt(60_000 / Math.max(1, n)); // ideal distance
  for (let iter = 0; iter < 200; iter++) {
    const temp = (1 - iter / 200) * 4;
    const disp: Array<[number, number, number]> = nodes.map(() => [0, 0, 0]);
    // Repulsion
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = nodes[i].position[0] - nodes[j].position[0];
        const dy = nodes[i].position[1] - nodes[j].position[1];
        const dz = nodes[i].position[2] - nodes[j].position[2];
        const d2 = dx*dx + dy*dy + dz*dz + 0.01;
        const d = Math.sqrt(d2);
        const f = (k * k) / d;
        const fx = (dx / d) * f, fy = (dy / d) * f, fz = (dz / d) * f;
        disp[i][0] += fx; disp[i][1] += fy; disp[i][2] += fz;
        disp[j][0] -= fx; disp[j][1] -= fy; disp[j][2] -= fz;
      }
    }
    // Mild centripetal pull so the graph stays bounded
    for (let i = 0; i < n; i++) {
      const px = nodes[i].position[0], py = nodes[i].position[1], pz = nodes[i].position[2];
      disp[i][0] -= px * 0.05; disp[i][1] -= py * 0.05; disp[i][2] -= pz * 0.05;
    }
    // Apply with temperature
    for (let i = 0; i < n; i++) {
      const dx = disp[i][0], dy = disp[i][1], dz = disp[i][2];
      const dl = Math.sqrt(dx*dx + dy*dy + dz*dz) + 0.0001;
      const scale = Math.min(dl, temp) / dl;
      nodes[i].position = [
        nodes[i].position[0] + dx * scale,
        nodes[i].position[1] + dy * scale,
        nodes[i].position[2] + dz * scale,
      ];
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function classifyGroup(category: string): string {
  const c = category.toLowerCase();
  if (/decision|adr|architecture/.test(c)) return 'decision';
  if (/pattern|recipe/.test(c)) return 'pattern';
  if (/entity|symbol/.test(c)) return 'entity';
  if (/memory|note|fact/.test(c)) return 'memory';
  return 'other';
}

function shortLabel(s: string): string {
  const clean = (s || '').replace(/\s+/g, ' ').trim();
  return clean.length > 48 ? clean.slice(0, 45) + '...' : (clean || 'untitled');
}

function hash32(s: string): number {
  return parseInt(crypto.createHash('md5').update(s).digest('hex').slice(0, 8), 16);
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance: Brain3d | null = null;
export function getBrain3d(): Brain3d {
  if (!_instance) _instance = new Brain3d();
  return _instance;
}
export function resetBrain3dForTests(): void { _instance = null; }
