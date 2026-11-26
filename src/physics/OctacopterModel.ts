import type {FlightMode, StickInput} from '../types';

/**
 * Physical, geometric, and aerodynamic constants for the 8.00 kg Planar Electric Octocopter
 * (SI Units, Body FRD frame, Inertial NED frame).
 */
export const OCTA_PARAMS = {
  // 1.1 Mass, Inertia, and Geometry
  m: 8.0, // kg (4.00 fuselage + 8*0.12 arms + 8*0.38 motor+ESC+prop)
  mFuselage: 4.0,
  rFuselage: 0.13,
  hFuselage: 0.2,
  mArm: 0.12,
  mMotorSet: 0.38,

  Ixx: 0.505, // kg*m^2
  Iyy: 0.505, // kg*m^2
  Izz: 0.962, // kg*m^2
  Jr: 3.0e-4, // kg*m^2

  numRotors: 8,
  L: 0.52, // m (CG to rotor axis)
  hr: 0.06, // m (rotor plane above CG -> z_i = -0.06 m)
  R: 0.19, // m (15-inch propeller)

  // 1.2 Aerodynamic, Propulsive, and Environmental Constants
  g: 9.80665, // m/s^2
  rho: 1.225, // kg/m^3
  CT: 0.0125,
  FM: 0.65,
  J0: 0.8,
  CH: 0.0025,
  CdAx: 0.1, // m^2
  CdAy: 0.14, // m^2
  CdAz: 0.25, // m^2
  tauM: 0.05, // s (motor time constant, pole at -20 s^-1)
  omegaMin: 60.0, // rad/s
  omegaMax: 560.0, // rad/s
  maxTiltDeg: 35.0, // deg operational limit

  // Cascade Controller Gains
  Kv: [1.6, 1.6, 2.8] as const,
  Ki: [0.35, 0.35, 0.9] as const,
  Kp: [40.0, 40.0, 10.0] as const,
  Kd: [10.0, 10.0, 5.0] as const,
} as const;

// Derived aerodynamic constants
const PI = Math.PI;
const CQ = Math.pow(OCTA_PARAMS.CT, 1.5) / (Math.SQRT2 * OCTA_PARAMS.FM);
const kT = OCTA_PARAMS.CT * OCTA_PARAMS.rho * PI * Math.pow(OCTA_PARAMS.R, 4);
const kQ = CQ * OCTA_PARAMS.rho * PI * Math.pow(OCTA_PARAMS.R, 5);
const cTau = kQ / kT;
const kTv = (PI * kT) / (OCTA_PARAMS.J0 * OCTA_PARAMS.R);
const kH = OCTA_PARAMS.CH * OCTA_PARAMS.rho * PI * Math.pow(OCTA_PARAMS.R, 3);
const weightN = OCTA_PARAMS.m * OCTA_PARAMS.g;
const hoverThrustPerRotor = weightN / OCTA_PARAMS.numRotors;
const hoverOmega = Math.sqrt(hoverThrustPerRotor / kT);
const maxThrustPerRotor = kT * OCTA_PARAMS.omegaMax * OCTA_PARAMS.omegaMax;
const minThrustPerRotor = kT * OCTA_PARAMS.omegaMin * OCTA_PARAMS.omegaMin;

export const DERIVED_CONSTANTS = {
  CQ,
  kT,
  kQ,
  cTau,
  kTv,
  kH,
  weightN,
  hoverThrustPerRotor,
  hoverOmega,
  hoverRpm: (hoverOmega * 60) / (2 * PI),
  hoverPowerW: 8 * kQ * Math.pow(hoverOmega, 3),
  hoverInducedVel: Math.sqrt(
    hoverThrustPerRotor / (2 * OCTA_PARAMS.rho * PI * OCTA_PARAMS.R * OCTA_PARAMS.R),
  ),
  maxThrustPerRotor,
  minThrustPerRotor,
} as const;

export interface RotorSpec {
  index: number;
  gammaDeg: number;
  gammaRad: number;
  x: number;
  y: number;
  z: number;
  s: 1 | -1; // +1 = CCW from above, -1 = CW from above
}

export const ROTOR_SPECS: readonly RotorSpec[] = Array.from({length: 8}, (_, idx) => {
  const gammaDeg = 22.5 + idx * 45;
  const gammaRad = (gammaDeg * PI) / 180;
  const s: 1 | -1 = idx % 2 === 0 ? 1 : -1;
  return {
    index: idx + 1,
    gammaDeg,
    gammaRad,
    x: OCTA_PARAMS.L * Math.cos(gammaRad),
    y: OCTA_PARAMS.L * Math.sin(gammaRad),
    z: -OCTA_PARAMS.hr,
    s,
  };
});

