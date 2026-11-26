import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import type {ScenarioId} from '../types';

const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();

interface SlalomGate {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  ring: THREE.Mesh;
  passed: boolean;
}

/**
 * Generates procedural CanvasTexture ground markings (helipad + meter grid)
 * with SRGBColorSpace and maximum anisotropy.
 */
function createHelipadTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#1e2633';
  ctx.fillRect(0, 0, 1024, 1024);

  // Subtle concrete grain
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 1024;
    const v = 32 + Math.floor(Math.random() * 18);
    ctx.fillStyle = `rgb(${v}, ${v + 6}, ${v + 14})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Outer dashed circle (radius 10m scaled)
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(512, 512, 430, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 6;
  ctx.setLineDash([28, 22]);
  ctx.beginPath();
  ctx.arc(512, 512, 310, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Compass ticks N / E / S / W
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 44px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', 512, 44);
  ctx.fillText('S', 512, 980);
  ctx.fillText('E', 980, 512);
  ctx.fillText('W', 44, 512);

  // Center 'H' marking
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(392, 330, 44, 364);
  ctx.fillRect(588, 330, 44, 364);
  ctx.fillRect(392, 490, 240, 44);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createGroundGridTexture(
  bgHex: string,
  lineHex: string,
  subLineHex: string,
  maxAnisotropy: number,
  repeat = 80,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = subLineHex;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 512; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  ctx.strokeStyle = lineHex;
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 512, 512);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createBuildingFacadeTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#1f2937';
  ctx.fillRect(0, 0, 256, 512);

  for (let y = 16; y < 496; y += 28) {
    for (let x = 14; x < 242; x += 28) {
      const lit = Math.random() > 0.62;
      ctx.fillStyle = lit ? '#bae6fd' : '#334155';
      ctx.fillRect(x, y, 18, 18);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Manages the 4 optimized 3D environments, studio PBR lighting, sky/fog,
 * animated 3D windsock (biruta), wind flow particles, and Slalom course tracking.
 */
export class EnvironmentManager {
  public currentScenario: ScenarioId = 'ifsp';
  private readonly scene: THREE.Scene;
  private readonly maxAnisotropy: number;
  private readonly isSoftwareGl: boolean;

  private readonly scenarioGroups = new Map<ScenarioId, THREE.Group>();
  private readonly keyLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private envTexture: THREE.Texture | null = null;

  // Windsock parts for IFSP Lab
  private windsockGroup: THREE.Group | null = null;
  private windsockSegments: THREE.Mesh[] = [];

  // Wind particles (InstancedMesh)
  private readonly particleCount = 160;
  private readonly windParticles: THREE.InstancedMesh;
  private readonly particlePositions = new Float32Array(160 * 3);
  private readonly particlePhase = new Float32Array(160);

  // Slalom gates
  private slalomGates: SlalomGate[] = [];
  public slalomPassed = 0;
  public slalomTotal = 0;
  public slalomTimerSec = 0;
  private slalomTimerRunning = false;
  private prevDronePos = new THREE.Vector3();
  private hasPrevDronePos = false;

  private readonly disposables: Array<{dispose: () => void}> = [];

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, isSoftwareGl: boolean) {
    this.scene = scene;
    this.isSoftwareGl = isSoftwareGl;
    this.maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    // Studio Environment Reflections (PMREM + RoomEnvironment)
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = this.envTexture;
    pmrem.dispose();

    // Sky + Horizon-matched Fog
    const skyColor = new THREE.Color(0x0b1628);
    scene.background = skyColor;
    scene.fog = new THREE.FogExp2(0x0b1628, 0.0022);

    // Balanced 3-point outdoor lighting (warm sun key + cool hemisphere fill)
    this.hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 1.35);
    scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff5e4, 2.4);
    this.keyLight.position.set(35, 70, 25);
    if (!this.isSoftwareGl) {
      this.keyLight.castShadow = true;
      this.keyLight.shadow.mapSize.set(2048, 2048);
      const d = 18;
      this.keyLight.shadow.camera.left = -d;
      this.keyLight.shadow.camera.right = d;
      this.keyLight.shadow.camera.top = d;
      this.keyLight.shadow.camera.bottom = -d;
      this.keyLight.shadow.camera.near = 2;
      this.keyLight.shadow.camera.far = 160;
      this.keyLight.shadow.bias = -0.0005;
      this.keyLight.shadow.normalBias = 0.02;
    }
    scene.add(this.keyLight);
    scene.add(this.keyLight.target);

    // Build all 4 scenarios
    this.scenarioGroups.set('ifsp', this.buildIfspLab());
    this.scenarioGroups.set('cerrado', this.buildCerrado());
    this.scenarioGroups.set('urban', this.buildUrbanCanyon());
    this.scenarioGroups.set('slalom', this.buildSlalomCourse());

    for (const [id, group] of this.scenarioGroups.entries()) {
      group.visible = id === this.currentScenario;
      scene.add(group);
    }

    // Wind streamline particles (InstancedMesh)
    const streakGeo = new THREE.BoxGeometry(0.03, 0.03, 0.75);
    const streakMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.45,
    });
    this.disposables.push(streakGeo, streakMat);

    this.windParticles = new THREE.InstancedMesh(streakGeo, streakMat, this.particleCount);
    this.windParticles.frustumCulled = false;
    for (let i = 0; i < this.particleCount; i++) {
      this.particlePositions[i * 3 + 0] = (Math.random() - 0.5) * 32;
      this.particlePositions[i * 3 + 1] = Math.random() * 14 - 4;
      this.particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 32;
      this.particlePhase[i] = Math.random() * Math.PI * 2;
    }
    scene.add(this.windParticles);
  }

  private buildIfspLab(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'IFSP_Lab';

    const groundTex = createGroundGridTexture('#101926', '#1e3a5f', '#17253a', this.maxAnisotropy, 90);
    const groundGeo = new THREE.PlaneGeometry(1200, 1200);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      map: groundTex,
      roughness: 0.88,
      metalness: 0.08,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    group.add(ground);
    this.disposables.push(groundTex, groundGeo, groundMat);

    // Helipad (elevated +0.02 m above ground to avoid Z-fighting)
    const padTex = createHelipadTexture(this.maxAnisotropy);
    const padGeo = new THREE.CylinderGeometry(8.0, 8.2, 0.04, 48);
    const padMat = new THREE.MeshStandardMaterial({
      map: padTex,
      roughness: 0.7,
      metalness: 0.15,
    });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.y = 0.02;
    pad.receiveShadow = true;
    group.add(pad);
    this.disposables.push(padTex, padGeo, padMat);

    // 4 Altitude Reference Towers (10 m, 25 m, 50 m, 75 m)
    const towerHeights = [10, 25, 50, 75];
    const towerPositions: Array<[number, number]> = [
      [-18, -18],
      [18, -18],
      [22, 16],
      [-22, 16],
    ];
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.35,
      metalness: 0.8,
    });
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 1.5,
      roughness: 0.2,
    });
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xd97706,
      emissiveIntensity: 0.4,
      roughness: 0.3,
    });
    this.disposables.push(steelMat, beaconMat, ringMat);

    towerHeights.forEach((h, idx) => {
      const [tx, tz] = towerPositions[idx];
      const mastGeo = new THREE.CylinderGeometry(0.18, 0.32, h, 12);
      const mast = new THREE.Mesh(mastGeo, steelMat);
      mast.position.set(tx, h * 0.5, tz);
      mast.castShadow = !this.isSoftwareGl;
      group.add(mast);
      this.disposables.push(mastGeo);

      // Altitude marker collars every 10 m
      for (let m = 10; m <= h; m += 10) {
        const collarGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 16);
        const collar = new THREE.Mesh(collarGeo, m === h ? beaconMat : ringMat);
        collar.position.set(tx, m, tz);
        group.add(collar);
        this.disposables.push(collarGeo);
      }

      // Top altitude label plaque sprite/canvas
      const labelTex = this.createBadgeTexture(`${h} m`);
      const labelMat = new THREE.SpriteMaterial({map: labelTex});
      const sprite = new THREE.Sprite(labelMat);
      sprite.position.set(tx, h + 1.8, tz);
      sprite.scale.set(3.2, 1.6, 1);
      group.add(sprite);
      this.disposables.push(labelTex, labelMat);
    });

    // Animated 3D Windsock (Biruta) near helipad
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 4.5, 12);
    const pole = new THREE.Mesh(poleGeo, steelMat);
    pole.position.set(10.5, 2.25, -4);
    group.add(pole);
    this.disposables.push(poleGeo);

    const sockPivot = new THREE.Group();
    sockPivot.position.set(10.5, 4.35, -4);
    group.add(sockPivot);
    this.windsockGroup = sockPivot;

    const orangeMat = new THREE.MeshStandardMaterial({color: 0xf97316, roughness: 0.6});
    const whiteMat = new THREE.MeshStandardMaterial({color: 0xf8fafc, roughness: 0.6});
    this.disposables.push(orangeMat, whiteMat);

    for (let s = 0; s < 5; s++) {
      const r1 = 0.24 - s * 0.032;
      const r2 = 0.24 - (s + 1) * 0.032;
      const segGeo = new THREE.CylinderGeometry(r2, r1, 0.36, 16, 1, true);
      segGeo.rotateX(Math.PI / 2);
      const seg = new THREE.Mesh(segGeo, s % 2 === 0 ? orangeMat : whiteMat);
      seg.material.side = THREE.DoubleSide;
      seg.position.z = 0.18 + s * 0.35;
      sockPivot.add(seg);
      this.windsockSegments.push(seg);
      this.disposables.push(segGeo);
    }

    return group;
  }

  private buildCerrado(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Cerrado_Field';

    const groundTex = createGroundGridTexture('#1a2a1d', '#2b452f', '#213624', this.maxAnisotropy, 70);
    const groundGeo = new THREE.PlaneGeometry(1400, 1400);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      map: groundTex,
      roughness: 0.94,
      metalness: 0.02,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    group.add(ground);
    this.disposables.push(groundTex, groundGeo, groundMat);

    // Launching pad in field
    const padGeo = new THREE.CylinderGeometry(4.5, 4.8, 0.05, 32);
    const padMat = new THREE.MeshStandardMaterial({color: 0x334155, roughness: 0.78});
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.y = 0.025;
    pad.receiveShadow = true;
    group.add(pad);
    this.disposables.push(padGeo, padMat);

    // Instanced Cerrado trees (trunks + multi-crown canopy)
    const treeCount = 180;
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 3.2, 8);
    trunkGeo.translate(0, 1.6, 0);
    const trunkMat = new THREE.MeshStandardMaterial({color: 0x5c4033, roughness: 0.9});

    const crownGeo = new THREE.DodecahedronGeometry(1.85, 1);
    crownGeo.translate(0, 3.8, 0);
    const crownMat = new THREE.MeshStandardMaterial({color: 0x3f6a34, roughness: 0.85});

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, treeCount);
    trunks.castShadow = !this.isSoftwareGl;
    crowns.castShadow = !this.isSoftwareGl;
    crowns.receiveShadow = true;

    const tint = new THREE.Color();
    for (let i = 0; i < treeCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 22 + Math.random() * 210;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const s = 0.75 + Math.random() * 0.95;

      _pos.set(x, 0, z);
      _quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
      _scale.set(s, s * (0.85 + Math.random() * 0.35), s);
      _mat4.compose(_pos, _quat, _scale);

      trunks.setMatrixAt(i, _mat4);
      crowns.setMatrixAt(i, _mat4);

      tint.setHSL(0.26 + (Math.random() - 0.5) * 0.06, 0.42, 0.28 + Math.random() * 0.12);
      crowns.setColorAt(i, tint);
    }
    trunks.computeBoundingSphere();
    crowns.computeBoundingSphere();
    group.add(trunks, crowns);
    this.disposables.push(trunkGeo, trunkMat, crownGeo, crownMat);

    return group;
  }

  private buildUrbanCanyon(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Urban_Canyon';

    const roadTex = createGroundGridTexture('#151a22', '#334155', '#232c3b', this.maxAnisotropy, 60);
    const groundGeo = new THREE.PlaneGeometry(1200, 1200);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({map: roadTex, roughness: 0.85});
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    group.add(ground);
    this.disposables.push(roadTex, groundGeo, groundMat);

    // Street avenue markings along North-South corridor
    const padGeo = new THREE.BoxGeometry(10, 0.04, 10);
    const padMat = new THREE.MeshStandardMaterial({color: 0x38bdf8, roughness: 0.6});
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.y = 0.02;
    group.add(pad);
    this.disposables.push(padGeo, padMat);

    // Instanced city towers forming wind corridors
    const facadeTex = createBuildingFacadeTexture(this.maxAnisotropy);
    const bldgGeo = new THREE.BoxGeometry(1, 1, 1);
    bldgGeo.translate(0, 0.5, 0);
    const bldgMat = new THREE.MeshStandardMaterial({
      map: facadeTex,
      roughness: 0.45,
      metalness: 0.35,
    });

    const positions: Array<[number, number, number, number, number]> = [];
    // Two parallel canyon walls on East/West + cross blocks
    for (let z = -120; z <= 120; z += 28) {
      for (const side of [-1, 1]) {
        const w = 14 + Math.random() * 8;
        const d = 18 + Math.random() * 6;
        const h = 28 + Math.random() * 62;
        positions.push([side * (22 + w * 0.5), z, w, h, d]);
        // Second row
        positions.push([side * (52 + w * 0.5), z + 10, w + 4, 22 + Math.random() * 75, d + 4]);
      }
    }

    const buildings = new THREE.InstancedMesh(bldgGeo, bldgMat, positions.length);
    buildings.castShadow = !this.isSoftwareGl;
    buildings.receiveShadow = true;

    const color = new THREE.Color();
    positions.forEach(([x, z, w, h, d], idx) => {
      _pos.set(x, 0, z);
      _quat.identity();
      _scale.set(w, h, d);
      _mat4.compose(_pos, _quat, _scale);
      buildings.setMatrixAt(idx, _mat4);
      const shade = 0.72 + Math.random() * 0.35;
      color.setRGB(shade, shade, shade * 1.05);
      buildings.setColorAt(idx, color);
    });
    buildings.computeBoundingSphere();
    group.add(buildings);
    this.disposables.push(facadeTex, bldgGeo, bldgMat);

    return group;
  }

  private buildSlalomCourse(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Slalom_Precision';

    const groundTex = createGroundGridTexture('#121a28', '#253952', '#1a283b', this.maxAnisotropy, 75);
    const groundGeo = new THREE.PlaneGeometry(1200, 1200);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({map: groundTex, roughness: 0.85});
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    group.add(ground);
    this.disposables.push(groundTex, groundGeo, groundMat);

    // Start & Finish precision pads
    const padGeo = new THREE.CylinderGeometry(4.0, 4.2, 0.05, 32);
    const startPadMat = new THREE.MeshStandardMaterial({color: 0x0ea5e9, roughness: 0.55});
    const startPad = new THREE.Mesh(padGeo, startPadMat);
    startPad.position.y = 0.025;
    group.add(startPad);
    this.disposables.push(padGeo, startPadMat);

    const gateSpecs: Array<[number, number, number, number]> = [
      [0, 12, -22, 0],
      [10, 16, -45, -0.35],
      [22, 20, -70, -0.6],
      [12, 18, -96, 0.45],
      [-8, 14, -112, 0.25],
      [-20, 12, -85, -0.4],
      [-15, 10, -50, -0.2],
      [0, 8, -24, 0],
    ];

    const ringGeo = new THREE.TorusGeometry(3.4, 0.22, 16, 40);
    const pillarGeo = new THREE.CylinderGeometry(0.14, 0.18, 1, 10);
    const pillarMat = new THREE.MeshStandardMaterial({color: 0x475569, metalness: 0.7, roughness: 0.35});
    this.disposables.push(ringGeo, pillarGeo, pillarMat);

    this.slalomGates = gateSpecs.map(([x, y, z, yaw], idx) => {
      const ringMat = new THREE.MeshStandardMaterial({
        color: idx === 0 ? 0x22c55e : 0xf59e0b,
        emissive: idx === 0 ? 0x16a34a : 0xd97706,
        emissiveIntensity: 0.65,
        roughness: 0.25,
      });
      this.disposables.push(ringMat);

      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(x, y, z);
      ring.rotation.y = yaw;
      group.add(ring);

      const pillarHeight = Math.max(0.5, y - 3.4);
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.scale.set(1, pillarHeight, 1);
      pillar.position.set(x, pillarHeight * 0.5, z);
      group.add(pillar);

      const normal = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      return {
        position: new THREE.Vector3(x, y, z),
        normal,
        ring,
        passed: false,
      };
    });

    this.slalomTotal = this.slalomGates.length;
    return group;
  }

  private createBadgeTexture(text: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 6;
    ctx.fillRect(8, 8, 240, 112);
    ctx.strokeRect(8, 8, 240, 112);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 52px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 66);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  public setScenario(id: ScenarioId): void {
    this.currentScenario = id;
    for (const [k, grp] of this.scenarioGroups.entries()) {
      grp.visible = k === id;
    }
    this.resetSlalom();

    const bgColors: Record<ScenarioId, number> = {
      ifsp: 0x0b1628,
      cerrado: 0x10202b,
      urban: 0x0d131f,
      slalom: 0x091322,
    };
    const c = bgColors[id];
    (this.scene.background as THREE.Color).setHex(c);
    (this.scene.fog as THREE.FogExp2).color.setHex(c);
  }

  public resetSlalom(): void {
    this.slalomPassed = 0;
    this.slalomTimerSec = 0;
    this.slalomTimerRunning = false;
    this.hasPrevDronePos = false;
    this.slalomGates.forEach((g, idx) => {
      g.passed = false;
      const mat = g.ring.material as THREE.MeshStandardMaterial;
      mat.color.setHex(idx === 0 ? 0x22c55e : 0xf59e0b);
      mat.emissive.setHex(idx === 0 ? 0x16a34a : 0xd97706);
    });
  }

  public update(droneWorldPos: THREE.Vector3, windInertial: Float64Array, dt: number, simTime: number): void {
    // Keep directional light shadow frustum centered on the drone
    if (!this.isSoftwareGl) {
      this.keyLight.position.set(droneWorldPos.x + 35, droneWorldPos.y + 70, droneWorldPos.z + 25);
      this.keyLight.target.position.copy(droneWorldPos);
      this.keyLight.target.updateMatrixWorld();
    }

    // Animate windsock in IFSP Lab
    const wx = windInertial[1]; // East -> +X
    const wy = -windInertial[2]; // -Down -> +Y
    const wz = -windInertial[0]; // -North -> +Z
    const windSpeed = Math.hypot(wx, wy, wz);

    if (this.windsockGroup && this.currentScenario === 'ifsp') {
      if (windSpeed > 0.25) {
        const yaw = Math.atan2(wx, wz);
        this.windsockGroup.rotation.y = yaw;
      }
      const droop = Math.max(0, 1.0 - windSpeed / 8.5) * 0.85;
      for (let i = 0; i < this.windsockSegments.length; i++) {
        const flutter = Math.sin(simTime * (4 + windSpeed * 0.7) - i * 0.8) * Math.min(0.18, windSpeed * 0.015);
        this.windsockSegments[i].rotation.x = droop * (0.25 + i * 0.15) + flutter;
        this.windsockSegments[i].rotation.z = flutter * 0.7;
      }
    }

    // Update wind streamline particles around drone
    const showParticles = windSpeed > 0.35;
    this.windParticles.visible = showParticles;
    if (showParticles) {
      const dirX = wx / windSpeed;
      const dirY = wy / windSpeed;
      const dirZ = wz / windSpeed;
      _pos.set(dirX, dirY, dirZ);
      _quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _pos);
      const streakScale = Math.min(2.6, 0.5 + windSpeed * 0.14);

      for (let i = 0; i < this.particleCount; i++) {
        const ix = i * 3;
        this.particlePositions[ix + 0] += wx * dt;
        this.particlePositions[ix + 1] += wy * dt;
        this.particlePositions[ix + 2] += wz * dt;

        // Wrap around a 32x16x32 box relative to drone
        const dx = this.particlePositions[ix + 0] - droneWorldPos.x;
        const dy = this.particlePositions[ix + 1] - droneWorldPos.y;
        const dz = this.particlePositions[ix + 2] - droneWorldPos.z;

        if (dx > 16) this.particlePositions[ix + 0] -= 32;
        else if (dx < -16) this.particlePositions[ix + 0] += 32;
        if (dy > 8) this.particlePositions[ix + 1] -= 16;
        else if (dy < -8 || this.particlePositions[ix + 1] < 0.2) {
          this.particlePositions[ix + 1] = Math.max(0.5, droneWorldPos.y + (Math.random() - 0.5) * 14);
        }
        if (dz > 16) this.particlePositions[ix + 2] -= 32;
        else if (dz < -16) this.particlePositions[ix + 2] += 32;

        _pos.set(
          this.particlePositions[ix + 0],
          this.particlePositions[ix + 1],
          this.particlePositions[ix + 2],
        );
        _scale.set(1, 1, streakScale);
        _mat4.compose(_pos, _quat, _scale);
        this.windParticles.setMatrixAt(i, _mat4);
      }
      this.windParticles.instanceMatrix.needsUpdate = true;
    }

    // Slalom gate check
    if (this.currentScenario === 'slalom') {
      if (this.slalomTimerRunning) {
        this.slalomTimerSec += dt;
      }
      if (this.hasPrevDronePos) {
        const nextIdx = this.slalomPassed;
        if (nextIdx < this.slalomGates.length) {
          const gate = this.slalomGates[nextIdx];
          if (!gate.passed && droneWorldPos.distanceTo(gate.position) < 3.6) {
            gate.passed = true;
            const mat = gate.ring.material as THREE.MeshStandardMaterial;
            mat.color.setHex(0x38bdf8);
            mat.emissive.setHex(0x0284c7);
            this.slalomPassed++;
            if (this.slalomPassed === 1) this.slalomTimerRunning = true;
            if (this.slalomPassed === this.slalomGates.length) {
              this.slalomTimerRunning = false;
            } else {
              const nextMat = this.slalomGates[this.slalomPassed].ring.material as THREE.MeshStandardMaterial;
              nextMat.color.setHex(0x22c55e);
              nextMat.emissive.setHex(0x16a34a);
            }
          }
        }
      }
      this.prevDronePos.copy(droneWorldPos);
      this.hasPrevDronePos = true;
    }
  }

  public dispose(): void {
    this.envTexture?.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
