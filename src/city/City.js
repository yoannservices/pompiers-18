// Génération de la ville (reprise de bus-city-simulator) : sol, routes, marquages, maisons et immeubles instanciés, lampadaires, caserne, poteaux incendie.
import * as THREE from 'three';
import { G, P, ROAD, HALF, DIRS, rightOf, coord, inGrid, blockZone, nodes, nodeAt, CASERNE, HYDRANTS, MISSION_LOTS, IMMEUBLE_LOTS, HOSPITAL } from './grid.js';
import { Collision } from './Collision.js';
import '../../../../assets/building-kit.js';

const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const dummy = new THREE.Object3D();

// Archétypes de bâtiments : options du kit commun assets/building-kit.js (fenêtres en relief, portes, balcons, toits) + matériaux (m).
// Repère du kit : façade principale (porte d'entrée ou vitrine) vers +z, faîtage le long de w.
const ARCH = {
  tower1: { w: 22, d: 22, h: 72, fh: 3.6, gfh: 5, roof: 'flat', facade: 'curtain', door: '+z', doorType: 'block', mast: 16, m: { wall: '#7f8da0', style: 'concrete', frame: '#3c4652', glass: '#5a7a96' } },
  tower2: { w: 20, d: 20, h: 96, fh: 3.6, gfh: 5, roof: 'flat', facade: 'curtain', door: '+z', doorType: 'block', mast: 20, m: { wall: '#5f7388', style: 'concrete', frame: '#2c3440', glass: '#4d6c88' } },
  tower3: { w: 24, d: 24, h: 55, fh: 3.5, gfh: 4.5, roof: 'flat', door: '+z', doorType: 'block', win: [1.4, 1.8], bay: 3.2, tank: true, m: { wall: '#b4aa9c', style: 'stone', glass: '#2a3b4d' } },
  office: { w: 32, d: 26, h: 44, fh: 3.5, roof: 'flat', facade: 'ribbon', shop: true, door: '-z', doorType: 'block', mast: 8, m: { wall: '#a8a496', style: 'stone', glass: '#26384a', awning: '#2b5d8a' } },
  block: { w: 34, d: 30, h: 30, fh: 3.4, roof: 'flat', shop: true, door: '-z', doorType: 'block', balcony: true, tank: true, win: [1.4, 1.6], bay: 3.3, m: { wall: '#b9846c', style: 'brick', awning: '#b3262e' } },
  mid: { w: 28, d: 24, h: 21, fh: 3.3, roof: 'flat', shop: true, door: '-z', doorType: 'block', balcony: 'alt', win: [1.3, 1.6], shutters: true, m: { wall: '#c4b7a2', style: 'stucco', shutter: '#6b8fa8', awning: '#2f7a4a' } },
  house: { w: 12, d: 10, h: 5, fh: 2.5, roof: 'gable', rise: 3, shutters: true, quoins: true, win: [1.1, 1.25], m: { wall: '#d8c6a9', style: 'stucco', roof: 'tile' } },
  house2: { w: 12, d: 10, h: 5.5, fh: 2.75, roof: 'gable', rise: 2.6, shutters: true, win: [1.1, 1.3], m: { wall: '#c98f7a', style: 'stucco', roof: 'slate' } },
  shop: { w: 34, d: 28, h: 8, fh: 4, roof: 'flat', shop: ['+z'], door: false, m: { wall: '#d9d4c7', style: 'stone', awning: '#c98a1a' } },
  mall: { w: 62, d: 46, h: 12, fh: 6, roof: 'flat', shop: ['+z'], door: '-z', doorType: 'block', win: [3, 2.2], bay: 6, m: { wall: '#c9ced6', style: 'concrete', awning: '#6a3a7a' } },
};
const K = BuildingKit(THREE);
// cap qui tourne la façade +z du kit vers (fx, fz) : 0 = +z, PI/2 = +x, PI = -z, -PI/2 = -x
const yawTo = (fx, fz) => Math.atan2(fx, fz);

