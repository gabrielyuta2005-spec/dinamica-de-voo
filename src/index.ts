import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {registerSW} from 'virtual:pwa-register';
import * as xb from 'xrblocks';

import {PropellerAudio} from './audio/PropellerAudio';
import {GamepadManager} from './input/GamepadManager';
import {DERIVED_CONSTANTS, Octacoptero} from './physics/OctacopterModel';
import {ValidationManeuver} from './physics/ValidationManeuver';
import {WindSystem} from './physics/WindSystem';
import {EnvironmentManager} from './scene/Environments';
import {OctacopterMesh} from './scene/OctacopterMesh';
import type {CameraMode, FlightMode, ScenarioId, TelemetrySnapshot, VRMode, WindPresetId} from './types';
import {SimulatorUI} from './ui/SimulatorUI';

const PHYSICS_DT = 0.005; // 200 Hz RK4 fixed timestep (h = 5 ms)
const MAX_SUBSTEPS = 10; // Prevents spiral of death

// Pre-allocated scratch vectors for camera & telemetry (Zero GC in frame loop)
const _camTargetPos = new THREE.Vector3();
const _camLookAt = new THREE.Vector3();
const _camOffset = new THREE.Vector3();
const _forwardDir = new THREE.Vector3();
const _rendererSize = new THREE.Vector2();
const _vInertial = new Float64Array(3);

function detectSoftwareWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

class OctacopterSimulatorScript extends xb.Script {
  private readonly physics = new Octacoptero();
  private readonly wind = new WindSystem();
  private readonly validation = new ValidationManeuver();
  private readonly gamepad = new GamepadManager();
  private readonly audio = new PropellerAudio();

  private octoMesh!: OctacopterMesh;
  private envManager!: EnvironmentManager;
  private ui!: SimulatorUI;
  private orbitControls!: OrbitControls;

  // Optional VR-only spatial telemetry card & observer rig (hidden on desktop)
  private vrCard?: xb.UICard;
  private vrTelemetryText?: xb.UIText;
  private vrRig = new THREE.Group();
  private vrMode: VRMode = 'off';
  private isVRActive = false;
  private readonly stereoCamera = new THREE.StereoCamera();

  private cameraMode: CameraMode = 'chase';
  private accumulator = 0;
  private lastPerfTime = 0;
  private isSoftwareGl = false;
  private prevDronePos = new THREE.Vector3(0, 50.215, 0);

  private readonly telemetry: TelemetrySnapshot = {
    simTime: 0,
    xN: 0,
    yE: 0,
    zD: -50,
    altitude: 50,
    phiDeg: 0,
    thetaDeg: 0,
    psiDeg: 0,
    u: 0,
    v: 0,
    w: 0,
    vHorizontal: 0,
    vHorizontalKmh: 0,
    vClimb: 0,
    pDeg: 0,
    qDeg: 0,
    rDeg: 0,
    omega: this.physics.y.subarray(12, 20),
    thrusts: this.physics.rotorThrusts,
    totalThrust: DERIVED_CONSTANTS.weightN,
    thrustToWeight: 1.0,
    shaftPowerW: DERIVED_CONSTANTS.hoverPowerW,
    motorsArmed: true,
    windInertial: [0, 0, 0],
    windSpeed: 0,
    flightMode: 'stabilized',
    validationActive: false,
    validationTime: 0,
    validationPhaseLabel: 'Inativo',
    slalomGatesPassed: 0,
    slalomTotalGates: 8,
    slalomElapsedSec: 0,
  };