/**
 * Wrap angle to [-PI, PI)
 */
export function wrapAngleRad(angle: number): number {
  let a = (angle + PI) % (2 * PI);
  if (a < 0) a += 2 * PI;
  return a - PI;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Invert 4x4 symmetric positive-definite matrix using Gauss-Jordan elimination.
 */
function invert4x4(m: Float64Array): Float64Array {
  const a = new Float64Array(16);
  const inv = new Float64Array(16);
  a.set(m);
  for (let i = 0; i < 4; i++) inv[i * 4 + i] = 1;

  for (let i = 0; i < 4; i++) {
    let pivot = a[i * 4 + i];
    let pivotRow = i;
    for (let r = i + 1; r < 4; r++) {
      if (Math.abs(a[r * 4 + i]) > Math.abs(pivot)) {
        pivot = a[r * 4 + i];
        pivotRow = r;
      }
    }
    if (pivotRow !== i) {
      for (let c = 0; c < 4; c++) {
        const tmpA = a[i * 4 + c];
        a[i * 4 + c] = a[pivotRow * 4 + c];
        a[pivotRow * 4 + c] = tmpA;
        const tmpI = inv[i * 4 + c];
        inv[i * 4 + c] = inv[pivotRow * 4 + c];
        inv[pivotRow * 4 + c] = tmpI;
      }
    }
    const diag = a[i * 4 + i];
    for (let c = 0; c < 4; c++) {
      a[i * 4 + c] /= diag;
      inv[i * 4 + c] /= diag;
    }
    for (let r = 0; r < 4; r++) {
      if (r === i) continue;
      const factor = a[r * 4 + i];
      for (let c = 0; c < 4; c++) {
        a[r * 4 + c] -= factor * a[i * 4 + c];
        inv[r * 4 + c] -= factor * inv[i * 4 + c];
      }
    }
  }
  return inv;
}

/**
 * 20-State Nonlinear 6-DOF + 8-Motor Octocopter Flight Dynamics Engine
 * with Zero-Allocation Fixed-Step RK4 Integrator (h = 0.005 s).
 */
export class Octacoptero {
  // State vector y in R^20:
  // [0..2]: xN, yE, zD (NED inertial position, altitude = -zD)
  // [3..5]: phi, theta, psi (Euler 3-2-1)
  // [6..8]: u, v, w (Body FRD velocity)
  // [9..11]: p, q, r (Body FRD angular rates)
  // [12..19]: omega_1 .. omega_8 (Rotor speeds in rad/s)
  public readonly y = new Float64Array(20);
  public simTime = 0;

  // Control commands held (ZOH) over each RK4 step
  public readonly omegaCmd = new Float64Array(8);
  public readonly rotorThrusts = new Float64Array(8);
  public totalThrust = DERIVED_CONSTANTS.weightN;
  public shaftPowerW = DERIVED_CONSTANTS.hoverPowerW;

  // Cascade controller internal references & integrators
  public flightMode: FlightMode = 'stabilized';
  public motorsArmed = true;
  private disarmHoldTimer = 0;
  public psiRef = 0;
  public zDRef = -50; // starts at 50 m hover by default
  public readonly velIntError = new Float64Array(3); // [int_eN, int_eE, int_eD]
  public readonly vaxCurrent = new Float64Array(8);

  // Precomputed Moore-Penrose pseudoinverse Gamma^+ (8 x 4 flattened row-major: 8 rows, 4 cols)
  private readonly gammaPlus = new Float64Array(32);

  // Pre-allocated RK4 scratch arrays (zero GC in physics loop)
  private readonly k1 = new Float64Array(20);
  private readonly k2 = new Float64Array(20);
  private readonly k3 = new Float64Array(20);
  private readonly k4 = new Float64Array(20);
  private readonly yTmp = new Float64Array(20);
  private readonly Tdes = new Float64Array(8);
  private readonly uCtrl = new Float64Array(4); // [Tc, Lc, Mc, Nc]
  private readonly rBody = new Float64Array(9); // R_IB row-major
  private readonly vInertial = new Float64Array(3);

  // Rotor geometry flat arrays for fast inner loop
  private readonly rx = new Float64Array(8);
  private readonly ry = new Float64Array(8);
  private readonly rz = new Float64Array(8);
  private readonly rs = new Float64Array(8);

  constructor() {
    for (let i = 0; i < 8; i++) {
      this.rx[i] = ROTOR_SPECS[i].x;
      this.ry[i] = ROTOR_SPECS[i].y;
      this.rz[i] = ROTOR_SPECS[i].z;
      this.rs[i] = ROTOR_SPECS[i].s;
    }
    this.computeGammaPseudoinverse();
    this.resetToHover(50.0);
  }

  private computeGammaPseudoinverse(): void {
    // Gamma (4 x 8):
    // row 0: 1
    // row 1: -y_i
    // row 2: +x_i
    // row 3: cTau * s_i
    const gamma = new Float64Array(32);
    for (let i = 0; i < 8; i++) {
      gamma[0 * 8 + i] = 1.0;
      gamma[1 * 8 + i] = -this.ry[i];
      gamma[2 * 8 + i] = this.rx[i];
      gamma[3 * 8 + i] = DERIVED_CONSTANTS.cTau * this.rs[i];
    }

    // GGT = Gamma * Gamma^T (4 x 4)
    const ggt = new Float64Array(16);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = 0; k < 8; k++) {
          sum += gamma[r * 8 + k] * gamma[c * 8 + k];
        }
        ggt[r * 4 + c] = sum;
      }
    }

    const ggtInv = invert4x4(ggt);

    // Gamma^+ = Gamma^T * (Gamma * Gamma^T)^-1 (8 x 4)
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 4; j++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += gamma[k * 8 + i] * ggtInv[k * 4 + j];
        }
        this.gammaPlus[i * 4 + j] = sum;
      }
    }
  }

  public resetToHover(altitudeM = 50.0, xN = 0, yE = 0, psiRad = 0): void {
    this.y.fill(0);
    this.y[0] = xN;
    this.y[1] = yE;
    this.y[2] = -altitudeM;
    this.y[5] = wrapAngleRad(psiRad);

    for (let i = 0; i < 8; i++) {
      this.y[12 + i] = DERIVED_CONSTANTS.hoverOmega;
      this.omegaCmd[i] = DERIVED_CONSTANTS.hoverOmega;
      this.rotorThrusts[i] = DERIVED_CONSTANTS.hoverThrustPerRotor;
    }

    this.simTime = 0;
    this.motorsArmed = true;
    this.disarmHoldTimer = 0;
    this.psiRef = this.y[5];
    this.zDRef = this.y[2];
    this.velIntError.fill(0);
    this.totalThrust = DERIVED_CONSTANTS.weightN;
    this.shaftPowerW = DERIVED_CONSTANTS.hoverPowerW;
  }

  public resetToGround(): void {
    this.resetToHover(0.0, 0, 0, 0);
    this.motorsArmed = false;
    this.disarmHoldTimer = 0;
    for (let i = 0; i < 8; i++) {
      this.y[12 + i] = 0;
      this.omegaCmd[i] = 0;
      this.rotorThrusts[i] = 0;
    }
    this.totalThrust = 0;
    this.shaftPowerW = 0;
    this.zDRef = 0;
  }

  public armMotors(): void {
    this.motorsArmed = true;
    this.disarmHoldTimer = 0;
    this.zDRef = this.y[2];
    this.psiRef = this.y[5];
    this.velIntError.fill(0);
  }

  public disarmMotors(): void {
    this.motorsArmed = false;
    this.disarmHoldTimer = 0;
    this.omegaCmd.fill(0);
    this.velIntError.fill(0);
  }

  /**
   * Compute R_IB (body FRD -> inertial NED) into 9-element row-major buffer.
   */
  private computeRotationMatrix(phi: number, theta: number, psi: number, out: Float64Array): void {
    const cph = Math.cos(phi);
    const sph = Math.sin(phi);
    const cth = Math.cos(theta);
    const sth = Math.sin(theta);
    const cps = Math.cos(psi);
    const sps = Math.sin(psi);

    out[0] = cth * cps;
    out[1] = sph * sth * cps - cph * sps;
    out[2] = cph * sth * cps + sph * sps;

    out[3] = cth * sps;
    out[4] = sph * sth * sps + cph * cps;
    out[5] = cph * sth * sps - sph * cps;

    out[6] = -sth;
    out[7] = sph * cth;
    out[8] = cph * cth;
  }

  /**
   * Computes inertial velocity and rotor axial airspeed vax_i for control inversion.
   */
  private updateSensorDerived(windInertial: Float64Array): void {
    const phi = this.y[3];
    const theta = this.y[4];
    const psi = this.y[5];
    const u = this.y[6];
    const v = this.y[7];
    const w = this.y[8];
    const p = this.y[9];
    const q = this.y[10];
    const r = this.y[11];

    const R = this.rBody;
    this.computeRotationMatrix(phi, theta, psi, R);

    // v_I = R_IB * v_B
    this.vInertial[0] = R[0] * u + R[1] * v + R[2] * w;
    this.vInertial[1] = R[3] * u + R[4] * v + R[5] * w;
    this.vInertial[2] = R[6] * u + R[7] * v + R[8] * w;

    // v_ar = v_B - R_IB^T * v_wind
    const wx = windInertial[0];
    const wy = windInertial[1];
    const wz = windInertial[2];
    const varX = u - (R[0] * wx + R[3] * wy + R[6] * wz);
    const varY = v - (R[1] * wx + R[4] * wy + R[7] * wz);
    const varZ = w - (R[2] * wx + R[5] * wy + R[8] * wz);

    for (let i = 0; i < 8; i++) {
      // v_hub = v_ar + omega x r_i
      const hubZ = varZ + (p * this.ry[i] - q * this.rx[i]);
      // a_i = [0, 0, -1]^T -> v_ax = -hubZ
      this.vaxCurrent[i] = -hubZ;
    }
  }

  /**
   * Computes omegaCmd using either manual Mode 2 pilot input or external cascade velocity reference.
   */
  public computeControl(
    dt: number,
    stick: StickInput,
    windInertial: Float64Array,
    maxTiltDeg: number,
    maxYawRateDeg: number,
    maxClimbRate: number,
    vortexRingLimit: boolean,
    externalVelRef: Float64Array | null,
  ): void {
    this.updateSensorDerived(windInertial);

    // Handle Left Stick Down -> Disarm / Cut Motors; Left Stick Up -> Re-Arm
    if (externalVelRef) {
      this.motorsArmed = true;
      this.disarmHoldTimer = 0;
    } else {
      const altitude = -this.y[2];
      if (this.motorsArmed) {
        const onGroundDown = altitude <= 0.35 && stick.throttle <= -0.55;
        const fullDownAir = stick.throttle <= -0.88;
        if (onGroundDown) {
          this.disarmHoldTimer += dt;
          if (this.disarmHoldTimer >= 0.25) {
            this.disarmMotors();
            return;
          }
        } else if (fullDownAir) {
          this.disarmHoldTimer += dt;
          if (this.disarmHoldTimer >= 0.75) {
            this.disarmMotors();
            return;
          }
        } else {
          this.disarmHoldTimer = 0;
        }
      } else {
        // Re-arm smoothly as soon as left stick is pushed upward
        if (stick.throttle >= 0.15) {
          this.armMotors();
        } else {
          this.omegaCmd.fill(0);
          return;
        }
      }
    }

    const phi = this.y[3];
    const theta = this.y[4];
    const psi = this.y[5];
    const p = this.y[9];
    const q = this.y[10];
    const r = this.y[11];

    // Open-loop instability test mode (Q5: omega_cmd = omega_h + delta_stick, no feedback)
    if (this.flightMode === 'open_loop' && !externalVelRef) {
      const dColl = stick.throttle * 40.0;
      const dRoll = stick.roll * 18.0;
      const dPitch = stick.pitch * 18.0;
      const dYaw = stick.yaw * 22.0;

      for (let i = 0; i < 8; i++) {
        // Mixing perturbation proportional to geometry around hover omega_h
        const cmd =
          DERIVED_CONSTANTS.hoverOmega +
          dColl -
          (this.ry[i] / OCTA_PARAMS.L) * dRoll -
          (this.rx[i] / OCTA_PARAMS.L) * dPitch +
          this.rs[i] * dYaw;
        this.omegaCmd[i] = clamp(cmd, OCTA_PARAMS.omegaMin, OCTA_PARAMS.omegaMax);
      }
      return;
    }

    // Acro / Rate mode: direct angular rate control + thrust centered at weight
    if (this.flightMode === 'acro' && !externalVelRef) {
      const maxRateRad = (160 * Math.PI) / 180;
      const yawRateRad = (maxYawRateDeg * Math.PI) / 180;
      const pRef = stick.roll * maxRateRad;
      const qRef = -stick.pitch * maxRateRad;
      const rRef = stick.yaw * yawRateRad;

      const Tc = clamp(
        DERIVED_CONSTANTS.weightN * (1.0 + stick.throttle * 0.9),
        8 * DERIVED_CONSTANTS.minThrustPerRotor,
        8 * DERIVED_CONSTANTS.maxThrustPerRotor,
      );
      const Lc = OCTA_PARAMS.Ixx * (OCTA_PARAMS.Kd[0] * (pRef - p));
      const Mc = OCTA_PARAMS.Iyy * (OCTA_PARAMS.Kd[1] * (qRef - q));
      const Nc = OCTA_PARAMS.Izz * (OCTA_PARAMS.Kd[2] * (rRef - r));

      this.allocateAndInvert(Tc, Lc, Mc, Nc);
      return;
    }

    // Stabilized Cascade Controller
    const maxTiltRad = (Math.min(maxTiltDeg, OCTA_PARAMS.maxTiltDeg) * Math.PI) / 180;
    const maxYawRateRad = (maxYawRateDeg * Math.PI) / 180;
    const minClimbRate = vortexRingLimit ? -1.5 : -6.0;

    // 1. Vertical channel (altitude / climb rate)
    let vDRef = 0;
    if (externalVelRef) {
      vDRef = externalVelRef[2];
      this.zDRef = this.y[2];
    } else {
      const throttle = stick.throttle;
      if (Math.abs(throttle) > 0.001) {
        const desiredVc = throttle >= 0 ? throttle * maxClimbRate : throttle * Math.abs(minClimbRate);
        vDRef = -desiredVc; // NED down positive
        this.zDRef = this.y[2];
      } else {
        // Hold altitude at zDRef smoothly when left vertical stick is centered
        const altErr = this.zDRef - this.y[2];
        vDRef = clamp(altErr * 1.4, minClimbRate, maxClimbRate);
      }
    }

    const evZ = vDRef - this.vInertial[2];
    this.velIntError[2] = clamp(this.velIntError[2] + evZ * dt, -6.0, 6.0);
    const aDcmd = OCTA_PARAMS.Kv[2] * evZ + OCTA_PARAMS.Ki[2] * this.velIntError[2];

    // 2. Horizontal channels -> desired (phi_d, theta_d)
    let phiD = 0;
    let thetaD = 0;
    let aNcmd = 0;
    let aEcmd = 0;

    if (externalVelRef) {
      // Full outer velocity cascade (used by 62s validation maneuver)
      const evN = externalVelRef[0] - this.vInertial[0];
      const evE = externalVelRef[1] - this.vInertial[1];
      this.velIntError[0] = clamp(this.velIntError[0] + evN * dt, -8.0, 8.0);
      this.velIntError[1] = clamp(this.velIntError[1] + evE * dt, -8.0, 8.0);
      aNcmd = OCTA_PARAMS.Kv[0] * evN + OCTA_PARAMS.Ki[0] * this.velIntError[0];
      aEcmd = OCTA_PARAMS.Kv[1] * evE + OCTA_PARAMS.Ki[1] * this.velIntError[1];

      const cps = Math.cos(psi);
      const sps = Math.sin(psi);
      const axh = cps * aNcmd + sps * aEcmd;
      const ayh = -sps * aNcmd + cps * aEcmd;
      const gTerm = Math.max(2.0, OCTA_PARAMS.g - aDcmd);

      thetaD = Math.atan2(-axh, gTerm);
      phiD = Math.atan2(ayh, Math.hypot(axh, gTerm));
    } else {
      // Manual Mode 2: Right stick directly tilts (phi_d, theta_d) up to maxTiltRad
      // Push forward (stick.pitch > 0) -> nose down (theta_d < 0) -> accelerate along +x_b
      thetaD = -stick.pitch * maxTiltRad;
      phiD = stick.roll * maxTiltRad;
      this.velIntError[0] = 0;
      this.velIntError[1] = 0;
    }

    // Enforce operational tilt envelope epsilon_max = 35 deg
    const tiltMag = Math.hypot(phiD, thetaD);
    if (tiltMag > maxTiltRad) {
      const scale = maxTiltRad / tiltMag;
      phiD *= scale;
      thetaD *= scale;
    }

    // 3. Total thrust command Tc compensating for tilt cos(phi)*cos(theta)
    const cosTilt = Math.max(0.45, Math.cos(phi) * Math.cos(theta));
    let Tc: number;
    if (externalVelRef) {
      const gTerm = Math.max(2.0, OCTA_PARAMS.g - aDcmd);
      Tc = (OCTA_PARAMS.m * Math.hypot(aNcmd, aEcmd, gTerm)) / 1.0;
    } else {
      Tc = (OCTA_PARAMS.m * (OCTA_PARAMS.g - aDcmd)) / cosTilt;
    }

    // 4. Yaw reference integration
    const yawRateCmd = externalVelRef ? 0 : stick.yaw * maxYawRateRad;
    this.psiRef = wrapAngleRad(this.psiRef + yawRateCmd * dt);

    // 5. Inner Attitude Loop (Kp = diag(40,40,10), Kd = diag(10,10,5))
    const ePhi = phiD - phi;
    const eTheta = thetaD - theta;
    const ePsi = wrapAngleRad(this.psiRef - psi);

    const Lc = OCTA_PARAMS.Ixx * (OCTA_PARAMS.Kp[0] * ePhi - OCTA_PARAMS.Kd[0] * p);
    const Mc = OCTA_PARAMS.Iyy * (OCTA_PARAMS.Kp[1] * eTheta - OCTA_PARAMS.Kd[1] * q);
    const Nc =
      OCTA_PARAMS.Izz * (OCTA_PARAMS.Kp[2] * ePsi + OCTA_PARAMS.Kd[2] * (yawRateCmd - r));

    this.allocateAndInvert(Tc, Lc, Mc, Nc);
  }

  /**
   * Allocates [Tc, Lc, Mc, Nc] via Gamma^+, applies collective-shift desaturation
   * preserving moments, and analytically inverts T_i = k_T w^2 - k_Tv w v_ax.
   */
  private allocateAndInvert(Tc: number, Lc: number, Mc: number, Nc: number): void {
    this.uCtrl[0] = Tc;
    this.uCtrl[1] = Lc;
    this.uCtrl[2] = Mc;
    this.uCtrl[3] = Nc;

    const Tmin = DERIVED_CONSTANTS.minThrustPerRotor;
    const Tmax = DERIVED_CONSTANTS.maxThrustPerRotor;

    let minT = Infinity;
    let maxT = -Infinity;

    for (let i = 0; i < 8; i++) {
      const val =
        this.gammaPlus[i * 4 + 0] * this.uCtrl[0] +
        this.gammaPlus[i * 4 + 1] * this.uCtrl[1] +
        this.gammaPlus[i * 4 + 2] * this.uCtrl[2] +
        this.gammaPlus[i * 4 + 3] * this.uCtrl[3];
      this.Tdes[i] = val;
      if (val < minT) minT = val;
      if (val > maxT) maxT = val;
    }

    // Collective-shift desaturation preserving roll/pitch/yaw moments
    let shift = 0;
    if (minT < Tmin) {
      shift = Tmin - minT;
    } else if (maxT > Tmax) {
      shift = Tmax - maxT;
    }
    if (shift !== 0) {
      for (let i = 0; i < 8; i++) {
        this.Tdes[i] = clamp(this.Tdes[i] + shift, Tmin, Tmax);
      }
    }

    const kT_ = DERIVED_CONSTANTS.kT;
    const kTv_ = DERIVED_CONSTANTS.kTv;
    const twoKt = 2 * kT_;

    for (let i = 0; i < 8; i++) {
      const Ti = clamp(this.Tdes[i], Tmin, Tmax);
      const b = kTv_ * this.vaxCurrent[i];
      const disc = Math.max(0, b * b + 4 * kT_ * Ti);
      const wCmd = (b + Math.sqrt(disc)) / twoKt;
      this.omegaCmd[i] = clamp(wCmd, OCTA_PARAMS.omegaMin, OCTA_PARAMS.omegaMax);
    }
  }

  /**
   * Computes dy/dt = f(y, omegaCmd, windInertial) with ZERO allocations.
   */
  private computeDerivatives(
    state: Float64Array,
    omegaCmd: Float64Array,
    windInertial: Float64Array,
    out: Float64Array,
  ): void {
    const phi = state[3];
    const theta = state[4];
    const psi = state[5];
    const u = state[6];
    const v = state[7];
    const w = state[8];
    const p = state[9];
    const q = state[10];
    const r = state[11];

    const cph = Math.cos(phi);
    const sph = Math.sin(phi);
    const cthRaw = Math.cos(theta);
    const cth = Math.abs(cthRaw) < 1e-4 ? (cthRaw >= 0 ? 1e-4 : -1e-4) : cthRaw;
    const sth = Math.sin(theta);
    const tth = sth / cth;
    const cps = Math.cos(psi);
    const sps = Math.sin(psi);

    // R_IB
    const r00 = cth * cps;
    const r01 = sph * sth * cps - cph * sps;
    const r02 = cph * sth * cps + sph * sps;
    const r10 = cth * sps;
    const r11 = sph * sth * sps + cph * cps;
    const r12 = cph * sth * sps - sph * cps;
    const r20 = -sth;
    const r21 = sph * cth;
    const r22 = cph * cth;

    // 1. Inertial position kinematics: p_dot = R_IB * v_B
    out[0] = r00 * u + r01 * v + r02 * w;
    out[1] = r10 * u + r11 * v + r12 * w;
    out[2] = r20 * u + r21 * v + r22 * w;

    // 2. Euler kinematics: Theta_dot = W^-1(phi, theta) * omega
    out[3] = p + (q * sph + r * cph) * tth;
    out[4] = q * cph - r * sph;
    out[5] = (q * sph + r * cph) / cth;

    // 3. Relative airspeed in body frame: v_ar = v_B - R_IB^T * v_wind,I
    const wx = windInertial[0];
    const wy = windInertial[1];
    const wz = windInertial[2];
    const varX = u - (r00 * wx + r10 * wy + r20 * wz);
    const varY = v - (r01 * wx + r11 * wy + r21 * wz);
    const varZ = w - (r02 * wx + r12 * wy + r22 * wz);

    // 4. Rotor forces, moments, actuator derivatives, and gyroscopic terms
    let fAeroX = 0;
    let fAeroY = 0;
    let fAeroZ = 0;
    let mExtX = 0;
    let mExtY = 0;
    let mExtZ = 0;
    let hRotZ = 0; // sum(s_i * omega_i * a_i_z) = -sum(s_i * omega_i)
    let sumSjWdot = 0; // sum(s_i * wdot_i)

    const kT_ = DERIVED_CONSTANTS.kT;
    const kTv_ = DERIVED_CONSTANTS.kTv;
    const kH_ = DERIVED_CONSTANTS.kH;
    const cTau_ = DERIVED_CONSTANTS.cTau;
    const invTau = 1.0 / OCTA_PARAMS.tauM;

    const minCmd = this.motorsArmed ? OCTA_PARAMS.omegaMin : 0.0;
    for (let i = 0; i < 8; i++) {
      const wi = Math.max(0, state[12 + i]);
      const wCmd = clamp(omegaCmd[i], minCmd, OCTA_PARAMS.omegaMax);
      const wDot = (wCmd - wi) * invTau;
      out[12 + i] = wDot;

      const rx = this.rx[i];
      const ry = this.ry[i];
      const rz = this.rz[i];
      const si = this.rs[i];

      // v_hub = v_ar + omega x r_i
      const hubX = varX + (q * rz - r * ry);
      const hubY = varY + (r * rx - p * rz);
      const hubZ = varZ + (p * ry - q * rx);

      // a_i = [0, 0, -1]^T -> v_ax = -hubZ, v_ip = [hubX, hubY, 0]
      const vax = -hubZ;
      const Ti = kT_ * wi * wi - kTv_ * wi * vax;
      const Qi = cTau_ * Ti;
      const fHx = -kH_ * wi * hubX;
      const fHy = -kH_ * wi * hubY;

      // F_rot,i = [fHx, fHy, -Ti]
      const frX = fHx;
      const frY = fHy;
      const frZ = -Ti;

      fAeroX += frX;
      fAeroY += frY;
      fAeroZ += frZ;

      // r_i x F_rot,i
      mExtX += ry * frZ - rz * frY;
      mExtY += rz * frX - rx * frZ;
      mExtZ += rx * frY - ry * frX + si * Qi; // -s_i * Q_i * (-1) = +s_i * Q_i

      hRotZ -= OCTA_PARAMS.Jr * si * wi;
      sumSjWdot += si * wDot;
    }

    // 5. Fuselage parasitic drag: F_fus = -0.5 * rho * ||v_ar|| * diag(CdA) * v_ar
    const varNorm = Math.hypot(varX, varY, varZ);
    const dragCoeff = -0.5 * OCTA_PARAMS.rho * varNorm;
    fAeroX += dragCoeff * OCTA_PARAMS.CdAx * varX;
    fAeroY += dragCoeff * OCTA_PARAMS.CdAy * varY;
    fAeroZ += dragCoeff * OCTA_PARAMS.CdAz * varZ;

    // 6. Translational dynamics: v_dot = (1/m)(F_aero + m*g*R_IB^T*e_z) - omega x v_B
    const invM = 1.0 / OCTA_PARAMS.m;
    const gxB = OCTA_PARAMS.g * r20;
    const gyB = OCTA_PARAMS.g * r21;
    const gzB = OCTA_PARAMS.g * r22;

    out[6] = fAeroX * invM + gxB - (q * w - r * v);
    out[7] = fAeroY * invM + gyB - (r * u - p * w);
    out[8] = fAeroZ * invM + gzB - (p * v - q * u);

    // 7. Rotational dynamics:
    // I * omega_dot = M_ext - omega x (I*omega) - omega x h_rot - J_r * sum(s_i * wdot_i * a_i)
    const Ix = OCTA_PARAMS.Ixx * p;
    const Iy = OCTA_PARAMS.Iyy * q;
    const Iz = OCTA_PARAMS.Izz * r;

    const wCrossIwX = q * Iz - r * Iy;
    const wCrossIwY = r * Ix - p * Iz;
    const wCrossIwZ = p * Iy - q * Ix;

    // omega x [0, 0, hRotZ] = [q * hRotZ, -p * hRotZ, 0]
    const wCrossHx = q * hRotZ;
    const wCrossHy = -p * hRotZ;

    // -J_r * sum(s_i * wdot_i * [0,0,-1]) = [0, 0, +J_r * sumSjWdot]
    const mStartZ = OCTA_PARAMS.Jr * sumSjWdot;

    out[9] = (mExtX - wCrossIwX - wCrossHx) / OCTA_PARAMS.Ixx;
    out[10] = (mExtY - wCrossIwY - wCrossHy) / OCTA_PARAMS.Iyy;
    out[11] = (mExtZ - wCrossIwZ + mStartZ) / OCTA_PARAMS.Izz;
  }

  /**
   * Advances the 20-DOF state by one fixed RK4 step (h = 0.005 s) with ZOH on omegaCmd.
   */
  public stepRK4(h: number, windInertial: Float64Array, allowGroundClamp = true): void {
    const y = this.y;
    const k1 = this.k1;
    const k2 = this.k2;
    const k3 = this.k3;
    const k4 = this.k4;
    const yTmp = this.yTmp;

    this.computeDerivatives(y, this.omegaCmd, windInertial, k1);

    const h2 = 0.5 * h;
    for (let i = 0; i < 20; i++) yTmp[i] = y[i] + h2 * k1[i];
    this.computeDerivatives(yTmp, this.omegaCmd, windInertial, k2);

    for (let i = 0; i < 20; i++) yTmp[i] = y[i] + h2 * k2[i];
    this.computeDerivatives(yTmp, this.omegaCmd, windInertial, k3);

    for (let i = 0; i < 20; i++) yTmp[i] = y[i] + h * k3[i];
    this.computeDerivatives(yTmp, this.omegaCmd, windInertial, k4);

    const h6 = h / 6.0;
    for (let i = 0; i < 20; i++) {
      y[i] += h6 * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
    }
    for (let i = 12; i < 20; i++) {
      if (y[i] < 0) y[i] = 0;
    }

    // Wrap phi and psi to [-pi, pi)
    y[3] = wrapAngleRad(y[3]);
    y[5] = wrapAngleRad(y[5]);

    // Ground plane contact at zD = 0 (altitude h = -zD >= 0)
    if (allowGroundClamp && y[2] > 0) {
      y[2] = 0;
      // Damp downward velocity and ground friction
      this.computeRotationMatrix(y[3], y[4], y[5], this.rBody);
      const R = this.rBody;
      const vD = R[6] * y[6] + R[7] * y[7] + R[8] * y[8];
      if (vD > 0) {
        y[6] *= 0.85;
        y[7] *= 0.85;
        y[8] = Math.min(0, y[8]);
      }
      y[3] *= 0.85;
      y[4] *= 0.85;
      y[9] *= 0.7;
      y[10] *= 0.7;
      y[11] *= 0.85;
    }

    this.simTime += h;
    this.updateTelemetryMetrics(windInertial);
  }

  private updateTelemetryMetrics(windInertial: Float64Array): void {
    this.updateSensorDerived(windInertial);
    const kT_ = DERIVED_CONSTANTS.kT;
    const kTv_ = DERIVED_CONSTANTS.kTv;
    const kQ_ = DERIVED_CONSTANTS.kQ;
    const cTau_ = DERIVED_CONSTANTS.cTau;

    let sumT = 0;
    let sumP = 0;
    for (let i = 0; i < 8; i++) {
      const wi = Math.max(0, this.y[12 + i]);
      const Ti = wi > 1.0 ? Math.max(0, kT_ * wi * wi - kTv_ * wi * this.vaxCurrent[i]) : 0;
      const Qi = cTau_ * Ti;
      this.rotorThrusts[i] = Ti;
      sumT += Ti;
      sumP += Math.max(0, Qi * wi);
    }
    this.totalThrust = sumT;
    this.shaftPowerW = this.motorsArmed ? (sumP > 0 ? sumP : 8 * kQ_ * Math.pow(OCTA_PARAMS.omegaMin, 3)) : sumP;
  }

  public getInertialVelocity(out: Float64Array): void {
    this.computeRotationMatrix(this.y[3], this.y[4], this.y[5], this.rBody);
    const R = this.rBody;
    const u = this.y[6];
    const v = this.y[7];
    const w = this.y[8];
    out[0] = R[0] * u + R[1] * v + R[2] * w;
    out[1] = R[3] * u + R[4] * v + R[5] * w;
    out[2] = R[6] * u + R[7] * v + R[8] * w;
  }
}
