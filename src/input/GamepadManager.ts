import type {
  AxisCalibration,
  ControllerProfile,
  ControllerSettings,
  StickInput,
} from '../types';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function createDefaultAxes(): [
  AxisCalibration,
  AxisCalibration,
  AxisCalibration,
  AxisCalibration,
] {
  return [
    {min: -1, center: 0, max: 1, inverted: false}, // 0: Left X (Yaw)
    {min: -1, center: 0, max: 1, inverted: true}, // 1: Left Y (Throttle - pushing up on stick gives negative raw Y -> +1 climb)
    {min: -1, center: 0, max: 1, inverted: false}, // 2: Right X (Roll)
    {min: -1, center: 0, max: 1, inverted: true}, // 3: Right Y (Pitch - pushing forward gives negative raw Y -> +1 nose down)
  ];
}

export type CalibrationStep = 'idle' | 'center' | 'extremes';

/**
 * Universal PC Gamepad + Keyboard Manager (Mode 2)
 * Supports Xbox, PlayStation (DualShock 4 / DualSense), Nintendo Switch Pro / Joy-Con Grip,
 * 1-click center/extremes calibration, axis inversion, deadzone, and Linear<->Expo curve shaping.
 */
export class GamepadManager {
  public settings: ControllerSettings = {
    profile: 'auto',
    psAltAxes: false,
    deadzone: 0.06,
    expo: 0.35,
    maxTiltDeg: 35,
    maxYawRateDeg: 110,
    maxClimbRate: 6.5,
    vortexRingLimit: true,
    axes: createDefaultAxes(),
  };

  public calibrationStep: CalibrationStep = 'idle';
  private calMin = [0, 0, 0, 0];
  private calMax = [0, 0, 0, 0];

  private readonly keysDown = new Set<string>();
  private keySmooth = [0, 0, 0, 0];

  private activeGamepadIndex: number | null = null;
  private onKeyDownBound: (e: KeyboardEvent) => void;
  private onKeyUpBound: (e: KeyboardEvent) => void;
  private onBlurBound: () => void;
  private onGamepadConnectedBound: (e: GamepadEvent) => void;
  private onGamepadDisconnectedBound: (e: GamepadEvent) => void;

  public onHotkey?: (code: string) => void;

  constructor() {
    this.onKeyDownBound = (e) => this.handleKeyDown(e);
    this.onKeyUpBound = (e) => this.handleKeyUp(e);
    this.onBlurBound = () => this.keysDown.clear();
    this.onGamepadConnectedBound = (e) => {
      this.activeGamepadIndex = e.gamepad.index;
    };
    this.onGamepadDisconnectedBound = (e) => {
      if (this.activeGamepadIndex === e.gamepad.index) {
        this.activeGamepadIndex = null;
      }
    };

    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);
    window.addEventListener('blur', this.onBlurBound);
    window.addEventListener('gamepadconnected', this.onGamepadConnectedBound);
    window.addEventListener('gamepaddisconnected', this.onGamepadDisconnectedBound);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (!e.repeat) {
      this.onHotkey?.(e.code);
    }

