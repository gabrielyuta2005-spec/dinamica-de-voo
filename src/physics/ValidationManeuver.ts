/**
 * 62-Second Automated Validation Maneuver Profile from 50 m altitude:
 *  - 0..4 s:   Hover at 50 m
 *  - 4..10 s:  Vertical climb at Vc = +3.0 m/s
 *  - 10..14 s: Stabilize hover
 *  - 14..28 s: Forward flight at Vx = 12.0 m/s
 *  - 28..42 s: Right lateral flight at Vy = 8.0 m/s
 *  - 42..48 s: Decelerate to hover
 *  - 48..56 s: Vertical descent at Vc = -1.5 m/s
 *  - 56..62 s: Final hover hold
 */
export class ValidationManeuver {
  public active = false;
  public elapsed = 0;
  public readonly duration = 62.0;
  public readonly velRef = new Float64Array(3); // NED [vN_ref, vE_ref, vD_ref]
  public phaseLabel = 'Inativo';

  public start(): void {
    this.active = true;
    this.elapsed = 0;
    this.phaseLabel = '0–4 s: Pairado Inicial (50 m)';
    this.velRef.fill(0);
  }

  public stop(): void {
    this.active = false;
    this.elapsed = 0;
    this.phaseLabel = 'Inativo';
    this.velRef.fill(0);
  }

  public update(dt: number): Float64Array | null {
    if (!this.active) return null;

    this.elapsed += dt;
    const t = this.elapsed;

    if (t >= this.duration) {
      this.stop();
      return null;
    }

    if (t < 4) {
      this.phaseLabel = '0–4 s: Pairado Estabilizado (50 m)';
      this.velRef[0] = 0;
      this.velRef[1] = 0;
      this.velRef[2] = 0;
    } else if (t < 10) {
      this.phaseLabel = '4–10 s: Subida Vertical (Vc = +3.0 m/s)';
      this.velRef[0] = 0;
      this.velRef[1] = 0;
      this.velRef[2] = -3.0;
    } else if (t < 14) {
      this.phaseLabel = '10–14 s: Estabilização em Altitude';
      this.velRef[0] = 0;
      this.velRef[1] = 0;
      this.velRef[2] = 0;
    } else if (t < 28) {
      this.phaseLabel = '14–28 s: Voo Frontal (Vx = 12.0 m/s)';
      this.velRef[0] = 12.0;
      this.velRef[1] = 0;
      this.velRef[2] = 0;
    } else if (t < 42) {
      this.phaseLabel = '28–42 s: Voo Lateral Direita (Vy = 8.0 m/s)';
      this.velRef[0] = 0;
      this.velRef[1] = 8.0;
      this.velRef[2] = 0;
    } else if (t < 48) {
      this.phaseLabel = '42–48 s: Desaceleração para Pairado';
      this.velRef[0] = 0;
      this.velRef[1] = 0;
      this.velRef[2] = 0;
    } else if (t < 56) {
      this.phaseLabel = '48–56 s: Descida Vertical (Vc = -1.5 m/s)';
      this.velRef[0] = 0;
      this.velRef[1] = 0;
      this.velRef[2] = 1.5;
    } else {
      this.phaseLabel = '56–62 s: Pairado Final de Validação';
      this.velRef[0] = 0;
      this.velRef[1] = 0;
      this.velRef[2] = 0;
    }

    return this.velRef;
  }
}
