import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Disc3,
  Film,
  Camera,
  Calendar,
  SlidersHorizontal,
  UploadCloud,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Star,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  Loader2,
  Play,
  Pause,
  Database,
  Save,
  Music,
  Image as ImageIcon,
  Link2,
  X,
  Edit3,
} from 'lucide-react';
import {
  BAND_CMS_SQL_MIGRATION,
  cleanTrackTitleFromFilename,
  createBandAlbum,
  createBandEvent,
  createBandPhoto,
  createBandTrack,
  createBandVideo,
  DEFAULT_ALBUM_COVER,
  DEFAULT_BAND_PROFILE,
  DEFAULT_HERO_IMAGE,
  deleteBandAlbum,
  deleteBandEvent,
  deleteBandPhoto,
  deleteBandTrack,
  deleteBandVideo,
  detectMediaDuration,
  detectVideoSourceType,
  getAutoVideoThumbnail,
  loadBandHubData,
  saveBandProfile,
  setFeaturedBandVideo,
  swapTrackNumbers,
  updateBandAlbum,
  updateBandPhoto,
  updateBandTrack,
  uploadBandMedia,
} from '../services/bandContentService';
import type {
  BandAlbum,
  BandEvent,
  BandMember,
  BandPhoto,
  BandProfile,
  BandTrack,
  BandVideo,
} from '../types/bandContent';
import '../styles/laNacionDelLeon.css';

type CmsTab = 'albums' | 'videos' | 'photos' | 'events' | 'identity';

const SPRING_UI = { type: 'spring' as const, stiffness: 340, damping: 28 };