  init(): void {
    this.isSoftwareGl = detectSoftwareWebGL();
    const renderer = xb.core.renderer as THREE.WebGLRenderer;
    const scene = xb.core.scene;
    const camera = xb.core.camera;

    // Configure studio color & shadow pipeline
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !this.isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Perspective camera tailored for 3D flight simulation
    camera.fov = 62;
    camera.near = 0.08;
    camera.far = 1600;
    camera.updateProjectionMatrix();

    // Environments & Lighting
    this.envManager = new EnvironmentManager(scene, renderer, this.isSoftwareGl);

    // 3D Octocopter composite model
    this.octoMesh = new OctacopterMesh();
    this.add(this.octoMesh);
    this.add(this.octoMesh.vectorsGroup);

    // Free OrbitControls (active only in 'free' camera mode)
    this.orbitControls = new OrbitControls(camera, renderer.domElement);
    this.orbitControls.enableDamping = !this.isSoftwareGl;
    this.orbitControls.dampingFactor = 0.08;
    this.orbitControls.enabled = false;
    this.orbitControls.maxDistance = 280;
    this.orbitControls.minDistance = 0.8;

    // VR observer rig + spatial telemetry card (shown ONLY when user explicitly activates VR)
    this.vrRig.name = 'VRObserverRig';
    this.add(this.vrRig);

    this.vrTelemetryText = new xb.UIText({
      text: 'OctaSim 6-DOF VR',
      style: {fontSize: 22, whiteSpace: 'pre-line'},
    });
    this.vrCard = new xb.UICard({
      size: {width: 0.72, height: 'auto'},
      style: {padding: 18, gap: 8},
      children: [this.vrTelemetryText],
    });
    this.vrCard.visible = false;
    this.vrCard.position.set(0, 0.55, -1.7);
    this.vrRig.add(this.vrCard);

    // Initialize physics at 50 m hover
    this.physics.resetToHover(50.0);
    this.physics.getInertialVelocity(_vInertial);
    this.octoMesh.syncFromPhysics(
      this.physics.y,
      _vInertial,
      this.wind.currentWind,
      this.physics.totalThrust,
      0,
    );
    this.prevDronePos.copy(this.octoMesh.position);

    // Initial chase camera placement
    camera.position.set(0, 51.35, 3.4);
    camera.lookAt(0, 50.2, 0);

    // Mount HUD UI
    const hudRoot = document.getElementById('hud-root')!;
    this.ui = new SimulatorUI(hudRoot, this.gamepad, this.wind, {
      onFlightModeChange: (mode: FlightMode) => {
        this.validation.stop();
        this.physics.flightMode = mode;
        this.physics.psiRef = this.physics.y[5];
        this.physics.zDRef = this.physics.y[2];
        this.physics.velIntError.fill(0);
      },
      onCameraModeChange: (cam: CameraMode) => {
        this.setCameraMode(cam);
      },
      onScenarioChange: (scenario: ScenarioId) => {
        this.envManager.setScenario(scenario);
        if (scenario === 'slalom') {
          this.validation.stop();
          this.physics.resetToHover(12.0, 0, 0, 0);
          this.snapCameraToDrone();
        }
      },
      onResetHover: () => {
        this.validation.stop();
        this.physics.flightMode = 'stabilized';
        this.ui.setFlightModeActive('stabilized');
        this.physics.resetToHover(50.0);
        this.envManager.resetSlalom();
        this.snapCameraToDrone();
      },
      onResetGround: () => {
        this.validation.stop();
        this.physics.flightMode = 'stabilized';
        this.ui.setFlightModeActive('stabilized');
        this.physics.resetToGround();
        this.envManager.resetSlalom();
        this.snapCameraToDrone();
      },
      onToggleValidation: () => {
        if (this.validation.active) {
          this.validation.stop();
        } else {
          this.physics.flightMode = 'stabilized';
          this.ui.setFlightModeActive('stabilized');
          this.physics.resetToHover(50.0);
          this.snapCameraToDrone();
          this.validation.start();
        }
      },
      onTriggerGust: () => {
        this.wind.triggerInstantGust();
      },
      onWindPreset: (preset: WindPresetId) => {
        this.wind.applyPreset(preset);
      },
      onToggleVectors: (show: boolean) => {
        this.octoMesh.setVectorsVisible(show);
      },
      onToggleAudio: () => {
        return this.audio.toggle();
      },
      onToggleVR: () => {
        void this.toggleVR();
      },
    });

    // Keyboard hotkeys
    this.gamepad.onHotkey = (code) => {
      if (code === 'Space') {
        this.validation.stop();
        if (!this.physics.motorsArmed) {
          this.physics.armMotors();
        }
        this.physics.flightMode = 'stabilized';
        this.ui.setFlightModeActive('stabilized');
        // Zero rates/velocity tilt trim and lock current altitude & heading
        this.physics.zDRef = this.physics.y[2];
        this.physics.psiRef = this.physics.y[5];
        this.physics.velIntError.fill(0);
      } else if (code === 'KeyR') {
        this.validation.stop();
        this.physics.resetToHover(50.0);
        this.snapCameraToDrone();
      } else if (code === 'KeyC') {
        const order: CameraMode[] = ['chase', 'fpv', 'top', 'free'];
        const next = order[(order.indexOf(this.cameraMode) + 1) % order.length];
        this.ui.setCameraActive(next);
      } else if (code === 'KeyH') {
        this.ui.toggleDock();
      }
    };

    // Update VR button status based on WebXR capability (disabled natively by default)
    this.stereoCamera.eyeSep = 0.064;
    this.stereoCamera.aspect = 0.5;
    const mgr = xb.core.webXRSessionManager;
    if (mgr) {
      mgr.addEventListener(xb.WebXRSessionEventType.READY, () => {
        this.ui.setVRState(this.vrMode, true);
      });
      mgr.addEventListener(xb.WebXRSessionEventType.UNSUPPORTED, () => {
        this.ui.setVRState(this.vrMode, false);
      });
      mgr.addEventListener(xb.WebXRSessionEventType.SESSION_ERROR, () => {
        this.enableSBS(
          'Falha ao iniciar headset WebXR (sem runtime PCVR ativo ou bloqueado pelo iframe) — Modo VR Estéreo SBS ativado.',
        );
      });
      const supported = mgr.isXRSupported();
      if (supported !== undefined) {
        this.ui.setVRState(this.vrMode, Boolean(supported));
      }
    }

    if (!this.isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    this.lastPerfTime = performance.now();
  }

  private async toggleVR(): Promise<void> {
    const mgr = xb.core.webXRSessionManager;
    if (this.vrMode === 'webxr' && mgr) {
      await mgr.endSession();
      return;
    }
    if (this.vrMode === 'sbs') {
      this.disableSBS();
      return;
    }

    if (mgr?.isXRSupported()) {
      try {
        mgr.startSession();
      } catch {
        this.enableSBS(
          'Erro ao abrir sessão WebXR — usando VR Estéreo SBS. Para headset PCVR, abra fora do iframe ou via App Offline / .EXE.',
        );
      }
    } else {
      const inIframe = window.self !== window.top;
      const diag = inIframe
        ? 'WebXR bloqueado pelo iframe de preview — Modo VR Estéreo SBS ativo. Para conectar headset PCVR, instale via "PC / .EXE" ou abra fora do iframe.'
        : 'Nenhum headset WebXR detectado (SteamVR / Quest Link fechado) — Modo VR Estéreo SBS ativo no PC.';
      this.enableSBS(diag);
    }
  }

  private enableSBS(diagMessage = ''): void {
    this.vrMode = 'sbs';
    const renderer = xb.core.renderer as THREE.WebGLRenderer;
    this.stereoCamera.eyeSep = 0.064;
    this.stereoCamera.aspect = 0.5;
    xb.core.renderSceneOverride = (r, scene, cam) => {
      const glRenderer = r as THREE.WebGLRenderer;
      const persp = cam as THREE.PerspectiveCamera;
      if (!persp.isPerspectiveCamera) {
        glRenderer.render(scene, cam);
        return;
      }
      glRenderer.getSize(_rendererSize);
      const w = _rendererSize.x;
      const h = _rendererSize.y;
      const halfW = Math.floor(w * 0.5);

      persp.updateMatrixWorld();
      this.stereoCamera.aspect = 0.5;
      this.stereoCamera.update(persp);

      glRenderer.setScissorTest(true);
      glRenderer.setScissor(0, 0, halfW, h);
      glRenderer.setViewport(0, 0, halfW, h);
      glRenderer.render(scene, this.stereoCamera.cameraL);

      glRenderer.setScissor(halfW, 0, w - halfW, h);
      glRenderer.setViewport(halfW, 0, w - halfW, h);
      glRenderer.render(scene, this.stereoCamera.cameraR);

      glRenderer.setScissorTest(false);
      glRenderer.setViewport(0, 0, w, h);
    };
    this.ui.setVRState('sbs', Boolean(xb.core.webXRSessionManager?.isXRSupported()), diagMessage);
  }

  private disableSBS(): void {
    xb.core.renderSceneOverride = undefined;
    const renderer = xb.core.renderer as THREE.WebGLRenderer;
    renderer.setScissorTest(false);
    renderer.getSize(_rendererSize);
    renderer.setViewport(0, 0, _rendererSize.x, _rendererSize.y);
    this.vrMode = 'off';
    this.ui.setVRState('off', Boolean(xb.core.webXRSessionManager?.isXRSupported()));
  }

  onXRSessionStarted(): void {
    if (this.vrMode === 'sbs') {
      this.disableSBS();
    }
    this.isVRActive = true;
    this.vrMode = 'webxr';

    // Attach camera to VR observer rig positioned right behind the drone
    this.vrRig.add(xb.core.camera);
    this.updateVRRigTransform(1.0);

    this.ui.setVRState('webxr', true);
    if (this.vrCard) this.vrCard.visible = true;
  }

  onXRSessionEnded(): void {
    this.isVRActive = false;
    this.vrMode = 'off';
    xb.core.scene.add(xb.core.camera);
    this.vrRig.position.set(0, 0, 0);
    this.vrRig.rotation.set(0, 0, 0);

    this.ui.setVRState('off', Boolean(xb.core.webXRSessionManager?.isXRSupported()));
    if (this.vrCard) this.vrCard.visible = false;
    this.snapCameraToDrone();
  }

  private updateVRRigTransform(alpha: number): void {
    const dronePos = this.octoMesh.position;
    const psi = this.physics.y[5];
    if (this.cameraMode === 'fpv') {
      _camTargetPos.set(dronePos.x, dronePos.y + 0.08, dronePos.z);
    } else {
      _camTargetPos.set(
        dronePos.x - Math.sin(psi) * 3.2,
        Math.max(0.2, dronePos.y + 0.35),
        dronePos.z + Math.cos(psi) * 3.2,
      );
    }
    this.vrRig.position.lerp(_camTargetPos, alpha);
    this.vrRig.rotation.set(0, -psi, 0);
  }

  private setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    const isFree = mode === 'free';
    this.orbitControls.enabled = isFree;
    if (isFree) {
      this.orbitControls.target.copy(this.octoMesh.position);
      _camTargetPos.set(
        this.octoMesh.position.x + 2.2,
        this.octoMesh.position.y + 1.4,
        this.octoMesh.position.z + 2.8,
      );
      xb.core.camera.position.copy(_camTargetPos);
      this.orbitControls.update();
    } else {
      this.snapCameraToDrone();
    }
  }

