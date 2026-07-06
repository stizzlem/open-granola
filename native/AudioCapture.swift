// AudioCapture — captures mic (AVAudioEngine) and system audio (ScreenCaptureKit)
// and writes 16 kHz *interleaved stereo* Int16 little-endian PCM to stdout:
//   left channel  = microphone ("me")
//   right channel = system audio ("them")
// Echo cancellation is enabled on the mic so speaker output doesn't bleed into "me".
//
// Usage:
//   AudioCapture mic      -> microphone only (right channel is silence)
//   AudioCapture mix      -> microphone + system audio (needs Screen Recording permission)
//   AudioCapture micwatch -> no capture; watches whether ANY app is using the default mic
//                            and prints "MIC:on"/"MIC:off" lines on stdout (no permissions needed)
//
// Status/errors go to stderr as single lines prefixed with "STATUS:" or "ERROR:".

import Foundation
import AVFoundation
import ScreenCaptureKit
import CoreMedia
import CoreAudio

let SAMPLE_RATE: Double = 16000.0
let PULL_INTERVAL: Double = 0.1 // seconds
let PULL_FRAMES = Int(SAMPLE_RATE * PULL_INTERVAL) // 1600

func logErr(_ s: String) {
    FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
}

// Thread-safe ring buffer of Float samples
final class RingBuffer {
    private var buf: [Float] = []
    private let lock = NSLock()
    func write(_ samples: [Float]) {
        lock.lock(); defer { lock.unlock() }
        buf.append(contentsOf: samples)
        // cap at 30s to avoid unbounded growth if consumer stalls
        let cap = Int(SAMPLE_RATE * 30)
        if buf.count > cap { buf.removeFirst(buf.count - cap) }
    }
    // Read exactly n samples; pad with zeros if not enough available
    func read(_ n: Int) -> [Float] {
        lock.lock(); defer { lock.unlock() }
        if buf.count >= n {
            let out = Array(buf.prefix(n))
            buf.removeFirst(n)
            return out
        } else {
            var out = buf
            buf.removeAll()
            out.append(contentsOf: [Float](repeating: 0, count: n - out.count))
            return out
        }
    }
}

let micBuffer = RingBuffer()
let sysBuffer = RingBuffer()

// Convert an AVAudioPCMBuffer (any format) to 16 kHz mono Float samples
final class Downsampler {
    private var converter: AVAudioConverter?
    private var srcFormat: AVAudioFormat?
    private let dstFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                          sampleRate: SAMPLE_RATE, channels: 1, interleaved: false)!
    func process(_ buffer: AVAudioPCMBuffer) -> [Float] {
        if converter == nil || srcFormat != buffer.format {
            srcFormat = buffer.format
            converter = AVAudioConverter(from: buffer.format, to: dstFormat)
        }
        guard let converter = converter else { return [] }
        let ratio = SAMPLE_RATE / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 32)
        guard let out = AVAudioPCMBuffer(pcmFormat: dstFormat, frameCapacity: capacity) else { return [] }
        var fed = false
        converter.convert(to: out, error: nil) { _, outStatus in
            if fed {
                outStatus.pointee = .noDataNow
                return nil
            }
            fed = true
            outStatus.pointee = .haveData
            return buffer
        }
        guard let ch = out.floatChannelData else { return [] }
        return Array(UnsafeBufferPointer(start: ch[0], count: Int(out.frameLength)))
    }
}

// ---- Mic capture ----
let engine = AVAudioEngine()
let micDownsampler = Downsampler()

func startMic() {
    let input = engine.inputNode
    // Echo cancellation: subtracts device playback from the mic signal so the
    // "me" channel doesn't contain the other side's speech when using speakers.
    do {
        try input.setVoiceProcessingEnabled(true)
        // VP ducks other system audio by default, which mangles the "them" capture — disable it
        if #available(macOS 14.0, *) {
            input.voiceProcessingOtherAudioDuckingConfiguration =
                AVAudioVoiceProcessingOtherAudioDuckingConfiguration(enableAdvancedDucking: false, duckingLevel: .min)
        }
        logErr("STATUS: mic echo cancellation enabled (ducking off)")
    } catch {
        logErr("STATUS: echo cancellation unavailable (\(error.localizedDescription)); continuing without")
    }
    let fmt = input.outputFormat(forBus: 0)
    input.installTap(onBus: 0, bufferSize: 4096, format: fmt) { buffer, _ in
        micBuffer.write(micDownsampler.process(buffer))
    }
    do {
        try engine.start()
        logErr("STATUS: mic started (\(fmt.sampleRate) Hz, \(fmt.channelCount) ch)")
    } catch {
        logErr("ERROR: mic failed to start: \(error.localizedDescription)")
        exit(2)
    }
}

