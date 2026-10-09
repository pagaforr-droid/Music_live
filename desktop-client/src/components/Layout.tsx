import { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { MonitorPlay, CloudUpload, LogOut, User, Music, ListMusic, ChevronLeft, ChevronRight, Wand2, Type } from 'lucide-react';

export default function Layout() {
  const { user, signOut } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // Retracted by default for more space

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-white overflow-hidden">
      {/* Sidebar Glassmorphism */}
      <nav className={`${isSidebarOpen ? 'w-64' : 'w-20'} flex flex-col h-full bg-white/[0.02] border-r border-white/5 backdrop-blur-3xl relative z-20 shadow-2xl transition-all duration-300`}>
        
        {/* Toggle Button */}
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute -right-3 top-8 bg-gray-800 text-gray-400 border border-gray-600 rounded-full p-1 hover:text-white hover:bg-gray-700 z-50 transition"
        >
          {isSidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>

        <div className={`p-6 flex items-center ${isSidebarOpen ? 'space-x-3' : 'justify-center px-0'} border-b border-white/5 transition-all`}>
          <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl shadow-lg shadow-blue-500/20 shrink-0">
            <Music size={24} className="text-white" />
          </div>
          {isSidebarOpen && (
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400 whitespace-nowrap">
              Tandu Live
            </h1>
          )}
        </div>

        <div className="flex-1 py-6 px-4 space-y-2 overflow-y-auto custom-scrollbar">
          <NavLink 
            to="/" 
            className={({ isActive }) => 
              `flex items-center ${isSidebarOpen ? 'space-x-3 px-4' : 'justify-center px-0'} py-3 rounded-xl transition-all duration-300 ${
                isActive 
                  ? 'bg-red-600/20 text-red-400 shadow-inner border border-red-500/20' 
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`
            }
            title="Live Concert"
          >
            <MonitorPlay size={20} className="shrink-0" />
            {isSidebarOpen && <span className="font-medium whitespace-nowrap">Live Concert</span>}
          </NavLink>

          <NavLink 
            to="/editor" 
            className={({ isActive }) => 
              `flex items-center ${isSidebarOpen ? 'space-x-3 px-4' : 'justify-center px-0'} py-3 rounded-xl transition-all duration-300 ${
                isActive 
                  ? 'bg-blue-600/20 text-blue-400 shadow-inner border border-blue-500/20' 
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`
            }
            title="Studio Prompter"
          >
            <Music size={20} className="shrink-0" />
            {isSidebarOpen && <span className="font-medium whitespace-nowrap">Studio Prompter</span>}
          </NavLink>

          <NavLink 
            to="/studio" 
            className={({ isActive }) => 
              `flex items-center ${isSidebarOpen ? 'space-x-3 px-4' : 'justify-center px-0'} py-3 rounded-xl transition-all duration-300 ${
                isActive 
                  ? 'bg-purple-600/20 text-purple-400 shadow-inner border border-purple-500/20' 
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`
            }
            title="Stem Studio"
          >
            <CloudUpload size={20} className="shrink-0" />
            {isSidebarOpen && <span className="font-medium whitespace-nowrap">Stem Studio</span>}
          </NavLink>

          <NavLink 
            to="/setlists" 
            className={({ isActive }) => 
              `flex items-center ${isSidebarOpen ? 'space-x-3 px-4' : 'justify-center px-0'} py-3 rounded-xl transition-all duration-300 ${
                isActive 
                  ? 'bg-yellow-500/20 text-yellow-500 shadow-inner border border-yellow-500/20' 
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`
            }
            title="Setlists"
          >
            <ListMusic size={20} className="shrink-0" />
            {isSidebarOpen && <span className="font-medium whitespace-nowrap">Setlists</span>}
          </NavLink>

          <NavLink 
            to="/design" 
            className={({ isActive }) => 
              `flex items-center ${isSidebarOpen ? 'space-x-3 px-4' : 'justify-center px-0'} py-3 rounded-xl transition-all duration-300 ${
                isActive 
                  ? 'bg-indigo-500/20 text-indigo-400 shadow-inner border border-indigo-500/20' 
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`
            }
            title="Herramientas de Diseño"
          >
            <Wand2 size={20} className="shrink-0" />
            {isSidebarOpen && <span className="font-medium whitespace-nowrap">Diseño y Fotorrealismo</span>}
          </NavLink>

          <NavLink 
            to="/lyrics" 
            className={({ isActive }) => 
              `flex items-center ${isSidebarOpen ? 'space-x-3 px-4' : 'justify-center px-0'} py-3 rounded-xl transition-all duration-300 ${
                isActive 
                  ? 'bg-pink-600/20 text-pink-400 shadow-inner border border-pink-500/20' 
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`
            }
            title="Lyric Studio"
          >
            <Type size={20} className="shrink-0" />
            {isSidebarOpen && <span className="font-medium whitespace-nowrap">Lyric Studio</span>}
          </NavLink>

          <a 
            href="/mobile" 
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center ${isSidebarOpen ? 'space-x-3 px-4' : 'justify-center px-0'} py-3 rounded-xl transition-all duration-300 text-gray-400 hover:bg-white/5 hover:text-white mt-4 border border-dashed border-gray-600`}
            title="Abrir In-Ear (Prueba)"
          >
            <MonitorPlay size={20} className="text-gray-500 shrink-0" />
            {isSidebarOpen && <span className="font-medium text-sm whitespace-nowrap">Abrir In-Ear (Prueba)</span>}
          </a>
        </div>

        <div className={`p-4 border-t border-white/5 bg-black/20 ${!isSidebarOpen && 'flex flex-col items-center justify-center'}`}>
          {isSidebarOpen ? (
            <div className="flex items-center space-x-3 mb-4 px-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-gray-700 to-gray-500 flex items-center justify-center shrink-0">
                <User size={16} className="text-white/80" />
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className="text-sm font-medium truncate">{user?.email}</span>
                <span className="text-xs text-green-400">En línea</span>
              </div>
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-gray-700 to-gray-500 flex items-center justify-center shrink-0 mb-4" title={user?.email}>
              <User size={16} className="text-white/80" />
            </div>
          )}
          
          <button 
            onClick={signOut}
            className={`flex items-center justify-center ${isSidebarOpen ? 'w-full space-x-2 py-2.5 px-4' : 'p-2.5'} bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors border border-red-500/20`}
            title="Cerrar Sesión"
          >
            <LogOut size={16} className="shrink-0" />
            {isSidebarOpen && <span className="text-sm font-medium whitespace-nowrap">Cerrar Sesión</span>}
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 h-full relative overflow-hidden bg-gradient-to-br from-[#0a0a0a] to-[#121212]">
        <Outlet />
      </main>
    </div>
  );
}