  private snapCameraToDrone(): void {
    if (this.isVRActive || this.cameraMode === 'free') return;
    const camera = xb.core.camera;
    const pos = this.octoMesh.position;

    if (this.cameraMode === 'fpv') {
      _camOffset.set(0, 0.04, -0.18).applyQuaternion(this.octoMesh.quaternion);
      camera.position.copy(pos).add(_camOffset);
      _forwardDir.set(0, -0.05, -5.0).applyQuaternion(this.octoMesh.quaternion);
      camera.lookAt(_camLookAt.copy(pos).add(_forwardDir));
    } else if (this.cameraMode === 'top') {
      camera.position.set(pos.x, pos.y + 18, pos.z + 0.01);
      camera.lookAt(pos);
    } else {
      const psi = this.physics.y[5];
      camera.position.set(
        pos.x - Math.sin(psi) * 3.4,
        pos.y + 1.25,
        pos.z + Math.cos(psi) * 3.4,
      );
      camera.lookAt(pos);
    }
  }

  update(): void {
    const now = performance.now();
    const rawDt = (now - this.lastPerfTime) * 0.001;
    this.lastPerfTime = now;
    const frameDt = Math.min(Math.max(rawDt, 0.0005), 0.05);

    // 1. Poll gamepad / keyboard Mode 2 input
    const stick = this.gamepad.poll(frameDt);

    // Allow pilot to take manual control immediately if sticks move during 62s Validation
    if (
      this.validation.active &&
      (Math.abs(stick.throttle) > 0.15 ||
        Math.abs(stick.roll) > 0.15 ||
        Math.abs(stick.pitch) > 0.15 ||
        Math.abs(stick.yaw) > 0.15)
    ) {
      this.validation.stop();
      this.physics.zDRef = this.physics.y[2];
      this.physics.psiRef = this.physics.y[5];
    }

    // 2. Fixed-timestep 200 Hz RK4 physics accumulator
    this.accumulator += frameDt;
    let substeps = 0;
    while (this.accumulator >= PHYSICS_DT && substeps < MAX_SUBSTEPS) {
      const windVec = this.wind.update(PHYSICS_DT);
      const extVelRef = this.validation.update(PHYSICS_DT);

      this.physics.computeControl(
        PHYSICS_DT,
        stick,
        windVec,
        this.gamepad.settings.maxTiltDeg,
        this.gamepad.settings.maxYawRateDeg,
        this.gamepad.settings.maxClimbRate,
        this.gamepad.settings.vortexRingLimit,
        extVelRef,
      );

      this.physics.stepRK4(PHYSICS_DT, windVec, true);
      this.accumulator -= PHYSICS_DT;
      substeps++;
    }
    if (substeps === MAX_SUBSTEPS) {
      this.accumulator = 0;
    }

    // 3. Sync 3D octocopter mesh
    this.physics.getInertialVelocity(_vInertial);
    this.octoMesh.syncFromPhysics(
      this.physics.y,
      _vInertial,
      this.wind.currentWind,
      this.physics.totalThrust,
      frameDt,
    );

    // 4. Update environment (light shadow frustum, windsock, wind particles, slalom)
    this.envManager.update(this.octoMesh.position, this.wind.currentWind, frameDt, this.physics.simTime);

    // 5. Update desktop camera or VR observer rig
    if (this.isVRActive) {
      const alpha = 1 - Math.exp(-7.5 * frameDt);
      this.updateVRRigTransform(alpha);
    } else {
      this.updateCamera(frameDt);
    }

    // 6. Update procedural propeller audio
    let sumW = 0;
    for (let i = 0; i < 8; i++) sumW += this.physics.y[12 + i];
    this.audio.update(sumW / 8, this.physics.shaftPowerW);

    // 7. Update telemetry snapshot & HUD
    const y = this.physics.y;
    const rad2deg = 180 / Math.PI;
    const vh = Math.hypot(_vInertial[0], _vInertial[1]);
    const vc = -_vInertial[2];

    this.telemetry.simTime = this.physics.simTime;
    this.telemetry.xN = y[0];
    this.telemetry.yE = y[1];
    this.telemetry.zD = y[2];
    this.telemetry.altitude = -y[2];
    this.telemetry.phiDeg = y[3] * rad2deg;
    this.telemetry.thetaDeg = y[4] * rad2deg;
    this.telemetry.psiDeg = y[5] * rad2deg;
    this.telemetry.u = y[6];
    this.telemetry.v = y[7];
    this.telemetry.w = y[8];
    this.telemetry.vHorizontal = vh;
    this.telemetry.vHorizontalKmh = vh * 3.6;
    this.telemetry.vClimb = vc;
    this.telemetry.pDeg = y[9] * rad2deg;
    this.telemetry.qDeg = y[10] * rad2deg;
    this.telemetry.rDeg = y[11] * rad2deg;
    this.telemetry.totalThrust = this.physics.totalThrust;
    this.telemetry.thrustToWeight = this.physics.totalThrust / DERIVED_CONSTANTS.weightN;
    this.telemetry.shaftPowerW = this.physics.shaftPowerW;
    this.telemetry.motorsArmed = this.physics.motorsArmed;
    this.telemetry.windInertial[0] = this.wind.currentWind[0];
    this.telemetry.windInertial[1] = this.wind.currentWind[1];
    this.telemetry.windInertial[2] = this.wind.currentWind[2];
    this.telemetry.windSpeed = Math.hypot(
      this.wind.currentWind[0],
      this.wind.currentWind[1],
      this.wind.currentWind[2],
    );
    this.telemetry.flightMode = this.physics.flightMode;
    this.telemetry.validationActive = this.validation.active;
    this.telemetry.validationTime = this.validation.elapsed;
    this.telemetry.validationPhaseLabel = this.validation.phaseLabel;
    this.telemetry.slalomGatesPassed = this.envManager.slalomPassed;
    this.telemetry.slalomTotalGates = this.envManager.slalomTotal;
    this.telemetry.slalomElapsedSec = this.envManager.slalomTimerSec;

    this.ui.update(this.telemetry, stick);

    if (this.isVRActive && this.vrTelemetryText) {
      const armState = this.physics.motorsArmed ? 'ARMADO' : 'DESATIVADO';
      this.vrTelemetryText.text =
        `[${armState}] Alt: ${this.telemetry.altitude.toFixed(1)} m | Vh: ${vh.toFixed(1)} m/s | Vc: ${vc.toFixed(1)} m/s\n` +
        `Roll: ${this.telemetry.phiDeg.toFixed(1)}° | Pitch: ${this.telemetry.thetaDeg.toFixed(1)}° | P: ${this.telemetry.shaftPowerW.toFixed(0)} W`;
    }
  }

