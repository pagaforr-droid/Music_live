/**
 * Controlador de Audición Quirúrgica de Frecuencias (Band-Pass Solo 24 dB/octava).
 * Permite escuchar en aislamiento cualquier banda estrecha del espectrograma (Shift + Clic y arrastrar)
 * con compensación automática de ganancia (+7.5 dB) y limitador de protección auditiva.
 */
export class BandPassSoloController {
  private ctx: BaseAudioContext;
  public readonly inputNode: GainNode;
  public readonly outputNode: GainNode;

  private normalPassGain: GainNode;
  private soloActiveGain: GainNode;
  private bpFilter1: BiquadFilterNode;
  private bpFilter2: BiquadFilterNode;
  private soloMakeupGain: GainNode;
  private safetyLimiter: DynamicsCompressorNode;

  private active = false;
  private currentFreqHz = 3800;
  private currentQ = 8.0;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.inputNode = ctx.createGain();
    this.outputNode = ctx.createGain();

    this.normalPassGain = ctx.createGain();
    this.normalPassGain.gain.value = 1.0;

    this.soloActiveGain = ctx.createGain();
    this.soloActiveGain.gain.value = 0.0;

    // Dos filtros Band-Pass en serie = pendiente quirúrgica de 24 dB/octava
    this.bpFilter1 = ctx.createBiquadFilter();
    this.bpFilter1.type = 'bandpass';
    this.bpFilter1.frequency.value = this.currentFreqHz;
    this.bpFilter1.Q.value = this.currentQ;

    this.bpFilter2 = ctx.createBiquadFilter();
    this.bpFilter2.type = 'bandpass';
    this.bpFilter2.frequency.value = this.currentFreqHz;
    this.bpFilter2.Q.value = this.currentQ;

    // Compensación automática de ganancia (+7.5 dB base)
    this.soloMakeupGain = ctx.createGain();
    this.soloMakeupGain.gain.value = Math.pow(10, 7.5 / 20);

    // Limitador de protección para el oído al audicionar resonancias fuertes
    this.safetyLimiter = ctx.createDynamicsCompressor();
    this.safetyLimiter.threshold.value = -2.5;
    this.safetyLimiter.knee.value = 2.0;
    this.safetyLimiter.ratio.value = 20.0;
    this.safetyLimiter.attack.value = 0.001;
    this.safetyLimiter.release.value = 0.05;

    // Ruta Normal (Master Completo)
    this.inputNode.connect(this.normalPassGain);
    this.normalPassGain.connect(this.outputNode);

    // Ruta Quirúrgica Aislada (Band-Pass Cascada 24dB/oct -> Makeup -> Safety Limiter -> Solo Gain)
    this.inputNode.connect(this.bpFilter1);
    this.bpFilter1.connect(this.bpFilter2);
    this.bpFilter2.connect(this.soloMakeupGain);
    this.soloMakeupGain.connect(this.safetyLimiter);
    this.safetyLimiter.connect(this.soloActiveGain);
    this.soloActiveGain.connect(this.outputNode);
  }

  public startSoloListen(freqHz: number, qFactor = 8.0): void {
    this.active = true;
    this.updateSoloFrequency(freqHz, qFactor);

    const now = this.ctx.currentTime;
    this.normalPassGain.gain.setTargetAtTime(0.0, now, 0.015);
    this.soloActiveGain.gain.setTargetAtTime(1.0, now, 0.015);
  }

  public updateSoloFrequency(freqHz: number, qFactor?: number): void {
    const now = this.ctx.currentTime;
    const clampedFreq = Math.max(30, Math.min(18500, freqHz));
    this.currentFreqHz = clampedFreq;

    if (qFactor !== undefined) {
      this.currentQ = Math.max(1.5, Math.min(18.0, qFactor));
    }

    // Cada etapa en cascada usa Q * 0.78 para que el ancho de banda combinado equivalga al Q objetivo
    const stageQ = Math.max(1.2, this.currentQ * 0.78);
    this.bpFilter1.frequency.setTargetAtTime(clampedFreq, now, 0.012);
    this.bpFilter2.frequency.setTargetAtTime(clampedFreq, now, 0.012);
    this.bpFilter1.Q.setTargetAtTime(stageQ, now, 0.012);
    this.bpFilter2.Q.setTargetAtTime(stageQ, now, 0.012);

    // Compensación dinámica de ganancia según la estrechez de banda (+7.5 dB a +11.5 dB)
    const makeupDb = 7.5 + Math.log2(Math.max(1, this.currentQ / 4)) * 2.2;
    this.soloMakeupGain.gain.setTargetAtTime(
      Math.pow(10, makeupDb / 20),
      now,
      0.015
    );
  }

  public stopSoloListen(): void {
    if (!this.active) return;
    this.active = false;
    const now = this.ctx.currentTime;
    this.soloActiveGain.gain.setTargetAtTime(0.0, now, 0.015);
    this.normalPassGain.gain.setTargetAtTime(1.0, now, 0.015);
  }

  public isSoloActive(): boolean {
    return this.active;
  }
}
