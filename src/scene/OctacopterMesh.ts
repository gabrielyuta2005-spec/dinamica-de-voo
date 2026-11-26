import * as THREE from 'three';
import {OCTA_PARAMS, ROTOR_SPECS} from '../physics/OctacopterModel';

// Pre-allocated scratch math objects (Zero GC in render loop)
const _mThree = new THREE.Matrix4();
const _velDir = new THREE.Vector3();
const _windDir = new THREE.Vector3();

/**
 * High-detail Composite Procedural 3D Octocopter Model (FRD -> Three.js Y-up).
 * Local Three.js axes:
 *   -Z = +x_b (Nose / Forward)
 *   +X = +y_b (Starboard / Right)
 *   -Y = +z_b (Downward)
 *   +Y = -z_b (Upward; rotor plane sits at Y = +0.06 m above CG)
 */
export class OctacopterMesh extends THREE.Group {
  private readonly rotorSpinGroups: THREE.Group[] = [];
  private readonly rotorDiscs: THREE.Mesh[] = [];
  private readonly rotorDiscMaterials: THREE.MeshBasicMaterial[] = [];

  public readonly thrustArrow: THREE.ArrowHelper;
  public readonly velocityArrow: THREE.ArrowHelper;
  public readonly windArrow: THREE.ArrowHelper;
  public readonly vectorsGroup = new THREE.Group();

  private showVectors = false;
  private readonly disposables: Array<{dispose: () => void}> = [];

