import { describe, expect, it } from 'vitest';
import { captureParams } from '../view/capture';
import { captureUrl, ffmpegArgs, parseCameraList, publishTarget, redact, STREAM } from './cameras';
import { mediaMtxConfig } from './mediamtx';

const KNOWN = ['overview', 'infeed', 'springbase', 'cartridge', 'housing', 'outfeed'];

describe('RTSP_CAMERAS', () => {
  it('is off when empty', () => {
    expect(parseCameraList(undefined, KNOWN)).toEqual([]);
    expect(parseCameraList(' ', KNOWN)).toEqual([]);
  });
  it('takes a list (trimmed, deduplicated) or all', () => {
    expect(parseCameraList('infeed, outfeed,infeed', KNOWN)).toEqual(['infeed', 'outfeed']);
    expect(parseCameraList('all', KNOWN)).toEqual(KNOWN);
  });
  it('rejects unknown cameras', () => {
    expect(() => parseCameraList('infeed,lobby', KNOWN)).toThrow(/unknown camera lobby/);
  });
});

describe('stream addresses', () => {
  it('appends the camera id to the publish URL', () => {
    expect(publishTarget('rtsp://127.0.0.1:18554', 'infeed')).toBe('rtsp://127.0.0.1:18554/infeed');
    expect(publishTarget('rtsp://vms:8554/simulator/', 'infeed')).toBe('rtsp://vms:8554/simulator/infeed');
  });
  it('hides passwords in logged URLs', () => {
    expect(redact('rtsp://sim:s3cret@vms:8554/simulator/infeed')).toBe('rtsp://sim:***@vms:8554/simulator/infeed');
    expect(redact('rtsp://vms:8554/infeed')).toBe('rtsp://vms:8554/infeed');
  });
  it('opens the page in capture mode, which the page reads back', () => {
    const url = new URL(captureUrl('http://127.0.0.1:3000', 'housing', true));
    expect(url.pathname).toBe('/');
    expect(url.searchParams.get('cam')).toBe('housing');
    expect(captureParams(url.search)).toEqual({ fps: STREAM.fps, timestamp: true });
    expect(captureParams(new URL(captureUrl('http://127.0.0.1:3000', 'housing', false)).search)?.timestamp).toBe(false);
    expect(captureParams('?cam=housing')).toBeNull();
  });
});

describe('ffmpeg', () => {
  const args = ffmpegArgs('rtsp://127.0.0.1:18554/infeed');
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  it('encodes H.264 720p25 with a keyframe every 2 s and no B-frames', () => {
    expect(value('-c:v')).toBe('libx264');
    expect(value('-vf')).toContain('fps=25');
    expect(value('-vf')).toContain('scale=1280:720');
    expect(value('-g')).toBe('50');
    expect(value('-bf')).toBe('0');
  });
  it('publishes over RTSP/TCP to the target', () => {
    expect(args[args.lastIndexOf('-f') + 1]).toBe('rtsp');
    expect(args.slice(-1)[0]).toBe('rtsp://127.0.0.1:18554/infeed');
    expect(value('-rtsp_transport')).toBe('tcp');
  });
  it('does not use -fflags nobuffer (it delays the start by 5 s)', () => {
    expect(args.join(' ')).not.toContain('nobuffer');
  });
});

describe('bundled MediaMTX config', () => {
  const yml = mediaMtxConfig(18554);
  it('only serves RTSP, on ports clear of a stock MediaMTX', () => {
    expect(yml).toContain('rtspAddress: :18554');
    expect(yml).toContain('rtpAddress: :18556');
    expect(yml).toContain('rtcpAddress: :18557');
    for (const off of ['rtmp', 'hls', 'webrtc', 'srt', 'moq', 'api', 'metrics', 'pprof', 'playback']) expect(yml).toContain(`\n${off}: false\n`);
  });
  it('keeps the RTP port even for odd RTSP ports', () => {
    expect(mediaMtxConfig(9001)).toContain('rtpAddress: :9002');
  });
});