// ---- System audio capture via ScreenCaptureKit ----
final class SysAudioCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    var stream: SCStream?
    let downsampler = Downsampler()

    func start() {
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: false) { content, error in
            if let error = error {
                logErr("ERROR: shareable content failed: \(error.localizedDescription) (grant Screen Recording permission)")
                exit(3)
            }
            guard let display = content?.displays.first else {
                logErr("ERROR: no display found for system audio capture")
                exit(3)
            }
            let filter = SCContentFilter(display: display, excludingWindows: [])
            let config = SCStreamConfiguration()
            config.capturesAudio = true
            config.excludesCurrentProcessAudio = true
            config.sampleRate = 48000
            config.channelCount = 2
            // minimize video overhead; we only want audio
            config.width = 2
            config.height = 2
            config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
            let stream = SCStream(filter: filter, configuration: config, delegate: self)
            self.stream = stream
            do {
                try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: DispatchQueue(label: "sysaudio"))
                stream.startCapture { err in
                    if let err = err {
                        logErr("ERROR: system audio startCapture failed: \(err.localizedDescription)")
                        exit(3)
                    }
                    logErr("STATUS: system audio started")
                }
            } catch {
                logErr("ERROR: addStreamOutput failed: \(error.localizedDescription)")
                exit(3)
            }
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        guard let pcm = sampleBuffer.toPCMBuffer() else { return }
        sysBuffer.write(downsampler.process(pcm))
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        logErr("ERROR: system audio stream stopped: \(error.localizedDescription)")
    }
}

extension CMSampleBuffer {
    func toPCMBuffer() -> AVAudioPCMBuffer? {
        guard let fmtDesc = CMSampleBufferGetFormatDescription(self),
              let asbdPtr = CMAudioFormatDescriptionGetStreamBasicDescription(fmtDesc) else { return nil }
        var asbd = asbdPtr.pointee
        guard let format = AVAudioFormat(streamDescription: &asbd) else { return nil }
        let numSamples = AVAudioFrameCount(CMSampleBufferGetNumSamples(self))
        guard let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: numSamples) else { return nil }
        pcm.frameLength = numSamples
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            self, at: 0, frameCount: Int32(numSamples), into: pcm.mutableAudioBufferList)
        return status == noErr ? pcm : nil
    }
}

// ---- Writer: pull from both buffers every 100 ms, write interleaved stereo Int16 to stdout ----
func startMixer(includeSystem: Bool) {
    let out = FileHandle.standardOutput
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "mixer"))
    timer.schedule(deadline: .now() + PULL_INTERVAL, repeating: PULL_INTERVAL)
    timer.setEventHandler {
        let mic = micBuffer.read(PULL_FRAMES)
        let sys = includeSystem ? sysBuffer.read(PULL_FRAMES) : [Float](repeating: 0, count: PULL_FRAMES)
        var pcm = [Int16](repeating: 0, count: PULL_FRAMES * 2)
        for i in 0..<PULL_FRAMES {
            pcm[i * 2] = Int16(max(-1.0, min(1.0, mic[i])) * 32767.0)     // L = me
            pcm[i * 2 + 1] = Int16(max(-1.0, min(1.0, sys[i])) * 32767.0) // R = them
        }
        pcm.withUnsafeBufferPointer { ptr in
            out.write(Data(buffer: ptr))
        }
    }
    timer.resume()
    // keep a strong reference
    globalTimer = timer
}
var globalTimer: DispatchSourceTimer?
let sysCapture = SysAudioCapture()

// ---- Mic-in-use watcher (for meeting detection) ----
// Uses CoreAudio process objects (macOS 14+): reports the pid of any process
// actively capturing audio input (what drives the orange mic indicator).
// Note: our own capture uses voice-processing I/O and does not register here,
// so the watcher naturally ignores OpenGranola's own recordings.
func processCapturingInput() -> pid_t? {
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(0)
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr, size > 0 else { return nil }
    var procs = [AudioObjectID](repeating: 0, count: Int(size) / 4)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &procs) == noErr else { return nil }
    for p in procs {
        var a = AudioObjectPropertyAddress(
            mSelector: kAudioProcessPropertyIsRunningInput,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var val = UInt32(0)
        var s = UInt32(4)
        guard AudioObjectGetPropertyData(p, &a, 0, nil, &s, &val) == noErr, val != 0 else { continue }
        var pa = AudioObjectPropertyAddress(
            mSelector: kAudioProcessPropertyPID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var pid = pid_t(0)
        var ps = UInt32(4)
        _ = AudioObjectGetPropertyData(p, &pa, 0, nil, &ps, &pid)
        return pid
    }
    return nil
}

func runMicWatch() {
    let out = FileHandle.standardOutput
    var lastOn = false
    logErr("STATUS: watching for processes capturing mic input")
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "micwatch"))
    timer.schedule(deadline: .now(), repeating: 2.0)
    timer.setEventHandler {
        let pid = processCapturingInput()
        let on = pid != nil
        if on != lastOn {
            lastOn = on
            out.write("MIC:\(on ? "on \(pid!)" : "off")\n".data(using: .utf8)!)
        }
    }
    timer.resume()
    globalTimer = timer
}

// ---- Main ----
let mode = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "mix"
signal(SIGPIPE, SIG_IGN) // exit cleanly via read loop instead
signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }

if mode == "micwatch" {
    runMicWatch()
    RunLoop.main.run()
}

AVCaptureDevice.requestAccess(for: .audio) { granted in
    if !granted {
        logErr("ERROR: microphone permission denied")
        exit(2)
    }
    DispatchQueue.main.async {
        startMic()
        if mode == "mix" {
            sysCapture.start()
        } else {
            logErr("STATUS: mic-only mode")
        }
        startMixer(includeSystem: mode == "mix")
        logErr("STATUS: streaming 16kHz stereo (L=me, R=them) s16le PCM on stdout")
    }
}

RunLoop.main.run()
