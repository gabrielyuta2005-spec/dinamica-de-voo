import type {GamepadManager} from '../input/GamepadManager';
import type {WindSystem} from '../physics/WindSystem';
import {DERIVED_CONSTANTS, OCTA_PARAMS, ROTOR_SPECS} from '../physics/OctacopterModel';
import type {
  CameraMode,
  ControllerProfile,
  FlightMode,
  ScenarioId,
  StickInput,
  TelemetrySnapshot,
  VRMode,
  WindPresetId,
} from '../types';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'; platform: string}>;
}

export interface UICallbacks {
  onFlightModeChange: (mode: FlightMode) => void;
  onCameraModeChange: (cam: CameraMode) => void;
  onScenarioChange: (scenario: ScenarioId) => void;
  onResetHover: () => void;
  onResetGround: () => void;
  onToggleValidation: () => void;
  onTriggerGust: () => void;
  onWindPreset: (preset: WindPresetId) => void;
  onToggleVectors: (show: boolean) => void;
  onToggleAudio: () => boolean;
  onToggleVR: () => void;
}

export class SimulatorUI {
  private readonly root: HTMLElement;
  private readonly gamepad: GamepadManager;
  private readonly wind: WindSystem;
  private readonly cb: UICallbacks;

  // Telemetry DOM refs
  private modeBadge!: HTMLElement;
  private motorBadge!: HTMLElement;
  private offlinePill!: HTMLElement;
  private valAlt!: HTMLElement;
  private valPos!: HTMLElement;
  private valVh!: HTMLElement;
  private valVc!: HTMLElement;
  private valTW!: HTMLElement;
  private valPower!: HTMLElement;
  private valPhi!: HTMLElement;
  private valTheta!: HTMLElement;
  private valPsi!: HTMLElement;
  private horizonGroup!: SVGGElement;

  // 8-rotor bar DOM refs
  private rotorBars: HTMLElement[] = [];
  private rotorLabels: HTMLElement[] = [];
  private valMeanOmega!: HTMLElement;

  // Buttons & banners
  private flightModeBtns = new Map<FlightMode, HTMLButtonElement>();
  private cameraBtns = new Map<CameraMode, HTMLButtonElement>();
  private scenarioBtns = new Map<ScenarioId, HTMLButtonElement>();
  private validationBtn!: HTMLButtonElement;
  private validationBanner!: HTMLElement;
  private validationPhaseEl!: HTMLElement;
  private validationTimerEl!: HTMLElement;
  private validationProgressEl!: HTMLElement;
  private slalomBadge!: HTMLElement;
  private slalomText!: HTMLElement;
  private audioBtn!: HTMLButtonElement;
  private vrBtn!: HTMLButtonElement;
  private pcBtn!: HTMLButtonElement;
  private pcModal!: HTMLElement;
  private pwaInstallBtn!: HTMLButtonElement;
  private pwaStatusEl!: HTMLElement;
  private vrDiagEl!: HTMLElement;
  private dockWrapper!: HTMLElement;
  private dockToggleBtn!: HTMLButtonElement;
  private dockCollapsed = false;

  private deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
  private isInstalledPWA = false;

  // Gamepad / Curve SVG refs
  private gpStatusEl!: HTMLElement;
  private calBtn!: HTMLButtonElement;
  private calHintEl!: HTMLElement;
  private expoCurvePath!: SVGPathElement;
  private leftStickDot!: SVGCircleElement;
  private rightStickDot!: SVGCircleElement;
  private stickReadoutEl!: HTMLElement;

  // Wind readout
  private windReadoutEl!: HTMLElement;
  private windSpeedSlider!: HTMLInputElement;
  private windSpeedVal!: HTMLElement;
  private windAzSlider!: HTMLInputElement;
  private windAzVal!: HTMLElement;
  private gustIntSlider!: HTMLInputElement;
  private gustIntVal!: HTMLElement;
  private gustFreqSlider!: HTMLInputElement;
  private gustFreqVal!: HTMLElement;
  private turbCheckbox!: HTMLInputElement;

  // Live Strip Chart history (last 180 samples ~ 9 seconds at 20Hz UI chart update)
  private chartAltPath!: SVGPathElement;
  private chartVhPath!: SVGPathElement;
  private chartPwrPath!: SVGPathElement;
  private chartHistory: Array<{alt: number; vh: number; pwr: number}> = [];
  private lastChartSampleTime = -1;

  constructor(
    root: HTMLElement,
    gamepad: GamepadManager,
    wind: WindSystem,
    callbacks: UICallbacks,
  ) {
    this.root = root;
    this.gamepad = gamepad;
    this.wind = wind;
    this.cb = callbacks;
    this.render();
    this.bindEvents();
    this.setupPWAEvents();
    this.updateExpoCurvePath();
  }