function noiseTexture(size, base, spread, line) {
  const c = canvas(size, size), g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size / 12; i++) {
    const v = (Math.random() - 0.5) * spread | 0;
    g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
    g.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  if (line) { g.strokeStyle = line; g.lineWidth = 2; g.strokeRect(0, 0, size, size); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class City {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.col = new Collision();
    this.rand = rng(7);
    this.nightMats = [];     // matériaux émissifs pilotés par la nuit
    this.wetMats = [];       // matériaux dont la rugosité baisse sous la pluie
    this.build();
  }

  // 0 = jour, 1 = nuit
  setNight(n) {
    for (const m of this.nightMats) m.emissiveIntensity = m.userData.max * n;
  }
  setWet(w) {
    for (const m of this.wetMats) m.roughness = m.userData.dry - w * 0.55;
  }

  instanced(geo, material, matrices, colors, cast = false) {
    const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, matrices.length));
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    if (colors) colors.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.count = matrices.length;
    mesh.castShadow = cast; mesh.receiveShadow = true; mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }
  M(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) {
    dummy.position.set(x, y, z); dummy.rotation.set(0, ry, 0); dummy.scale.set(sx, sy, sz); dummy.updateMatrix();
    return dummy.matrix.clone();
  }

  build() {
    const { scene, rand } = this;
    const span = (G - 1) * P;
    const flat = (w, l) => new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2);

    // sol herbe
    const grassT = noiseTexture(128, '#3f6b3a', 60); grassT.repeat.set(500, 500);
    grassT.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ map: grassT, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
    scene.add(ground);

    // routes
    const asphaltT = noiseTexture(128, '#43484f', 50);
    asphaltT.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const road = new THREE.MeshStandardMaterial({ map: asphaltT, roughness: 0.95 });
    road.userData.dry = 0.95; this.wetMats.push(road);
    this.asphalt = road;
    const len = span + ROAD + 40;
    // rues nord-sud : même hauteur que les rues est-ouest mais tirées devant aux carrefours (plus de scintillement entre les deux couches)
    const roadNS = road.clone(); roadNS.polygonOffset = true; roadNS.polygonOffsetFactor = -1; roadNS.polygonOffsetUnits = -1;
    roadNS.userData.dry = 0.95; this.wetMats.push(roadNS);
    for (let k = 0; k < G; k++) {
      const m1 = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, ROAD), road); m1.position.set(0, 0.0, coord(k));
      const m2 = new THREE.Mesh(new THREE.BoxGeometry(ROAD, 0.04, len), roadNS); m2.position.set(coord(k), 0.0, 0);
      m1.receiveShadow = m2.receiveShadow = true; scene.add(m1, m2);
    }
    // trottoirs : un pavé par îlot
    const side = new THREE.MeshStandardMaterial({ map: noiseTexture(64, '#9a9a96', 40, '#7a7a76'), roughness: 0.9 });
    side.map.repeat.set(30, 30);
    const blocks = [];
    for (let bi = 0; bi < G - 1; bi++) for (let bj = 0; bj < G - 1; bj++) blocks.push(this.M((bi - 4) * P, 0.075, (bj - 4) * P, 0, P - ROAD, 0.15, P - ROAD));
    this.instanced(new THREE.BoxGeometry(1, 1, 1), side, blocks);

    this.markings();
    this.lots();
    this.treesAndLamps();
    this.caserne();
    this.hospital();
    this.hydrants();
  }

  markings() {
    const white = new THREE.MeshBasicMaterial({ color: '#e8e8e8', polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });   // marquages devant la chaussée
    const flat = (w, l) => new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2);
    const dashes = [], stripes = [], lines = [], signs = [], poles = [];
    const Y = 0.035;
    for (const n of nodes) {
      DIRS.forEach((d, k) => {
        if (!inGrid(n.i + d.x, n.j + d.z)) return;
        const ry = k % 2 === 0 ? Math.PI / 2 : 0, r = rightOf(d);
        // ligne axiale pointillée de l'arête (une fois par arête : seulement k=0,1)
        if (k < 2) for (let s = 14; s < P - 14; s += 7) dashes.push(this.M(n.x + d.x * (s + 1.5), Y, n.z + d.z * (s + 1.5), ry));
        if (n.type === 'round') return;
        // ligne de stop sur la voie entrante (cap -d) : côté droit de -d = -r
        lines.push(this.M(n.x + d.x * 11.5 - r.x * LANE_C, Y, n.z + d.z * 11.5 - r.z * LANE_C, ry));
        if (n.type === 'signal') for (let o = -5.5; o <= 5.5; o += 1) stripes.push(this.M(n.x + d.x * 9 + r.x * o, Y, n.z + d.z * 9 + r.z * o, ry));
        else if (axisMinor(n, k)) {
          signs.push(this.M(n.x + d.x * 9 - r.x * 6.8, 2.4, n.z + d.z * 9 - r.z * 6.8, Math.atan2(d.x, d.z)));
          poles.push(this.M(n.x + d.x * 9 - r.x * 6.8, 1.2, n.z + d.z * 9 - r.z * 6.8));
        }
      });
    }
    this.instanced(flat(0.18, 3), white, dashes);
    this.instanced(flat(0.5, 3), white, stripes);
    this.instanced(flat(5.8, 0.4), white, lines);
    // panneaux STOP
    const sc = canvas(64, 64), g = sc.getContext('2d');
    g.fillStyle = '#c4161c'; g.fillRect(0, 0, 64, 64); g.strokeStyle = '#fff'; g.lineWidth = 4; g.strokeRect(3, 3, 58, 58);
    g.fillStyle = '#fff'; g.font = 'bold 20px sans-serif'; g.textAlign = 'center'; g.fillText('STOP', 32, 40);
    const st = new THREE.CanvasTexture(sc); st.colorSpace = THREE.SRGBColorSpace;
    this.instanced(new THREE.BoxGeometry(0.8, 0.8, 0.05), new THREE.MeshBasicMaterial({ map: st }), signs);
    this.instanced(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6), new THREE.MeshStandardMaterial({ color: '#888' }), poles);

    // îlots centraux des ronds-points
    const isl = [], islTrees = [];
    for (const n of nodes) if (n.type === 'round') {
      isl.push(this.M(n.x, 0.12, n.z, 0, 4.2, 0.24, 4.2));
      this.col.addCircle(n.x, n.z, 4.2, 'island');
      islTrees.push([n.x, n.z]);
    }
    this.instanced(new THREE.CylinderGeometry(1, 1, 1, 24), new THREE.MeshStandardMaterial({ color: '#4d7f3f' }), isl);
    this.islandTrees = islTrees;
  }

  lots() {
    const { rand } = this;
    const place = {};                      // archétype -> [matrices]
    // yaw : la façade principale regarde la rue ; l'emprise de collision suit la rotation (w et d échangés à 90°)
    const add = (id, x, z, yaw = 0) => {
      const a = ARCH[id], q = Math.abs(Math.sin(yaw)) > 0.5, hw = (q ? a.d : a.w) / 2, hd = (q ? a.w : a.d) / 2;
      (place[id] ??= []).push(this.M(x, 0.15, z, yaw));
      this.col.addBox(x - hw, x + hw, z - hd, z + hd, 'building');
    };
    // orientation d'un lot décalé de (ox, oz) dans son îlot : vers le bord le plus proche (au hasard pour un coin ou le centre)
    const facing = (ox, oz) => {
      const opts = [];
      if (Math.abs(ox) >= Math.abs(oz) && ox) opts.push(yawTo(Math.sign(ox), 0));
      if (Math.abs(oz) >= Math.abs(ox) && oz) opts.push(yawTo(0, Math.sign(oz)));
      if (!opts.length) opts.push(yawTo(1, 0), yawTo(-1, 0), yawTo(0, 1), yawTo(0, -1));
      return opts[Math.floor(rand() * opts.length)];
    };
    const grassLots = [], parkLots = [], parkTrees = [];
    this.parkTrees = parkTrees;
    const pick = (a) => a[Math.floor(rand() * a.length)];
    for (let bi = 0; bi < G - 1; bi++) for (let bj = 0; bj < G - 1; bj++) {
      const cx = (bi - 4) * P, cz = (bj - 4) * P, zone = blockZone(bi, bj);
      if (zone === 'centre') {
        for (const ox of [-20, 20]) for (const oz of [-20, 20]) {
          const id = bi === 4 && bj === 4 ? pick(['tower1', 'tower2', 'tower2', 'tower3']) : pick(['tower1', 'tower3', 'office', 'block', 'mid', 'tower2']);
          add(id, cx + ox, cz + oz, facing(ox, oz));
        }
      } else if (bi === HOSPITAL.bi && bj === HOSPITAL.bj) {
        parkLots.push(this.M(cx, 0.18, cz, 0, 80, 1, 80));
      } else if (zone === 'peripherie') {
        const mission = [...MISSION_LOTS, ...IMMEUBLE_LOTS].some((l) => l.bi === bi && l.bj === bj);
        if (rand() < 0.15 && !mission) {   // pas de pelouse sur l'îlot d'une maison visitable : elle recouvrait son rez-de-chaussée
          grassLots.push(this.M(cx, 0.18, cz, 0, 80, 1, 80));
          for (let t = 0; t < 14; t++) parkTrees.push([cx + (rand() - 0.5) * 70, cz + (rand() - 0.5) * 70]);
        } else for (const ox of [-26, 0, 26]) for (const oz of [-26, 0, 26]) if (rand() < 0.85 && !(ox === 0 && oz === 26 && mission)) add(rand() < 0.5 ? 'house' : 'house2', cx + ox + (rand() - 0.5) * 4, cz + oz + (rand() - 0.5) * 4, facing(ox, oz));
      } else if (zone === 'commerce') {
        parkLots.push(this.M(cx, 0.18, cz, 0, 80, 1, 80));
        if (rand() < 0.5) add('mall', cx, cz - 14);
        else { add('shop', cx - 20, cz - 22); add('shop', cx + 20, cz - 22); }
      }
    }
    // pelouses et parkings 3 cm au-dessus du trottoir (0,15 m), tirés devant : ils scintillaient à 1 cm
    const lotMat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.instanced(flat1(), lotMat('#4a8a3d'), grassLots);
    this.instanced(flat1(), lotMat('#35383d'), parkLots);

    // bâtiments du kit fusionnés par zone et par matériau, détaillés de près, simplifiés au loin (assets/quality.js choisit selon la distance)
    this.scene.add(K.cityOfTypes(Object.entries(place).map(([id, list]) => {
      const a = ARCH[id], m = K.materials(a.m);
      this.nightKit(m);
      return { opts: { ...a, rand }, mats: m, places: list.map((M) => { const e = M.elements; return [e[12], e[13], e[14], Math.atan2(e[8], e[10])]; }) };
    }), 240));
  }

  // fenêtres et vitrines du kit allumées la nuit (même pilotage que les autres matériaux émissifs)
  nightKit(m) {
    m.lit.userData.max = 1.4; m.shop.userData.max = 1.1;
    this.nightMats.push(m.lit, m.shop);
  }

  treesAndLamps() {
    const { rand } = this;
    const nearStop = () => false;
    const nearNode = (x, z, r) => nodes.some((n) => Math.abs(n.x - x) < r && Math.abs(n.z - z) < r);
    const trees = [];
    const half = (P - ROAD) / 2;
    for (let bi = 0; bi < G - 1; bi++) for (let bj = 0; bj < G - 1; bj++) {
      const cx = (bi - 4) * P, cz = (bj - 4) * P, zone = blockZone(bi, bj), step = zone === 'centre' ? 18 : 12;
      for (let s = -half + 8; s <= half - 8; s += step) {
        for (const [x, z] of [[cx + s, cz - half + 1.8], [cx + s, cz + half - 1.8], [cx - half + 1.8, cz + s], [cx + half - 1.8, cz + s]]) {
          if (nearNode(x, z, 15) || nearStop(x, z, 6)) continue;
          trees.push([x, z]);
        }
      }
    }
    trees.length = 0; // arbres retirés (demande de Yoann)
    const trunkM = [], leafM = [], leafC = [];
    for (const [x, z] of trees) {
      const sc = 0.8 + rand() * 0.6;
      trunkM.push(this.M(x, 1 * sc, z, 0, sc, sc, sc));
      leafM.push(this.M(x, 3.3 * sc, z, rand() * 3, sc, sc, sc));
      leafC.push(new THREE.Color().setHSL(0.27 + rand() * 0.08, 0.5, 0.25 + rand() * 0.1));
      this.col.addCircle(x, z, 0.5, 'tree');
    }
    if (trunkM.length) {
      this.instanced(new THREE.CylinderGeometry(0.15, 0.22, 2, 6), new THREE.MeshStandardMaterial({ color: '#5a3c25' }), trunkM);
      this.instanced(new THREE.IcosahedronGeometry(1.6, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true }), leafM, leafC);
    }

    // lampadaires : 4 par arête, deux côtés
    const poles = [], heads = [];
    for (const n of nodes) for (let k = 0; k < 2; k++) {
      const d = DIRS[k];
      if (!inGrid(n.i + d.x, n.j + d.z)) continue;
      const r = rightOf(d);
      for (const s of [22, 38, 62, 78]) for (const sd of [-1, 1]) {
        const x = n.x + d.x * s + r.x * sd * 6.8, z = n.z + d.z * s + r.z * sd * 6.8;
        poles.push(this.M(x, 3.25, z)); heads.push(this.M(x - r.x * sd * 0.9, 6.5, z - r.z * sd * 0.9, k % 2 === 0 ? 0 : Math.PI / 2));
        this.col.addCircle(x, z, 0.25, 'lamp');
      }
    }
    this.instanced(new THREE.CylinderGeometry(0.07, 0.1, 6.5, 6), new THREE.MeshStandardMaterial({ color: '#555' }), poles);
    const lampMat = new THREE.MeshStandardMaterial({ color: '#fff3c0', emissive: '#ffd27a', emissiveIntensity: 0 });
    lampMat.userData.max = 3; this.nightMats.push(lampMat);
    this.instanced(new THREE.BoxGeometry(1.8, 0.14, 0.35), lampMat, heads);
  }

  // Caserne : remise à 3 portes sectionnelles rouges (relevées) face à la rue sud, bâtiment de vie à façade crépie, tour de séchage rayée,
  // mât de drapeau, antenne radio avec feu bleu, marquage jaune devant les baies, lampes allumées la nuit.
  caserne() {
    const { x, z } = CASERNE, rand = this.rand, std = (o) => new THREE.MeshStandardMaterial(o);
    const red = std({ color: '#b3121b', roughness: 0.5, metalness: 0.2 }), roofM = std({ color: '#5b5f66', roughness: 0.9 }), white = std({ color: '#efeae0', roughness: 0.7 }), dark = std({ color: '#2a2d31', roughness: 0.6 });
    const box = (w, h, d, m, px, py, pz) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(px, py, pz); o.castShadow = o.receiveShadow = true; this.scene.add(o); return o; };
    const kitAt = (opt, mo, px, pz, yaw = 0) => { const acc = K.acc(); K.building(acc, { rand, ...opt }); const m = K.materials(mo); this.nightKit(m); const g = K.group(acc.geometries(), m); g.position.set(px, 0.18, pz); g.rotation.y = yaw; this.scene.add(g); return g; };
    const casM = { wall: '#ddd5c6', style: 'stucco', trim: '#f4f1ea', frame: '#e8e8e6', glass: '#2b3b4c', door: '#8a1a1e' };
    // remise : 36 x 16 m, 3 baies de 10,4 x 7,2 m vers la rue sud (+z), fenêtres hautes sur les autres faces, toit-terrasse
    kitAt({ w: 36, d: 16, h: 9, fh: 9, roof: 'flat', parapet: 0.6, door: false, faces: ['-z', '+x', '-x'], win: [1.8, 1.2], bay: 4,
      openings: [-12, 0, 12].map((o) => ({ face: '+z', s: o, w: 10.4, h: 7.2, type: 'bay' })) }, casM, x, z - 6);
    // rives rouges, lanterneaux posés sur la dalle (9,28 m)
    for (const [w, d, px, pz] of [[37.4, 0.4, 0, 2.3], [37.4, 0.4, 0, -14.3], [0.4, 17, 18.7, -6], [0.4, 17, -18.7, -6]]) box(w, 0.7, d, red, x + px, 9.75, z + pz);
    for (const o of [-9, 9]) { box(7, 1.0, 3, white, x + o, 9.8, z - 6); box(6.4, 0.4, 2.4, dark, x + o, 10.5, z - 6); }
    const mast = box(0.16, 9, 0.16, white, x - 9, 14.3, z - 11); mast.castShadow = false;
    const beacon = std({ color: '#2a6bff', emissive: '#2a6bff', emissiveIntensity: 0.4 }); beacon.userData.max = 3; this.nightMats.push(beacon);
    const bl = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), beacon); bl.position.set(x - 9, 19.1, z - 11); this.scene.add(bl);
    // façade avant : piliers, portes sectionnelles relevées (lames + hublots), numéros, lampes
    const dc = canvas(256, 64), dg = dc.getContext('2d');
    dg.fillStyle = '#b3121b'; dg.fillRect(0, 0, 256, 64);
    for (let y = 0; y < 64; y += 8) { dg.fillStyle = 'rgba(0,0,0,0.3)'; dg.fillRect(0, y, 256, 2); dg.fillStyle = 'rgba(255,255,255,0.1)'; dg.fillRect(0, y + 2, 256, 1); }
    for (let k = 0; k < 4; k++) { dg.fillStyle = '#10171f'; dg.fillRect(20 + k * 58, 22, 40, 14); dg.fillStyle = 'rgba(160,200,230,0.35)'; dg.fillRect(20 + k * 58, 22, 40, 5); }
    const doorT = new THREE.CanvasTexture(dc); doorT.colorSpace = THREE.SRGBColorSpace;
    const doorM = std({ map: doorT, roughness: 0.45, metalness: 0.25 });
    const lampM = std({ color: '#fff3c0', emissive: '#ffd27a', emissiveIntensity: 0 }); lampM.userData.max = 3; this.nightMats.push(lampM);
    for (const o of [-12, 0, 12]) {
      box(10.3, 0.7, 0.25, doorM, x + o, 0.18 + 6.8, z + 1.55);                      // tablier relevé sous le linteau
      box(0.7, 0.16, 0.35, lampM, x + o + 2.6, 0.18 + 7.62, z + 2.28);                    // applique au-dessus du cadre
      const nc = canvas(64, 64), ng = nc.getContext('2d'); ng.fillStyle = '#fff'; ng.fillRect(0, 0, 64, 64); ng.fillStyle = '#b3121b'; ng.font = 'bold 54px sans-serif'; ng.textAlign = 'center'; ng.fillText(String((o + 12) / 12 + 1), 32, 50);
      const nt = new THREE.CanvasTexture(nc); nt.colorSpace = THREE.SRGBColorSpace;
      const num = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), std({ map: nt, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); num.position.set(x + o, 0.18 + 7.95, z + 2.03); this.scene.add(num);
    }
    this.col.addBox(x - 18.5, x + 18.5, z - 14.5, z - 13.5, 'building');
    this.col.addBox(x - 18.5, x - 17.5, z - 14, z + 2.5, 'building'); this.col.addBox(x + 17.5, x + 18.5, z - 14, z + 2.5, 'building');
    // marquage jaune à chevrons devant chaque baie
    const hc = canvas(128, 64), hg = hc.getContext('2d'); hg.fillStyle = 'rgba(0,0,0,0)'; hg.clearRect(0, 0, 128, 64);
    hg.fillStyle = '#f2c400'; for (let k = -64; k < 192; k += 22) { hg.beginPath(); hg.moveTo(k, 64); hg.lineTo(k + 12, 64); hg.lineTo(k + 44, 0); hg.lineTo(k + 32, 0); hg.fill(); }
    const ht = new THREE.CanvasTexture(hc); ht.colorSpace = THREE.SRGBColorSpace;
    for (const o of [-12, 0, 12]) { const hp = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.2).rotateX(-Math.PI / 2), std({ map: ht, transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })); hp.position.set(x + o, 0.2, z + 4.4); hp.receiveShadow = true; this.scene.add(hp); }
    // bâtiment de vie : façade crépie à 3 niveaux, auvent d'entrée, perron, toit-terrasse
    kitAt({ w: 22, d: 14, h: 10.8, fh: 3.6, roof: 'flat', door: '+z', doorType: 'block', win: [1.5, 1.7], bay: 3.4, shutters: false }, casM, x - 6, z - 30);
    this.col.addBox(x - 17, x + 5, z - 37, z - 23, 'building');
    // tour de séchage des tuyaux : meurtrières en relief sur 8 niveaux, bandeaux rouges, lanterne sur la terrasse
    kitAt({ w: 5, d: 5, h: 22, fh: 2.6, roof: 'flat', parapet: 0.5, equip: false, bands: false, door: '+z', margin: 1.4, win: [0.45, 1.3], lintel: false }, casM, x + 14, z - 30);
    this.col.addBox(x + 11.5, x + 16.5, z - 32.5, z - 27.5, 'building');
    for (const y of [2.9, 21.0]) box(5.12, 0.5, 5.12, red, x + 14, 0.18 + y, z - 30);
    box(3.4, 1.6, 3.4, dark, x + 14, 0.18 + 22.1 + 0.8, z - 30); box(3.8, 0.3, 3.8, red, x + 14, 0.18 + 22.1 + 1.75, z - 30);
    // mât de drapeau tricolore
    const fc = canvas(96, 64), fg = fc.getContext('2d'); fg.fillStyle = '#1f3d9a'; fg.fillRect(0, 0, 32, 64); fg.fillStyle = '#fff'; fg.fillRect(32, 0, 32, 64); fg.fillStyle = '#d4202a'; fg.fillRect(64, 0, 32, 64);
    const ft = new THREE.CanvasTexture(fc); ft.colorSpace = THREE.SRGBColorSpace;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 10, 8), std({ color: '#cfd3d6', metalness: 0.6, roughness: 0.35 })); pole.position.set(x + 22, 5, z + 8); pole.castShadow = true; this.scene.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.8), std({ map: ft, side: THREE.DoubleSide, roughness: 0.9 })); flag.position.set(x + 23.4, 9, z + 8); this.scene.add(flag);
    this.col.addCircle(x + 22, z + 8, 0.2, 'post');
    // enseigne
    const c = canvas(1024, 128), g = c.getContext('2d');
    g.fillStyle = '#b3121b'; g.fillRect(0, 0, 1024, 128); g.fillStyle = '#fff'; g.font = 'bold 72px sans-serif'; g.textAlign = 'center';
    g.fillText('SAPEURS-POMPIERS', 512, 92);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Mesh(new THREE.PlaneGeometry(24, 3), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#fff', emissiveIntensity: 0.3 }));
    box(26, 2.4, 0.4, white, x, 11.3, z + 2.35);
    s.geometry.dispose(); s.geometry = new THREE.PlaneGeometry(18, 2.25); s.position.set(x, 11.3, z + 2.56); this.scene.add(s);
    // sol de la remise et de la cour
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.95 }));
    lot.position.set(x, 0.18, z); lot.receiveShadow = true; this.scene.add(lot);
  }

  // Hôpital : bloc blanc à façade vitrée sur 5 niveaux, entrée sous auvent, enseigne URGENCES, héliport et équipements sur le toit.
  hospital() {
    const { x, z } = HOSPITAL, std = (o) => new THREE.MeshStandardMaterial(o), rand = this.rand;
    const white = std({ color: '#eef1f4', roughness: 0.6 }), roofM = std({ color: '#8a8f96', roughness: 0.9 });
    const box = (w, h, d, m, px, py, pz) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(px, py, pz); o.castShadow = o.receiveShadow = true; this.scene.add(o); return o; };
    const acc = K.acc();
    K.building(acc, { rand, w: 56, d: 30, h: 22, fh: 4.4, roof: 'flat', door: '+z', doorType: 'block', doorW: 2.4, win: [2.4, 2.0], bay: 3.6, canopy: false, tank: false });
    const km = K.materials({ wall: '#eef1f4', style: 'stone', trim: '#ffffff', frame: '#d8dde2', glass: '#3b5a74' }); this.nightKit(km);
    const hg0 = K.group(acc.geometries(), km); hg0.position.set(x, 0.18, z - 8); this.scene.add(hg0);
    this.col.addBox(x - 28, x + 28, z - 23, z + 7, 'building');
    const hc = canvas(128, 128), hg = hc.getContext('2d'); hg.fillStyle = '#3a3f46'; hg.beginPath(); hg.arc(64, 64, 62, 0, 7); hg.fill(); hg.strokeStyle = '#f2c400'; hg.lineWidth = 5; hg.beginPath(); hg.arc(64, 64, 55, 0, 7); hg.stroke();
    hg.fillStyle = '#fff'; hg.font = 'bold 76px sans-serif'; hg.textAlign = 'center'; hg.fillText('H', 64, 90);
    const ht = new THREE.CanvasTexture(hc); ht.colorSpace = THREE.SRGBColorSpace;
    const hp = new THREE.Mesh(new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2), std({ map: ht, transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); hp.position.set(x - 14, 22.33, z - 10); this.scene.add(hp);
    box(16, 0.4, 9, white, x, 4.2, z + 11.5); for (const o of [-7.5, 7.5]) { box(0.4, 4.2, 0.4, white, x + o, 2.1, z + 15.6); this.col.addCircle(x + o, z + 15.6, 0.3, 'post'); }
    const c = canvas(1024, 160), g = c.getContext('2d');
    g.fillStyle = '#c4161c'; g.fillRect(0, 0, 1024, 160); g.fillStyle = '#fff'; g.font = 'bold 92px sans-serif'; g.textAlign = 'center'; g.fillText('URGENCES', 600, 115);
    g.fillRect(70, 40, 120, 40); g.fillRect(110, 0, 40, 160);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.2), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#fff', emissiveIntensity: 0.5 }));
    box(14.4, 2.4, 0.3, white, x, 5.6, z + 15.85);   // caisson de l'enseigne (elle flottait seule au-dessus de l'auvent)
    s.position.set(x, 5.6, z + 16.02); this.scene.add(s);
  }

  // Poteaux incendie rouges (norme française) : fût, chapeau, deux sorties.
  hydrants() {
    const m = [], caps = [];
    for (const h of HYDRANTS) { m.push(this.M(h.x, 0.5, h.z)); caps.push(this.M(h.x, 1.05, h.z)); this.col.addCircle(h.x, h.z, 0.3, 'hydrant'); }
    const red = new THREE.MeshStandardMaterial({ color: '#c8161d', roughness: 0.45, metalness: 0.3 });
    this.instanced(new THREE.CylinderGeometry(0.17, 0.2, 1, 10), red, m, null, true);
    this.instanced(new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), red, caps);
  }
}

const LANE_C = 3;
const axisMinor = (n, k) => (k % 2 === 0 ? 'x' : 'z') !== n.major;
const flat1 = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
