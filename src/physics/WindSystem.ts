import type {WindConfig, WindPresetId} from '../types';

export const WIND_PRESETS: Record<WindPresetId, {label: string; config: WindConfig}> = {
  calm: {
    label: 'Ar Parado (Trim)',
    config: {
      speed: 0,
      azimuthDeg: 90,
      gustIntensity: 0,
      gustFrequency: 0.25,
      turbulenceEnabled: false,
    },
  },
  breeze: {
    label: 'Brisa Leve (4 m/s)',
    config: {
      speed: 4,
      azimuthDeg: 65,
      gustIntensity: 1.5,
      gustFrequency: 0.3,
      turbulenceEnabled: true,
    },
  },
  crosswind: {
    label: 'Vento Cruzado Forte (10 m/s)',
    config: {
      speed: 10,
      azimuthDeg: 90,
      gustIntensity: 4.0,
      gustFrequency: 0.45,
      turbulenceEnabled: true,
    },
  },
  storm: {
    label: 'Tempestade c/ Rajadas (12 m/s)',
    config: {
      speed: 12,
      azimuthDeg: 135,
      gustIntensity: 8.0,
      gustFrequency: 0.75,
      turbulenceEnabled: true,
    },
  },
};

interface ActiveGust {
  elapsed: number;
  duration: number;
  peakVx: number;
  peakVy: number;
  peakVz: number;
}

/**
 * Dynamic Inertial Wind Generator (Steady Wind + 3-Axis Dryden-style Turbulence + 1-Cosine Gusts)
 */
export class WindSystem {
  public config: WindConfig = {...WIND_PRESETS.calm.config};
  public readonly currentWind = new Float64Array(3); // [wN, wE, wD] in NED

  private turbState = new Float64Array(3);
  private activeGust: ActiveGust | null = null;
  private autoGustTimer = 0;

  public applyPreset(presetId: WindPresetId): void {
    this.config = {...WIND_PRESETS[presetId].config};
    if (!this.config.turbulenceEnabled) {
      this.turbState.fill(0);
    }
  }

  public triggerInstantGust(strengthOverride?: number): void {
    const peak = Math.max(3.5, strengthOverride ?? (this.config.gustIntensity > 0.5 ? this.config.gustIntensity : 6.0));
    const angleRad = ((this.config.azimuthDeg + (Math.random() - 0.5) * 50) * Math.PI) / 180;
    this.activeGust = {
      elapsed: 0,
      duration: 2.4 + Math.random() * 1.2,
      peakVx: peak * Math.cos(angleRad),
      peakVy: peak * Math.sin(angleRad),
      peakVz: (Math.random() - 0.5) * peak * 0.28,
    };
  }

  public update(dt: number): Float64Array {
    const azRad = (this.config.azimuthDeg * Math.PI) / 180;
    let wN = this.config.speed * Math.cos(azRad);
    let wE = this.config.speed * Math.sin(azRad);
    let wD = 0;

    // Continuous 3-axis filtered Dryden-like turbulence
    if (this.config.turbulenceEnabled && (this.config.speed > 0 || this.config.gustIntensity > 0)) {
      const sigma = 0.14 * this.config.speed + 0.18 * this.config.gustIntensity;
      const tau = 0.85;
      const alpha = Math.min(1, dt / tau);
      const gain = Math.sqrt(2 * alpha);

      for (let i = 0; i < 3; i++) {
        // Box-Muller approx via sum of 3 uniforms
        const noise = (Math.random() + Math.random() + Math.random() - 1.5) * 2.0;
        const scale = i === 2 ? 0.55 : 1.0;
        this.turbState[i] += -alpha * this.turbState[i] + gain * sigma * scale * noise;
      }

      wN += this.turbState[0];
      wE += this.turbState[1];
      wD += this.turbState[2];
    } else {
      this.turbState.fill(0);
    }

    // Periodic automatic 1-cosine gusts when gustIntensity > 0
    if (this.config.gustIntensity > 0.05 && this.config.gustFrequency > 0.01) {
      this.autoGustTimer += dt;
      const interval = Math.max(2.8, 12.0 - this.config.gustFrequency * 9.0);
      if (!this.activeGust && this.autoGustTimer >= interval) {
        this.autoGustTimer = 0;
        this.triggerInstantGust(this.config.gustIntensity);
      }
    } else {
      this.autoGustTimer = 0;
    }

    // 1-cosine discrete gust envelope: 0.5 * (1 - cos(2*pi*t/T))
    if (this.activeGust) {
      this.activeGust.elapsed += dt;
      const progress = this.activeGust.elapsed / this.activeGust.duration;
      if (progress >= 1.0) {
        this.activeGust = null;
      } else {
        const envelope = 0.5 * (1.0 - Math.cos(2.0 * Math.PI * progress));
        wN += this.activeGust.peakVx * envelope;
        wE += this.activeGust.peakVy * envelope;
        wD += this.activeGust.peakVz * envelope;
      }
    }

    this.currentWind[0] = wN;
    this.currentWind[1] = wE;
    this.currentWind[2] = wD;
    return this.currentWind;
  }
}
