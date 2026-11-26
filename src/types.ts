export type FlightMode = 'stabilized' | 'acro' | 'open_loop';

export type CameraMode = 'chase' | 'fpv' | 'top' | 'free';

export type ScenarioId = 'ifsp' | 'cerrado' | 'urban' | 'slalom';

export type ControllerProfile = 'auto' | 'xbox' | 'playstation' | 'switch' | 'keyboard';

export type WindPresetId = 'calm' | 'breeze' | 'crosswind' | 'storm';

export interface AxisCalibration {
  min: number;
  center: number;
  max: number;
  inverted: boolean;
}

export interface ControllerSettings {
  profile: ControllerProfile;
  psAltAxes: boolean;
  deadzone: number; // 0.0 to 0.15
  expo: number; // 0.0 (linear) to 0.85 (cubic blend)
  maxTiltDeg: number; // 10 to 35
  maxYawRateDeg: number; // 30 to 180
  maxClimbRate: number; // 1.5 to 10.6 m/s
  vortexRingLimit: boolean; // limits descent to -1.5 m/s when enabled
  axes: [AxisCalibration, AxisCalibration, AxisCalibration, AxisCalibration];
}

export interface StickInput {
  throttle: number; // [-1, 1], 0 = hover center
  yaw: number; // [-1, 1], +1 = CW (right)
  roll: number; // [-1, 1], +1 = right wing down
  pitch: number; // [-1, 1], +1 = stick forward (nose down, forward flight)
  rawAxes: [number, number, number, number];
  shapedAxes: [number, number, number, number];
  sourceName: string;
  detectedType: Exclude<ControllerProfile, 'auto'>;
  gamepadConnected: boolean;
  gamepadId: string;
}

export interface WindConfig {
  speed: number; // 0..15 m/s
  azimuthDeg: number; // 0..360 deg (0 = blowing toward North, 90 = East)
  gustIntensity: number; // 0..10 m/s
  gustFrequency: number; // 0..1 normalized
  turbulenceEnabled: boolean;
}

export type VRMode = 'off' | 'webxr' | 'sbs';

export interface TelemetrySnapshot {
  simTime: number;
  xN: number;
  yE: number;
  zD: number;
  altitude: number;
  phiDeg: number;
  thetaDeg: number;
  psiDeg: number;
  u: number;
  v: number;
  w: number;
  vHorizontal: number;
  vHorizontalKmh: number;
  vClimb: number;
  pDeg: number;
  qDeg: number;
  rDeg: number;
  omega: Float64Array; // 8 rotor speeds [rad/s]
  thrusts: Float64Array; // 8 rotor thrusts [N]
  totalThrust: number;
  thrustToWeight: number;
  shaftPowerW: number;
  motorsArmed: boolean;
  windInertial: [number, number, number];
  windSpeed: number;
  flightMode: FlightMode;
  validationActive: boolean;
  validationTime: number;
  validationPhaseLabel: string;
  slalomGatesPassed: number;
  slalomTotalGates: number;
  slalomElapsedSec: number;
}