  private render(): void {
    const rotorBarsHtml = ROTOR_SPECS.map((spec, idx) => {
      const cls = spec.s === 1 ? 'ccw' : 'cw';
      return `
        <div class="rotor-bar-col">
          <div class="rotor-bar-fill ${cls}" id="rotor-fill-${idx}" style="height:50%"></div>
          <span class="rotor-bar-label" id="rotor-lbl-${idx}">M${idx + 1}</span>
        </div>
      `;
    }).join('');

    this.root.innerHTML = `
      <!-- TOP-LEFT TELEMETRY HUD -->
      <div class="hud-card hud-top-left">
        <div class="hud-header-row">
          <span class="brand-title">OctaSim 6-DOF · 8,00 kg</span>
          <div style="display:flex;gap:4px;align-items:center;">
            <span class="mode-badge armed" id="hud-motor-badge">ARMADO</span>
            <span class="mode-badge" id="hud-mode-badge">ESTAB.</span>
          </div>
        </div>
        <div class="offline-pill" id="offline-pill">Modo Offline Ativo — Cache Local</div>
        <div class="telem-main-row">
          <svg width="78" height="78" viewBox="0 0 80 80" style="flex-shrink:0;border-radius:50%;border:1px solid rgba(148,163,184,0.35);background:#08101c;">
            <defs>
              <clipPath id="ah-clip"><circle cx="40" cy="40" r="36"/></clipPath>
            </defs>
            <g clip-path="url(#ah-clip)">
              <g id="ah-horizon" transform="translate(40,40)">
                <rect x="-80" y="-120" width="160" height="120" fill="#0369a1" opacity="0.72"/>
                <rect x="-80" y="0" width="160" height="120" fill="#78350f" opacity="0.72"/>
                <line x1="-80" y1="0" x2="80" y2="0" stroke="#f8fafc" stroke-width="1.5"/>
                <line x1="-18" y1="-15" x2="18" y2="-15" stroke="#bae6fd" stroke-width="1"/>
                <line x1="-18" y1="15" x2="18" y2="15" stroke="#fed7aa" stroke-width="1"/>
              </g>
            </g>
            <path d="M24 40 L34 40 L40 44 L46 40 L56 40" fill="none" stroke="#f59e0b" stroke-width="2"/>
            <circle cx="40" cy="40" r="36" fill="none" stroke="rgba(148,163,184,0.3)" stroke-width="1"/>
          </svg>
          <div class="telem-grid">
            <div class="telem-cell">
              <span class="telem-label">Altitude h</span>
              <span class="telem-value mono" id="val-alt">50.00 m</span>
            </div>
            <div class="telem-cell">
              <span class="telem-label">Pos (N, E)</span>
              <span class="telem-value mono" id="val-pos">0.0, 0.0</span>
            </div>
            <div class="telem-cell">
              <span class="telem-label">Vel Horiz Vh</span>
              <span class="telem-value mono" id="val-vh">0.00 m/s</span>
            </div>
            <div class="telem-cell">
              <span class="telem-label">Subida Vc</span>
              <span class="telem-value mono" id="val-vc">+0.00 m/s</span>
            </div>
          </div>
        </div>
        <div class="euler-row">
          <div class="telem-cell">
            <span class="telem-label">Roll φ</span>
            <span class="telem-value mono" id="val-phi">0.0°</span>
          </div>
          <div class="telem-cell">
            <span class="telem-label">Pitch θ</span>
            <span class="telem-value mono" id="val-theta">0.0°</span>
          </div>
          <div class="telem-cell">
            <span class="telem-label">Yaw ψ</span>
            <span class="telem-value mono" id="val-psi">0.0°</span>
          </div>
        </div>
      </div>

      <!-- TOP-RIGHT ROTORS, CAMERAS & QUICK CONTROLS -->
      <div class="hud-card hud-top-right">
        <div class="hud-header-row">
          <span class="telem-label" style="color:#e2e8f0;font-weight:700;">Rotores ω₁..ω₈ [rad/s]</span>
          <span class="mono telem-sub" id="val-mean-omega">ω̄ 395.5 · T/W 1.00</span>
        </div>

        <div class="rotor-chart">
          <div class="rotor-hover-line" title="Equilíbrio Hover: 395.5 rad/s"></div>
          ${rotorBarsHtml}
        </div>

        <div style="display:flex;justify-content:space-between;font-size:10.5px;">
          <span>Potência: <strong class="mono" id="val-power">717 W</strong></span>
          <span>T/W: <strong class="mono" id="val-tw">1.00</strong></span>
          <span style="color:#38bdf8;">● CCW</span>
          <span style="color:#fb923c;">● CW</span>
        </div>

        <div class="quick-btn-row">
          <button class="btn active" data-cam="chase">Chase</button>
          <button class="btn" data-cam="fpv">FPV</button>
          <button class="btn" data-cam="top">Topo</button>
          <button class="btn" data-cam="free">Livre</button>
          <button class="btn" id="btn-audio">Som: Off</button>
          <button class="btn" id="btn-vr" title="Conectar headset WebXR ou modo VR Estéreo SBS no PC">VR: Off</button>
          <button class="btn primary" id="btn-pc-download" title="Instalar Offline no PC ou gerar .EXE Windows">PC / .EXE</button>
        </div>

        <div class="quick-btn-row">
          <button class="btn primary" id="btn-validation" style="flex:1;">Executar Manobra de Validação (62 s)</button>
          <button class="btn" id="btn-quick-hover" title="Espaço">Pairar 50m</button>
        </div>

        <div class="hint-strip" id="vr-diag" style="display:none;color:#fbbf24;"></div>

        <div class="validation-banner" id="validation-banner" style="display:none;">
          <div style="display:flex;justify-content:space-between;font-size:10.5px;">
            <strong id="val-phase-label">0–4 s: Pairado</strong>
            <span class="mono" id="val-timer">0.0 / 62.0 s</span>
          </div>
          <div class="progress-track"><div class="progress-fill" id="val-progress"></div></div>
        </div>

        <div class="slalom-badge" id="slalom-badge">
          <span>Circuito Slalom</span>
          <strong class="mono" id="slalom-text">Portões: 0/8 · 0.0 s</strong>
        </div>
      </div>

      <!-- COLLAPSIBLE BOTTOM CONTROL DOCK -->
      <div class="dock-wrapper" id="dock-wrapper">
        <button class="dock-toggle-btn" id="btn-dock-toggle">▾ Ocultar Painel (H)</button>
        <div class="hud-card dock-panel">
          <div class="dock-tabs">
            <div class="tab-buttons">
              <button class="tab-btn active" data-tab="controls">Controle & Curvas</button>
              <button class="tab-btn" data-tab="wind">Vento & Rajadas</button>
              <button class="tab-btn" data-tab="scenarios">Cenários & Modos</button>
              <button class="tab-btn" data-tab="physics">Física & Validação</button>
            </div>
            <span class="hint-strip">Mode 2 · Stick Esq ↓ desliga motores (↑ religa) · Espaço Pairar · C Câmera · H Painel</span>
          </div>

          <!-- TAB 1: CONTROLS & EXPO -->
          <div class="tab-content active grid-controls" id="tab-controls">
            <div class="sub-box">
              <div class="sub-title">Gamepad Bluetooth / USB (Mode 2)</div>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
                <span class="mono" style="font-size:10.5px;color:#38bdf8;" id="gp-status">Teclado Ativo</span>
                <select class="select-input" id="sel-profile">
                  <option value="auto">Perfil: Auto-Detectar</option>
                  <option value="xbox">Xbox (One / Series / 360)</option>
                  <option value="playstation">PlayStation (DS4 / DualSense)</option>
                  <option value="switch">Nintendo Switch Pro / Joy-Con</option>
                  <option value="keyboard">Teclado (WASD + Setas)</option>
                </select>
              </div>
              <div class="check-row">
                <label><input type="checkbox" id="chk-ps-alt"/> PS Eixos Alt (2/5)</label>
                <label><input type="checkbox" id="chk-inv-0"/> Inv Yaw</label>
                <label><input type="checkbox" id="chk-inv-1" checked/> Inv Thr</label>
                <label><input type="checkbox" id="chk-inv-2"/> Inv Roll</label>
                <label><input type="checkbox" id="chk-inv-3" checked/> Inv Pitch</label>
              </div>
              <div style="display:flex;gap:6px;align-items:center;">
                <button class="btn amber" id="btn-calibrate">Calibrar Centro & Extremos</button>
                <button class="btn" id="btn-cal-reset">Reset Cal.</button>
              </div>
              <span class="hint-strip" id="cal-hint">Stick esquerdo no centro = pairado estável em ω_h = 395.5 rad/s.</span>
            </div>

            <div class="sub-box">
              <div class="sub-title">Curva Linear ↔ Exponencial & Sensibilidade</div>
              <div class="slider-row">
                <span>Curva Expo α</span>
                <input type="range" id="sld-expo" min="0" max="0.85" step="0.05" value="0.35"/>
                <span class="mono" id="lbl-expo">0.35</span>
              </div>
              <div class="slider-row">
                <span>Zona Morta</span>
                <input type="range" id="sld-dz" min="0" max="0.15" step="0.01" value="0.06"/>
                <span class="mono" id="lbl-dz">6%</span>
              </div>
              <div class="slider-row">
                <span>Inclinação Máx</span>
                <input type="range" id="sld-tilt" min="10" max="35" step="1" value="35"/>
                <span class="mono" id="lbl-tilt">35°</span>
              </div>
              <div class="slider-row">
                <span>Taxa Guinada</span>
                <input type="range" id="sld-yaw" min="30" max="180" step="5" value="110"/>
                <span class="mono" id="lbl-yaw">110°/s</span>
              </div>
              <div class="slider-row">
                <span>Subida Máx</span>
                <input type="range" id="sld-climb" min="1.5" max="10.6" step="0.1" value="6.5"/>
                <span class="mono" id="lbl-climb">6.5 m/s</span>
              </div>
            </div>

            <div class="sub-box" style="align-items:center;">
              <div class="sub-title" style="width:100%;">Entrada × Saída ao Vivo</div>
              <svg width="164" height="114" viewBox="-1.1 -1.1 2.2 2.2" style="background:#08101c;border:1px solid rgba(148,163,184,0.22);border-radius:6px;">
                <line x1="-1" y1="0" x2="1" y2="0" stroke="rgba(148,163,184,0.25)" stroke-width="0.02"/>
                <line x1="0" y1="-1" x2="0" y2="1" stroke="rgba(148,163,184,0.25)" stroke-width="0.02"/>
                <line x1="-1" y1="1" x2="1" y2="-1" stroke="rgba(148,163,184,0.2)" stroke-dasharray="0.06 0.06" stroke-width="0.02"/>
                <path id="expo-curve-path" d="" fill="none" stroke="#38bdf8" stroke-width="0.045"/>
                <circle id="stick-dot-left" cx="0" cy="0" r="0.08" fill="#22c55e" stroke="#fff" stroke-width="0.02"/>
                <circle id="stick-dot-right" cx="0" cy="0" r="0.08" fill="#fb923c" stroke="#fff" stroke-width="0.02"/>
              </svg>
              <span class="mono" style="font-size:9.5px;color:var(--text-muted);" id="stick-readout">L(0.00, 0.00) · R(0.00, 0.00)</span>
            </div>
          </div>

          <!-- TAB 2: WIND & GUSTS -->
          <div class="tab-content grid-wind" id="tab-wind">
            <div class="sub-box">
              <div class="sub-title">Presets Climáticos</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                <button class="btn" data-wind-preset="calm">Ar Parado (Trim)</button>
                <button class="btn" data-wind-preset="breeze">Brisa Leve (4 m/s)</button>
                <button class="btn" data-wind-preset="crosswind">Vento Cruzado (10)</button>
                <button class="btn danger" data-wind-preset="storm">Tempestade (12+)</button>
              </div>
              <button class="btn amber" id="btn-gust-now">⚡ Disparar Rajada Instantânea</button>
            </div>

            <div class="sub-box">
              <div class="sub-title">Vetor Vento Inercial v_vento,I</div>
              <div class="slider-row">
                <span>Vento Médio</span>
                <input type="range" id="sld-wind-spd" min="0" max="15" step="0.5" value="0"/>
                <span class="mono" id="lbl-wind-spd">0.0 m/s</span>
              </div>
              <div class="slider-row">
                <span>Azimute Vento</span>
                <input type="range" id="sld-wind-az" min="0" max="360" step="5" value="90"/>
                <span class="mono" id="lbl-wind-az">90°</span>
              </div>
              <div class="slider-row">
                <span>Rajadas (1-cos)</span>
                <input type="range" id="sld-gust-int" min="0" max="10" step="0.5" value="0"/>
                <span class="mono" id="lbl-gust-int">0.0 m/s</span>
              </div>
              <div class="slider-row">
                <span>Frequência</span>
                <input type="range" id="sld-gust-freq" min="0" max="1" step="0.05" value="0.25"/>
                <span class="mono" id="lbl-gust-freq">25%</span>
              </div>
            </div>

            <div class="sub-box">
              <div class="sub-title">Turbulência & Leitura</div>
              <div class="check-row">
                <label><input type="checkbox" id="chk-turbulence"/> Turbulência Dryden 3D</label>
              </div>
              <div class="mono" style="font-size:11px;color:#fbbf24;" id="wind-readout">
                v_vento = [0.00, 0.00, 0.00] m/s
              </div>
              <span class="hint-strip">Equação aerodinâmica: v_ar = v_B - R_IBᵀ · v_vento,I</span>
            </div>
          </div>

          <!-- TAB 3: SCENARIOS & FLIGHT MODES -->
          <div class="tab-content grid-scenarios" id="tab-scenarios">
            <div class="sub-box">
              <div class="sub-title">Cenários 3D</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                <button class="btn active" data-scenario="ifsp">1. Pista IFSP Lab</button>
                <button class="btn" data-scenario="cerrado">2. Campo Cerrado</button>
                <button class="btn" data-scenario="urban">3. Cânion Urbano</button>
                <button class="btn" data-scenario="slalom">4. Circuito Slalom</button>
              </div>
              <div class="check-row" style="margin-top:4px;">
                <label><input type="checkbox" id="chk-vectors"/> Mostrar Vetores 3D (Empuxo/Vel/Vento)</label>
                <label><input type="checkbox" id="chk-vortex" checked/> Limite Anel Vortical (-1.5 m/s)</label>
              </div>
            </div>

            <div class="sub-box">
              <div class="sub-title">Modo de Controle & Reinício</div>
              <div style="display:flex;gap:6px;">
                <button class="btn active" data-fmode="stabilized" style="flex:1;">Estabilizado</button>
                <button class="btn" data-fmode="acro" style="flex:1;">Acro (Taxa)</button>
                <button class="btn" data-fmode="open_loop" style="flex:1;">Malha Aberta (Q5)</button>
              </div>
              <div style="display:flex;gap:6px;margin-top:2px;">
                <button class="btn primary" id="btn-reset-50" style="flex:1;">Reset Hover (50 m)</button>
                <button class="btn" id="btn-reset-pad" style="flex:1;">Heliponto (0 m)</button>
              </div>
              <span class="hint-strip">Malha Aberta Q5 injeta ω_h + Δω sem realimentação (oscilação instável T = 14,44 s).</span>
            </div>
          </div>

          <!-- TAB 4: PHYSICS & VALIDATION -->
          <div class="tab-content grid-validation" id="tab-physics">
            <div class="sub-box">
              <div class="sub-title">Valores de Equilíbrio (Referência vs Modelo RK4)</div>
              <table class="ref-table mono">
                <thead>
                  <tr><th>Regime</th><th>ω Ref</th><th>Potência Ref</th><th>Detalhe</th></tr>
                </thead>
                <tbody>
                  <tr><td>Hover (Vc=0)</td><td>395.5 rad/s</td><td>717 W</td><td>v_h=5.94 m/s, T=9.81 N</td></tr>
                  <tr><td>Subida (+3 m/s)</td><td>431.2 rad/s</td><td>795 W</td><td>Máx: +10.6 m/s</td></tr>
                  <tr><td>Descida (-1.5 m/s)</td><td>379.4 rad/s</td><td>685 W</td><td>|Vc| ≤ 0.25 v_h</td></tr>
                  <tr><td>V_max Frontal / Lat</td><td>θ=-24.8° / φ=+28.3°</td><td>1319 / 1284 W</td><td>22.04 / 20.53 m/s</td></tr>
                  <tr><td>Malha Aberta Q5</td><td>ω_h = 395.5</td><td>Instável (F_H)</td><td>T=14.44 s · t₂=10.55 s</td></tr>
                </tbody>
              </table>
            </div>

            <div class="sub-box">
              <div class="sub-title">Telemetria Temporal (Altitude · Vh · Potência)</div>
              <svg width="100%" height="96" viewBox="0 0 360 96" preserveAspectRatio="none" style="background:#08101c;border:1px solid rgba(148,163,184,0.2);border-radius:6px;">
                <line x1="0" y1="48" x2="360" y2="48" stroke="rgba(148,163,184,0.16)" stroke-dasharray="4 4"/>
                <path id="chart-alt" d="" fill="none" stroke="#38bdf8" stroke-width="1.6"/>
                <path id="chart-vh" d="" fill="none" stroke="#22c55e" stroke-width="1.6"/>
                <path id="chart-pwr" d="" fill="none" stroke="#fb923c" stroke-width="1.4"/>
              </svg>
              <div style="display:flex;justify-content:space-between;font-size:10px;">
                <span style="color:#38bdf8;">— Altitude (0..100 m)</span>
                <span style="color:#22c55e;">— Vh (0..25 m/s)</span>
                <span style="color:#fb923c;">— Potência (0..2000 W)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- MODAL PC OFFLINE / .EXE / VR -->
      <div class="sim-modal-backdrop" id="pc-modal">
        <div class="sim-modal">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong style="font-size:14px;color:#f8fafc;">Jogar Offline no PC (.EXE / App Desktop) & VR</strong>
            <button class="btn" id="btn-pc-close">Fechar</button>
          </div>

          <div class="sub-box">
            <div class="sub-title">1. App Desktop Offline (1 Clique — Windows / Chrome / Edge)</div>
            <span class="hint-strip" id="pwa-status-text">
              Instale o OctaSim 6-DOF diretamente no Windows como aplicativo independente com cache 100% offline, controles Xbox/PS/Switch e suporte a VR.
            </span>
            <div style="display:flex;gap:8px;align-items:center;">
              <button class="btn primary" id="btn-pwa-install">Instalar App Offline no PC</button>
            </div>
          </div>

          <div class="sub-box">
            <div class="sub-title">2. Gerar Executável Windows (.EXE via Electron)</div>
            <span class="hint-strip">
              O projeto já inclui <span class="mono">electron/main.cjs</span> e <span class="mono">electron-builder.json</span> prontos para compilar <span class="mono">OctaSim-6DOF-Portable.exe</span> e <span class="mono">OctaSim-6DOF-Setup.exe</span> offline no seu PC (requer Node.js):
            </span>
            <div class="sim-code-box">npm install &amp;&amp; npm run build:exe</div>
            <div style="display:flex;gap:8px;">
              <button class="btn amber" id="btn-download-bat">Baixar Script Automático (.BAT para Windows)</button>
            </div>
          </div>

          <div class="sub-box">
            <div class="sub-title">3. Dica para Conexão VR no PC (WebXR / SteamVR / Quest Link)</div>
            <span class="hint-strip">
              Por segurança do navegador, headsets WebXR não conectam dentro de iframes de preview. Ao instalar o App Desktop ou rodar no navegador em aba direta (<span class="mono">localhost</span> / <span class="mono">.exe</span>) com SteamVR ou Meta Quest Link aberto, o botão <strong>VR</strong> entra direto no headset. Enquanto isso, clicar em <strong>VR</strong> ativa o modo <strong>Estéreo Lado-a-Lado (SBS)</strong> no PC.
            </span>
          </div>
        </div>
      </div>
    `;

    // Query DOM refs
    this.modeBadge = this.root.querySelector('#hud-mode-badge')!;
    this.motorBadge = this.root.querySelector('#hud-motor-badge')!;
    this.offlinePill = this.root.querySelector('#offline-pill')!;
    this.valAlt = this.root.querySelector('#val-alt')!;
    this.valPos = this.root.querySelector('#val-pos')!;
    this.valVh = this.root.querySelector('#val-vh')!;
    this.valVc = this.root.querySelector('#val-vc')!;
    this.valTW = this.root.querySelector('#val-tw')!;
    this.valPower = this.root.querySelector('#val-power')!;
    this.valPhi = this.root.querySelector('#val-phi')!;
    this.valTheta = this.root.querySelector('#val-theta')!;
    this.valPsi = this.root.querySelector('#val-psi')!;
    this.horizonGroup = this.root.querySelector('#ah-horizon')!;
    this.valMeanOmega = this.root.querySelector('#val-mean-omega')!;

    for (let i = 0; i < 8; i++) {
      this.rotorBars.push(this.root.querySelector(`#rotor-fill-${i}`)!);
      this.rotorLabels.push(this.root.querySelector(`#rotor-lbl-${i}`)!);
    }

    this.validationBtn = this.root.querySelector('#btn-validation')!;
    this.validationBanner = this.root.querySelector('#validation-banner')!;
    this.validationPhaseEl = this.root.querySelector('#val-phase-label')!;
    this.validationTimerEl = this.root.querySelector('#val-timer')!;
    this.validationProgressEl = this.root.querySelector('#val-progress')!;
    this.slalomBadge = this.root.querySelector('#slalom-badge')!;
    this.slalomText = this.root.querySelector('#slalom-text')!;
    this.audioBtn = this.root.querySelector('#btn-audio')!;
    this.vrBtn = this.root.querySelector('#btn-vr')!;
    this.pcBtn = this.root.querySelector('#btn-pc-download')!;
    this.pcModal = this.root.querySelector('#pc-modal')!;
    this.pwaInstallBtn = this.root.querySelector('#btn-pwa-install')!;
    this.pwaStatusEl = this.root.querySelector('#pwa-status-text')!;
    this.vrDiagEl = this.root.querySelector('#vr-diag')!;
    this.dockWrapper = this.root.querySelector('#dock-wrapper')!;
    this.dockToggleBtn = this.root.querySelector('#btn-dock-toggle')!;

    this.gpStatusEl = this.root.querySelector('#gp-status')!;
    this.calBtn = this.root.querySelector('#btn-calibrate')!;
    this.calHintEl = this.root.querySelector('#cal-hint')!;
    this.expoCurvePath = this.root.querySelector('#expo-curve-path')!;
    this.leftStickDot = this.root.querySelector('#stick-dot-left')!;
    this.rightStickDot = this.root.querySelector('#stick-dot-right')!;
    this.stickReadoutEl = this.root.querySelector('#stick-readout')!;

    this.windReadoutEl = this.root.querySelector('#wind-readout')!;
    this.windSpeedSlider = this.root.querySelector('#sld-wind-spd')!;
    this.windSpeedVal = this.root.querySelector('#lbl-wind-spd')!;
    this.windAzSlider = this.root.querySelector('#sld-wind-az')!;
    this.windAzVal = this.root.querySelector('#lbl-wind-az')!;
    this.gustIntSlider = this.root.querySelector('#sld-gust-int')!;
    this.gustIntVal = this.root.querySelector('#lbl-gust-int')!;
    this.gustFreqSlider = this.root.querySelector('#sld-gust-freq')!;
    this.gustFreqVal = this.root.querySelector('#lbl-gust-freq')!;
    this.turbCheckbox = this.root.querySelector('#chk-turbulence')!;

    this.chartAltPath = this.root.querySelector('#chart-alt')!;
    this.chartVhPath = this.root.querySelector('#chart-vh')!;
    this.chartPwrPath = this.root.querySelector('#chart-pwr')!;

    this.root.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((btn) => {
      this.cameraBtns.set(btn.dataset.cam as CameraMode, btn);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((btn) => {
      this.scenarioBtns.set(btn.dataset.scenario as ScenarioId, btn);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-fmode]').forEach((btn) => {
      this.flightModeBtns.set(btn.dataset.fmode as FlightMode, btn);
    });
  }

  private bindEvents(): void {
    // Dock collapse toggle
    this.dockToggleBtn.addEventListener('click', () => this.toggleDock());

    // Tabs
    this.root.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab!;
        this.root.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        this.root.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
        btn.classList.add('active');
        this.root.querySelector(`#tab-${target}`)?.classList.add('active');
      });
    });

    // Camera buttons
    this.cameraBtns.forEach((btn, mode) => {
      btn.addEventListener('click', () => this.setCameraActive(mode));
    });

    // Scenario buttons
    this.scenarioBtns.forEach((btn, id) => {
      btn.addEventListener('click', () => this.setScenarioActive(id));
    });

    // Flight modes
    this.flightModeBtns.forEach((btn, mode) => {
      btn.addEventListener('click', () => this.setFlightModeActive(mode));
    });

    // Quick actions
    this.validationBtn.addEventListener('click', () => this.cb.onToggleValidation());
    this.root.querySelector('#btn-quick-hover')!.addEventListener('click', () => this.cb.onResetHover());
    this.root.querySelector('#btn-reset-50')!.addEventListener('click', () => this.cb.onResetHover());
    this.root.querySelector('#btn-reset-pad')!.addEventListener('click', () => this.cb.onResetGround());
    this.audioBtn.addEventListener('click', () => {
      const on = this.cb.onToggleAudio();
      this.audioBtn.textContent = on ? 'Som: On' : 'Som: Off';
      this.audioBtn.classList.toggle('active', on);
    });
    this.vrBtn.addEventListener('click', () => this.cb.onToggleVR());

    // PC Offline / .EXE Modal
    this.pcBtn.addEventListener('click', () => this.pcModal.classList.add('open'));
    this.root.querySelector('#btn-pc-close')!.addEventListener('click', () => {
      this.pcModal.classList.remove('open');
    });
    this.pcModal.addEventListener('click', (e) => {
      if (e.target === this.pcModal) this.pcModal.classList.remove('open');
    });

    this.pwaInstallBtn.addEventListener('click', () => void this.handleInstallClick());
    this.root.querySelector('#btn-download-bat')!.addEventListener('click', () => {
      this.downloadWindowsBat();
    });

    // Gamepad profile & axes
    const selProfile = this.root.querySelector<HTMLSelectElement>('#sel-profile')!;
    selProfile.addEventListener('change', () => {
      this.gamepad.settings.profile = selProfile.value as ControllerProfile;
    });

    const chkPsAlt = this.root.querySelector<HTMLInputElement>('#chk-ps-alt')!;
    chkPsAlt.addEventListener('change', () => {
      this.gamepad.settings.psAltAxes = chkPsAlt.checked;
    });

    for (let i = 0; i < 4; i++) {
      const chk = this.root.querySelector<HTMLInputElement>(`#chk-inv-${i}`)!;
      chk.addEventListener('change', () => {
        this.gamepad.settings.axes[i].inverted = chk.checked;
      });
    }

    this.calBtn.addEventListener('click', () => {
      if (this.gamepad.calibrationStep === 'idle') {
        const step = this.gamepad.startCalibration();
        if (step === 'extremes') {
          this.calBtn.textContent = 'Concluir Calibração';
          this.calHintEl.textContent = 'Mova os 2 sticks até os extremos em círculo e clique em Concluir.';
        } else {
          this.calHintEl.textContent = 'Nenhum gamepad conectado — calibração padrão mantida.';
        }
      } else {
        this.gamepad.finishCalibration();
        this.calBtn.textContent = 'Calibrar Centro & Extremos';
        this.calHintEl.textContent = 'Calibração concluída com sucesso!';
      }
    });

    this.root.querySelector('#btn-cal-reset')!.addEventListener('click', () => {
      this.gamepad.resetCalibration();
      this.calBtn.textContent = 'Calibrar Centro & Extremos';
      this.calHintEl.textContent = 'Calibração restaurada para padrão.';
    });

    // Response curve sliders
    const sldExpo = this.root.querySelector<HTMLInputElement>('#sld-expo')!;
    const lblExpo = this.root.querySelector<HTMLElement>('#lbl-expo')!;
    sldExpo.addEventListener('input', () => {
      this.gamepad.settings.expo = parseFloat(sldExpo.value);
      lblExpo.textContent = this.gamepad.settings.expo.toFixed(2);
      this.updateExpoCurvePath();
    });

    const sldDz = this.root.querySelector<HTMLInputElement>('#sld-dz')!;
    const lblDz = this.root.querySelector<HTMLElement>('#lbl-dz')!;
    sldDz.addEventListener('input', () => {
      this.gamepad.settings.deadzone = parseFloat(sldDz.value);
      lblDz.textContent = `${Math.round(this.gamepad.settings.deadzone * 100)}%`;
      this.updateExpoCurvePath();
    });

    const sldTilt = this.root.querySelector<HTMLInputElement>('#sld-tilt')!;
    const lblTilt = this.root.querySelector<HTMLElement>('#lbl-tilt')!;
    sldTilt.addEventListener('input', () => {
      this.gamepad.settings.maxTiltDeg = parseFloat(sldTilt.value);
      lblTilt.textContent = `${this.gamepad.settings.maxTiltDeg.toFixed(0)}°`;
    });

    const sldYaw = this.root.querySelector<HTMLInputElement>('#sld-yaw')!;
    const lblYaw = this.root.querySelector<HTMLElement>('#lbl-yaw')!;
    sldYaw.addEventListener('input', () => {
      this.gamepad.settings.maxYawRateDeg = parseFloat(sldYaw.value);
      lblYaw.textContent = `${this.gamepad.settings.maxYawRateDeg.toFixed(0)}°/s`;
    });

    const sldClimb = this.root.querySelector<HTMLInputElement>('#sld-climb')!;
    const lblClimb = this.root.querySelector<HTMLElement>('#lbl-climb')!;
    sldClimb.addEventListener('input', () => {
      this.gamepad.settings.maxClimbRate = parseFloat(sldClimb.value);
      lblClimb.textContent = `${this.gamepad.settings.maxClimbRate.toFixed(1)} m/s`;
    });

    // Wind controls
    this.root.querySelectorAll<HTMLButtonElement>('[data-wind-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.windPreset as WindPresetId;
        this.cb.onWindPreset(preset);
        this.syncWindSliders();
      });
    });

    this.root.querySelector('#btn-gust-now')!.addEventListener('click', () => {
      this.cb.onTriggerGust();
    });

    this.windSpeedSlider.addEventListener('input', () => {
      this.wind.config.speed = parseFloat(this.windSpeedSlider.value);
      this.windSpeedVal.textContent = `${this.wind.config.speed.toFixed(1)} m/s`;
    });

    this.windAzSlider.addEventListener('input', () => {
      this.wind.config.azimuthDeg = parseFloat(this.windAzSlider.value);
      this.windAzVal.textContent = `${this.wind.config.azimuthDeg.toFixed(0)}°`;
    });

    this.gustIntSlider.addEventListener('input', () => {
      this.wind.config.gustIntensity = parseFloat(this.gustIntSlider.value);
      this.gustIntVal.textContent = `${this.wind.config.gustIntensity.toFixed(1)} m/s`;
    });

    this.gustFreqSlider.addEventListener('input', () => {
      this.wind.config.gustFrequency = parseFloat(this.gustFreqSlider.value);
      this.gustFreqVal.textContent = `${Math.round(this.wind.config.gustFrequency * 100)}%`;
    });

    this.turbCheckbox.addEventListener('change', () => {
      this.wind.config.turbulenceEnabled = this.turbCheckbox.checked;
    });

    // Scenario options
    const chkVectors = this.root.querySelector<HTMLInputElement>('#chk-vectors')!;
    chkVectors.addEventListener('change', () => this.cb.onToggleVectors(chkVectors.checked));

    const chkVortex = this.root.querySelector<HTMLInputElement>('#chk-vortex')!;
    chkVortex.addEventListener('change', () => {
      this.gamepad.settings.vortexRingLimit = chkVortex.checked;
    });
  }

  public syncWindSliders(): void {
    this.windSpeedSlider.value = String(this.wind.config.speed);
    this.windSpeedVal.textContent = `${this.wind.config.speed.toFixed(1)} m/s`;
    this.windAzSlider.value = String(this.wind.config.azimuthDeg);
    this.windAzVal.textContent = `${this.wind.config.azimuthDeg.toFixed(0)}°`;
    this.gustIntSlider.value = String(this.wind.config.gustIntensity);
    this.gustIntVal.textContent = `${this.wind.config.gustIntensity.toFixed(1)} m/s`;
    this.gustFreqSlider.value = String(this.wind.config.gustFrequency);
    this.gustFreqVal.textContent = `${Math.round(this.wind.config.gustFrequency * 100)}%`;
    this.turbCheckbox.checked = this.wind.config.turbulenceEnabled;
  }

  public setCameraActive(mode: CameraMode): void {
    this.cameraBtns.forEach((b, k) => b.classList.toggle('active', k === mode));
    this.cb.onCameraModeChange(mode);
  }

  public setScenarioActive(id: ScenarioId): void {
    this.scenarioBtns.forEach((b, k) => b.classList.toggle('active', k === id));
    this.slalomBadge.style.display = id === 'slalom' ? 'flex' : 'none';
    this.cb.onScenarioChange(id);
  }

  public setFlightModeActive(mode: FlightMode): void {
    this.flightModeBtns.forEach((b, k) => b.classList.toggle('active', k === mode));
    this.cb.onFlightModeChange(mode);
  }

  public setVRState(mode: VRMode, webxrSupported: boolean, diagMessage = ''): void {
    if (mode === 'webxr') {
      this.vrBtn.textContent = 'VR: WebXR';
      this.vrBtn.classList.add('active');
    } else if (mode === 'sbs') {
      this.vrBtn.textContent = 'VR: SBS 3D';
      this.vrBtn.classList.add('active');
    } else {
      this.vrBtn.textContent = webxrSupported ? 'VR: Off (Pronto)' : 'VR: Off (SBS)';
      this.vrBtn.classList.remove('active');
    }

    if (diagMessage) {
      this.vrDiagEl.style.display = 'block';
      this.vrDiagEl.textContent = diagMessage;
    } else {
      this.vrDiagEl.style.display = 'none';
    }
  }

  private setupPWAEvents(): void {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as {standalone?: boolean}).standalone === true;
    this.isInstalledPWA = isStandalone;
    if (isStandalone) {
      this.pwaInstallBtn.style.display = 'none';
      this.pwaStatusEl.textContent = 'Aplicativo Desktop já instalado e pronto para uso 100% offline.';
    }

    const updateOnline = () => {
      this.offlinePill.style.display = navigator.onLine ? 'none' : 'block';
    };
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e as BeforeInstallPromptEvent;
      if (!this.isInstalledPWA) {
        this.pwaInstallBtn.textContent = 'Instalar App Offline no PC (1 Clique)';
      }
    });

    window.addEventListener('appinstalled', () => {
      this.isInstalledPWA = true;
      this.deferredInstallPrompt = null;
      this.pwaInstallBtn.style.display = 'none';
      this.pwaStatusEl.textContent = 'OctaSim 6-DOF instalado com sucesso no seu PC!';
    });
  }

  private async handleInstallClick(): Promise<void> {
    if (this.deferredInstallPrompt) {
      await this.deferredInstallPrompt.prompt();
      const {outcome} = await this.deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        this.deferredInstallPrompt = null;
      }
    } else {
      this.pwaStatusEl.textContent =
        'Para instalar como App Offline no PC: abra em aba própria no Chrome/Edge (fora do iframe) e clique no ícone de instalação na barra de endereços ou Menu → Salvar e compartilhar → Instalar OctaSim 6-DOF.';
    }
  }

  private downloadWindowsBat(): void {
    const batContent = [
      '@echo off',
      'title OctaSim 6-DOF - Compilador EXE Windows',
      'echo ===================================================',
      'echo  OctaSim 6-DOF - Compilador Windows .EXE (Electron)',
      'echo ===================================================',
      'echo.',
      'where node >nul 2>nul',
      'if %errorlevel% neq 0 (',
      '  echo [ERRO] Node.js nao encontrado. Instale em https://nodejs.org/',
      '  pause',
      '  exit /b 1',
      ')',
      'echo [1/2] Instalando dependencias...',
      'call npm install',
      'if %errorlevel% neq 0 pause && exit /b 1',
      'echo [2/2] Gerando OctaSim-6DOF-Portable.exe e Instalador...',
      'call npm run build:exe',
      'echo.',
      'echo Concluido! Verifique a pasta "release\\".',
      'pause',
    ].join('\r\n');

    const blob = new Blob([batContent], {type: 'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'OctaSim_Gerar_EXE.bat';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  public toggleDock(): void {
    this.dockCollapsed = !this.dockCollapsed;
    this.dockWrapper.classList.toggle('collapsed', this.dockCollapsed);
    this.dockToggleBtn.textContent = this.dockCollapsed ? '▴ Mostrar Painel (H)' : '▾ Ocultar Painel (H)';
  }

  private updateExpoCurvePath(): void {
    let d = '';
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const x = -1 + (2 * i) / steps;
      const y = -this.gamepad.shapeResponse(x); // SVG Y inverted
      d += i === 0 ? `M ${x.toFixed(3)} ${y.toFixed(3)}` : ` L ${x.toFixed(3)} ${y.toFixed(3)}`;
    }
    this.expoCurvePath.setAttribute('d', d);
  }

  public update(t: TelemetrySnapshot, stick: StickInput): void {
    // Mode & Motor badges
    const modeText =
      t.flightMode === 'stabilized'
        ? 'ESTAB.'
        : t.flightMode === 'acro'
          ? 'ACRO'
          : 'M.ABERTA Q5';
    this.modeBadge.textContent = modeText;
    this.modeBadge.classList.toggle('warn', t.flightMode === 'open_loop');

    this.motorBadge.textContent = t.motorsArmed ? 'ARMADO' : 'DESATIVADO';
    this.motorBadge.classList.toggle('armed', t.motorsArmed);
    this.motorBadge.classList.toggle('disarmed', !t.motorsArmed);

    // Primary telemetry
    this.valAlt.textContent = `${t.altitude.toFixed(2)} m`;
    this.valPos.textContent = `${t.xN.toFixed(1)}, ${t.yE.toFixed(1)}`;
    this.valVh.textContent = `${t.vHorizontal.toFixed(2)} m/s (${t.vHorizontalKmh.toFixed(0)} km/h)`;
    this.valVc.textContent = `${t.vClimb >= 0 ? '+' : ''}${t.vClimb.toFixed(2)} m/s`;
    this.valPhi.textContent = `${t.phiDeg.toFixed(1)}°`;
    this.valTheta.textContent = `${t.thetaDeg.toFixed(1)}°`;
    this.valPsi.textContent = `${t.psiDeg.toFixed(1)}°`;
    this.valPower.textContent = `${t.shaftPowerW.toFixed(0)} W`;
    this.valTW.textContent = t.thrustToWeight.toFixed(2);

    // Artificial Horizon SVG transform (roll + pitch scaled)
    const pitchPx = Math.max(-24, Math.min(24, t.thetaDeg * 0.9));
    this.horizonGroup.setAttribute(
      'transform',
      `translate(40,40) rotate(${(-t.phiDeg).toFixed(1)}) translate(0,${pitchPx.toFixed(1)})`,
    );

    // 8-rotor bars
    let sumOmega = 0;
    const span = OCTA_PARAMS.omegaMax - OCTA_PARAMS.omegaMin;
    for (let i = 0; i < 8; i++) {
      const w = t.omega[i];
      sumOmega += w;
      const pct = Math.max(2, Math.min(100, ((w - OCTA_PARAMS.omegaMin) / span) * 100));
      this.rotorBars[i].style.height = `${pct.toFixed(1)}%`;
      this.rotorLabels[i].textContent = `${w.toFixed(0)}`;
    }
    const meanOmega = sumOmega / 8;
    this.valMeanOmega.textContent = `ω̄ ${meanOmega.toFixed(1)} · Ref ${DERIVED_CONSTANTS.hoverOmega.toFixed(1)}`;

    // Validation banner
    if (t.validationActive) {
      this.validationBanner.style.display = 'flex';
      this.validationPhaseEl.textContent = t.validationPhaseLabel;
      this.validationTimerEl.textContent = `${t.validationTime.toFixed(1)} / 62.0 s`;
      this.validationProgressEl.style.width = `${Math.min(100, (t.validationTime / 62) * 100).toFixed(1)}%`;
      this.validationBtn.textContent = 'Parar Validação';
      this.validationBtn.classList.add('danger');
      this.validationBtn.classList.remove('primary');
    } else {
      this.validationBanner.style.display = 'none';
      this.validationBtn.textContent = 'Executar Manobra de Validação (62 s)';
      this.validationBtn.classList.remove('danger');
      this.validationBtn.classList.add('primary');
    }

    // Slalom readout
    if (this.slalomBadge.style.display === 'flex') {
      this.slalomText.textContent = `Portões: ${t.slalomGatesPassed}/${t.slalomTotalGates} · ${t.slalomElapsedSec.toFixed(1)} s`;
    }

    // Gamepad & stick graph
    this.gpStatusEl.textContent = stick.sourceName;
    this.leftStickDot.setAttribute('cx', stick.yaw.toFixed(3));
    this.leftStickDot.setAttribute('cy', (-stick.throttle).toFixed(3));
    this.rightStickDot.setAttribute('cx', stick.roll.toFixed(3));
    this.rightStickDot.setAttribute('cy', (-stick.pitch).toFixed(3));
    this.stickReadoutEl.textContent = `L(${stick.yaw.toFixed(2)}, ${stick.throttle.toFixed(2)}) · R(${stick.roll.toFixed(2)}, ${stick.pitch.toFixed(2)})`;

    // Wind vector readout
    this.windReadoutEl.textContent = `v_vento = [${t.windInertial[0].toFixed(2)}, ${t.windInertial[1].toFixed(2)}, ${t.windInertial[2].toFixed(2)}] m/s (${t.windSpeed.toFixed(1)})`;

    // Telemetry strip chart (sampled every 0.08 s)
    if (t.simTime - this.lastChartSampleTime >= 0.08 || t.simTime < this.lastChartSampleTime) {
      if (t.simTime < this.lastChartSampleTime) this.chartHistory = [];
      this.lastChartSampleTime = t.simTime;
      this.chartHistory.push({alt: t.altitude, vh: t.vHorizontal, pwr: t.shaftPowerW});
      if (this.chartHistory.length > 120) this.chartHistory.shift();
      this.renderStripChart();
    }
  }

  private renderStripChart(): void {
    const n = this.chartHistory.length;
    if (n < 2) return;
    let dAlt = '';
    let dVh = '';
    let dPwr = '';

    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 360;
      const sample = this.chartHistory[i];
      const yAlt = 92 - Math.max(0, Math.min(1, sample.alt / 100)) * 86;
      const yVh = 92 - Math.max(0, Math.min(1, sample.vh / 25)) * 86;
      const yPwr = 92 - Math.max(0, Math.min(1, sample.pwr / 2000)) * 86;
      const cmd = i === 0 ? 'M' : 'L';
      dAlt += `${cmd} ${x.toFixed(1)} ${yAlt.toFixed(1)} `;
      dVh += `${cmd} ${x.toFixed(1)} ${yVh.toFixed(1)} `;
      dPwr += `${cmd} ${x.toFixed(1)} ${yPwr.toFixed(1)} `;
    }
    this.chartAltPath.setAttribute('d', dAlt);
    this.chartVhPath.setAttribute('d', dVh);
    this.chartPwrPath.setAttribute('d', dPwr);
  }
}