    if (
      e.code === 'ArrowUp' ||
      e.code === 'ArrowDown' ||
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight' ||
      e.code === 'Space'
    ) {
      e.preventDefault();
    }
    this.keysDown.add(e.code);
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keysDown.delete(e.code);
  }

  public isKeyHeld(code: string): boolean {
    return this.keysDown.has(code);
  }

  public detectProfileFromId(id: string): Exclude<ControllerProfile, 'auto'> {
    const lower = id.toLowerCase();
    if (
      lower.includes('nintendo') ||
      lower.includes('pro controller') ||
      lower.includes('joy-con') ||
      lower.includes('057e')
    ) {
      return 'switch';
    }
    if (
      lower.includes('dualshock') ||
      lower.includes('dualsense') ||
      lower.includes('playstation') ||
      lower.includes('054c') ||
      lower.includes('wireless controller')
    ) {
      return 'playstation';
    }
    if (
      lower.includes('xbox') ||
      lower.includes('xinput') ||
      lower.includes('045e') ||
      lower.includes('microsoft')
    ) {
      return 'xbox';
    }
    return 'xbox';
  }

  private getActiveGamepad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (!pads) return null;

    if (this.activeGamepadIndex !== null && pads[this.activeGamepadIndex]) {
      return pads[this.activeGamepadIndex];
    }
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i]!.connected) {
        this.activeGamepadIndex = i;
        return pads[i];
      }
    }
    return null;
  }

  private extractRawAxes(
    gp: Gamepad,
    profile: Exclude<ControllerProfile, 'auto'>,
  ): [number, number, number, number] {
    const ax = gp.axes;
    const a0 = ax[0] ?? 0;
    const a1 = ax[1] ?? 0;
    let a2 = ax[2] ?? 0;
    let a3 = ax[3] ?? 0;

    if (profile === 'playstation') {
      // Alternate DualShock/DualSense mapping on Firefox/Linux/DirectInput:
      // Right stick can appear on axes[2] and axes[5] (or axes[3] and axes[4] depending on driver)
      if (this.settings.psAltAxes || (gp.mapping !== 'standard' && ax.length >= 6)) {
        a2 = ax[2] ?? 0;
        a3 = ax[5] ?? ax[3] ?? 0;
      }
    } else if (profile === 'switch') {
      // Nintendo Switch Pro Controller via Bluetooth/DirectInput on PC:
      // Sometimes non-standard drivers map right stick to axes[2], axes[3] with ~0.72..0.85 max range
      // or axes[2], axes[5] when triggers are analog axes.
      if (gp.mapping !== 'standard' && ax.length >= 6 && Math.abs(ax[3] ?? 0) > 0.9 && Math.abs(ax[5] ?? 0) < 0.3) {
        // Likely axis 3/4 are triggers resting at -1/+1, right stick on 2 & 5
        a3 = ax[5] ?? 0;
      }
    }

    return [a0, a1, a2, a3];
  }

  /**
   * 1-Click Calibration Wizard for Switch Pro / PlayStation / Generic Bluetooth controllers
   */
  public startCalibration(): CalibrationStep {
    const gp = this.getActiveGamepad();
    if (!gp) {
      this.resetCalibration();
      return this.calibrationStep;
    }
    const profile =
      this.settings.profile === 'auto' ? this.detectProfileFromId(gp.id) : this.settings.profile;
    const raw = this.extractRawAxes(gp, profile === 'keyboard' ? 'xbox' : profile);

    // Capture current resting center immediately
    for (let i = 0; i < 4; i++) {
      this.settings.axes[i].center = raw[i];
      this.calMin[i] = raw[i];
      this.calMax[i] = raw[i];
    }
    this.calibrationStep = 'extremes';
    return this.calibrationStep;
  }

  public finishCalibration(): void {
    for (let i = 0; i < 4; i++) {
      const c = this.settings.axes[i].center;
      const minSpan = Math.abs(c - this.calMin[i]);
      const maxSpan = Math.abs(this.calMax[i] - c);
      // Only update min/max if user actually moved the stick significantly
      this.settings.axes[i].min = minSpan > 0.25 ? this.calMin[i] : -1;
      this.settings.axes[i].max = maxSpan > 0.25 ? this.calMax[i] : 1;
    }
    this.calibrationStep = 'idle';
  }

  public resetCalibration(): void {
    const currentInverts = this.settings.axes.map((a) => a.inverted);
    this.settings.axes = createDefaultAxes();
    for (let i = 0; i < 4; i++) {
      this.settings.axes[i].inverted = currentInverts[i];
    }
    this.calibrationStep = 'idle';
  }

  private normalizeAxis(raw: number, cal: AxisCalibration, switchAutoGain: boolean): number {
    let val: number;
    if (raw >= cal.center) {
      const span = Math.max(0.15, cal.max - cal.center);
      val = (raw - cal.center) / span;
    } else {
      const span = Math.max(0.15, cal.center - cal.min);
      val = (raw - cal.center) / span;
    }

    // Switch Pro Controllers without custom calibration often peak around 0.78 in browser WebHID/DirectInput
    if (switchAutoGain && cal.min === -1 && cal.max === 1) {
      val *= 1.25;
    }

    val = clamp(val, -1, 1);
    return cal.inverted ? -val : val;
  }

  public shapeResponse(input: number): number {
    const dz = this.settings.deadzone;
    const abs = Math.abs(input);
    if (abs <= dz) return 0;

    const rescaled = (abs - dz) / Math.max(0.01, 1 - dz);
    const sign = input >= 0 ? 1 : -1;
    const alpha = this.settings.expo;
    const shaped = (1 - alpha) * rescaled + alpha * rescaled * rescaled * rescaled;
    return clamp(sign * shaped, -1, 1);
  }

  public poll(dt: number): StickInput {
    const gp = this.getActiveGamepad();
    const forceKeyboard = this.settings.profile === 'keyboard';

    // Keyboard targets (Mode 2)
    const kbYaw = (this.keysDown.has('KeyD') ? 1 : 0) - (this.keysDown.has('KeyA') ? 1 : 0);
    const kbThr = (this.keysDown.has('KeyW') ? 1 : 0) - (this.keysDown.has('KeyS') ? 1 : 0);
    const kbRoll = (this.keysDown.has('ArrowRight') ? 1 : 0) - (this.keysDown.has('ArrowLeft') ? 1 : 0);
    const kbPitch = (this.keysDown.has('ArrowUp') ? 1 : 0) - (this.keysDown.has('ArrowDown') ? 1 : 0);

    const kRate = 1 - Math.exp(-10 * dt);
    this.keySmooth[0] += (kbYaw - this.keySmooth[0]) * kRate;
    this.keySmooth[1] += (kbThr - this.keySmooth[1]) * kRate;
    this.keySmooth[2] += (kbRoll - this.keySmooth[2]) * kRate;
    this.keySmooth[3] += (kbPitch - this.keySmooth[3]) * kRate;

    const kbActive =
      Math.abs(kbYaw) > 0 ||
      Math.abs(kbThr) > 0 ||
      Math.abs(kbRoll) > 0 ||
      Math.abs(kbPitch) > 0;

    if (gp && !forceKeyboard && !kbActive) {
      const detected = this.detectProfileFromId(gp.id);
      const effectiveProfile = this.settings.profile === 'auto' ? detected : this.settings.profile;
      const raw = this.extractRawAxes(
        gp,
        effectiveProfile === 'keyboard' ? 'xbox' : effectiveProfile,
      );

      if (this.calibrationStep === 'extremes') {
        for (let i = 0; i < 4; i++) {
          if (raw[i] < this.calMin[i]) this.calMin[i] = raw[i];
          if (raw[i] > this.calMax[i]) this.calMax[i] = raw[i];
        }
      }

      const isSwitchNonStandard = effectiveProfile === 'switch' && gp.mapping !== 'standard';
      const n0 = this.normalizeAxis(raw[0], this.settings.axes[0], isSwitchNonStandard);
      const n1 = this.normalizeAxis(raw[1], this.settings.axes[1], isSwitchNonStandard);
      const n2 = this.normalizeAxis(raw[2], this.settings.axes[2], isSwitchNonStandard);
      const n3 = this.normalizeAxis(raw[3], this.settings.axes[3], isSwitchNonStandard);

      const s0 = this.shapeResponse(n0);
      const s1 = this.shapeResponse(n1);
      const s2 = this.shapeResponse(n2);
      const s3 = this.shapeResponse(n3);

      return {
        yaw: s0,
        throttle: s1,
        roll: s2,
        pitch: s3,
        rawAxes: [n0, n1, n2, n3],
        shapedAxes: [s0, s1, s2, s3],
        sourceName:
          effectiveProfile === 'xbox'
            ? 'Xbox Controller'
            : effectiveProfile === 'playstation'
              ? 'PlayStation DualSense/DS4'
              : 'Nintendo Switch Pro',
        detectedType: effectiveProfile === 'keyboard' ? 'xbox' : effectiveProfile,
        gamepadConnected: true,
        gamepadId: gp.id,
      };
    }

    const s0 = this.shapeResponse(this.keySmooth[0]);
    const s1 = this.shapeResponse(this.keySmooth[1]);
    const s2 = this.shapeResponse(this.keySmooth[2]);
    const s3 = this.shapeResponse(this.keySmooth[3]);

    return {
      yaw: s0,
      throttle: s1,
      roll: s2,
      pitch: s3,
      rawAxes: [this.keySmooth[0], this.keySmooth[1], this.keySmooth[2], this.keySmooth[3]],
      shapedAxes: [s0, s1, s2, s3],
      sourceName: gp ? 'Teclado (Override)' : 'Teclado (WASD + Setas)',
      detectedType: 'keyboard',
      gamepadConnected: Boolean(gp),
      gamepadId: gp ? gp.id : '',
    };
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    window.removeEventListener('blur', this.onBlurBound);
    window.removeEventListener('gamepadconnected', this.onGamepadConnectedBound);
    window.removeEventListener('gamepaddisconnected', this.onGamepadDisconnectedBound);
  }
}
