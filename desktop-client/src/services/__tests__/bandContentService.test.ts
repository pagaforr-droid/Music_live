import { describe, expect, it } from 'vitest';
import {
  cleanTrackTitleFromFilename,
  detectVideoSourceType,
  extractVimeoId,
  extractYouTubeId,
  formatSecondsToMMSS,
  getAutoVideoThumbnail,
  getEmbedVideoUrl,
  sanitizeFileName,
} from '../bandContentService';
import { formatBytes, isLosslessOrHeavyAudio } from '../../utils/webAudioOptimizer';

describe('bandContentService media helpers', () => {
  it('cleans track titles from audio filenames cleanly', () => {
    expect(cleanTrackTitleFromFilename('01 - Rugido_de_Acero.mp3')).toBe('Rugido de Acero');
    expect(cleanTrackTitleFromFilename('04.Noches-De-Obsidiana.wav')).toBe('Noches De Obsidiana');
    expect(cleanTrackTitleFromFilename('Fuego.flac')).toBe('Fuego');
  });

  it('sanitizes filenames removing accents and unsafe characters', () => {
    expect(sanitizeFileName('La Nación del León (En Vivo!).mp3')).toBe('La_Nacion_del_Leon_En_Vivo_.mp3');
  });

  it('formats durations into MM:SS accurately', () => {
    expect(formatSecondsToMMSS(0)).toBe('0:00');
    expect(formatSecondsToMMSS(-5)).toBe('0:00');
    expect(formatSecondsToMMSS(65)).toBe('1:05');
    expect(formatSecondsToMMSS(228.9)).toBe('3:48');
  });

  it('extracts YouTube and Vimeo IDs, source types, embed URLs and thumbnails', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ?t=12')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractVimeoId('https://vimeo.com/123456789')).toBe('123456789');

    expect(detectVideoSourceType('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube');
    expect(detectVideoSourceType('https://vimeo.com/987654321')).toBe('vimeo');
    expect(detectVideoSourceType('https://storage.supabase.co/video.mp4')).toBe('upload');

    expect(
      getEmbedVideoUrl({
        source_type: 'youtube',
        video_url: 'https://youtu.be/dQw4w9WgXcQ',
      })
    ).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&modestbranding=1');

    expect(
      getEmbedVideoUrl({
        source_type: 'upload',
        video_url: 'https://cdn.example.com/live.mp4',
      })
    ).toBeNull();

    expect(getAutoVideoThumbnail('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    );
  });

  it('detects lossless WAV/FLAC studio files and formats byte sizes cleanly', () => {
    const wav = new File([new Uint8Array(10)], 'TU_ERES_STADIUM-POP-ROCK_24BIT_48KHZ.WAV', {
      type: 'audio/wav',
    });
    const mp3 = new File([new Uint8Array(10)], 'rugido.mp3', { type: 'audio/mpeg' });
    const flac = new File([new Uint8Array(10)], 'master.flac', { type: '' });

    expect(isLosslessOrHeavyAudio(wav)).toBe(true);
    expect(isLosslessOrHeavyAudio(flac)).toBe(true);
    expect(isLosslessOrHeavyAudio(mp3)).toBe(false);

    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(72.4 * 1024 * 1024)).toBe('72.4 MB');
  });
});