  constructor() {
    super();
    this.name = 'Octacoptero_8kg';

    // Materials with varied PBR roughness/metalness
    const carbonMat = new THREE.MeshStandardMaterial({
      color: 0x1b2029,
      roughness: 0.42,
      metalness: 0.28,
    });
    const aluminumMat = new THREE.MeshStandardMaterial({
      color: 0xb8c4d4,
      roughness: 0.22,
      metalness: 0.88,
    });
    const avionicsMat = new THREE.MeshPhysicalMaterial({
      color: 0x0f172a,
      roughness: 0.16,
      metalness: 0.15,
      clearcoat: 0.9,
      clearcoatRoughness: 0.12,
    });
    const batteryMat = new THREE.MeshStandardMaterial({
      color: 0x262e3d,
      roughness: 0.72,
      metalness: 0.08,
    });
    const accentCyanMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.75,
      roughness: 0.25,
      metalness: 0.3,
    });
    const ccwMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8, // Blue for s_i = +1 (CCW)
      roughness: 0.28,
      metalness: 0.35,
    });
    const cwMat = new THREE.MeshStandardMaterial({
      color: 0xfb923c, // Orange for s_i = -1 (CW)
      roughness: 0.28,
      metalness: 0.35,
    });
    const greenLedMat = new THREE.MeshBasicMaterial({color: 0x22c55e});
    const redLedMat = new THREE.MeshBasicMaterial({color: 0xef4444});
    const whiteLedMat = new THREE.MeshBasicMaterial({color: 0xf8fafc});

    this.disposables.push(
      carbonMat,
      aluminumMat,
      avionicsMat,
      batteryMat,
      accentCyanMat,
      ccwMat,
      cwMat,
      greenLedMat,
      redLedMat,
      whiteLedMat,
    );

    // 1. Primary Silhouette: Central cylindrical fuselage (r = 0.13 m, h = 0.20 m)
    const fuselageGeo = new THREE.CylinderGeometry(
      OCTA_PARAMS.rFuselage,
      OCTA_PARAMS.rFuselage,
      OCTA_PARAMS.hFuselage * 0.72,
      32,
    );
    const fuselageMesh = new THREE.Mesh(fuselageGeo, carbonMat);
    fuselageMesh.castShadow = true;
    fuselageMesh.receiveShadow = true;
    this.add(fuselageMesh);
    this.disposables.push(fuselageGeo);

    // 2. Upper LatheGeometry avionics canopy dome
    const domePoints = [
      new THREE.Vector2(0.0, 0.065),
      new THREE.Vector2(0.075, 0.06),
      new THREE.Vector2(0.115, 0.036),
      new THREE.Vector2(0.13, 0.0),
    ];
    const domeGeo = new THREE.LatheGeometry(domePoints, 32);
    const domeMesh = new THREE.Mesh(domeGeo, avionicsMat);
    domeMesh.position.y = OCTA_PARAMS.hFuselage * 0.36;
    domeMesh.castShadow = true;
    this.add(domeMesh);
    this.disposables.push(domeGeo);

    // 3. Top hub flange ring (where arms clamp at +0.04 m)
    const flangeGeo = new THREE.CylinderGeometry(0.145, 0.145, 0.018, 32);
    const flangeMesh = new THREE.Mesh(flangeGeo, aluminumMat);
    flangeMesh.position.y = OCTA_PARAMS.hr - 0.015;
    flangeMesh.castShadow = true;
    this.add(flangeMesh);
    this.disposables.push(flangeGeo);

    // 4. Lower battery / payload module
    const bayGeo = new THREE.BoxGeometry(0.18, 0.065, 0.22);
    const bayMesh = new THREE.Mesh(bayGeo, batteryMat);
    bayMesh.position.y = -0.095;
    bayMesh.castShadow = true;
    this.add(bayMesh);
    this.disposables.push(bayGeo);

    // 5. Dual TubeGeometry carbon landing skids
    const skidCrossGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.24, 12);
    const skidRunnerGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.44, 12);
    skidRunnerGeo.rotateX(Math.PI / 2);
    this.disposables.push(skidCrossGeo, skidRunnerGeo);

    for (const side of [-1, 1]) {
      const xPos = side * 0.14;
      const runner = new THREE.Mesh(skidRunnerGeo, carbonMat);
      runner.position.set(xPos, -0.21, 0);
      runner.castShadow = true;
      this.add(runner);

      for (const zOff of [-0.11, 0.11]) {
        const strut = new THREE.Mesh(skidCrossGeo, aluminumMat);
        strut.position.set(xPos * 0.72, -0.145, zOff);
        strut.rotation.z = side * 0.35;
        strut.castShadow = true;
        this.add(strut);
      }
    }

    // 6. Nose forward direction indicator & FPV camera housing (-Z = +x_b)
    const noseBarGeo = new THREE.BoxGeometry(0.11, 0.022, 0.04);
    const noseBar = new THREE.Mesh(noseBarGeo, accentCyanMat);
    noseBar.position.set(0, 0.015, -OCTA_PARAMS.rFuselage - 0.015);
    this.add(noseBar);
    this.disposables.push(noseBarGeo);

    const camHousingGeo = new THREE.CylinderGeometry(0.022, 0.024, 0.036, 16);
    camHousingGeo.rotateX(Math.PI / 2);
    const camHousing = new THREE.Mesh(camHousingGeo, aluminumMat);
    camHousing.position.set(0, -0.04, -OCTA_PARAMS.rFuselage - 0.025);
    this.add(camHousing);
    this.disposables.push(camHousingGeo);

    // 7. GPS Mast on top rear
    const mastGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.09, 10);
    const puckGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.012, 20);
    const mast = new THREE.Mesh(mastGeo, aluminumMat);
    mast.position.set(0, 0.145, 0.05);
    const puck = new THREE.Mesh(puckGeo, avionicsMat);
    puck.position.set(0, 0.19, 0.05);
    this.add(mast, puck);
    this.disposables.push(mastGeo, puckGeo);

    // 8. 8 Arms, Motor Mounts, Brushless Motors, Hubs, 15-inch Propellers & Color Discs
    const armLen = OCTA_PARAMS.L - 0.11;
    const armGeo = new THREE.CylinderGeometry(0.012, 0.014, armLen, 12);
    armGeo.rotateX(Math.PI / 2); // aligned along Z initially

    const mountGeo = new THREE.CylinderGeometry(0.028, 0.026, 0.024, 20);
    const bellGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.026, 20);
    const hubGeo = new THREE.CylinderGeometry(0.014, 0.018, 0.014, 16);
    const bladeGeo = new THREE.BoxGeometry(OCTA_PARAMS.R * 2, 0.004, 0.028);
    const discGeo = new THREE.RingGeometry(0.028, OCTA_PARAMS.R, 36);
    discGeo.rotateX(-Math.PI / 2);

    const ledGeo = new THREE.SphereGeometry(0.01, 10, 10);
    this.disposables.push(armGeo, mountGeo, bellGeo, hubGeo, bladeGeo, discGeo, ledGeo);

    for (const spec of ROTOR_SPECS) {
      const isCCW = spec.s === 1;
      const propMat = isCCW ? ccwMat : cwMat;

      // FRD (x, y, z) -> Three.js local (y, -z, -x)
      const lx = spec.y;
      const ly = -spec.z; // +0.06 m above CG
      const lz = -spec.x;

      // Arm from inner hub radius (0.11 m) to motor center (0.52 m)
      const armDir = new THREE.Vector3(lx, 0, lz).normalize();
      const midDist = 0.11 + armLen * 0.5;
      const armMesh = new THREE.Mesh(armGeo, carbonMat);
      armMesh.position.set(armDir.x * midDist, ly - 0.016, armDir.z * midDist);
      armMesh.lookAt(lx, ly - 0.016, lz);
      armMesh.castShadow = true;
      this.add(armMesh);

      // Motor mount + bell
      const mount = new THREE.Mesh(mountGeo, aluminumMat);
      mount.position.set(lx, ly - 0.012, lz);
      mount.castShadow = true;
      this.add(mount);

      const bell = new THREE.Mesh(bellGeo, propMat);
      bell.position.set(lx, ly + 0.008, lz);
      bell.castShadow = true;
      this.add(bell);

      // Tip navigation LED under motor mount
      const ledMat = spec.y > 0.05 ? greenLedMat : spec.y < -0.05 ? redLedMat : whiteLedMat;
      const led = new THREE.Mesh(ledGeo, ledMat);
      led.position.set(lx, ly - 0.026, lz);
      this.add(led);

      // Spinning rotor assembly
      const spinGroup = new THREE.Group();
      spinGroup.position.set(lx, ly + 0.022, lz);

      const hub = new THREE.Mesh(hubGeo, aluminumMat);
      const bladeA = new THREE.Mesh(bladeGeo, propMat);
      bladeA.rotation.x = isCCW ? 0.16 : -0.16;
      bladeA.castShadow = true;
      spinGroup.add(hub, bladeA);

      this.add(spinGroup);
      this.rotorSpinGroups.push(spinGroup);

      // Motion-blur translucent disc (blue = CCW, orange = CW)
      const discMat = new THREE.MeshBasicMaterial({
        color: isCCW ? 0x38bdf8 : 0xfb923c,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      this.disposables.push(discMat);

      const disc = new THREE.Mesh(discGeo, discMat);
      disc.position.set(lx, ly + 0.022, lz);
      this.add(disc);
      this.rotorDiscs.push(disc);
      this.rotorDiscMaterials.push(discMat);
    }

    // Optional debug vectors (in world space, attached outside body rotation)
    this.thrustArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(),
      1.0,
      0x38bdf8,
      0.18,
      0.09,
    );
    this.velocityArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(),
      1.0,
      0x22c55e,
      0.18,
      0.09,
    );
    this.windArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(),
      1.0,
      0xf59e0b,
      0.18,
      0.09,
    );
    this.vectorsGroup.add(this.thrustArrow, this.velocityArrow, this.windArrow);
    this.vectorsGroup.visible = false;
  }

  public setVectorsVisible(visible: boolean): void {
    this.showVectors = visible;
    this.vectorsGroup.visible = visible;
  }

  /**
   * Synchronizes Three.js transform from physics state y[0..19] and spins blades proportionally to omega_i.
   */
  public syncFromPhysics(
    y: Float64Array,
    vInertial: Float64Array,
    windInertial: Float64Array,
    totalThrust: number,
    dt: number,
  ): void {
    // 1. NED (xN, yE, zD) -> Three.js (yE, -zD, -xN)
    // Add +0.215 m vertical offset at ground contact so skids sit flush on y = 0 when h = 0
    this.position.set(y[1], -y[2] + 0.215, -y[0]);

    // 2. Euler ZYX (phi, theta, psi) -> R_IB -> R_three = M_TN * R_IB * M_TN^T
    const phi = y[3];
    const theta = y[4];
    const psi = y[5];

    const cph = Math.cos(phi);
    const sph = Math.sin(phi);
    const cth = Math.cos(theta);
    const sth = Math.sin(theta);
    const cps = Math.cos(psi);
    const sps = Math.sin(psi);

    const r00 = cth * cps;
    const r01 = sph * sth * cps - cph * sps;
    const r02 = cph * sth * cps + sph * sps;
    const r10 = cth * sps;
    const r11 = sph * sth * sps + cph * cps;
    const r12 = cph * sth * sps - sph * cps;
    const r20 = -sth;
    const r21 = sph * cth;
    const r22 = cph * cth;

    // M_TN = [0 1 0; 0 0 -1; -1 0 0] -> row/col permutation of R_IB:
    // Row 0 (X = +E): [ r11, -r12, -r10 ]
    // Row 1 (Y = -D): [-r21,  r22,  r20 ]
    // Row 2 (Z = -N): [-r01,  r02,  r00 ]
    _mThree.set(
      r11, -r12, -r10, 0,
      -r21, r22, r20, 0,
      -r01, r02, r00, 0,
      0, 0, 0, 1,
    );
    this.quaternion.setFromRotationMatrix(_mThree);

    // 3. Spin propellers proportionally to omega_i (with visual strobe clamp for crisp 60fps blade read)
    for (let i = 0; i < 8; i++) {
      const wi = Math.max(0, y[12 + i]);
      const s = ROTOR_SPECS[i].s;
      if (wi > 0.5) {
        const visualOmega = Math.min(wi * 0.085, 42);
        this.rotorSpinGroups[i].rotation.y += s * visualOmega * dt;
      }

      const norm = (wi - OCTA_PARAMS.omegaMin) / (OCTA_PARAMS.omegaMax - OCTA_PARAMS.omegaMin);
      this.rotorDiscMaterials[i].opacity = wi < 2.0 ? 0.0 : 0.06 + Math.max(0, Math.min(1, norm)) * 0.24;
    }

    // 4. Optional world-space debug vectors
    if (this.showVectors) {
      this.vectorsGroup.position.copy(this.position);

      // Thrust vector along body up (+Y in local Three.js)
      _velDir.set(0, 1, 0).applyQuaternion(this.quaternion).normalize();
      this.thrustArrow.setDirection(_velDir);
      this.thrustArrow.setLength(Math.max(0.3, (totalThrust / (OCTA_PARAMS.m * OCTA_PARAMS.g)) * 0.9), 0.16, 0.08);

      // Velocity vector
      const vMag = Math.hypot(vInertial[0], vInertial[1], vInertial[2]);
      if (vMag > 0.15) {
        this.velocityArrow.visible = true;
        _velDir.set(vInertial[1], -vInertial[2], -vInertial[0]).normalize();
        this.velocityArrow.setDirection(_velDir);
        this.velocityArrow.setLength(Math.min(3.5, 0.35 + vMag * 0.14), 0.16, 0.08);
      } else {
        this.velocityArrow.visible = false;
      }

      // Wind vector
      const wMag = Math.hypot(windInertial[0], windInertial[1], windInertial[2]);
      if (wMag > 0.2) {
        this.windArrow.visible = true;
        _windDir.set(windInertial[1], -windInertial[2], -windInertial[0]).normalize();
        this.windArrow.setDirection(_windDir);
        this.windArrow.setLength(Math.min(3.0, 0.35 + wMag * 0.16), 0.16, 0.08);
      } else {
        this.windArrow.visible = false;
      }
    }
  }

  public dispose(): void {
    for (const item of this.disposables) {
      item.dispose();
    }
  }
}
