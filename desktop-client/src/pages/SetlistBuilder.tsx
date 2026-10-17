import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, ArrowUp, ArrowDown, ListMusic, Save, Music, ArrowRight, Radio } from 'lucide-react';

const FAKE_BAND_ID = "00000000-0000-0000-0000-000000000000";

export default function SetlistBuilder() {
  const navigate = useNavigate();
  const [setlists, setSetlists] = useState<any[]>([]);
  const [selectedSetlistId, setSelectedSetlistId] = useState<string | null>(() => {
    return sessionStorage.getItem('tandu_active_setlist_id');
  });
  
  const [setlistSongs, setSetlistSongs] = useState<any[]>([]);
  const [allSongs, setAllSongs] = useState<any[]>([]);
  
  const [newSetlistName, setNewSetlistName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchSetlists();
    fetchAllSongs();
  }, []);

  useEffect(() => {
    if (selectedSetlistId) {
      sessionStorage.setItem('tandu_active_setlist_id', selectedSetlistId);
      fetchSetlistSongs(selectedSetlistId);
    } else {
      setSetlistSongs([]);
    }
  }, [selectedSetlistId]);

  const fetchSetlists = async () => {
    const { data, error } = await supabase
      .from('setlists')
      .select('*')
      .eq('band_id', FAKE_BAND_ID)
      .order('created_at', { ascending: false });
      
    if (error) console.error(error);
    else {
      const list = data || [];
      setSetlists(list);
      const savedId = sessionStorage.getItem('tandu_active_setlist_id');
      if (savedId && list.some((s: any) => s.id === savedId)) {
        setSelectedSetlistId(savedId);
      } else if (!selectedSetlistId && list.length > 0) {
        setSelectedSetlistId(list[0].id);
      }
    }
  };

  const fetchAllSongs = async () => {
    const { data, error } = await supabase
      .from('songs')
      .select('id, title, foh_mix_url, cue_mix_url, prompter_data')
      .eq('band_id', FAKE_BAND_ID)
      .order('title', { ascending: true });
      
    if (error) console.error(error);
    else setAllSongs(data || []);
  };

  const fetchSetlistSongs = async (setId: string) => {
    const { data, error } = await supabase
      .from('setlist_songs')
      .select(`
        id,
        position,
        song:songs (id, title, foh_mix_url, cue_mix_url, prompter_data)
      `)
      .eq('setlist_id', setId)
      .order('position', { ascending: true });
      
    if (error) {
      console.error(error);
    } else {
      const mapped = (data || []).map(item => {
        const s = (item.song as any) || {};
        const pd = s.prompter_data || {};
        return {
          id: item.id,
          position: item.position,
          songId: s.id,
          title: s.title,
          bpm: pd.bpm ? Math.round(Number(pd.bpm)) : null,
          key: pd.key || null,
          hasAudio: !!s.foh_mix_url && !!s.cue_mix_url,
          hasChords: Array.isArray(pd.chords) && pd.chords.length > 0,
          hasLyrics: Array.isArray(pd.lyrics) && pd.lyrics.length > 0,
        };
      });
      setSetlistSongs(mapped);
    }
  };

  const createSetlist = async () => {
    if (!newSetlistName.trim()) return;
    setIsSaving(true);
    const { data, error } = await supabase
      .from('setlists')
      .insert({ title: newSetlistName, band_id: FAKE_BAND_ID })
      .select()
      .single();
      
    setIsSaving(false);
    if (error) {
      alert('Error creando setlist: ' + error.message);
    } else if (data) {
      setNewSetlistName('');
      setSetlists([data, ...setlists]);
      setSelectedSetlistId(data.id);
    }
  };

  const deleteSetlist = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este setlist?')) return;
    const { error } = await supabase.from('setlists').delete().eq('id', id);
    if (error) {
      alert(error.message);
    } else {
      setSetlists(setlists.filter(s => s.id !== id));
      if (selectedSetlistId === id) setSelectedSetlistId(null);
    }
  };

  const addSongToSetlist = async (songId: string) => {
    if (!selectedSetlistId) return;
    const newPosition = setlistSongs.length;
    
    const { data, error } = await supabase
      .from('setlist_songs')
      .insert({
        setlist_id: selectedSetlistId,
        song_id: songId,
        position: newPosition
      })
      .select(`
        id,
        position,
        song:songs (id, title, foh_mix_url, cue_mix_url, prompter_data)
      `)
      .single();
      
    if (error) {
      alert('Error agregando canción: ' + error.message);
    } else if (data) {
      const s = (data.song as any) || {};
      const pd = s.prompter_data || {};
      const newItem = {
        id: data.id,
        position: data.position,
        songId: s.id,
        title: s.title,
        bpm: pd.bpm ? Math.round(Number(pd.bpm)) : null,
        key: pd.key || null,
        hasAudio: !!s.foh_mix_url && !!s.cue_mix_url,
        hasChords: Array.isArray(pd.chords) && pd.chords.length > 0,
        hasLyrics: Array.isArray(pd.lyrics) && pd.lyrics.length > 0,
      };
      setSetlistSongs([...setlistSongs, newItem]);
    }
  };

  const removeSongFromSetlist = async (setlistSongId: string) => {
    const { error } = await supabase.from('setlist_songs').delete().eq('id', setlistSongId);
    if (error) {
      alert(error.message);
    } else {
      const filtered = setlistSongs.filter(s => s.id !== setlistSongId);
      const updated = filtered.map((s, index) => ({ ...s, position: index }));
      setSetlistSongs(updated);
      savePositions(updated);
    }
  };

  const moveSong = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === setlistSongs.length - 1) return;
    
    const newArr = [...setlistSongs];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    
    const temp = newArr[index];
    newArr[index] = newArr[targetIndex];
    newArr[targetIndex] = temp;
    
    const updated = newArr.map((s, i) => ({ ...s, position: i }));
    setSetlistSongs(updated);
    savePositions(updated);
  };

  const savePositions = async (songs: any[]) => {
    for (const song of songs) {
      supabase.from('setlist_songs').update({ position: song.position }).eq('id', song.id).then();
    }
  };

  return (
    <div className="h-full flex bg-[#07090e] text-white overflow-hidden p-6 gap-6 font-sans select-none">
      
      {/* LEFT COLUMN: Setlist Management */}
      <div className="w-80 shrink-0 flex flex-col gap-4">
        <div className="bg-[#0d1017] border border-white/[0.08] rounded-xl p-5 shadow-2xl flex flex-col h-full">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-black uppercase tracking-widest flex items-center gap-2 text-white">
              <ListMusic size={16} className="text-red-500" /> Mis Setlists
            </h2>
            <span className="text-[10px] font-mono text-zinc-500">{setlists.length} shows</span>
          </div>
          
          <div className="flex gap-2 mb-5">
            <input 
              type="text"
              placeholder="Nombre del Setlist / Show..."
              value={newSetlistName}
              onChange={e => setNewSetlistName(e.target.value)}
              className="flex-1 bg-[#07090e] border border-zinc-800 rounded-lg px-3.5 py-2 outline-none focus:border-red-500 transition text-xs font-medium"
              onKeyDown={e => e.key === 'Enter' && createSetlist()}
            />
            <button 
              onClick={createSetlist}
              disabled={!newSetlistName.trim() || isSaving}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-3 py-2 rounded-lg transition font-black flex items-center justify-center shadow-[0_0_15px_rgba(239,68,68,0.3)]"
              title="Crear nuevo Setlist"
            >
              <Plus size={18} />
            </button>
          </div>

          <div className="space-y-1.5 flex-1 overflow-y-auto pr-1 custom-scrollbar">
            {setlists.map(setlist => (
              <div 
                key={setlist.id} 
                onClick={() => setSelectedSetlistId(setlist.id)}
                className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition border ${
                  selectedSetlistId === setlist.id 
                  ? 'bg-red-600/15 border-red-500/50 text-white shadow-[0_0_15px_rgba(239,68,68,0.12)]' 
                  : 'bg-[#111520] border-white/[0.04] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'
                }`}
              >
                <span className="font-bold text-xs truncate">{setlist.title}</span>
                <button 
                  onClick={(e) => { e.stopPropagation(); deleteSetlist(setlist.id); }}
                  className="text-zinc-600 hover:text-red-400 p-1 rounded transition"
                  title="Eliminar Setlist"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {setlists.length === 0 && (
              <p className="text-zinc-600 text-xs text-center py-6">No hay setlists creados aún.</p>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Setlist Songs & Catalog */}
      <div className="flex-1 flex flex-col gap-5 overflow-hidden">
        {selectedSetlistId ? (
          <>
            <div className="flex-1 bg-[#0d1017] border border-white/[0.08] rounded-xl p-5 shadow-2xl flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-black uppercase tracking-wider text-white">Repertorio del Show</h2>
                  <span className="text-[10px] bg-zinc-900 border border-zinc-800 px-2.5 py-0.5 rounded-full font-mono text-zinc-300 font-bold">
                    {setlistSongs.length} CANCIONES
                  </span>
                </div>
                <button
                  onClick={() => navigate('/concert')}
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-[0_0_20px_rgba(239,68,68,0.3)] transition-all"
                >
                  <Radio size={14} />
                  <span>Lanzar en Live Concert</span>
                  <ArrowRight size={14} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {setlistSongs.map((ss, index) => (
                  <div key={ss.id} className="flex items-center bg-[#090b10] border border-white/[0.06] rounded-lg p-2.5 group hover:border-white/[0.14] transition">
                    <div className="flex flex-col mr-3 opacity-40 group-hover:opacity-100 transition">
                      <button onClick={() => moveSong(index, 'up')} disabled={index === 0} className="hover:text-red-400 disabled:opacity-30">
                        <ArrowUp size={13} />
                      </button>
                      <button onClick={() => moveSong(index, 'down')} disabled={index === setlistSongs.length - 1} className="hover:text-red-400 disabled:opacity-30">
                        <ArrowDown size={13} />
                      </button>
                    </div>
                    
                    <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-red-600/15 border border-red-500/30 text-xs font-black text-red-400 mr-3.5 shrink-0 font-mono">
                      {index + 1}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold truncate text-sm text-white">{ss.title}</p>
                        {ss.bpm && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                            {ss.bpm} BPM
                          </span>
                        )}
                        {ss.key && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">
                            {ss.key}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {ss.hasAudio ? (
                          <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                            <Save size={9} /> MIX EXPORTADO (FOH + MÚSICOS)
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              sessionStorage.setItem('tandu_active_song_id', ss.songId);
                              navigate('/prompter');
                            }}
                            className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 flex items-center gap-1"
                            title="Haz clic para abrir en Studio Prompter y exportar la mezcla"
                          >
                            <Music size={9} /> FALTA EXPORTAR MIX EN STUDIO PROMPTER →
                          </button>
                        )}
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                          ss.hasChords
                            ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                            : 'bg-zinc-900 text-zinc-600 border-zinc-800'
                        }`}>
                          {ss.hasChords ? '✓ Acordes' : 'Sin Acordes'}
                        </span>
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                          ss.hasLyrics
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                            : 'bg-zinc-900 text-zinc-600 border-zinc-800'
                        }`}>
                          {ss.hasLyrics ? '✓ Letras Sincronizadas' : 'Sin Letras'}
                        </span>
                      </div>
                    </div>
                    
                    <button 
                      onClick={() => removeSongFromSetlist(ss.id)}
                      className="ml-3 text-zinc-600 hover:text-red-400 p-2 rounded transition"
                      title="Quitar del Setlist"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                
                {setlistSongs.length === 0 && (
                  <div className="h-full flex items-center justify-center flex-col text-zinc-600">
                    <ListMusic size={42} className="mb-3 opacity-40" />
                    <p className="text-sm font-bold text-zinc-400">Repertorio vacío</p>
                    <p className="text-xs mt-1">Agrega canciones desde el catálogo inferior.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="h-56 bg-[#0d1017] border border-white/[0.08] rounded-xl p-4 shadow-2xl flex flex-col shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-black uppercase tracking-widest text-zinc-300">Catálogo de Canciones Disponibles ({allSongs.length})</h2>
                <span className="text-[10px] text-zinc-500">Las canciones con borde verde ya tienen su Mix En Vivo exportado</span>
              </div>
              <div className="flex-1 overflow-y-auto grid grid-cols-2 lg:grid-cols-3 gap-2 pr-1 custom-scrollbar">
                {allSongs.map(song => {
                  const hasAudio = !!song.foh_mix_url && !!song.cue_mix_url;
                  const pd = song.prompter_data || {};
                  const hasLyrics = Array.isArray(pd.lyrics) && pd.lyrics.length > 0;
                  return (
                    <div 
                      key={song.id} 
                      className={`flex items-center justify-between p-2.5 rounded-lg border transition group ${
                        hasAudio
                          ? 'bg-[#090b10] border-emerald-500/30 hover:border-emerald-400'
                          : 'bg-red-950/10 border-red-900/30 opacity-75 hover:opacity-100'
                      }`}
                    >
                      <div className="min-w-0 flex-1 mr-2">
                        <div className="text-xs font-bold text-white truncate" title={song.title}>{song.title}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`text-[8px] font-black uppercase ${hasAudio ? 'text-emerald-400' : 'text-red-400'}`}>
                            {hasAudio ? '● Mix Listo' : '○ Sin Mix'}
                          </span>
                          {hasLyrics && (
                            <span className="text-[8px] font-bold text-amber-400 uppercase">&bull; Lyrics</span>
                          )}
                        </div>
                      </div>
                      <button 
                        onClick={() => addSongToSetlist(song.id)}
                        className="bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/30 w-7 h-7 flex items-center justify-center rounded-lg transition shrink-0"
                        title="Añadir al Setlist"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-zinc-500 border-2 border-dashed border-white/[0.07] rounded-xl">
            <div className="text-center">
              <ListMusic size={48} className="mx-auto mb-4 opacity-40" />
              <p className="text-base font-bold text-zinc-300">Selecciona o crea un Setlist a la izquierda</p>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
