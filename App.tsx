
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { geminiService } from './services/geminiService';
import { SearchResult, SearchState, FileContext, ChatMessage, MissionTask, GroundingChunk } from './types';
import { 
  SearchIcon, 
  ExternalLinkIcon, 
  CopyIcon, 
  LoadingSpinner,
  PhotoIcon,
  DocumentIcon,
  CodeIcon,
  MapPinIcon,
  HistoryIcon
} from './components/Icons';
import MarkdownContent from './components/MarkdownContent';

const personas = [
  { id: 'general', label: 'Omni' },
  { id: 'financial', label: 'Quant' },
  { id: 'technical', label: 'System' },
  { id: 'market', label: 'Market' },
];

const glossaryTerms: Record<string, string> = {
  neuralAutonomy: "The system self-analyzes your query to automatically configure tool-sets, personas, and thinking budgets.",
  swarmPulse: "Direct visibility into the Meta-Planner's internal reasoning and agentic decisions.",
  spatialGrounding: "Geo-verifying business data and physical coordinates via global mapping indices.",
  missionBoard: "Real-time task breakdown managed by the sub-agent swarm.",
  thinkingBudget: "Recursive logic cycles allocated for complex reasoning before the system generates an answer."
};

const WithGlossary: React.FC<{ term: string; isActive: boolean; children: React.ReactElement; position?: 'top' | 'bottom' | 'left' | 'right' }> = ({ term, isActive, children, position = 'bottom' }) => {
  const [isHovered, setIsHovered] = useState(false);
  const text = glossaryTerms[term] || term;
  if (!isActive) return children;

  const posClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-3',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-3',
    left: 'right-full top-1/2 -translate-y-1/2 mr-3',
    right: 'left-full top-1/2 -translate-y-1/2 ml-3'
  }[position];

  return (
    <div className="relative inline-block" onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
      {children}
      {isHovered && (
        <div className={`fixed lg:absolute z-[9999] w-56 p-4 rounded-2xl bg-slate-900 border border-cyan-500 shadow-2xl backdrop-blur-3xl animate-in fade-in zoom-in duration-150 pointer-events-none ${posClasses}`}>
          <p className="text-[10px] font-bold text-cyan-50 leading-relaxed text-center font-mono">{text}</p>
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => {
  const [state, setState] = useState<SearchState>({ activeNodeIds: [], history: [], tasks: [], error: null });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [isAutonomous, setIsAutonomous] = useState(true);
  const [persona, setPersona] = useState<'general' | 'financial' | 'technical' | 'market'>('general');
  const [useMaps, setUseMaps] = useState(false);
  const [viewMode, setViewMode] = useState<'report' | 'map' | 'api'>('report');
  const [isGlossaryActive, setIsGlossaryActive] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileContext | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('omni_v11');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setState(s => ({ ...s, history: data.history || [], tasks: data.tasks || [] }));
        setIsAutonomous(data.isAutonomous ?? true);
        if (data.history?.length) setSelectedId(data.history[0].id);
      } catch {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('omni_v11', JSON.stringify({ 
      history: state.history.slice(0, 30), 
      tasks: state.tasks,
      isAutonomous 
    }));
  }, [state.history, state.tasks, isAutonomous]);

  const parseOutput = (text: string) => {
    const logs: string[] = [];
    let report = "";
    let rawJson = null;
    let inDataBoundary = false;
    const lines = text.split('\n');

    for (const line of lines) {
      if (line.includes('[DATA_BOUNDARY]')) { inDataBoundary = true; continue; }
      if (inDataBoundary) { try { rawJson = JSON.parse(line.trim()); } catch {} continue; }
      if (line.includes('[SWARM_LOG]')) { logs.push(line.replace('[SWARM_LOG]', '').trim()); }
      else { report += line + '\n'; }
    }
    return { logs, report: report.trim(), rawJson };
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const activeQuery = query.trim();
    if (!activeQuery && !selectedFile) return;

    const searchId = Math.random().toString(36).substring(7);
    const fileToUse = selectedFile;
    setQuery('');
    setSelectedFile(null);

    const initial: SearchResult = {
      id: searchId, query: activeQuery || "Visual Discovery", answer: '', messages: [], chunks: [],
      timestamp: Date.now(), status: 'streaming', fileContext: fileToUse || undefined
    };

    setState(prev => ({ ...prev, activeNodeIds: [...prev.activeNodeIds, searchId], history: [initial, ...prev.history] }));
    setSelectedId(searchId);

    try {
      const stream = geminiService.searchStream(activeQuery || "Analyze request parameters.", { 
        model: 'gemini-3-pro-preview', autonomous: isAutonomous, persona, useMaps 
      });

      for await (const update of stream) {
        const { logs, report, rawJson } = parseOutput(update.text);
        if (update.functionCalls) {
          update.functionCalls.forEach((fc: any) => {
            if (fc.name === 'manageTasks') {
              setState(p => ({ ...p, tasks: fc.args.tasks.map((t: any) => ({ ...t, searchId })) }));
            }
          });
        }
        setState(prev => ({
          ...prev,
          history: prev.history.map(h => h.id === searchId ? {
            ...h, answer: report, chunks: update.chunks, swarmLogs: logs, rawJson,
            status: update.isComplete ? 'completed' : 'streaming', sentiment: rawJson?.sentiment
          } : h)
        }));
      }
    } catch (err: any) {
      setState(prev => ({ ...prev, error: err.message }));
    } finally {
      setState(prev => ({ ...prev, activeNodeIds: prev.activeNodeIds.filter(id => id !== searchId) }));
    }
  };

  const currentResult = state.history.find(h => h.id === selectedId);
  const currentTasks = state.tasks.filter(t => t.searchId === selectedId);

  return (
    <div className="flex h-screen bg-[#020617] text-slate-100 overflow-hidden font-sans">
      
      {/* Sidebar - History */}
      <aside className={`fixed lg:static inset-y-0 left-0 w-72 bg-[#050810] border-r border-slate-800/50 z-50 transition-transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="p-6 h-full flex flex-col">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-8 h-8 rounded-lg bg-cyan-500 flex items-center justify-center"><SearchIcon className="w-5 h-5 text-black" /></div>
            <h2 className="text-[10px] font-black uppercase tracking-[0.2em]">Nexus Swarm</h2>
          </div>
          <button onClick={() => { setSelectedId(null); setIsSidebarOpen(false); }} className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest hover:bg-white/10 mb-8 transition-all">New Mission</button>
          <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
             <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest px-2 block mb-2">History Archive</label>
             {state.history.map(h => (
               <button key={h.id} onClick={() => { setSelectedId(h.id); setIsSidebarOpen(false); }} className={`w-full text-left p-3 rounded-xl transition-all border text-[11px] font-bold truncate ${selectedId === h.id ? 'bg-slate-800/50 border-cyan-500/30 text-white' : 'bg-transparent border-transparent text-slate-500 hover:text-slate-300'}`}>{h.query}</button>
             ))}
          </div>
        </div>
      </aside>

      {/* Main Terminal Interface */}
      <main className="flex-1 flex flex-col relative bg-[radial-gradient(circle_at_50%_0%,_#0a1329_0%,_transparent_60%)]">
        
        {/* Simplified Header */}
        <header className="h-16 border-b border-slate-800/50 flex items-center justify-between px-6 backdrop-blur-3xl sticky top-0 z-40">
          <div className="flex items-center gap-6">
            <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-2 text-slate-400"><SearchIcon className="w-5 h-5" /></button>
            <div className="flex items-center gap-4">
              <WithGlossary term="neuralAutonomy" isActive={isGlossaryActive}>
                <button onClick={() => setIsAutonomous(!isAutonomous)} className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase transition-all flex items-center gap-2 border ${isAutonomous ? 'bg-cyan-500 text-black border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.4)]' : 'bg-slate-900 border-slate-800 text-slate-500'}`}>
                   <div className={`w-1.5 h-1.5 rounded-full ${isAutonomous ? 'bg-black animate-pulse' : 'bg-slate-700'}`} />
                   {isAutonomous ? 'Neural Autonomy ON' : 'Manual Mode'}
                </button>
              </WithGlossary>
              {!isAutonomous && (
                <div className="flex bg-black/40 p-1 rounded-lg border border-slate-800 animate-in fade-in slide-in-from-left-2">
                  {personas.map(p => (
                    <button key={p.id} onClick={() => setPersona(p.id as any)} className={`px-3 py-1 rounded-md text-[9px] font-black uppercase transition-all ${persona === p.id ? 'bg-slate-800 text-cyan-400' : 'text-slate-600 hover:text-slate-300'}`}>{p.label}</button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
             <div className="flex bg-black/40 p-1 rounded-lg border border-slate-800">
                {(['report', 'map', 'api'] as const).map(mode => (
                  <button key={mode} onClick={() => setViewMode(mode)} className={`px-4 py-1.5 rounded-md text-[10px] font-black uppercase transition-all ${viewMode === mode ? 'bg-slate-800 text-cyan-400' : 'text-slate-600 hover:text-slate-300'}`}>{mode}</button>
                ))}
             </div>
             <button onClick={() => setIsGlossaryActive(!isGlossaryActive)} className={`p-2 rounded-lg transition-all ${isGlossaryActive ? 'text-cyan-400 bg-cyan-500/10' : 'text-slate-600'}`}>?</button>
          </div>
        </header>

        {/* Dynamic Workspace */}
        <div className="flex-1 overflow-y-auto px-6 md:px-12 lg:px-24 py-12 custom-scrollbar">
          {!currentResult ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto space-y-12 animate-in fade-in duration-1000">
              <div className="relative">
                <div className="absolute inset-0 bg-cyan-500/10 blur-3xl animate-pulse" />
                <div className="w-24 h-24 rounded-[2rem] bg-slate-900/50 border border-slate-800 flex items-center justify-center shadow-2xl relative z-10"><SearchIcon className="w-10 h-10 text-cyan-500" /></div>
              </div>
              <div className="space-y-4">
                <h1 className="text-5xl md:text-7xl font-black text-white uppercase tracking-tighter leading-none italic">NEXUS</h1>
                <p className="text-slate-500 text-xl font-medium tracking-tight">The ultimate search engine is now autonomous. Simply ask, and the swarm thinks, configures, and delivers.</p>
              </div>
              <div className="flex flex-wrap justify-center gap-3 opacity-60">
                {["Latest AI market trends", "Deep spec analysis of RTX 5090", "Best rooftop restaurants in SF", "Synthesize lithium-ion battery recycling data"].map(s => (
                  <button key={s} onClick={() => { setQuery(s); handleSearch(); }} className="px-5 py-3 rounded-2xl bg-slate-900/40 border border-slate-800 hover:border-cyan-500/40 text-xs font-bold text-slate-400 hover:text-white transition-all">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-6xl mx-auto space-y-12 pb-48">
              
              <div className="flex flex-col gap-6">
                 <div className="flex items-center justify-between">
                    <div className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-2 border ${currentResult.status === 'streaming' ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
                       <div className={`w-1.5 h-1.5 rounded-full ${currentResult.status === 'streaming' ? 'bg-cyan-400 animate-pulse' : 'bg-emerald-400'}`} />
                       {isAutonomous ? 'Neural Autonomy Active' : 'Manual Mission'}
                    </div>
                    <button onClick={() => currentResult.answer && navigator.clipboard.writeText(currentResult.answer)} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-500 hover:text-white transition-all"><CopyIcon className="w-4 h-4" /></button>
                 </div>
                 <h1 className="text-4xl md:text-6xl font-black text-white tracking-tighter uppercase leading-none">{currentResult.query}</h1>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
                 <div className="lg:col-span-8 space-y-12">
                    
                    {/* The Swarm Pulse (Internal Reasoning) */}
                    {(currentResult.swarmLogs?.length || 0) > 0 && (
                      <div className="space-y-4">
                        <WithGlossary term="swarmPulse" isActive={isGlossaryActive} position="right">
                          <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest flex items-center gap-2">
                             <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse" /> Swarm Intelligence Log
                          </label>
                        </WithGlossary>
                        <div className="p-6 rounded-[2rem] bg-black/40 border border-slate-800/50 font-mono text-[10px] space-y-2 max-h-56 overflow-y-auto custom-scrollbar shadow-inner backdrop-blur-xl">
                          {currentResult.swarmLogs?.map((log, i) => (
                            <div key={i} className="flex gap-4 animate-in fade-in slide-in-from-left-4 duration-500">
                              <span className="text-cyan-500/80 font-bold shrink-0">{log.split('>')[0]}</span>
                              <span className="text-slate-400 leading-relaxed">{log.split('>')[1] || log}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Dynamic Viewport */}
                    <div className="relative min-h-[400px]">
                       {viewMode === 'report' ? (
                         <div className="p-10 md:p-14 rounded-[3rem] bg-[#070b14] border border-slate-800/80 shadow-[0_40px_100px_rgba(0,0,0,0.6)] backdrop-blur-3xl animate-in fade-in duration-1000">
                            {currentResult.answer ? <MarkdownContent content={currentResult.answer} /> : <div className="py-20 flex flex-col items-center gap-6"><LoadingSpinner /><p className="text-cyan-500 font-black text-[10px] uppercase tracking-widest animate-pulse">Synthesizing absolute data...</p></div>}
                         </div>
                       ) : viewMode === 'api' ? (
                         <pre className="p-10 rounded-[3rem] bg-black border border-slate-800 text-cyan-400/80 font-mono text-xs overflow-x-auto leading-relaxed shadow-2xl">
                            {JSON.stringify(currentResult.rawJson || { status: "Calculating entities..." }, null, 2)}
                         </pre>
                       ) : (
                         <div className="grid grid-cols-1 gap-8">
                            {currentResult.chunks.filter(c => c.maps).map((c, i) => (
                              <div key={i} className="h-[450px] rounded-[3rem] border border-slate-800 overflow-hidden bg-slate-950 shadow-2xl grayscale invert contrast-125 opacity-70">
                                 <iframe title={c.maps?.title} width="100%" height="100%" frameBorder="0" src={`https://maps.google.com/maps?q=${encodeURIComponent(c.maps?.title || '')}&t=m&z=17&ie=UTF8&iwloc=&output=embed`} />
                              </div>
                            ))}
                         </div>
                       )}
                    </div>
                 </div>

                 {/* Lateral Verification Panel */}
                 <div className="lg:col-span-4 space-y-8 sticky top-24">
                    <div className="p-8 rounded-[2.5rem] bg-[#0d1117] border border-slate-800/80 shadow-2xl space-y-8">
                       <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center justify-between">
                         Neural Evidence
                         <span className="px-2 py-0.5 rounded-lg bg-cyan-500/10 text-cyan-400 text-[9px] font-bold">{currentResult.chunks.length} Nodes</span>
                       </label>
                       <div className="space-y-4 max-h-[600px] overflow-y-auto custom-scrollbar pr-1">
                          {currentResult.chunks.map((chunk, i) => {
                            const data = chunk.web || chunk.maps;
                            if (!data) return null;
                            return (
                              <a key={i} href={data.uri} target="_blank" rel="noreferrer" className="block p-4 rounded-2xl border border-slate-800/50 hover:border-cyan-500/30 bg-black/40 group transition-all animate-in slide-in-from-right-4">
                                <div className="text-[8px] font-black uppercase tracking-widest mb-1 opacity-40 group-hover:text-cyan-400 transition-colors">Verified Source</div>
                                <div className="text-[11px] font-bold text-slate-300 leading-tight group-hover:text-white transition-colors">{data.title}</div>
                              </a>
                            );
                          })}
                       </div>
                    </div>
                 </div>
              </div>
            </div>
          )}
        </div>

        {/* Command Console */}
        <div className="absolute bottom-0 left-0 right-0 p-8 md:p-12 bg-gradient-to-t from-[#020617] via-[#020617]/90 to-transparent z-40">
           <div className="max-w-4xl mx-auto">
              <form onSubmit={handleSearch} className="relative group">
                 <div className="absolute -inset-1.5 bg-gradient-to-r from-cyan-500/30 to-indigo-600/30 rounded-[3rem] blur-2xl opacity-0 group-focus-within:opacity-100 transition duration-1000" />
                 <div className="relative flex items-center bg-[#0d1117] border border-slate-800 group-focus-within:border-cyan-500/50 rounded-[2.5rem] shadow-2xl p-2.5 pr-8 transition-all">
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="w-14 h-14 flex items-center justify-center text-slate-600 hover:text-cyan-400 transition-all shrink-0">
                      <DocumentIcon className="w-6 h-6" />
                    </button>
                    <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if(f) { const reader = new FileReader(); reader.onload=(ev)=>setSelectedFile({ data: (ev.target?.result as string).split(',')[1], mimeType: f.type, name: f.name }); reader.readAsDataURL(f); }}} />
                    <textarea
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch(); } }}
                      rows={1}
                      placeholder={isAutonomous ? "Command the swarm..." : "Enter mission parameters..."}
                      className="flex-1 bg-transparent border-none focus:ring-0 px-5 py-5 text-white placeholder-slate-700 text-xl font-bold tracking-tight resize-none no-scrollbar min-h-[70px]"
                    />
                    <button type="submit" disabled={!query.trim() && !selectedFile} className={`h-12 px-10 rounded-[1.5rem] font-black transition-all flex items-center gap-3 shrink-0 active:scale-95 ${!query.trim() && !selectedFile ? 'bg-slate-800 text-slate-600' : 'bg-white text-black hover:bg-cyan-50 shadow-2xl'}`}>
                      <span className="hidden sm:inline text-xs uppercase tracking-widest">Ignite</span>
                      <SearchIcon className="w-5 h-5" />
                    </button>
                 </div>
              </form>
              <div className="mt-8 flex justify-center gap-12 opacity-20 pointer-events-none">
                 <p className="text-[10px] font-black uppercase tracking-[0.5em] text-slate-400">Precision Swarm Kernel v11.0</p>
                 <p className="text-[10px] font-black uppercase tracking-[0.5em] text-slate-400">Neural Autonomy Mode</p>
              </div>
           </div>
        </div>
      </main>
    </div>
  );
};

export default App;
