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
    <div className="h-full flex bg-[#f8f9fa] text-zinc-900 overflow-hidden p-6 gap-6 font-sans select-none relative">
      {/* LEFT COLUMN: Setlist Management */}
      <div className="w-80 shrink-0 flex flex-col gap-4 z-10">
        <div className="bg-white border border-zinc-200 rounded-2xl p-5 flex flex-col h-full shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-black uppercase tracking-[0.18em] flex items-center gap-2 text-zinc-950">
              <div className="w-7 h-7 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-center text-[#e11d48]">
                <ListMusic size={14} />
              </div>
              <span>Mis Setlists</span>
            </h2>
            <span className="text-[10px] font-mono text-zinc-800 bg-zinc-100 border border-zinc-200 px-2.5 py-0.5 rounded-full tabular-nums font-bold">
              {setlists.length} {setlists.length === 1 ? 'show' : 'shows'}
            </span>
          </div>
          
          <div className="flex gap-2 mb-5">
            <input 
              type="text"
              placeholder="Nombre del Setlist / Show..."
              value={newSetlistName}
              onChange={e => setNewSetlistName(e.target.value)}
              className="flex-1 bg-white border border-zinc-300 rounded-xl px-3.5 py-2.5 outline-none focus:border-black transition text-xs font-medium text-zinc-900 placeholder:text-zinc-400 shadow-xs"
              onKeyDown={e => e.key === 'Enter' && createSetlist()}
            />
            <button 
              onClick={createSetlist}
              disabled={!newSetlistName.trim() || isSaving}
              className="ruby-pill-accent hover:brightness-105 disabled:opacity-40 text-white px-3.5 py-2.5 rounded-xl transition font-black flex items-center justify-center shadow-xs cursor-pointer active:scale-95"
              title="Crear nuevo Setlist"
            >
              <Plus size={16} />
            </button>
          </div>

          <div className="space-y-2 flex-1 overflow-y-auto pr-1 custom-scrollbar">
            {setlists.map(setlist => {
              const isSelected = selectedSetlistId === setlist.id;
              return (
                <div 
                  key={setlist.id} 
                  onClick={() => setSelectedSetlistId(setlist.id)}
                  className={`relative flex items-center justify-between p-3.5 rounded-xl cursor-pointer transition-all border ${
                    isSelected 
                    ? 'bg-rose-50/70 border-2 border-[#e11d48] text-zinc-950 font-bold shadow-xs' 
                    : 'bg-zinc-50 border-zinc-200 text-zinc-700 hover:bg-zinc-100 hover:text-black font-semibold'
                  }`}
                >
                  {isSelected && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-6 bg-[#e11d48] rounded-r-full" />
                  )}
                  <span className="font-bold text-xs truncate pl-1">{setlist.title}</span>
                  <button 
                    onClick={(e) => { e.stopPropagation(); deleteSetlist(setlist.id); }}
                    className="text-zinc-400 hover:text-rose-600 p-1 rounded-lg transition-colors cursor-pointer"
                    title="Eliminar Setlist"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
            {setlists.length === 0 && (
              <p className="text-zinc-400 text-xs text-center py-8">No hay setlists creados aún.</p>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Setlist Songs & Catalog */}
      <div className="flex-1 flex flex-col gap-5 overflow-hidden z-10">
        {selectedSetlistId ? (
          <>
            <div className="flex-1 bg-white border border-zinc-200 rounded-2xl p-5 flex flex-col overflow-hidden shadow-xs">
              <div className="flex items-center justify-between mb-4 pb-3.5 border-b border-zinc-200">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-black uppercase tracking-wider text-zinc-950">Repertorio del Show</h2>
                  <span className="text-[10px] bg-zinc-100 border border-zinc-200 px-3 py-1 rounded-full font-mono text-zinc-800 font-bold tabular-nums">
                    {setlistSongs.length} {setlistSongs.length === 1 ? 'CANCIÓN' : 'CANCIONES'}
                  </span>
                </div>
                <button
                  onClick={() => navigate('/concert')}
                  className="px-4 py-2 rounded-xl ruby-pill-accent text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-xs hover:brightness-105 active:scale-98 transition-all cursor-pointer"
                >
                  <Radio size={14} />
                  <span>Lanzar en Live Concert</span>
                  <ArrowRight size={14} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 custom-scrollbar">
                {setlistSongs.map((ss, index) => (
                  <div key={ss.id} className="flex items-center bg-zinc-50 hover:bg-zinc-100/80 border border-zinc-200 rounded-xl p-3 group hover:border-zinc-300 transition-all shadow-xs">
                    <div className="flex flex-col mr-3 opacity-50 group-hover:opacity-100 transition">
                      <button onClick={() => moveSong(index, 'up')} disabled={index === 0} className="hover:text-black text-zinc-600 disabled:opacity-20 cursor-pointer">
                        <ArrowUp size={13} />
                      </button>
                      <button onClick={() => moveSong(index, 'down')} disabled={index === setlistSongs.length - 1} className="hover:text-black text-zinc-600 disabled:opacity-20 cursor-pointer">
                        <ArrowDown size={13} />
                      </button>
                    </div>
                    
                    <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-white border border-zinc-300 text-xs font-black text-zinc-900 mr-3.5 shrink-0 font-mono tabular-nums shadow-xs">
                      {String(index + 1).padStart(2, '0')}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold truncate text-sm text-zinc-950 tracking-tight">{ss.title}</p>
                        {ss.bpm && (
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-white text-zinc-800 border border-zinc-200 tabular-nums shadow-xs">
                            {ss.bpm} BPM
                          </span>
                        )}
                        {ss.key && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-800 border border-purple-200 shadow-xs">
                            {ss.key}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {ss.hasAudio ? (
                          <span className="text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-300 flex items-center gap-1 shadow-xs">
                            <Save size={9} /> MIX EXPORTADO (FOH + MÚSICOS)
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              sessionStorage.setItem('tandu_active_song_id', ss.songId);
                              navigate('/prompter');
                            }}
                            className="text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1 transition-colors cursor-pointer shadow-xs"
                            title="Haz clic para abrir en Studio Prompter y exportar la mezcla"
                          >
                            <Music size={9} /> FALTA EXPORTAR MIX EN STUDIO PROMPTER →
                          </button>
                        )}
                        <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border shadow-xs ${
                          ss.hasChords
                            ? 'bg-sky-50 text-sky-800 border-sky-300'
                            : 'bg-white text-zinc-400 border-zinc-200'
                        }`}>
                          {ss.hasChords ? '✓ Acordes' : 'Sin Acordes'}
                        </span>
                        <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border shadow-xs ${
                          ss.hasLyrics
                            ? 'bg-amber-50 text-amber-800 border-amber-300'
                            : 'bg-white text-zinc-400 border-zinc-200'
                        }`}>
                          {ss.hasLyrics ? '✓ Letras Sincronizadas' : 'Sin Letras'}
                        </span>
                      </div>
                    </div>
                    
                    <button 
                      onClick={() => removeSongFromSetlist(ss.id)}
                      className="ml-3 text-zinc-400 hover:text-rose-600 p-2 rounded-lg transition-colors cursor-pointer"
                      title="Quitar del Setlist"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                
                {setlistSongs.length === 0 && (
                  <div className="h-full flex items-center justify-center flex-col text-zinc-400 py-16">
                    <ListMusic size={42} className="mb-3 opacity-40 text-zinc-400" />
                    <p className="text-sm font-bold text-zinc-700">Repertorio vacío</p>
                    <p className="text-xs mt-1 text-zinc-400">Agrega canciones desde el catálogo inferior.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="h-56 bg-white border border-zinc-200 rounded-2xl p-4 flex flex-col shrink-0 shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-black uppercase tracking-[0.16em] text-zinc-950">Catálogo de Canciones Disponibles ({allSongs.length})</h2>
                <span className="text-[10px] text-zinc-500 font-medium">Las canciones con borde esmeralda ya tienen su Mix En Vivo exportado</span>
              </div>
              <div className="flex-1 overflow-y-auto grid grid-cols-2 lg:grid-cols-3 gap-2.5 pr-1 custom-scrollbar">
                {allSongs.map(song => {
                  const hasAudio = !!song.foh_mix_url && !!song.cue_mix_url;
                  const pd = song.prompter_data || {};
                  const hasLyrics = Array.isArray(pd.lyrics) && pd.lyrics.length > 0;
                  return (
                    <div 
                      key={song.id} 
                      className={`flex items-center justify-between p-3 rounded-xl border transition-all group shadow-xs ${
                        hasAudio
                          ? 'bg-white border-emerald-300 hover:border-emerald-500'
                          : 'bg-zinc-50/60 border-zinc-200 hover:border-zinc-300'
                      }`}
                    >
                      <div className="min-w-0 flex-1 mr-2">
                        <div className="text-xs font-bold text-zinc-950 truncate tracking-tight" title={song.title}>{song.title}</div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className={`text-[8.5px] font-black uppercase px-2 py-0.5 rounded-full border shadow-xs ${hasAudio ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
                            {hasAudio ? '● Mix Listo' : '○ Sin Mix'}
                          </span>
                          {hasLyrics && (
                            <span className="text-[8.5px] font-bold text-amber-800 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded-full uppercase shadow-xs">Lyrics</span>
                          )}
                        </div>
                      </div>
                      <button 
                        onClick={() => addSongToSetlist(song.id)}
                        className="w-8 h-8 flex items-center justify-center rounded-xl bg-zinc-100 hover:bg-black text-zinc-700 hover:text-white border border-zinc-200 hover:border-black transition-all shrink-0 cursor-pointer shadow-xs active:scale-95"
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
          <div className="h-full flex items-center justify-center text-zinc-400 bg-white border border-zinc-200 rounded-2xl shadow-xs">
            <div className="text-center">
              <ListMusic size={48} className="mx-auto mb-4 opacity-40 text-[#e11d48]" />
              <p className="text-base font-bold text-zinc-800">Selecciona o crea un Setlist a la izquierda</p>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
