import { afterEach, expect, it, vi } from 'vitest';
import { CameraScanner, barcodeDecoder, decodeBarcodeFile, identifierValue, scannedIdentifier, type BarcodeDecoder } from './barcode';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(decoder: () => Promise<BarcodeDecoder> = async () => async () => undefined) {
  const track = { stop: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), getCapabilities: () => ({ torch: true, focusMode: ['single-shot'] }), applyConstraints: vi.fn().mockResolvedValue(undefined) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  const media = { getUserMedia: vi.fn().mockResolvedValue(stream) };
  const video = { pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined), srcObject: null, videoWidth: 1280, videoHeight: 720 } as unknown as HTMLVideoElement;
  const canvas = { getContext: () => ({ drawImage: vi.fn() }) } as unknown as HTMLCanvasElement;
  const onCode = vi.fn(), onError = vi.fn(), onReady = vi.fn();
  const scanner = new CameraScanner({ video, media, decoder, canvas: () => canvas, onCode, onError, onReady });
  return { scanner, stream, track, media, video, onCode, onError, onReady };
}
it('T05 validates ISBN checksums and book prefixes, preserving raw danacode zeros', () => {
  expect(identifierValue('0-14-032872-6', 'isbn')).toBe('0140328726');
  expect(() => identifierValue('9780140328722', 'isbn')).toThrow();
  expect(scannedIdentifier('4006381333931').isbn).toBe(false);
  expect(identifierValue(' 002001 ', 'danacode')).toBe('002001');
  expect(() => identifierValue(' ', 'danacode')).toThrow();
});
it('T16 closes a camera permission result arriving after cancellation', async () => {
  const f = fixture(), pending = deferred<MediaStream>(); f.media.getUserMedia.mockReturnValue(pending.promise);
  const starting = f.scanner.start(); f.scanner.stop(); pending.resolve(f.stream); await starting;
  expect(f.track.stop).toHaveBeenCalledTimes(1); expect(f.video.srcObject).toBeNull(); expect(f.onReady).not.toHaveBeenCalled(); expect(f.onCode).not.toHaveBeenCalled();
});
it('T16 ignores a late frame and does not schedule decoding after stop', async () => {
  vi.useFakeTimers(); const frame = deferred<string | undefined>(), decode = vi.fn(() => frame.promise), f = fixture(async () => decode);
  await f.scanner.start(); expect(decode).toHaveBeenCalledTimes(1); f.scanner.stop(); frame.resolve('9780140328721'); await Promise.resolve(); await vi.runAllTimersAsync();
  expect(decode).toHaveBeenCalledTimes(1); expect(f.onCode).not.toHaveBeenCalled(); expect(f.track.stop).toHaveBeenCalledTimes(1);
});
it('T16 reports exactly one scan, stops tracks, and applies only requested camera constraints', async () => {
  const frame = deferred<string | undefined>(), f = fixture(async () => async () => frame.promise);
  await f.scanner.start(); expect(f.onReady).toHaveBeenCalledWith({ torch: true, focus: true }); await f.scanner.torch(true); await f.scanner.focus();
  expect(f.track.applyConstraints.mock.calls).toEqual([[{ advanced: [{ torch: true }] }], [{ advanced: [{ focusMode: 'single-shot' }] }]]);
  frame.resolve('9780140328721'); await vi.waitFor(() => expect(f.onCode).toHaveBeenCalledTimes(1)); expect(f.track.stop).toHaveBeenCalledTimes(1); expect(f.video.srcObject).toBeNull();
});
it('T16 distinguishes denied permission and disposes streams when decoder setup fails', async () => {
  const denied = fixture(); denied.media.getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError')); await denied.scanner.start(); expect(denied.onError.mock.calls[0][0]).toContain('לא ניתנה הרשאה');
  const broken = fixture(async () => { throw new Error('decoder'); }); await broken.scanner.start(); expect(broken.track.stop).toHaveBeenCalledTimes(1); expect(broken.onError).toHaveBeenCalledTimes(1);
});
it('T16 ignores decoder initialization completing after camera closure', async () => {
  const ready = deferred<BarcodeDecoder>(), f = fixture(() => ready.promise); const starting = f.scanner.start(); await Promise.resolve(); await Promise.resolve(); f.scanner.stop(); ready.resolve(async () => '9780140328721'); await starting;
  expect(f.track.stop).toHaveBeenCalledTimes(1); expect(f.onCode).not.toHaveBeenCalled(); expect(f.onReady).not.toHaveBeenCalled();
});
it('T16 unavailable camera offers recovery, track disconnection stops scanning', async () => {
  const absent = fixture(); absent.media.getUserMedia.mockRejectedValue(new DOMException('no camera', 'NotFoundError')); await absent.scanner.start(); expect(absent.onError.mock.calls[0][0]).toContain('אפשר לבחור תמונה');
  const connected = fixture(); await connected.scanner.start(); const ended = connected.track.addEventListener.mock.calls[0][1] as () => void; ended(); expect(connected.track.stop).toHaveBeenCalledTimes(1); expect(connected.onError.mock.calls[0][0]).toContain('נותקה'); expect(connected.video.srcObject).toBeNull();
});
it('T16 native detector returns raw code without loading fallback', async () => {
  const detect = vi.fn().mockResolvedValue([{ rawValue: '002001' }]);
  vi.stubGlobal('BarcodeDetector', class { static getSupportedFormats() { return Promise.resolve(['ean_13']); } detect = detect; });
  expect(await (await barcodeDecoder())({} as HTMLCanvasElement)).toBe('002001'); expect(detect).toHaveBeenCalledTimes(1);
});
it('T16 rejects non-image or oversized files before creating URLs or loading decoder', async () => {
  const decoder = vi.fn(); await expect(decodeBarcodeFile({ type: 'text/html', size: 2 } as File, decoder)).rejects.toThrow(); await expect(decodeBarcodeFile({ type: 'image/png', size: 21 * 1024 * 1024 } as File, decoder)).rejects.toThrow(); expect(decoder).not.toHaveBeenCalled();
});
