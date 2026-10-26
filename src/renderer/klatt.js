// The Klatt formant synthesizer, from klatt-syn 1.0.9 by Christian
// d'Heureuse (https://github.com/chdh/klatt-syn), unchanged but for being
// a plain script: no imports, and no automatic level control (Blaube
// always sets gainDb). Used by voice.js to say words.
//
// MIT License
//
// Copyright (c) 2019 Christian d'Heureuse, chdh@inventec.ch
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
(function (root) {
'use strict';
class LpFilter1 {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.y1 = 0;
        this.passthrough = true;
        this.muted = false;
    }
    set(f, g, extraGain = 1) {
        if (f <= 0 || f >= this.sampleRate / 2 || g <= 0 || g >= 1 || !isFinite(f) || !isFinite(g) || !isFinite(extraGain)) {
            throw new Error("Invalid filter parameters.");
        }
        const w = 2 * Math.PI * f / this.sampleRate;
        const q = (1 - g ** 2 * Math.cos(w)) / (1 - g ** 2);
        this.b = q - Math.sqrt(q ** 2 - 1);
        this.a = (1 - this.b) * extraGain;
        this.passthrough = false;
        this.muted = false;
    }
    setPassthrough() {
        this.passthrough = true;
        this.muted = false;
        this.y1 = 0;
    }
    setMute() {
        this.passthrough = false;
        this.muted = true;
        this.y1 = 0;
    }
    getTransferFunctionCoefficients() {
        if (this.passthrough) {
            return [[1], [1]];
        }
        if (this.muted) {
            return [[0], [1]];
        }
        return [[this.a], [1, -this.b]];
    }
    step(x) {
        if (this.passthrough) {
            return x;
        }
        if (this.muted) {
            return 0;
        }
        const y = this.a * x + this.b * this.y1;
        this.y1 = y;
        return y;
    }
}
class Resonator {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.y1 = 0;
        this.y2 = 0;
        this.passthrough = true;
        this.muted = false;
    }
    set(f, bw, dcGain = 1) {
        if (f < 0 || f >= this.sampleRate / 2 || bw <= 0 || dcGain <= 0 || !isFinite(f) || !isFinite(bw) || !isFinite(dcGain)) {
            throw new Error("Invalid resonator parameters.");
        }
        this.r = Math.exp(-Math.PI * bw / this.sampleRate);
        const w = 2 * Math.PI * f / this.sampleRate;
        this.c = -(this.r ** 2);
        this.b = 2 * this.r * Math.cos(w);
        this.a = (1 - this.b - this.c) * dcGain;
        this.passthrough = false;
        this.muted = false;
    }
    setPassthrough() {
        this.passthrough = true;
        this.muted = false;
        this.y1 = 0;
        this.y2 = 0;
    }
    setMute() {
        this.passthrough = false;
        this.muted = true;
        this.y1 = 0;
        this.y2 = 0;
    }
    adjustImpulseGain(newA) {
        this.a = newA;
    }
    adjustPeakGain(peakGain) {
        if (peakGain <= 0 || !isFinite(peakGain)) {
            throw new Error("Invalid resonator peak gain.");
        }
        this.a = peakGain * (1 - this.r);
    }
    getTransferFunctionCoefficients() {
        if (this.passthrough) {
            return [[1], [1]];
        }
        if (this.muted) {
            return [[0], [1]];
        }
        return [[this.a], [1, -this.b, -this.c]];
    }
    step(x) {
        if (this.passthrough) {
            return x;
        }
        if (this.muted) {
            return 0;
        }
        const y = this.a * x + this.b * this.y1 + this.c * this.y2;
        this.y2 = this.y1;
        this.y1 = y;
        return y;
    }
}
class AntiResonator {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.x1 = 0;
        this.x2 = 0;
        this.passthrough = true;
        this.muted = false;
    }
    set(f, bw) {
        if (f <= 0 || f >= this.sampleRate / 2 || bw <= 0 || !isFinite(f) || !isFinite(bw)) {
            throw new Error("Invalid anti-resonator parameters.");
        }
        const r = Math.exp(-Math.PI * bw / this.sampleRate);
        const w = 2 * Math.PI * f / this.sampleRate;
        const c0 = -(r * r);
        const b0 = 2 * r * Math.cos(w);
        const a0 = 1 - b0 - c0;
        if (a0 == 0) {
            this.a = 0;
            this.b = 0;
            this.c = 0;
            return;
        }
        this.a = 1 / a0;
        this.b = -b0 / a0;
        this.c = -c0 / a0;
        this.passthrough = false;
        this.muted = false;
    }
    setPassthrough() {
        this.passthrough = true;
        this.muted = false;
        this.x1 = 0;
        this.x2 = 0;
    }
    setMute() {
        this.passthrough = false;
        this.muted = true;
        this.x1 = 0;
        this.x2 = 0;
    }
    getTransferFunctionCoefficients() {
        if (this.passthrough) {
            return [[1], [1]];
        }
        if (this.muted) {
            return [[0], [1]];
        }
        return [[this.a, this.b, this.c], [1]];
    }
    step(x) {
        if (this.passthrough) {
            return x;
        }
        if (this.muted) {
            return 0;
        }
        const y = this.a * x + this.b * this.x1 + this.c * this.x2;
        this.x2 = this.x1;
        this.x1 = x;
        return y;
    }
}
class DifferencingFilter {
    constructor() {
        this.x1 = 0;
    }
    getTransferFunctionCoefficients() {
        return [[1, -1], [1]];
    }
    step(x) {
        const y = x - this.x1;
        this.x1 = x;
        return y;
    }
}
function getWhiteNoise() {
    return Math.random() * 2 - 1;
}
class LpNoiseSource {
    constructor(sampleRate) {
        const oldB = 0.75;
        const oldSampleRate = 10000;
        const f = 1000;
        const g = (1 - oldB) / Math.sqrt(1 - 2 * oldB * Math.cos(2 * Math.PI * f / oldSampleRate) + oldB ** 2);
        const extraGain = 2.5 * (sampleRate / 10000) ** 0.33;
        this.lpFilter = new LpFilter1(sampleRate);
        this.lpFilter.set(f, g, extraGain);
    }
    getNext() {
        const x = getWhiteNoise();
        return this.lpFilter.step(x);
    }
}
class ImpulsiveGlottalSource {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.resonator = undefined;
    }
    startPeriod(openPhaseLength) {
        if (!openPhaseLength) {
            this.resonator = undefined;
            return;
        }
        if (!this.resonator) {
            this.resonator = new Resonator(this.sampleRate);
        }
        const bw = this.sampleRate / openPhaseLength;
        this.resonator.set(0, bw);
        this.resonator.adjustImpulseGain(1);
        this.positionInPeriod = 0;
    }
    getNext() {
        if (!this.resonator) {
            return 0;
        }
        const pulse = (this.positionInPeriod == 1) ? 1 : (this.positionInPeriod == 2) ? -1 : 0;
        this.positionInPeriod++;
        return this.resonator.step(pulse);
    }
}
class NaturalGlottalSource {
    constructor() {
        this.startPeriod(0);
    }
    startPeriod(openPhaseLength) {
        this.openPhaseLength = openPhaseLength;
        this.x = 0;
        const amplification = 5;
        this.b = -amplification / openPhaseLength ** 2;
        this.a = -this.b * openPhaseLength / 3;
        this.positionInPeriod = 0;
    }
    getNext() {
        if (this.positionInPeriod++ >= this.openPhaseLength) {
            this.x = 0;
            return 0;
        }
        this.a += this.b;
        this.x += this.a;
        return this.x;
    }
}
function performFrequencyModulation(f0, flutterLevel, time) {
    if (flutterLevel <= 0) {
        return f0;
    }
    const w = 2 * Math.PI * time;
    const a = Math.sin(12.7 * w) + Math.sin(7.1 * w) + Math.sin(4.7 * w);
    return f0 * (1 + a * flutterLevel / 50);
}
function dbToLin(db) {
    if (db <= -99 || isNaN(db)) {
        return 0;
    }
    else {
        return Math.pow(10, db / 20);
    }
}
const glottalSourceTypeEnumNames = ["impulsive", "natural", "noise"];
const maxOralFormants = 6;
class Generator {
    constructor(mParms) {
        this.mParms = mParms;
        this.fState = {};
        this.absPosition = 0;
        this.tiltFilter = new LpFilter1(mParms.sampleRate);
        this.flutterTimeOffset = Math.random() * 1000;
        this.outputLpFilter = new Resonator(mParms.sampleRate);
        this.outputLpFilter.set(0, mParms.sampleRate / 2);
        this.initGlottalSource();
        this.aspirationSourceCasc = new LpNoiseSource(mParms.sampleRate);
        this.aspirationSourcePar = new LpNoiseSource(mParms.sampleRate);
        this.fricationSourcePar = new LpNoiseSource(mParms.sampleRate);
        this.nasalFormantCasc = new Resonator(mParms.sampleRate);
        this.nasalAntiformantCasc = new AntiResonator(mParms.sampleRate);
        this.oralFormantCasc = Array(maxOralFormants);
        for (let i = 0; i < maxOralFormants; i++) {
            this.oralFormantCasc[i] = new Resonator(mParms.sampleRate);
        }
        this.nasalFormantPar = new Resonator(mParms.sampleRate);
        this.oralFormantPar = Array(maxOralFormants);
        for (let i = 0; i < maxOralFormants; i++) {
            this.oralFormantPar[i] = new Resonator(mParms.sampleRate);
        }
        this.differencingFilterPar = new DifferencingFilter();
    }
    generateFrame(fParms, outBuf) {
        if (fParms == this.fParms) {
            throw new Error("FrameParms structure must not be re-used.");
        }
        this.newFParms = fParms;
        for (let outPos = 0; outPos < outBuf.length; outPos++) {
            if (!this.pState || this.pState.positionInPeriod >= this.pState.periodLength) {
                this.startNewPeriod();
            }
            outBuf[outPos] = this.computeNextOutputSignalSample();
            this.pState.positionInPeriod++;
            this.absPosition++;
        }
    }
    computeNextOutputSignalSample() {
        const fParms = this.fParms;
        const fState = this.fState;
        const pState = this.pState;
        let voice = this.glottalSource();
        voice = this.tiltFilter.step(voice);
        if (pState.positionInPeriod < pState.openPhaseLength) {
            voice += getWhiteNoise() * fState.breathinessLin;
        }
        const cascadeOut = fParms.cascadeEnabled ? this.computeCascadeBranch(voice) : 0;
        const parallelOut = fParms.parallelEnabled ? this.computeParallelBranch(voice) : 0;
        let out = cascadeOut + parallelOut;
        out = this.outputLpFilter.step(out);
        out *= fState.gainLin;
        return out;
    }
    computeCascadeBranch(voice) {
        const fParms = this.fParms;
        const fState = this.fState;
        const pState = this.pState;
        const cascadeVoice = voice * fState.cascadeVoicingLin;
        const currentAspirationMod = (pState.positionInPeriod >= pState.periodLength / 2) ? fParms.cascadeAspirationMod : 0;
        const aspiration = this.aspirationSourceCasc.getNext() * fState.cascadeAspirationLin * (1 - currentAspirationMod);
        let v = cascadeVoice + aspiration;
        v = this.nasalAntiformantCasc.step(v);
        v = this.nasalFormantCasc.step(v);
        for (let i = 0; i < maxOralFormants; i++) {
            v = this.oralFormantCasc[i].step(v);
        }
        return v;
    }
    computeParallelBranch(voice) {
        const fParms = this.fParms;
        const fState = this.fState;
        const pState = this.pState;
        const parallelVoice = voice * fState.parallelVoicingLin;
        const currentAspirationMod = (pState.positionInPeriod >= pState.periodLength / 2) ? fParms.parallelAspirationMod : 0;
        const aspiration = this.aspirationSourcePar.getNext() * fState.parallelAspirationLin * (1 - currentAspirationMod);
        const source = parallelVoice + aspiration;
        const sourceDifference = this.differencingFilterPar.step(source);
        const currentFricationMod = (pState.positionInPeriod >= pState.periodLength / 2) ? fParms.fricationMod : 0;
        const fricationNoise = this.fricationSourcePar.getNext() * fState.fricationLin * (1 - currentFricationMod);
        const source2 = sourceDifference + fricationNoise;
        let v = 0;
        v += this.nasalFormantPar.step(source);
        v += this.oralFormantPar[0].step(source);
        for (let i = 1; i < maxOralFormants; i++) {
            const alternatingSign = (i % 2 == 0) ? 1 : -1;
            v += alternatingSign * this.oralFormantPar[i].step(source2);
        }
        v += fState.parallelBypassLin * source2;
        return v;
    }
    startNewPeriod() {
        if (this.newFParms) {
            this.fParms = this.newFParms;
            this.newFParms = undefined;
            this.startUsingNewFrameParameters();
        }
        if (!this.pState) {
            this.pState = {};
        }
        const pState = this.pState;
        const mParms = this.mParms;
        const fParms = this.fParms;
        const flutterTime = this.absPosition / mParms.sampleRate + this.flutterTimeOffset;
        pState.f0 = performFrequencyModulation(fParms.f0, fParms.flutterLevel, flutterTime);
        pState.periodLength = (pState.f0 > 0) ? Math.round(mParms.sampleRate / pState.f0) : 1;
        pState.openPhaseLength = (pState.periodLength > 1) ? Math.round(pState.periodLength * fParms.openPhaseRatio) : 0;
        pState.positionInPeriod = 0;
        this.startGlottalSourcePeriod();
    }
    startUsingNewFrameParameters() {
        const mParms = this.mParms;
        const fParms = this.fParms;
        const fState = this.fState;
        fState.breathinessLin = dbToLin(fParms.breathinessDb);
        fState.gainLin = dbToLin(fParms.gainDb || 0);
        setTiltFilter(this.tiltFilter, fParms.tiltDb);
        fState.cascadeVoicingLin = dbToLin(fParms.cascadeVoicingDb);
        fState.cascadeAspirationLin = dbToLin(fParms.cascadeAspirationDb);
        setNasalFormantCasc(this.nasalFormantCasc, fParms);
        setNasalAntiformantCasc(this.nasalAntiformantCasc, fParms);
        for (let i = 0; i < maxOralFormants; i++) {
            setOralFormantCasc(this.oralFormantCasc[i], fParms, i);
        }
        fState.parallelVoicingLin = dbToLin(fParms.parallelVoicingDb);
        fState.parallelAspirationLin = dbToLin(fParms.parallelAspirationDb);
        fState.fricationLin = dbToLin(fParms.fricationDb);
        fState.parallelBypassLin = dbToLin(fParms.parallelBypassDb);
        setNasalFormantPar(this.nasalFormantPar, fParms);
        for (let i = 0; i < maxOralFormants; i++) {
            setOralFormantPar(this.oralFormantPar[i], mParms, fParms, i);
        }
    }
    initGlottalSource() {
        switch (this.mParms.glottalSourceType) {
            case 0: {
                this.impulsiveGSource = new ImpulsiveGlottalSource(this.mParms.sampleRate);
                this.glottalSource = () => this.impulsiveGSource.getNext();
                break;
            }
            case 1: {
                this.naturalGSource = new NaturalGlottalSource();
                this.glottalSource = () => this.naturalGSource.getNext();
                break;
            }
            case 2: {
                this.glottalSource = getWhiteNoise;
                break;
            }
            default: {
                throw new Error("Undefined glottal source type.");
            }
        }
    }
    startGlottalSourcePeriod() {
        switch (this.mParms.glottalSourceType) {
            case 0: {
                this.impulsiveGSource.startPeriod(this.pState.openPhaseLength);
                break;
            }
            case 1: {
                this.naturalGSource.startPeriod(this.pState.openPhaseLength);
                break;
            }
            default: {
            }
        }
    }
}
function setTiltFilter(tiltFilter, tiltDb) {
    if (!tiltDb) {
        tiltFilter.setPassthrough();
    }
    else {
        tiltFilter.set(3000, dbToLin(-tiltDb));
    }
}
function setNasalFormantCasc(nasalFormantCasc, fParms) {
    if (fParms.nasalFormantFreq && fParms.nasalFormantBw) {
        nasalFormantCasc.set(fParms.nasalFormantFreq, fParms.nasalFormantBw);
    }
    else {
        nasalFormantCasc.setPassthrough();
    }
}
function setNasalAntiformantCasc(nasalAntiformantCasc, fParms) {
    if (fParms.nasalAntiformantFreq && fParms.nasalAntiformantBw) {
        nasalAntiformantCasc.set(fParms.nasalAntiformantFreq, fParms.nasalAntiformantBw);
    }
    else {
        nasalAntiformantCasc.setPassthrough();
    }
}
function setOralFormantCasc(oralFormantCasc, fParms, i) {
    const f = (i < fParms.oralFormantFreq.length) ? fParms.oralFormantFreq[i] : NaN;
    const bw = (i < fParms.oralFormantBw.length) ? fParms.oralFormantBw[i] : NaN;
    if (f && bw) {
        oralFormantCasc.set(f, bw);
    }
    else {
        oralFormantCasc.setPassthrough();
    }
}
function setNasalFormantPar(nasalFormantPar, fParms) {
    if (fParms.nasalFormantFreq && fParms.nasalFormantBw && dbToLin(fParms.nasalFormantDb)) {
        nasalFormantPar.set(fParms.nasalFormantFreq, fParms.nasalFormantBw);
        nasalFormantPar.adjustPeakGain(dbToLin(fParms.nasalFormantDb));
    }
    else {
        nasalFormantPar.setMute();
    }
}
function setOralFormantPar(oralFormantPar, mParms, fParms, i) {
    const formant = i + 1;
    const f = (i < fParms.oralFormantFreq.length) ? fParms.oralFormantFreq[i] : NaN;
    const bw = (i < fParms.oralFormantBw.length) ? fParms.oralFormantBw[i] : NaN;
    const db = (i < fParms.oralFormantDb.length) ? fParms.oralFormantDb[i] : NaN;
    const peakGain = dbToLin(db);
    if (f && bw && peakGain) {
        oralFormantPar.set(f, bw);
        const w = 2 * Math.PI * f / mParms.sampleRate;
        const diffGain = Math.sqrt(2 - 2 * Math.cos(w));
        const filterGain = (formant >= 2) ? peakGain / diffGain : peakGain;
        oralFormantPar.adjustPeakGain(filterGain);
    }
    else {
        oralFormantPar.setMute();
    }
}
function generateSound(mParms, fParmsA) {
    const generator = new Generator(mParms);
    let outBufLen = 0;
    for (const fParms of fParmsA) {
        outBufLen += Math.round(fParms.duration * mParms.sampleRate);
    }
    const outBuf = new Float64Array(outBufLen);
    let outBufPos = 0;
    for (const fParms of fParmsA) {
        const frameLen = Math.round(fParms.duration * mParms.sampleRate);
        const frameBuf = outBuf.subarray(outBufPos, outBufPos + frameLen);
        generator.generateFrame(fParms, frameBuf);
        outBufPos += frameLen;
    }
    return outBuf;
}
const api = { Generator, generateSound, maxOralFormants };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.BlaubeKlatt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