  private updateCamera(dt: number): void {
    const camera = xb.core.camera;
    const dronePos = this.octoMesh.position;

    if (this.cameraMode === 'free') {
      // Shift OrbitControls target smoothly by drone delta so user can orbit moving drone
      const dx = dronePos.x - this.prevDronePos.x;
      const dy = dronePos.y - this.prevDronePos.y;
      const dz = dronePos.z - this.prevDronePos.z;
      this.orbitControls.target.x += dx;
      this.orbitControls.target.y += dy;
      this.orbitControls.target.z += dz;
      camera.position.x += dx;
      camera.position.y += dy;
      camera.position.z += dz;
      this.orbitControls.update();
    } else if (this.cameraMode === 'fpv') {
      _camOffset.set(0, 0.04, -0.18).applyQuaternion(this.octoMesh.quaternion);
      camera.position.copy(dronePos).add(_camOffset);
      _forwardDir.set(0, -0.08, -6.0).applyQuaternion(this.octoMesh.quaternion);
      camera.lookAt(_camLookAt.copy(dronePos).add(_forwardDir));
    } else if (this.cameraMode === 'top') {
      const alpha = 1 - Math.exp(-8 * dt);
      _camTargetPos.set(dronePos.x, dronePos.y + 18.0, dronePos.z + 0.01);
      camera.position.lerp(_camTargetPos, alpha);
      camera.lookAt(dronePos);
    } else {
      // Smooth Chase Cam behind drone heading (psi)
      const psi = this.physics.y[5];
      const dist = 3.4;
      const height = 1.15;
      _camTargetPos.set(
        dronePos.x - Math.sin(psi) * dist,
        Math.max(0.6, dronePos.y + height),
        dronePos.z + Math.cos(psi) * dist,
      );
      const alpha = 1 - Math.exp(-7.5 * dt);
      camera.position.lerp(_camTargetPos, alpha);
      _camLookAt.set(
        dronePos.x + Math.sin(psi) * 1.1,
        dronePos.y + 0.1,
        dronePos.z - Math.cos(psi) * 1.1,
      );
      camera.lookAt(_camLookAt);
    }

    this.prevDronePos.copy(dronePos);
  }

  dispose(): void {
    xb.core.renderSceneOverride = undefined;
    this.gamepad.dispose();
    this.audio.dispose();
    this.octoMesh.dispose();
    this.envManager.dispose();
    this.orbitControls.dispose();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    registerSW({immediate: true});
  }

  const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
  const options = new xb.Options();
  options.canvas = canvas;
  // VR is supported optionally via WebXR session, but disabled natively by default for Desktop 60fps flight
  options.enableVR();
  options.referenceSpaceType = 'local';
  options.webxrOptionalFeatures = ['local-floor', 'local'];
  options.xrButton.enabled = false;
  options.enableSimulator = false;
  options.reticles.enabled = false;
  options.controllers.enabledMouse = false;
  options.controllers.visualizeRays = false;
  options.setAppTitle('OctaSim 6-DOF');
  options.setAppDescription('Simulador de Voo 3D — Octacóptero Elétrico 8,0 kg');

  xb.add(new OctacopterSimulatorScript());
  void xb.init(options);
});