export default function BandContentStudio() {
  const [activeTab, setActiveTab] = useState<CmsTab>('albums');
  const [loading, setLoading] = useState(true);
  const [missingTables, setMissingTables] = useState<string[]>([]);
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [sqlCopied, setSqlCopied] = useState(false);

  // Core state
  const [profile, setProfile] = useState<BandProfile>(DEFAULT_BAND_PROFILE);
  const [albums, setAlbums] = useState<BandAlbum[]>([]);
  const [videos, setVideos] = useState<BandVideo[]>([]);
  const [photos, setPhotos] = useState<BandPhoto[]>([]);
  const [events, setEvents] = useState<BandEvent[]>([]);

  // Feedback toast
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    setNotice({ kind, text });
    window.setTimeout(() => {
      setNotice((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  }, []);

  // =========================================================================
  // TAB 1: ALBUMS & TRACKS STATE
  // =========================================================================
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [isCreatingAlbum, setIsCreatingAlbum] = useState(false);
  const [albumForm, setAlbumForm] = useState({
    title: '',
    artist: 'La Nación del León',
    cover_url: '',
    description: '',
    credits: '',
    release_date: String(new Date().getFullYear()),
    buy_link: '',
  });
  const [savingAlbum, setSavingAlbum] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

  // Audio batch upload state
  const [audioUploadStatus, setAudioUploadStatus] = useState<string | null>(null);
  const [manualTrackForm, setManualTrackForm] = useState({ title: '', duration: '', audio_url: '' });
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [editingTrackTitle, setEditingTrackTitle] = useState('');
  const [previewAudioId, setPreviewAudioId] = useState<string | null>(null);
  const [previewAudioEl, setPreviewAudioEl] = useState<HTMLAudioElement | null>(null);

  // =========================================================================
  // TAB 2: VIDEOS STATE
  // =========================================================================
  const [videoMode, setVideoMode] = useState<'url' | 'upload'>('upload');
  const [videoForm, setVideoForm] = useState({
    title: '',
    category: 'En Vivo',
    video_url: '',
    thumbnail_url: '',
    duration: '',
    description: '',
    is_featured: false,
  });
  const [uploadingVideo, setUploadingVideo] = useState<string | null>(null);
  const [savingVideo, setSavingVideo] = useState(false);

  // =========================================================================
  // TAB 3: PHOTOS STATE
  // =========================================================================
  const [photoUploadCategory, setPhotoUploadCategory] = useState('En Vivo');
  const [photoUploadProgress, setPhotoUploadProgress] = useState<string | null>(null);
  const [editingPhotoId, setEditingPhotoId] = useState<string | null>(null);
  const [editingPhotoDraft, setEditingPhotoDraft] = useState({ title: '', caption: '', category: 'En Vivo' });

  // =========================================================================
  // TAB 4: EVENTS STATE
  // =========================================================================
  const [eventForm, setEventForm] = useState({
    event_date: '',
    venue: '',
    city: '',
    event_type: 'ARENA',
    status: 'DISPONIBLE',
    ticket_url: '',
    notes: '',
  });
  const [savingEvent, setSavingEvent] = useState(false);

  // =========================================================================
  // TAB 5: IDENTITY STATE
  // =========================================================================
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingHeroAsset, setUploadingHeroAsset] = useState<string | null>(null);

  const selectedAlbum = albums.find((a) => a.id === selectedAlbumId) || null;

  const hydrate = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadBandHubData();
      setProfile(data.profile);
      setAlbums(data.albums);
      setVideos(data.videos);
      setPhotos(data.photos);
      setEvents(data.events);
      setMissingTables(data.missingTables);
      setSelectedAlbumId((prev) => {
        if (prev && data.albums.some((a) => a.id === prev)) return prev;
        return data.albums[0]?.id ?? null;
      });
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error al conectar con Supabase');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Sync album form when switching selected album (unless in "create new" mode)
  useEffect(() => {
    if (isCreatingAlbum) return;
    if (selectedAlbum) {
      setAlbumForm({
        title: selectedAlbum.title || '',
        artist: selectedAlbum.artist || 'La Nación del León',
        cover_url: selectedAlbum.cover_url || '',
        description: selectedAlbum.description || '',
        credits: selectedAlbum.credits || '',
        release_date: selectedAlbum.release_date || '',
        buy_link: selectedAlbum.buy_link || '',
      });
    }
  }, [selectedAlbum, isCreatingAlbum]);

  // Stop inline audio preview on unmount
  useEffect(() => {
    return () => {
      if (previewAudioEl) {
        previewAudioEl.pause();
      }
    };
  }, [previewAudioEl]);

  const toggleTrackPreview = (track: BandTrack) => {
    if (!track.audio_url) {
      notify('err', 'Esta pista no tiene un archivo de audio asignado.');
      return;
    }
    if (previewAudioId === track.id && previewAudioEl) {
      previewAudioEl.pause();
      setPreviewAudioId(null);
      return;
    }
    if (previewAudioEl) {
      previewAudioEl.pause();
    }
    const audio = new Audio(track.audio_url);
    audio.onended = () => setPreviewAudioId(null);
    audio.onerror = () => {
      setPreviewAudioId(null);
      notify('err', 'No se pudo reproducir la vista previa de audio.');
    };
    audio.play().catch(() => notify('err', 'No se pudo iniciar el audio.'));
    setPreviewAudioEl(audio);
    setPreviewAudioId(track.id);
  };

  // =========================================================================
  // HANDLERS: ALBUMS & TRACKS
  // =========================================================================
  const startNewAlbum = () => {
    setIsCreatingAlbum(true);
    setAlbumForm({
      title: '',
      artist: 'La Nación del León',
      cover_url: '',
      description: '',
      credits: '',
      release_date: String(new Date().getFullYear()),
      buy_link: '',
    });
  };

  const handleCoverFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notify('err', 'Selecciona una imagen válida (JPG, PNG, WEBP).');
      return;
    }
    setUploadingCover(true);
    try {
      const { publicUrl } = await uploadBandMedia(file, 'covers');
      setAlbumForm((prev) => ({ ...prev, cover_url: publicUrl }));
      notify('ok', 'Portada subida al Storage correctamente.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error subiendo portada');
    } finally {
      setUploadingCover(false);
    }
  };

  const handleSaveAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!albumForm.title.trim()) return;
    setSavingAlbum(true);
    try {
      if (isCreatingAlbum || !selectedAlbum) {
        const created = await createBandAlbum(albumForm);
        setAlbums((prev) => [created, ...prev]);
        setSelectedAlbumId(created.id);
        setIsCreatingAlbum(false);
        notify('ok', `Álbum "${created.title}" creado. Ya puedes subir sus pistas de audio.`);
      } else {
        const updated = await updateBandAlbum(selectedAlbum.id, albumForm);
        setAlbums((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
        notify('ok', `Álbum "${updated.title}" actualizado.`);
      }
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error guardando álbum');
    } finally {
      setSavingAlbum(false);
    }
  };

  const handleDeleteAlbum = async (album: BandAlbum) => {
    if (!window.confirm(`¿Eliminar el álbum "${album.title}" y todas sus pistas?`)) return;
    try {
      await deleteBandAlbum(album);
      const next = albums.filter((a) => a.id !== album.id);
      setAlbums(next);
      if (selectedAlbumId === album.id) {
        setSelectedAlbumId(next[0]?.id ?? null);
      }
      notify('ok', `Álbum "${album.title}" eliminado.`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error eliminando álbum');
    }
  };

  const handleBatchTrackUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0 || !selectedAlbum) {
      e.target.value = '';
      return;
    }

    const files = Array.from(fileList);
    e.target.value = '';

    let nextOrder = (selectedAlbum.tracks?.length || 0) + 1;
    const addedTracks: BandTrack[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setAudioUploadStatus(`Subiendo pista ${i + 1} de ${files.length}: ${file.name}`);
        const [duration, uploaded] = await Promise.all([
          detectMediaDuration(file, 'audio'),
          uploadBandMedia(file, 'tracks'),
        ]);
        const track = await createBandTrack({
          album_id: selectedAlbum.id,
          title: cleanTrackTitleFromFilename(file.name),
          duration,
          audio_url: uploaded.publicUrl,
          track_number: nextOrder++,
        });
        addedTracks.push(track);
      }

      setAlbums((prev) =>
        prev.map((a) =>
          a.id === selectedAlbum.id ? { ...a, tracks: [...a.tracks, ...addedTracks] } : a
        )
      );
      notify('ok', `${addedTracks.length} pista(s) de audio agregadas a "${selectedAlbum.title}".`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error subiendo audios');
    } finally {
      setAudioUploadStatus(null);
    }
  };

  const handleManualAddTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAlbum || !manualTrackForm.title.trim()) return;
    try {
      const created = await createBandTrack({
        album_id: selectedAlbum.id,
        title: manualTrackForm.title,
        duration: manualTrackForm.duration || '0:00',
        audio_url: manualTrackForm.audio_url,
        track_number: (selectedAlbum.tracks?.length || 0) + 1,
      });
      setAlbums((prev) =>
        prev.map((a) =>
          a.id === selectedAlbum.id ? { ...a, tracks: [...a.tracks, created] } : a
        )
      );
      setManualTrackForm({ title: '', duration: '', audio_url: '' });
      notify('ok', `Pista "${created.title}" añadida.`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error al agregar pista');
    }
  };

  const handleMoveTrack = async (idx: number, direction: -1 | 1) => {
    if (!selectedAlbum) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= selectedAlbum.tracks.length) return;
    const a = selectedAlbum.tracks[idx];
    const b = selectedAlbum.tracks[targetIdx];
    try {
      await swapTrackNumbers(a, b);
      const nextTracks = [...selectedAlbum.tracks];
      nextTracks[idx] = { ...b, track_number: a.track_number };
      nextTracks[targetIdx] = { ...a, track_number: b.track_number };
      setAlbums((prev) =>
        prev.map((alb) => (alb.id === selectedAlbum.id ? { ...alb, tracks: nextTracks } : alb))
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error reordenando pistas');
    }
  };

  const handleRenameTrack = async (track: BandTrack) => {
    if (!editingTrackTitle.trim()) {
      setEditingTrackId(null);
      return;
    }
    try {
      const updated = await updateBandTrack(track.id, { title: editingTrackTitle.trim() });
      setAlbums((prev) =>
        prev.map((alb) =>
          alb.id === track.album_id
            ? { ...alb, tracks: alb.tracks.map((t) => (t.id === updated.id ? updated : t)) }
            : alb
        )
      );
      setEditingTrackId(null);
      notify('ok', 'Título de pista actualizado.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error actualizando pista');
    }
  };

  const handleDeleteTrack = async (track: BandTrack) => {
    if (!window.confirm(`¿Eliminar la pista "${track.title}"?`)) return;
    try {
      await deleteBandTrack(track);
      setAlbums((prev) =>
        prev.map((alb) =>
          alb.id === track.album_id
            ? { ...alb, tracks: alb.tracks.filter((t) => t.id !== track.id) }
            : alb
        )
      );
      notify('ok', 'Pista eliminada.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error eliminando pista');
    }
  };

  // =========================================================================
  // HANDLERS: VIDEOS
  // =========================================================================
  const handleVideoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingVideo(`Subiendo video: ${file.name}...`);
    try {
      const [duration, uploaded] = await Promise.all([
        detectMediaDuration(file, 'video'),
        uploadBandMedia(file, 'videos'),
      ]);
      setVideoForm((prev) => ({
        ...prev,
        title: prev.title || cleanTrackTitleFromFilename(file.name),
        video_url: uploaded.publicUrl,
        duration: duration !== '0:00' ? duration : prev.duration,
      }));
      notify('ok', 'Video subido al Storage. Completa el título y pulsa Publicar.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error subiendo video');
    } finally {
      setUploadingVideo(null);
    }
  };

  const handleVideoThumbUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingVideo('Subiendo miniatura...');
    try {
      const uploaded = await uploadBandMedia(file, 'covers');
      setVideoForm((prev) => ({ ...prev, thumbnail_url: uploaded.publicUrl }));
      notify('ok', 'Miniatura subida.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error subiendo miniatura');
    } finally {
      setUploadingVideo(null);
    }
  };

  const handleCreateVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoForm.title.trim() || !videoForm.video_url.trim()) return;
    setSavingVideo(true);
    try {
      const sourceType =
        videoMode === 'upload' ? 'upload' : detectVideoSourceType(videoForm.video_url);
      const thumb =
        videoForm.thumbnail_url.trim() ||
        getAutoVideoThumbnail(videoForm.video_url, DEFAULT_HERO_IMAGE);

      const created = await createBandVideo({
        title: videoForm.title.trim(),
        category: videoForm.category,
        source_type: sourceType,
        video_url: videoForm.video_url.trim(),
        thumbnail_url: thumb,
        duration: videoForm.duration.trim(),
        description: videoForm.description.trim(),
        is_featured: videoForm.is_featured || videos.length === 0,
        sort_order: videos.length + 1,
      });

      setVideos((prev) => {
        const cleared = created.is_featured ? prev.map((v) => ({ ...v, is_featured: false })) : prev;
        return [created, ...cleared];
      });
      setVideoForm({
        title: '',
        category: 'En Vivo',
        video_url: '',
        thumbnail_url: '',
        duration: '',
        description: '',
        is_featured: false,
      });
      notify('ok', `Video "${created.title}" publicado en la web.`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error guardando video');
    } finally {
      setSavingVideo(false);
    }
  };

  const handleFeatureVideo = async (videoId: string) => {
    try {
      await setFeaturedBandVideo(videoId);
      setVideos((prev) => prev.map((v) => ({ ...v, is_featured: v.id === videoId })));
      notify('ok', 'Video marcado como destacado principal.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error destacando video');
    }
  };

  const handleDeleteVideo = async (video: BandVideo) => {
    if (!window.confirm(`¿Eliminar el video "${video.title}"?`)) return;
    try {
      await deleteBandVideo(video);
      setVideos((prev) => prev.filter((v) => v.id !== video.id));
      notify('ok', 'Video eliminado.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error eliminando video');
    }
  };

  // =========================================================================
  // HANDLERS: PHOTOS
  // =========================================================================
  const handleBatchPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) {
      e.target.value = '';
      return;
    }
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    e.target.value = '';
    if (files.length === 0) {
      notify('err', 'Selecciona archivos de imagen válidos (JPG, PNG, WEBP).');
      return;
    }

    const added: BandPhoto[] = [];
    let order = photos.length + 1;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setPhotoUploadProgress(`Subiendo foto ${i + 1} de ${files.length}: ${file.name}`);
        const { publicUrl } = await uploadBandMedia(file, 'photos');
        const created = await createBandPhoto({
          title: cleanTrackTitleFromFilename(file.name),
          caption: '',
          category: photoUploadCategory,
          image_url: publicUrl,
          sort_order: order++,
        });
        added.push(created);
      }
      setPhotos((prev) => [...added, ...prev]);
      notify('ok', `${added.length} foto(s) publicadas en la galería.`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error subiendo fotos');
    } finally {
      setPhotoUploadProgress(null);
    }
  };

  const handleSavePhotoEdit = async (photoId: string) => {
    try {
      const updated = await updateBandPhoto(photoId, editingPhotoDraft);
      setPhotos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setEditingPhotoId(null);
      notify('ok', 'Foto actualizada.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error actualizando foto');
    }
  };

  const handleDeletePhoto = async (photo: BandPhoto) => {
    if (!window.confirm('¿Eliminar esta fotografía de la galería?')) return;
    try {
      await deleteBandPhoto(photo);
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      notify('ok', 'Foto eliminada.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error eliminando foto');
    }
  };

  // =========================================================================
  // HANDLERS: TOUR EVENTS
  // =========================================================================
  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventForm.event_date || !eventForm.venue.trim() || !eventForm.city.trim()) return;
    setSavingEvent(true);
    try {
      const created = await createBandEvent({
        ...eventForm,
        event_date: new Date(eventForm.event_date).toISOString(),
      });
      setEvents((prev) =>
        [...prev, created].sort(
          (a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime()
        )
      );
      setEventForm({
        event_date: '',
        venue: '',
        city: '',
        event_type: 'ARENA',
        status: 'DISPONIBLE',
        ticket_url: '',
        notes: '',
      });
      notify('ok', `Concierto en ${created.city} añadido a la gira.`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error creando fecha de gira');
    } finally {
      setSavingEvent(false);
    }
  };

  const handleDeleteEvent = async (id: string) => {
    if (!window.confirm('¿Eliminar esta fecha de gira?')) return;
    try {
      await deleteBandEvent(id);
      setEvents((prev) => prev.filter((ev) => ev.id !== id));
      notify('ok', 'Fecha eliminada.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error eliminando fecha');
    }
  };

  // =========================================================================
  // HANDLERS: PROFILE & IDENTITY
  // =========================================================================
  const handleHeroAssetUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    kind: 'image' | 'video'
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingHeroAsset(kind === 'image' ? 'Subiendo fondo Hero...' : 'Subiendo video Hero...');
    try {
      const { publicUrl } = await uploadBandMedia(file, 'hero');
      setProfile((prev) =>
        kind === 'image'
          ? { ...prev, hero_image_url: publicUrl }
          : { ...prev, hero_video_url: publicUrl }
      );
      notify('ok', `${kind === 'image' ? 'Imagen' : 'Video'} de portada subido. Recuerda Guardar Cambios.`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error subiendo archivo');
    } finally {
      setUploadingHeroAsset(null);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await saveBandProfile(profile);
      notify('ok', 'Identidad y portada de La Nación del León actualizadas en vivo.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Error guardando identidad');
    } finally {
      setSavingProfile(false);
    }
  };

  const updateMember = (idx: number, field: keyof BandMember, value: string) => {
    setProfile((prev) => ({
      ...prev,
      members: prev.members.map((m, i) => (i === idx ? { ...m, [field]: value } : m)),
    }));
  };

  const addMember = () => {
    setProfile((prev) => ({
      ...prev,
      members: [
        ...prev.members,
        { id: `m-${Date.now()}`, name: 'NOMBRE INTEGRANTE', role: 'INSTRUMENTO', bio: '' },
      ],
    }));
  };

  const removeMember = (idx: number) => {
    setProfile((prev) => ({
      ...prev,
      members: prev.members.filter((_, i) => i !== idx),
    }));
  };

  const copySql = () => {
    navigator.clipboard.writeText(BAND_CMS_SQL_MIGRATION);
    setSqlCopied(true);
    window.setTimeout(() => setSqlCopied(false), 2500);
  };

  const tabs: { id: CmsTab; label: string; count?: number; icon: React.ReactNode }[] = [
    { id: 'albums', label: 'Álbumes y Música', count: albums.length, icon: <Disc3 size={16} /> },
    { id: 'videos', label: 'Videos', count: videos.length, icon: <Film size={16} /> },
    { id: 'photos', label: 'Fotos', count: photos.length, icon: <Camera size={16} /> },
    { id: 'events', label: 'Fechas de Gira', count: events.length, icon: <Calendar size={16} /> },
    { id: 'identity', label: 'Portada & Web', icon: <SlidersHorizontal size={16} /> },
  ];

  const inputCls =
    'w-full bg-[#080706] border border-white/[0.12] focus:border-[#ff5412] px-3.5 py-2.5 text-sm text-[#f4efe6] placeholder-[#6f655c] outline-none transition-colors';
  const labelCls = 'block lion-label text-[11px] text-[#b3a89a] mb-1.5';

  return (
    <div className="lion-root h-full w-full overflow-y-auto bg-[#080706] text-[#f4efe6]">
      {/* TOP WORKSTATION BAR */}
      <header className="sticky top-0 z-30 bg-[#0d0b0a]/95 backdrop-blur-md border-b border-white/[0.1]">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="lion-label text-[11px] text-[#ff5412]">
              MÓDULO EXCLUSIVO DE CONTENIDO WEB · SUPABASE STORAGE
            </div>
            <h1 className="lion-display text-3xl sm:text-4xl text-[#f4efe6] mt-0.5">
              LA NACIÓN DEL LEÓN · STUDIO CMS
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={hydrate}
              className="px-3.5 py-2.5 border border-white/[0.14] hover:border-[#ff5412] text-[#b3a89a] hover:text-[#f4efe6] lion-label text-[11px] inline-flex items-center gap-2 cursor-pointer transition-colors"
              title="Recargar datos desde Supabase"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>SINCRONIZAR</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSqlModal(true)}
              className={`px-3.5 py-2.5 border lion-label text-[11px] inline-flex items-center gap-2 cursor-pointer transition-colors ${
                missingTables.length > 0
                  ? 'border-[#ffaa3b] bg-[#ffaa3b]/12 text-[#ffaa3b]'
                  : 'border-white/[0.14] hover:border-[#ff5412] text-[#b3a89a] hover:text-[#f4efe6]'
              }`}
            >
              <Database size={14} />
              <span>{missingTables.length > 0 ? `SQL REQUERIDO (${missingTables.length})` : 'SQL SUPABASE'}</span>
            </button>

            <a
              href="/lanacion_delleon_web"
              target="_blank"
              rel="noreferrer"
              className="lion-btn-ember lion-label text-xs !min-h-[40px] !py-2 !px-4"
            >
              <span>VER WEB PÚBLICA</span>
              <ExternalLink size={14} />
            </a>
          </div>
        </div>

        {/* NAVIGATION TABS */}
        <div className="max-w-[1400px] mx-auto px-6 lg:px-10 flex items-center gap-1 overflow-x-auto border-t border-white/[0.06]">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-4 py-3.5 lion-label text-xs inline-flex items-center gap-2 whitespace-nowrap cursor-pointer transition-colors ${
                  active ? 'text-[#f4efe6]' : 'text-[#8e8378] hover:text-[#f4efe6]'
                }`}
              >
                <span className={active ? 'text-[#ff5412]' : ''}>{tab.icon}</span>
                <span>{tab.label}</span>
                {typeof tab.count === 'number' && (
                  <span className="text-[11px] tnum px-1.5 py-0.5 bg-white/[0.06] text-[#b3a89a]">
                    {tab.count}
                  </span>
                )}
                {active && (
                  <motion.span
                    layoutId="cms-tab-underline"
                    transition={SPRING_UI}
                    className="absolute inset-x-0 bottom-0 h-[2px] bg-[#ff5412]"
                  />
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* MISSING TABLES NOTICE */}
      {missingTables.length > 0 && (
        <div className="max-w-[1400px] mx-auto px-6 lg:px-10 pt-6">
          <div className="border border-[#ffaa3b]/40 bg-[#ffaa3b]/8 px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="lion-label text-xs text-[#ffaa3b]">
                CONFIGURACIÓN INICIAL DE TABLAS PENDIENTE EN SUPABASE
              </div>
              <p className="text-xs text-[#d4cbc0]">
                Tus álbumes y pistas ya funcionan de inmediato. Para guardar{' '}
                <strong className="text-[#f4efe6]">{missingTables.join(', ')}</strong>, ejecuta el script SQL listo en tu Supabase SQL Editor.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowSqlModal(true)}
              className="lion-btn-ember lion-label text-xs !min-h-[38px] !py-2 !px-4"
            >
              VER Y COPIAR SQL
            </button>
          </div>
        </div>
      )}

      {/* INLINE FEEDBACK TOAST */}
      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={SPRING_UI}
            className={`fixed bottom-6 right-6 z-50 px-5 py-3.5 shadow-2xl border lion-label text-xs flex items-center gap-3 ${
              notice.kind === 'ok'
                ? 'bg-[#ff5412] text-[#060505] border-[#ffaa3b]'
                : 'bg-[#2a0c0a] text-[#fca5a5] border-[#ef4444]'
            }`}
          >
            <span>{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} className="cursor-pointer opacity-70 hover:opacity-100">
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MAIN CONTENT BODY */}
      <main className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8 pb-24">
        {loading ? (
          <div className="py-24 flex items-center justify-center gap-3 lion-label text-xs text-[#b3a89a]">
            <Loader2 size={18} className="animate-spin text-[#ff5412]" />
            <span>CARGANDO CATÁLOGO DE LA BANDA...</span>
          </div>
        ) : (
          <>
            {/* ===============================================================
                TAB 1: ÁLBUMES Y MÚSICA REAL
               =============================================================== */}
            {activeTab === 'albums' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
                {/* LEFT RAIL: ALBUMS LIST */}
                <div className="lg:col-span-4 space-y-5">
                  <div className="flex items-center justify-between border-b border-white/[0.1] pb-4">
                    <div>
                      <h2 className="lion-display text-2xl text-[#f4efe6]">ÁLBUMES ({albums.length})</h2>
                      <p className="text-xs text-[#8e8378]">Selecciona un álbum o crea uno nuevo</p>
                    </div>
                    <button
                      type="button"
                      onClick={startNewAlbum}
                      className="lion-btn-ember lion-label text-[11px] !min-h-[38px] !py-2 !px-3.5"
                    >
                      <Plus size={14} />
                      <span>NUEVO</span>
                    </button>
                  </div>

                  <div className="space-y-2 max-h-[620px] overflow-y-auto pr-1">
                    {albums.length === 0 ? (
                      <div className="py-10 px-4 border border-dashed border-white/[0.14] text-center text-xs text-[#8e8378]">
                        Aún no has creado ningún álbum. Usa el formulario de la derecha para crear tu primer lanzamiento.
                      </div>
                    ) : (
                      albums.map((album) => {
                        const isSelected = !isCreatingAlbum && selectedAlbumId === album.id;
                        return (
                          <div
                            key={album.id}
                            onClick={() => {
                              setIsCreatingAlbum(false);
                              setSelectedAlbumId(album.id);
                            }}
                            className={`flex items-center gap-3.5 p-3 border cursor-pointer transition-colors group ${
                              isSelected
                                ? 'bg-[#ff5412]/12 border-[#ff5412]'
                                : 'bg-[#110e0c] border-white/[0.08] hover:border-white/[0.24]'
                            }`}
                          >
                            <img
                              src={album.cover_url || DEFAULT_ALBUM_COVER}
                              alt={album.title}
                              className="w-14 h-14 object-cover shrink-0 border border-white/[0.1]"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="lion-display text-xl text-[#f4efe6] truncate">
                                {album.title}
                              </div>
                              <div className="text-xs text-[#8e8378] truncate">
                                {album.release_date ? `${album.release_date} · ` : ''}
                                {album.tracks.length} pista(s)
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteAlbum(album);
                              }}
                              className="p-2 text-[#72675d] hover:text-[#ef4444] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                              title="Eliminar álbum"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* RIGHT WORKSPACE: ALBUM EDITOR + BATCH TRACK UPLOADER */}
                <div className="lg:col-span-8 space-y-10">
                  {/* Album Details Form */}
                  <section className="border-b border-white/[0.1] pb-10">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="lion-display text-3xl text-[#f4efe6]">
                        {isCreatingAlbum || !selectedAlbum
                          ? 'CREAR NUEVO ÁLBUM'
                          : `EDITAR: ${selectedAlbum.title}`}
                      </h2>
                      {selectedAlbum && !isCreatingAlbum && (
                        <button
                          type="button"
                          onClick={async () => {
                            const updated = { ...profile, featured_album_id: selectedAlbum.id };
                            setProfile(updated);
                            try {
                              await saveBandProfile(updated);
                              notify('ok', `"${selectedAlbum.title}" ahora es el álbum destacado del Hero.`);
                            } catch (err) {
                              notify('err', err instanceof Error ? err.message : 'Error destacando álbum');
                            }
                          }}
                          className={`px-3 py-2 border lion-label text-[11px] inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                            profile.featured_album_id === selectedAlbum.id
                              ? 'border-[#ffaa3b] bg-[#ffaa3b]/15 text-[#ffaa3b]'
                              : 'border-white/[0.14] text-[#b3a89a] hover:border-[#ff5412]'
                          }`}
                        >
                          <Star size={13} fill={profile.featured_album_id === selectedAlbum.id ? 'currentColor' : 'none'} />
                          <span>{profile.featured_album_id === selectedAlbum.id ? 'DESTACADO EN HERO' : 'DESTACAR EN HERO'}</span>
                        </button>
                      )}
                    </div>

                    <form onSubmit={handleSaveAlbum} className="grid grid-cols-1 md:grid-cols-12 gap-6">
                      {/* Cover Uploader */}
                      <div className="md:col-span-4 space-y-3">
                        <label className={labelCls}>PORTADA DEL ÁLBUM</label>
                        <div className="relative aspect-square w-full bg-[#110e0c] border border-dashed border-white/[0.2] hover:border-[#ff5412] overflow-hidden group transition-colors">
                          <img
                            src={albumForm.cover_url || DEFAULT_ALBUM_COVER}
                            alt="Portada"
                            className="w-full h-full object-cover"
                          />
                          <label className="absolute inset-0 bg-[#060505]/75 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 cursor-pointer p-4 text-center">
                            {uploadingCover ? (
                              <Loader2 size={24} className="animate-spin text-[#ff5412]" />
                            ) : (
                              <>
                                <UploadCloud size={26} className="text-[#ff5412]" />
                                <span className="lion-label text-[11px] text-[#f4efe6]">
                                  SUBIR PORTADA (JPG/PNG/WEBP)
                                </span>
                              </>
                            )}
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleCoverFileSelect}
                              className="hidden"
                            />
                          </label>
                        </div>
                        <input
                          type="url"
                          value={albumForm.cover_url}
                          onChange={(e) => setAlbumForm((prev) => ({ ...prev, cover_url: e.target.value }))}
                          placeholder="O pega URL directa de portada"
                          className={inputCls}
                        />
                      </div>

                      {/* Metadata fields */}
                      <div className="md:col-span-8 space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className={labelCls}>TÍTULO DEL ÁLBUM *</label>
                            <input
                              required
                              type="text"
                              value={albumForm.title}
                              onChange={(e) => setAlbumForm((prev) => ({ ...prev, title: e.target.value }))}
                              placeholder="Ej: Rugido Eterno"
                              className={inputCls}
                            />
                          </div>
                          <div>
                            <label className={labelCls}>BANDA / ARTISTA</label>
                            <input
                              required
                              type="text"
                              value={albumForm.artist}
                              onChange={(e) => setAlbumForm((prev) => ({ ...prev, artist: e.target.value }))}
                              placeholder="La Nación del León"
                              className={inputCls}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className={labelCls}>AÑO / FECHA DE LANZAMIENTO</label>
                            <input
                              type="text"
                              value={albumForm.release_date}
                              onChange={(e) => setAlbumForm((prev) => ({ ...prev, release_date: e.target.value }))}
                              placeholder="Ej: 2026"
                              className={inputCls}
                            />
                          </div>
                          <div>
                            <label className={labelCls}>ENLACE SPOTIFY / COMPRA (OPCIONAL)</label>
                            <input
                              type="url"
                              value={albumForm.buy_link}
                              onChange={(e) => setAlbumForm((prev) => ({ ...prev, buy_link: e.target.value }))}
                              placeholder="https://open.spotify.com/..."
                              className={inputCls}
                            />
                          </div>
                        </div>

                        <div>
                          <label className={labelCls}>HISTORIA / DESCRIPCIÓN</label>
                          <textarea
                            rows={2}
                            value={albumForm.description}
                            onChange={(e) => setAlbumForm((prev) => ({ ...prev, description: e.target.value }))}
                            placeholder="Describe el concepto del disco o cómo se grabó..."
                            className={`${inputCls} resize-none`}
                          />
                        </div>

                        <div>
                          <label className={labelCls}>CRÉDITOS DE PRODUCCIÓN</label>
                          <input
                            type="text"
                            value={albumForm.credits}
                            onChange={(e) => setAlbumForm((prev) => ({ ...prev, credits: e.target.value }))}
                            placeholder="Producido y mezclado por..."
                            className={inputCls}
                          />
                        </div>

                        <div className="pt-2 flex items-center gap-3">
                          <button type="submit" disabled={savingAlbum} className="lion-btn-ember lion-label text-xs">
                            {savingAlbum ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                            <span>{isCreatingAlbum || !selectedAlbum ? 'CREAR ÁLBUM' : 'GUARDAR CAMBIOS'}</span>
                          </button>
                          {isCreatingAlbum && albums.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setIsCreatingAlbum(false)}
                              className="lion-btn-wire lion-label text-xs"
                            >
                              CANCELAR
                            </button>
                          )}
                        </div>
                      </div>
                    </form>
                  </section>

                  {/* TRACKS MANAGER FOR SELECTED ALBUM */}
                  {selectedAlbum && !isCreatingAlbum && (
                    <section className="space-y-6">
                      <div className="flex flex-wrap items-end justify-between gap-4">
                        <div>
                          <div className="lion-label text-[11px] text-[#ff5412]">
                            PISTAS DE AUDIO REALES · {selectedAlbum.title}
                          </div>
                          <h3 className="lion-display text-3xl text-[#f4efe6] mt-0.5">
                            TRACKLIST ({selectedAlbum.tracks.length})
                          </h3>
                        </div>
                      </div>

                      {/* Batch Multi-Audio Dropzone */}
                      <label className="block border-2 border-dashed border-[#ff5412]/45 hover:border-[#ff5412] bg-[#110e0c] hover:bg-[#181310] p-7 text-center cursor-pointer transition-colors">
                        <input
                          type="file"
                          accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a"
                          multiple
                          disabled={Boolean(audioUploadStatus)}
                          onChange={handleBatchTrackUpload}
                          className="hidden"
                        />
                        {audioUploadStatus ? (
                          <div className="flex flex-col items-center gap-2.5">
                            <Loader2 size={28} className="animate-spin text-[#ff5412]" />
                            <span className="lion-label text-xs text-[#ffaa3b]">{audioUploadStatus}</span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-2">
                            <UploadCloud size={32} className="text-[#ff5412]" />
                            <div className="lion-label text-xs text-[#f4efe6]">
                              HAZ CLIC PARA SUBIR UNA O VARIAS CANCIONES (MP3, WAV, FLAC, M4A)
                            </div>
                            <p className="text-xs text-[#8e8378]">
                              Detecta automáticamente la duración real y limpia los nombres de pista al subir a Supabase Storage.
                            </p>
                          </div>
                        )}
                      </label>

                      {/* Tracklist Table */}
                      {selectedAlbum.tracks.length > 0 && (
                        <div className="divide-y divide-white/[0.08] border-y border-white/[0.1]">
                          {selectedAlbum.tracks.map((track, idx) => (
                            <div
                              key={track.id}
                              className="py-3.5 px-2 flex flex-wrap items-center justify-between gap-4 hover:bg-white/[0.025] transition-colors"
                            >
                              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                                <span className="lion-display text-xl text-[#ff5412] w-7 shrink-0">
                                  {String(idx + 1).padStart(2, '0')}
                                </span>

                                <button
                                  type="button"
                                  onClick={() => toggleTrackPreview(track)}
                                  className={`w-9 h-9 flex items-center justify-center border shrink-0 cursor-pointer transition-colors ${
                                    previewAudioId === track.id
                                      ? 'bg-[#ff5412] border-[#ff5412] text-[#060505]'
                                      : 'border-white/[0.16] text-[#f4efe6] hover:border-[#ff5412]'
                                  }`}
                                  title="Escuchar vista previa"
                                >
                                  {previewAudioId === track.id ? (
                                    <Pause size={14} fill="currentColor" />
                                  ) : (
                                    <Play size={14} fill="currentColor" className="ml-0.5" />
                                  )}
                                </button>

                                {editingTrackId === track.id ? (
                                  <div className="flex items-center gap-2 flex-1">
                                    <input
                                      type="text"
                                      value={editingTrackTitle}
                                      onChange={(e) => setEditingTrackTitle(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleRenameTrack(track);
                                        if (e.key === 'Escape') setEditingTrackId(null);
                                      }}
                                      autoFocus
                                      className="flex-1 bg-[#080706] border border-[#ff5412] px-2.5 py-1 text-sm text-[#f4efe6] outline-none"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleRenameTrack(track)}
                                      className="px-2.5 py-1 bg-[#ff5412] text-[#060505] lion-label text-[11px] cursor-pointer"
                                    >
                                      OK
                                    </button>
                                  </div>
                                ) : (
                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm font-semibold text-[#f4efe6] truncate">
                                      {track.title}
                                    </div>
                                    <div className="text-[11px] text-[#72675d] truncate">
                                      {track.audio_url ? 'Audio alojado listo para streaming' : 'Sin URL de audio'}
                                    </div>
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs tnum text-[#b3a89a] mr-2">{track.duration}</span>
                                <button
                                  type="button"
                                  onClick={() => handleMoveTrack(idx, -1)}
                                  disabled={idx === 0}
                                  className="p-1.5 text-[#8e8378] hover:text-[#f4efe6] disabled:opacity-25 cursor-pointer"
                                  title="Subir orden"
                                >
                                  <ArrowUp size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveTrack(idx, 1)}
                                  disabled={idx === selectedAlbum.tracks.length - 1}
                                  className="p-1.5 text-[#8e8378] hover:text-[#f4efe6] disabled:opacity-25 cursor-pointer"
                                  title="Bajar orden"
                                >
                                  <ArrowDown size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTrackId(track.id);
                                    setEditingTrackTitle(track.title);
                                  }}
                                  className="p-1.5 text-[#8e8378] hover:text-[#ffaa3b] cursor-pointer"
                                  title="Renombrar pista"
                                >
                                  <Edit3 size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTrack(track)}
                                  className="p-1.5 text-[#8e8378] hover:text-[#ef4444] cursor-pointer"
                                  title="Eliminar pista"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Optional Manual URL Add Track */}
                      <form onSubmit={handleManualAddTrack} className="pt-2 space-y-3">
                        <div className="lion-label text-[11px] text-[#8e8378]">
                          O AÑADIR PISTA MEDIANTE ENLACE DIRECTO MP3/WAV
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                          <input
                            type="text"
                            required
                            value={manualTrackForm.title}
                            onChange={(e) => setManualTrackForm((p) => ({ ...p, title: e.target.value }))}
                            placeholder="Título de la canción"
                            className={`${inputCls} sm:col-span-4`}
                          />
                          <input
                            type="text"
                            value={manualTrackForm.duration}
                            onChange={(e) => setManualTrackForm((p) => ({ ...p, duration: e.target.value }))}
                            placeholder="Duración (ej: 3:45)"
                            className={`${inputCls} sm:col-span-2`}
                          />
                          <input
                            type="url"
                            required
                            value={manualTrackForm.audio_url}
                            onChange={(e) => setManualTrackForm((p) => ({ ...p, audio_url: e.target.value }))}
                            placeholder="https://.../pista.mp3"
                            className={`${inputCls} sm:col-span-4`}
                          />
                          <button type="submit" className="lion-btn-wire lion-label text-xs sm:col-span-2 !min-h-[42px] !py-2">
                            <Music size={14} />
                            <span>AÑADIR</span>
                          </button>
                        </div>
                      </form>
                    </section>
                  )}
                </div>
              </div>
            )}

            {/* ===============================================================
                TAB 2: VIDEOS (Subida MP4/WebM + YouTube / Vimeo)
               =============================================================== */}
            {activeTab === 'videos' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
                <form onSubmit={handleCreateVideo} className="lg:col-span-5 space-y-5 border-b lg:border-b-0 lg:border-r border-white/[0.1] pb-8 lg:pb-0 lg:pr-8">
                  <div>
                    <div className="lion-label text-[11px] text-[#ff5412]">NUEVO VIDEO OFICIAL</div>
                    <h2 className="lion-display text-3xl text-[#f4efe6] mt-0.5">PUBLICAR VIDEO</h2>
                  </div>

                  {/* Mode Switcher */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setVideoMode('upload')}
                      className={`py-2.5 px-3 lion-label text-xs border inline-flex items-center justify-center gap-2 cursor-pointer transition-colors ${
                        videoMode === 'upload'
                          ? 'bg-[#ff5412] border-[#ff5412] text-[#060505]'
                          : 'border-white/[0.14] text-[#b3a89a] hover:text-[#f4efe6]'
                      }`}
                    >
                      <UploadCloud size={15} />
                      <span>SUBIR ARCHIVO</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setVideoMode('url')}
                      className={`py-2.5 px-3 lion-label text-xs border inline-flex items-center justify-center gap-2 cursor-pointer transition-colors ${
                        videoMode === 'url'
                          ? 'bg-[#ff5412] border-[#ff5412] text-[#060505]'
                          : 'border-white/[0.14] text-[#b3a89a] hover:text-[#f4efe6]'
                      }`}
                    >
                      <Link2 size={15} />
                      <span>YOUTUBE / VIMEO</span>
                    </button>
                  </div>

                  {videoMode === 'upload' ? (
                    <label className="block border-2 border-dashed border-white/[0.2] hover:border-[#ff5412] bg-[#110e0c] p-6 text-center cursor-pointer transition-colors">
                      <input
                        type="file"
                        accept="video/mp4,video/webm,video/quicktime"
                        disabled={Boolean(uploadingVideo)}
                        onChange={handleVideoFileUpload}
                        className="hidden"
                      />
                      {uploadingVideo ? (
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 size={24} className="animate-spin text-[#ff5412]" />
                          <span className="lion-label text-xs text-[#ffaa3b]">{uploadingVideo}</span>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <Film size={28} className="mx-auto text-[#ff5412]" />
                          <div className="lion-label text-xs text-[#f4efe6]">
                            SELECCIONAR VIDEO (MP4 / WEBM / MOV)
                          </div>
                          <div className="text-xs text-[#8e8378]">
                            {videoForm.video_url ? 'Archivo cargado listo para publicar ✓' : 'Se alojará directamente en Supabase Storage'}
                          </div>
                        </div>
                      )}
                    </label>
                  ) : (
                    <div>
                      <label className={labelCls}>URL DE YOUTUBE O VIMEO *</label>
                      <input
                        type="url"
                        required
                        value={videoForm.video_url}
                        onChange={(e) => setVideoForm((p) => ({ ...p, video_url: e.target.value }))}
                        placeholder="https://www.youtube.com/watch?v=..."
                        className={inputCls}
                      />
                    </div>
                  )}

                  <div>
                    <label className={labelCls}>TÍTULO DEL VIDEO *</label>
                    <input
                      type="text"
                      required
                      value={videoForm.title}
                      onChange={(e) => setVideoForm((p) => ({ ...p, title: e.target.value }))}
                      placeholder="Ej: Rugido Eterno (Live Arena)"
                      className={inputCls}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>CATEGORÍA</label>
                      <select
                        value={videoForm.category}
                        onChange={(e) => setVideoForm((p) => ({ ...p, category: e.target.value }))}
                        className={inputCls}
                      >
                        <option value="En Vivo">En Vivo</option>
                        <option value="Videoclip Oficial">Videoclip Oficial</option>
                        <option value="Sesión Estudio">Sesión Estudio</option>
                        <option value="Documental">Documental</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>DURACIÓN</label>
                      <input
                        type="text"
                        value={videoForm.duration}
                        onChange={(e) => setVideoForm((p) => ({ ...p, duration: e.target.value }))}
                        placeholder="Ej: 4:15"
                        className={inputCls}
                      />
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>MINIATURA PERSONALIZADA (OPCIONAL)</label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={videoForm.thumbnail_url}
                        onChange={(e) => setVideoForm((p) => ({ ...p, thumbnail_url: e.target.value }))}
                        placeholder="Automática en YouTube o sube imagen"
                        className={inputCls}
                      />
                      <label className="px-3.5 border border-white/[0.16] hover:border-[#ff5412] flex items-center justify-center cursor-pointer shrink-0 text-[#f4efe6]" title="Subir miniatura">
                        <ImageIcon size={16} />
                        <input type="file" accept="image/*" onChange={handleVideoThumbUpload} className="hidden" />
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>DESCRIPCIÓN</label>
                    <textarea
                      rows={2}
                      value={videoForm.description}
                      onChange={(e) => setVideoForm((p) => ({ ...p, description: e.target.value }))}
                      placeholder="Detalles de grabación, concierto o créditos..."
                      className={`${inputCls} resize-none`}
                    />
                  </div>

                  <label className="flex items-center gap-3 cursor-pointer text-sm text-[#d4cbc0]">
                    <input
                      type="checkbox"
                      checked={videoForm.is_featured}
                      onChange={(e) => setVideoForm((p) => ({ ...p, is_featured: e.target.checked }))}
                      className="accent-[#ff5412] w-4 h-4"
                    />
                    <span>Fijar como video principal destacado en la web</span>
                  </label>

                  <button
                    type="submit"
                    disabled={savingVideo || !videoForm.video_url}
                    className="lion-btn-ember lion-label text-xs w-full"
                  >
                    {savingVideo ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                    <span>PUBLICAR VIDEO</span>
                  </button>
                </form>

                {/* Published Videos List */}
                <div className="lg:col-span-7 space-y-5">
                  <div className="flex items-center justify-between border-b border-white/[0.1] pb-4">
                    <h2 className="lion-display text-3xl text-[#f4efe6]">VIDEOS PUBLICADOS ({videos.length})</h2>
                  </div>

                  {videos.length === 0 ? (
                    <div className="py-16 border border-dashed border-white/[0.14] text-center text-sm text-[#8e8378]">
                      Aún no hay videos. Sube tu primer archivo MP4/WebM o pega un enlace de YouTube.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      {videos.map((vid) => (
                        <div key={vid.id} className="bg-[#110e0c] border border-white/[0.1] overflow-hidden flex flex-col">
                          <div className="relative aspect-video bg-black">
                            <img
                              src={vid.thumbnail_url || getAutoVideoThumbnail(vid.video_url, DEFAULT_HERO_IMAGE)}
                              alt={vid.title}
                              className="w-full h-full object-cover"
                            />
                            {vid.is_featured && (
                              <span className="absolute top-2.5 left-2.5 px-2.5 py-0.5 bg-[#ff5412] text-[#060505] lion-label text-[10px]">
                                DESTACADO
                              </span>
                            )}
                            {vid.duration && (
                              <span className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/80 text-[#f4efe6] lion-label text-[10px] tnum">
                                {vid.duration}
                              </span>
                            )}
                          </div>
                          <div className="p-4 flex-1 flex flex-col justify-between gap-4">
                            <div>
                              <div className="lion-label text-[10px] text-[#ff5412]">
                                {vid.category} · {vid.source_type.toUpperCase()}
                              </div>
                              <div className="lion-display text-2xl text-[#f4efe6] mt-0.5">{vid.title}</div>
                            </div>
                            <div className="flex items-center justify-between pt-3 border-t border-white/[0.08]">
                              <button
                                type="button"
                                onClick={() => handleFeatureVideo(vid.id)}
                                disabled={vid.is_featured}
                                className="lion-label text-[11px] text-[#ffaa3b] hover:underline disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"
                              >
                                <Star size={12} fill={vid.is_featured ? 'currentColor' : 'none'} />
                                <span>{vid.is_featured ? 'PRINCIPAL' : 'DESTACAR'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteVideo(vid)}
                                className="text-[#8e8378] hover:text-[#ef4444] p-1 cursor-pointer"
                                title="Eliminar video"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ===============================================================
                TAB 3: GALERÍA DE FOTOS (Batch Multi-Upload)
               =============================================================== */}
            {activeTab === 'photos' && (
              <div className="space-y-8">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/[0.1] pb-6">
                  <div>
                    <div className="lion-label text-[11px] text-[#ff5412]">GALERÍA MULTIMEDIA EN ALTA RESOLUCIÓN</div>
                    <h2 className="lion-display text-3xl sm:text-4xl text-[#f4efe6] mt-0.5">
                      FOTOGRAFÍAS DE LA BANDA ({photos.length})
                    </h2>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="lion-label text-[11px] text-[#b3a89a]">CATEGORÍA DE SUBIDA:</label>
                    <select
                      value={photoUploadCategory}
                      onChange={(e) => setPhotoUploadCategory(e.target.value)}
                      className="bg-[#110e0c] border border-white/[0.16] px-3 py-2 text-xs text-[#f4efe6] outline-none focus:border-[#ff5412]"
                    >
                      <option value="En Vivo">En Vivo</option>
                      <option value="Estudio">Estudio</option>
                      <option value="Backstage">Backstage</option>
                      <option value="Prensa">Prensa</option>
                    </select>
                  </div>
                </div>

                {/* Multi-Photo Upload Zone */}
                <label className="block border-2 border-dashed border-[#ff5412]/45 hover:border-[#ff5412] bg-[#110e0c] hover:bg-[#181310] p-8 text-center cursor-pointer transition-colors">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={Boolean(photoUploadProgress)}
                    onChange={handleBatchPhotoUpload}
                    className="hidden"
                  />
                  {photoUploadProgress ? (
                    <div className="flex flex-col items-center gap-2.5">
                      <Loader2 size={28} className="animate-spin text-[#ff5412]" />
                      <span className="lion-label text-xs text-[#ffaa3b]">{photoUploadProgress}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Camera size={32} className="text-[#ff5412]" />
                      <div className="lion-label text-xs text-[#f4efe6]">
                        SELECCIONA UNA O MÚLTIPLES FOTOS PARA SUBIR A LA GALERÍA
                      </div>
                      <p className="text-xs text-[#8e8378]">
                        Formatos JPG, PNG o WebP. Se publican de inmediato en la galería con Lightbox de /lanacion_delleon_web.
                      </p>
                    </div>
                  )}
                </label>

                {photos.length === 0 ? (
                  <div className="py-12 text-center text-sm text-[#8e8378]">
                    Todavía no hay fotos subidas.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {photos.map((photo) => {
                      const isEditing = editingPhotoId === photo.id;
                      return (
                        <div key={photo.id} className="bg-[#110e0c] border border-white/[0.1] overflow-hidden flex flex-col">
                          <div className="aspect-[4/3] bg-black overflow-hidden">
                            <img
                              src={photo.image_url}
                              alt={photo.title}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                            {isEditing ? (
                              <div className="space-y-2.5">
                                <input
                                  type="text"
                                  value={editingPhotoDraft.title}
                                  onChange={(e) =>
                                    setEditingPhotoDraft((d) => ({ ...d, title: e.target.value }))
                                  }
                                  placeholder="Título"
                                  className={inputCls}
                                />
                                <input
                                  type="text"
                                  value={editingPhotoDraft.caption}
                                  onChange={(e) =>
                                    setEditingPhotoDraft((d) => ({ ...d, caption: e.target.value }))
                                  }
                                  placeholder="Pie de foto"
                                  className={inputCls}
                                />
                                <select
                                  value={editingPhotoDraft.category}
                                  onChange={(e) =>
                                    setEditingPhotoDraft((d) => ({ ...d, category: e.target.value }))
                                  }
                                  className={inputCls}
                                >
                                  <option value="En Vivo">En Vivo</option>
                                  <option value="Estudio">Estudio</option>
                                  <option value="Backstage">Backstage</option>
                                  <option value="Prensa">Prensa</option>
                                </select>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleSavePhotoEdit(photo.id)}
                                    className="lion-btn-ember lion-label text-[11px] !min-h-[34px] !py-1.5 !px-3 flex-1"
                                  >
                                    GUARDAR
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingPhotoId(null)}
                                    className="lion-btn-wire lion-label text-[11px] !min-h-[34px] !py-1.5 !px-3"
                                  >
                                    CANCELAR
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div>
                                  <div className="lion-label text-[10px] text-[#ff5412]">{photo.category}</div>
                                  <div className="lion-display text-xl text-[#f4efe6] truncate mt-0.5">
                                    {photo.title || 'Sin título'}
                                  </div>
                                  {photo.caption && (
                                    <p className="text-xs text-[#8e8378] mt-1 line-clamp-2">{photo.caption}</p>
                                  )}
                                </div>
                                <div className="flex items-center justify-between pt-3 border-t border-white/[0.08]">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingPhotoId(photo.id);
                                      setEditingPhotoDraft({
                                        title: photo.title || '',
                                        caption: photo.caption || '',
                                        category: photo.category || 'En Vivo',
                                      });
                                    }}
                                    className="lion-label text-[11px] text-[#b3a89a] hover:text-[#ffaa3b] inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Edit3 size={12} />
                                    <span>EDITAR</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeletePhoto(photo)}
                                    className="text-[#8e8378] hover:text-[#ef4444] p-1 cursor-pointer"
                                    title="Eliminar foto"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ===============================================================
                TAB 4: FECHAS DE GIRA
               =============================================================== */}
            {activeTab === 'events' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
                <form onSubmit={handleCreateEvent} className="lg:col-span-5 space-y-4 border-b lg:border-b-0 lg:border-r border-white/[0.1] pb-8 lg:pb-0 lg:pr-8">
                  <div>
                    <div className="lion-label text-[11px] text-[#ff5412]">CALENDARIO &amp; TICKER EN GIRA</div>
                    <h2 className="lion-display text-3xl text-[#f4efe6] mt-0.5">AGREGAR CONCIERTO</h2>
                  </div>

                  <div>
                    <label className={labelCls}>FECHA Y HORA DEL SHOW *</label>
                    <input
                      type="datetime-local"
                      required
                      value={eventForm.event_date}
                      onChange={(e) => setEventForm((p) => ({ ...p, event_date: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>RECINTO / VENUE *</label>
                    <input
                      type="text"
                      required
                      value={eventForm.venue}
                      onChange={(e) => setEventForm((p) => ({ ...p, venue: e.target.value }))}
                      placeholder="Ej: Arena Monumental"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>CIUDAD Y PAÍS *</label>
                    <input
                      type="text"
                      required
                      value={eventForm.city}
                      onChange={(e) => setEventForm((p) => ({ ...p, city: e.target.value }))}
                      placeholder="Ej: Lima, Perú"
                      className={inputCls}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>TIPO</label>
                      <select
                        value={eventForm.event_type}
                        onChange={(e) => setEventForm((p) => ({ ...p, event_type: e.target.value }))}
                        className={inputCls}
                      >
                        <option value="ARENA">ARENA / ESTADIO</option>
                        <option value="TEATRO">TEATRO / CLUB</option>
                        <option value="FESTIVAL">FESTIVAL</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>ESTADO</label>
                      <select
                        value={eventForm.status}
                        onChange={(e) => setEventForm((p) => ({ ...p, status: e.target.value }))}
                        className={inputCls}
                      >
                        <option value="DISPONIBLE">DISPONIBLE</option>
                        <option value="ÚLTIMAS ENTRADAS">ÚLTIMAS ENTRADAS</option>
                        <option value="HEADLINER">HEADLINER</option>
                        <option value="AGOTADO">AGOTADO</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>URL DE ENTRADAS (OPCIONAL)</label>
                    <input
                      type="url"
                      value={eventForm.ticket_url}
                      onChange={(e) => setEventForm((p) => ({ ...p, ticket_url: e.target.value }))}
                      placeholder="https://..."
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>NOTAS (OPCIONAL)</label>
                    <input
                      type="text"
                      value={eventForm.notes}
                      onChange={(e) => setEventForm((p) => ({ ...p, notes: e.target.value }))}
                      placeholder="Ej: Puertas 19:00h · Banda invitada"
                      className={inputCls}
                    />
                  </div>
                  <button type="submit" disabled={savingEvent} className="lion-btn-ember lion-label text-xs w-full">
                    {savingEvent ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                    <span>PUBLICAR FECHA</span>
                  </button>
                </form>

                <div className="lg:col-span-7 space-y-5">
                  <div className="border-b border-white/[0.1] pb-4">
                    <h2 className="lion-display text-3xl text-[#f4efe6]">FECHAS PROGRAMADAS ({events.length})</h2>
                  </div>

                  {events.length === 0 ? (
                    <div className="py-16 border border-dashed border-white/[0.14] text-center text-sm text-[#8e8378]">
                      Aún no hay conciertos cargados.
                    </div>
                  ) : (
                    <div className="divide-y divide-white/[0.1] border-b border-white/[0.1]">
                      {events.map((ev) => (
                        <div key={ev.id} className="py-4 flex items-center justify-between gap-4">
                          <div>
                            <div className="lion-label text-xs text-[#ff5412] tnum">
                              {new Date(ev.event_date).toLocaleDateString('es-ES', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })}{' '}
                              · {ev.status}
                            </div>
                            <div className="lion-display text-2xl text-[#f4efe6] mt-0.5">
                              {ev.venue} — {ev.city}
                            </div>
                            {ev.notes && <div className="text-xs text-[#8e8378]">{ev.notes}</div>}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteEvent(ev.id)}
                            className="p-2 text-[#8e8378] hover:text-[#ef4444] cursor-pointer"
                            title="Eliminar concierto"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ===============================================================
                TAB 5: PORTADA, IDENTIDAD, INTEGRANTES Y REDES
               =============================================================== */}
            {activeTab === 'identity' && (
              <form onSubmit={handleSaveProfile} className="space-y-12 max-w-5xl">
                {/* Hero Section Settings */}
                <section className="space-y-6 pb-10 border-b border-white/[0.1]">
                  <div>
                    <div className="lion-label text-[11px] text-[#ff5412]">PORTADA PRINCIPAL (/lanacion_delleon_web)</div>
                    <h2 className="lion-display text-3xl text-[#f4efe6] mt-0.5">HERO E IDENTIDAD VISUAL</h2>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label className={labelCls}>NOMBRE DE LA BANDA</label>
                      <input
                        type="text"
                        value={profile.band_name}
                        onChange={(e) => setProfile((p) => ({ ...p, band_name: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>ANTETÍTULO SUPERIOR (EYEBROW)</label>
                      <input
                        type="text"
                        value={profile.hero_eyebrow}
                        onChange={(e) => setProfile((p) => ({ ...p, hero_eyebrow: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className={labelCls}>TÍTULO MONUMENTAL HERO (TIPOGRAFÍA ANTON)</label>
                      <input
                        type="text"
                        value={profile.hero_title}
                        onChange={(e) => setProfile((p) => ({ ...p, hero_title: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className={labelCls}>BAJADA / DESCRIPCIÓN DEL HERO</label>
                      <textarea
                        rows={2}
                        value={profile.hero_subtitle}
                        onChange={(e) => setProfile((p) => ({ ...p, hero_subtitle: e.target.value }))}
                        className={`${inputCls} resize-none`}
                      />
                    </div>
                  </div>

                  {/* Hero Media Uploaders */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                    <div className="space-y-2.5">
                      <label className={labelCls}>FOTO DE FONDO DEL HERO</label>
                      <div className="relative aspect-video bg-[#110e0c] border border-white/[0.14] overflow-hidden group">
                        <img
                          src={profile.hero_image_url || DEFAULT_HERO_IMAGE}
                          alt="Hero actual"
                          className="w-full h-full object-cover"
                        />
                        <label className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 cursor-pointer">
                          <UploadCloud size={24} className="text-[#ff5412]" />
                          <span className="lion-label text-xs text-[#f4efe6]">SUBIR FOTO HERO</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleHeroAssetUpload(e, 'image')}
                            className="hidden"
                          />
                        </label>
                      </div>
                      <input
                        type="text"
                        value={profile.hero_image_url}
                        onChange={(e) => setProfile((p) => ({ ...p, hero_image_url: e.target.value }))}
                        placeholder="URL imagen hero"
                        className={inputCls}
                      />
                    </div>

                    <div className="space-y-2.5">
                      <label className={labelCls}>VIDEO DE FONDO EN BUCLE (OPCIONAL · MP4/WEBM)</label>
                      <label className="flex flex-col items-center justify-center aspect-video border border-dashed border-white/[0.2] hover:border-[#ff5412] bg-[#110e0c] cursor-pointer transition-colors p-4 text-center">
                        <input
                          type="file"
                          accept="video/mp4,video/webm"
                          onChange={(e) => handleHeroAssetUpload(e, 'video')}
                          className="hidden"
                        />
                        {uploadingHeroAsset ? (
                          <div className="flex flex-col items-center gap-2">
                            <Loader2 size={24} className="animate-spin text-[#ff5412]" />
                            <span className="lion-label text-xs text-[#ffaa3b]">{uploadingHeroAsset}</span>
                          </div>
                        ) : (
                          <>
                            <Film size={28} className="text-[#ff5412] mb-2" />
                            <span className="lion-label text-xs text-[#f4efe6]">
                              {profile.hero_video_url ? 'VIDEO HERO CONFIGURADO ✓ (REEMPLAZAR)' : 'SUBIR VIDEO LOOP HERO'}
                            </span>
                            <span className="text-xs text-[#8e8378] mt-1">
                              Se reproducirá en silencio detrás del titular
                            </span>
                          </>
                        )}
                      </label>
                      <input
                        type="text"
                        value={profile.hero_video_url}
                        onChange={(e) => setProfile((p) => ({ ...p, hero_video_url: e.target.value }))}
                        placeholder="URL video .mp4 (dejar vacío para usar solo foto)"
                        className={inputCls}
                      />
                    </div>
                  </div>
                </section>

                {/* Manifesto & Band Members */}
                <section className="space-y-6 pb-10 border-b border-white/[0.1]">
                  <div className="flex items-center justify-between">
                    <h2 className="lion-display text-3xl text-[#f4efe6]">MANIFIESTO E INTEGRANTES</h2>
                    <button
                      type="button"
                      onClick={addMember}
                      className="lion-btn-wire lion-label text-xs !min-h-[38px] !py-1.5 !px-3.5"
                    >
                      <Plus size={14} />
                      <span>AÑADIR INTEGRANTE</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>TÍTULO MANIFIESTO</label>
                      <input
                        type="text"
                        value={profile.manifesto_title}
                        onChange={(e) => setProfile((p) => ({ ...p, manifesto_title: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>CORREO DE BOOKING / CONTRATACIONES</label>
                      <input
                        type="email"
                        value={profile.booking_email}
                        onChange={(e) => setProfile((p) => ({ ...p, booking_email: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className={labelCls}>TEXTO BIOGRÁFICO</label>
                      <textarea
                        rows={3}
                        value={profile.manifesto_body}
                        onChange={(e) => setProfile((p) => ({ ...p, manifesto_body: e.target.value }))}
                        className={`${inputCls} resize-none`}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {profile.members.map((member, idx) => (
                      <div key={member.id || idx} className="p-4 bg-[#110e0c] border border-white/[0.1] space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="lion-label text-[11px] text-[#ff5412]">INTEGRANTE #{idx + 1}</span>
                          <button
                            type="button"
                            onClick={() => removeMember(idx)}
                            className="text-[#8e8378] hover:text-[#ef4444] cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <input
                          type="text"
                          value={member.name}
                          onChange={(e) => updateMember(idx, 'name', e.target.value)}
                          placeholder="Nombre"
                          className={inputCls}
                        />
                        <input
                          type="text"
                          value={member.role}
                          onChange={(e) => updateMember(idx, 'role', e.target.value)}
                          placeholder="Rol / Instrumento"
                          className={inputCls}
                        />
                        <input
                          type="text"
                          value={member.bio}
                          onChange={(e) => updateMember(idx, 'bio', e.target.value)}
                          placeholder="Descripción breve"
                          className={inputCls}
                        />
                      </div>
                    ))}
                  </div>
                </section>

                {/* Social Links */}
                <section className="space-y-5">
                  <h2 className="lion-display text-3xl text-[#f4efe6]">PLATAFORMAS Y REDES SOCIALES</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>SPOTIFY URL</label>
                      <input
                        type="url"
                        value={profile.spotify_url}
                        onChange={(e) => setProfile((p) => ({ ...p, spotify_url: e.target.value }))}
                        placeholder="https://open.spotify.com/artist/..."
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>APPLE MUSIC URL</label>
                      <input
                        type="url"
                        value={profile.apple_music_url}
                        onChange={(e) => setProfile((p) => ({ ...p, apple_music_url: e.target.value }))}
                        placeholder="https://music.apple.com/..."
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>YOUTUBE URL</label>
                      <input
                        type="url"
                        value={profile.youtube_url}
                        onChange={(e) => setProfile((p) => ({ ...p, youtube_url: e.target.value }))}
                        placeholder="https://youtube.com/@..."
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>INSTAGRAM URL</label>
                      <input
                        type="url"
                        value={profile.instagram_url}
                        onChange={(e) => setProfile((p) => ({ ...p, instagram_url: e.target.value }))}
                        placeholder="https://instagram.com/..."
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>TIKTOK URL</label>
                      <input
                        type="url"
                        value={profile.tiktok_url}
                        onChange={(e) => setProfile((p) => ({ ...p, tiktok_url: e.target.value }))}
                        placeholder="https://tiktok.com/@..."
                        className={inputCls}
                      />
                    </div>
                  </div>

                  <div className="pt-4">
                    <button type="submit" disabled={savingProfile} className="lion-btn-ember lion-label text-xs">
                      {savingProfile ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      <span>GUARDAR TODA LA IDENTIDAD WEB</span>
                    </button>
                  </div>
                </section>
              </form>
            )}
          </>
        )}
      </main>

      {/* =====================================================================
          SQL MIGRATION HELPER MODAL
         ===================================================================== */}
      <AnimatePresence>
        {showSqlModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowSqlModal(false)}
            className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-8"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={SPRING_UI}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-3xl bg-[#110e0c] border border-[#ff5412]/50 p-6 space-y-4 max-h-[85vh] flex flex-col"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="lion-label text-xs text-[#ff5412]">ESQUEMA SUPABASE · 1 SOLO PASO</div>
                  <h3 className="lion-display text-3xl text-[#f4efe6]">SCRIPT SQL PARA VIDEOS, FOTOS Y GIRA</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSqlModal(false)}
                  className="p-2 text-[#b3a89a] hover:text-[#f4efe6] cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>
              <p className="text-xs text-[#b3a89a]">
                Copia este bloque y ejecútalo en tu panel de <strong>Supabase → SQL Editor → New Query → Run</strong>. Luego pulsa <strong>Sincronizar</strong>.
              </p>
              <pre className="flex-1 overflow-auto bg-[#060505] border border-white/[0.1] p-4 text-[11px] font-mono text-[#d4cbc0] leading-relaxed">
                {BAND_CMS_SQL_MIGRATION}
              </pre>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={copySql} className="lion-btn-ember lion-label text-xs">
                  {sqlCopied ? <Check size={15} /> : <Copy size={15} />}
                  <span>{sqlCopied ? 'SQL COPIADO' : 'COPIAR SQL'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowSqlModal(false);
                    hydrate();
                  }}
                  className="lion-btn-wire lion-label text-xs"
                >
                  CERRAR Y SINCRONIZAR
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
