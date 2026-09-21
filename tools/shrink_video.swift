// Shrink a screen recording for the web: scale it down, drop the frame rate and
// set an explicit H.264 bitrate. avconvert's presets only offer fixed quality
// levels (a 106s clip stays >10MB), and ffmpeg is not installed, so this uses
// AVAssetWriter directly — no extra software on the machine.
//
//   swift tools/shrink_video.swift <input> <output.mp4> [width] [fps] [kbps]
import AVFoundation
import CoreImage
import Foundation

let args = CommandLine.arguments
guard args.count >= 3 else {
    print("usage: swift shrink_video.swift <input> <output.mp4> [width=1280] [fps=15] [kbps=600]")
    exit(1)
}
let src = URL(fileURLWithPath: args[1])
let dst = URL(fileURLWithPath: args[2])
let targetW = args.count > 3 ? Int(args[3])! : 1280
let targetFPS = args.count > 4 ? Double(args[4])! : 15
let bitrate = args.count > 5 ? Int(args[5])! * 1000 : 600_000

try? FileManager.default.removeItem(at: dst)
let asset = AVURLAsset(url: src)
guard let track = asset.tracks(withMediaType: .video).first else {
    print("no video track"); exit(1)
}

// preferredTransform carries any rotation the recorder applied
let natural = track.naturalSize.applying(track.preferredTransform)
let srcW = abs(natural.width), srcH = abs(natural.height)
let scale = CGFloat(targetW) / srcW
var outW = targetW
var outH = Int((srcH * scale).rounded())
if outH % 2 != 0 { outH += 1 }          // H.264 wants even dimensions

let reader = try AVAssetReader(asset: asset)
let readerOut = AVAssetReaderTrackOutput(track: track, outputSettings: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
])
readerOut.alwaysCopiesSampleData = false
reader.add(readerOut)

let writer = try AVAssetWriter(outputURL: dst, fileType: .mp4)
writer.shouldOptimizeForNetworkUse = true      // moov atom first: starts playing at once
let settings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: outW,
    AVVideoHeightKey: outH,
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: bitrate,
        AVVideoMaxKeyFrameIntervalKey: Int(targetFPS * 2),
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoAllowFrameReorderingKey: true,
    ],
]
let writerIn = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
writerIn.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
    assetWriterInput: writerIn,
    sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: outW,
        kCVPixelBufferHeightKey as String: outH,
    ])
writer.add(writerIn)
writer.startWriting()
writer.startSession(atSourceTime: .zero)
reader.startReading()

let ciContext = CIContext(options: [.useSoftwareRenderer: false])
let colorSpace = CGColorSpaceCreateDeviceRGB()
let frameInterval = CMTime(value: 1, timescale: CMTimeScale(targetFPS))
var nextEmit = CMTime.zero
var written = 0
var read = 0

let queue = DispatchQueue(label: "shrink")
let group = DispatchGroup()
group.enter()
writerIn.requestMediaDataWhenReady(on: queue) {
    while writerIn.isReadyForMoreMediaData {
        guard let sample = readerOut.copyNextSampleBuffer() else {
            writerIn.markAsFinished()
            group.leave()
            return
        }
        read += 1
        let pts = CMSampleBufferGetPresentationTimeStamp(sample)
        if CMTimeCompare(pts, nextEmit) < 0 { continue }   // drop frames to hit target fps
        nextEmit = CMTimeAdd(pts, frameInterval)

        guard let imageBuffer = CMSampleBufferGetImageBuffer(sample),
              let pool = adaptor.pixelBufferPool,
              let dstBuffer = try? {
                  var pb: CVPixelBuffer?
                  CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb)
                  return pb
              }() else { continue }

        let image = CIImage(cvPixelBuffer: imageBuffer)
        let scaled = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        ciContext.render(scaled, to: dstBuffer, bounds: CGRect(x: 0, y: 0, width: outW, height: outH),
                         colorSpace: colorSpace)
        adaptor.append(dstBuffer, withPresentationTime: pts)
        written += 1
    }
}
group.wait()
writer.finishWriting {
    let bytes = (try? FileManager.default.attributesOfItem(atPath: dst.path)[.size] as? Int) ?? 0
    print("读取 \(read) 帧 → 写入 \(written) 帧")
    print("输出 \(outW)x\(outH) @ \(Int(targetFPS))fps, \(bitrate/1000) kbps")
    print(String(format: "文件大小: %.2f MB", Double(bytes ?? 0) / 1_048_576))
    print("状态: \(writer.status == .completed ? "完成 ✓" : "失败 ✗ \(writer.error?.localizedDescription ?? "")")")
}
