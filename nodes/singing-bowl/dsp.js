class SingingBowlDSP extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // Internal parameters with default matching manifest
    this.params = {
      frequency: 140.0,
      beating: 1.5,
      overtone: 0.4,
      intensity: 0.7
    };
    
    // Phase accumulators for 4 oscillators
    this.phaseF1 = 0; // Fundamental
    this.phaseF2 = 0; // Fundamental + Beat
    this.phaseO1 = 0; // Overtone
    this.phaseO2 = 0; // Overtone + Beat
    
    // Slow LFO for organic amplitude swelling
    this.lfoPhase = Math.random() * Math.PI * 2;
    
    this.port.onmessage = (event) => {
      if (event.data.type === 'PARAMETER_CHANGE') {
        // Implement simple low-pass smoothing here in a real build to prevent zipper noise
        this.params[event.data.id] = event.data.value;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const sampleRate = globalThis.sampleRate;
    const invSampleRate = 1.0 / sampleRate;
    
    // Overtone ratio (2.98 is an imperfect 12th, typical of singing bowls)
    const overtoneRatio = 2.98;

    for (let channel = 0; channel < output.length; ++channel) {
      const channelData = output[channel];
      
      for (let i = 0; i < channelData.length; ++i) {
        // Calculate current frequencies
        const f1 = this.params.frequency;
        const f2 = f1 + this.params.beating;
        const o1 = f1 * overtoneRatio;
        const o2 = o1 + (this.params.beating * 1.2); // Beating is slightly faster on overtones

        // Advance phases
        this.phaseF1 = (this.phaseF1 + f1 * Math.PI * 2 * invSampleRate) % (Math.PI * 2);
        this.phaseF2 = (this.phaseF2 + f2 * Math.PI * 2 * invSampleRate) % (Math.PI * 2);
        this.phaseO1 = (this.phaseO1 + o1 * Math.PI * 2 * invSampleRate) % (Math.PI * 2);
        this.phaseO2 = (this.phaseO2 + o2 * Math.PI * 2 * invSampleRate) % (Math.PI * 2);
        
        // Slow random walk / LFO for the overall amplitude to mimic human rubbing
        this.lfoPhase = (this.lfoPhase + 0.1 * Math.PI * 2 * invSampleRate) % (Math.PI * 2);
        const organicSwell = 0.8 + 0.2 * Math.sin(this.lfoPhase); 

        // Generate signals
        const fundamentalSignal = (Math.sin(this.phaseF1) + Math.sin(this.phaseF2)) * 0.5;
        const overtoneSignal = (Math.sin(this.phaseO1) + Math.sin(this.phaseO2)) * 0.5;
        
        // Mix and apply intensity
        const mixedSignal = (fundamentalSignal * (1.0 - this.params.overtone * 0.5)) + 
                            (overtoneSignal * this.params.overtone);
                            
        // Global amplitude scaling (-6dB base headroom)
        channelData[i] = mixedSignal * this.params.intensity * organicSwell * 0.5;
      }
    }
    return true;
  }
}

registerProcessor('singing-bowl-dsp', SingingBowlDSP);
