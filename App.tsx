
import React, { useState, useEffect, useRef } from 'react';
import { geminiService } from './services/geminiService';
import { SearchResult, SearchState, FileContext, LayoutMode, MissionTask, GroundingChunk } from './types';
import { 
  SearchIcon, 
  ExternalLinkIcon, 
  CopyIcon, 
  LoadingSpinner,
  DocumentIcon
} from './components/Icons';
import MarkdownContent from './components/MarkdownContent';

const App: React.FC = () => {
  const [state, setState] = useState<SearchState>({ activeNodeIds: [], history: [], tasks: [], error: null });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [isAutonomous, setIsAutonomous] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileContext | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('nexus_v14_1');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setState(s => ({ ...s, history: data.history || [], tasks: data.tasks || [] }));
        if (data.history?.length) setSelectedId(data.history[0].id);
      } catch {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('nexus_v14_1', JSON.stringify({ history: state.history.slice(0, 30), tasks: state.tasks }));
  }, [state.history, state.tasks]);

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
      else if (line.includes('[LAYOUT:')) { continue; }
      else { report += line + '\n'; }
    }
    return { logs, report: report.trim(), rawJson };
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const activeQuery = query.trim();
    if (!activeQuery && !selectedFile) return;

    // Pre-detect spatial queries to update UI immediately
    const isSpatial = activeQuery.toLowerCase().match(/(where|location|find|near|restaurant|food|hotel|address|street|map|sf|nyc|london|tenderloin)/);
    const predictedLayout: LayoutMode = isSpatial ? 'SPATIAL_SPLIT' : 'AUTO';

    const searchId = Math.random().toString(36).substring(7);
    const fileToUse = selectedFile;
    setQuery('');
    setSelectedFile(null);

    const initial: SearchResult = {
      id: searchId, query: activeQuery || "Visual Synthesis", answer: '', messages: [], chunks: [],
      timestamp: Date.now(), status: 'streaming', fileContext: fileToUse || undefined, suggestedLayout: predictedLayout
    };

    setState(prev => ({ ...prev, activeNodeIds: [...prev.activeNodeIds, searchId], history: [initial, ...prev.history], tasks: [] }));
    setSelectedId(searchId);

    try {
      const stream = geminiService.searchStream(activeQuery || "Synthesizing parameters.", { 
        model: 'gemini-3-pro-preview', autonomous: isAutonomous 
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
            status: update.isComplete ? 'completed' : 'streaming', sentiment: rawJson?.sentiment,
            suggestedLayout: update.suggestedLayout !== 'AUTO' ? update.suggestedLayout : h.suggestedLayout
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

  // Intelligent Layout Decision
  const getLayout = (): LayoutMode => {
    if (!currentResult) return 'AUTO';
    if (currentResult.suggestedLayout && currentResult.suggestedLayout !== 'AUTO') return currentResult.suggestedLayout;
    if (currentResult.chunks.some(c => c.maps)) return 'SPATIAL_SPLIT';
    return 'REPORT_ONLY';
  };

  const activeLayout = getLayout();

  return (
    <div className="flex h-screen bg-[#010409] text-slate-100 overflow-hidden font-sans selection:bg-cyan-500/30">
      
      {/* Sidebar - Historical Archive */}
      <aside className={`fixed lg:static inset-y-0 left-0 w-72 bg-[#0d1117] border-r border-slate-800/40 z-50 transition-transform duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="p-6 h-full flex flex-col space-y-8">
           <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-600 to-blue-700 flex items-center justify-center shadow-lg"><SearchIcon className="w-6 h-6 text-white" /></div>
              <h1 className="text-[11px] font-black uppercase tracking-[0.3em]">Nexus v14.1</h1>
           </div>
           <button onClick={() => { setSelectedId(null); setIsSidebarOpen(false); }} className="w-full py-4 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all">New Synthesis</button>
           <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6">
              <div className="px-2">
                 <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Mission Vault</label>
                 <div className="mt-4 space-y-1">
                    {state.history.map(h => (
                      <button key={h.id} onClick={() => { setSelectedId(h.id); setIsSidebarOpen(false); }} className={`w-full text-left p-3.5 rounded-xl transition-all border text-[11px] font-bold truncate flex items-center gap-3 ${selectedId === h.id ? 'bg-slate-800/80 border-cyan-500/30 text-white shadow-xl shadow-cyan-500/5' : 'bg-transparent border-transparent text-slate-500 hover:text-slate-300'}`}>
                         <div className={`w-1 h-1 rounded-full ${h.status === 'streaming' ? 'bg-cyan-500 animate-pulse' : 'bg-slate-700'}`} />
                         {h.query}
                      </button>
                    ))}
                 </div>
              </div>
           </div>
        </div>
      </aside>

      {/* Primary Orchestration Shell */}
      <main className="flex-1 flex flex-col relative bg-[radial-gradient(circle_at_50%_0%,_#0a1931_0%,_transparent_65%)] overflow-hidden">
        
        {/* Header HUD */}
        <header className="h-16 border-b border-slate-800/40 flex items-center justify-between px-8 backdrop-blur-3xl bg-black/10 z-40">
           <div className="flex items-center gap-6">
              <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-2 text-slate-400"><SearchIcon className="w-5 h-5" /></button>
              <button onClick={() => setIsAutonomous(!isAutonomous)} className={`px-5 py-2 rounded-full text-[10px] font-black uppercase transition-all flex items-center gap-3 border ${isAutonomous ? 'bg-cyan-500 text-black border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.3)]' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>
                 <div className={`w-2 h-2 rounded-full ${isAutonomous ? 'bg-black animate-pulse' : 'bg-slate-700'}`} />
                 {isAutonomous ? 'Neural Autonomy Active' : 'Manual Controller'}
              </button>
           </div>
           <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-black/40 border border-slate-800">
                 <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Active Layout:</span>
                 <span className="text-[9px] font-black text-cyan-400 uppercase tracking-widest">{activeLayout}</span>
              </div>
           </div>
        </header>

        {/* Viewport Core */}
        <div className="flex-1 overflow-hidden relative">
           {!currentResult ? (
             <div className="h-full flex flex-col items-center justify-center text-center p-8 max-w-2xl mx-auto space-y-12 animate-in fade-in duration-1000">
                <div className="relative">
                  <div className="absolute inset-0 bg-cyan-500/10 blur-[100px] rounded-full animate-pulse" />
                  <div className="w-24 h-24 rounded-3xl bg-slate-900 border border-slate-800 flex items-center justify-center relative z-10"><SearchIcon className="w-10 h-10 text-cyan-500" /></div>
                </div>
                <div className="space-y-4">
                  <h2 className="text-6xl font-black text-white italic tracking-tighter uppercase leading-none">NEXUS CORE</h2>
                  <p className="text-slate-500 text-xl font-medium tracking-tight">Ultimate Data & Search Engine. Zero Latency Synthesis.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full opacity-60">
                   {["Detailed market data for EV startups", "Hardware specs of RTX 50 series", "Michelin star restaurants in SF", "Comparison of LLM architectures"].map(s => (
                     <button key={s} onClick={() => { setQuery(s); handleSearch(); }} className="p-4 rounded-2xl bg-slate-900/40 border border-slate-800 hover:border-cyan-500/40 text-left text-[11px] font-bold text-slate-400 transition-all">→ {s}</button>
                   ))}
                </div>
             </div>
           ) : (
             <div className="h-full flex flex-col lg:flex-row overflow-hidden transition-all duration-700">
                
                {/* Analytic Panel (Report) */}
                <div className={`flex-1 overflow-y-auto custom-scrollbar p-6 md:p-12 transition-all duration-700 ${activeLayout === 'SPATIAL_SPLIT' ? 'lg:w-1/2' : 'w-full'}`}>
                   <div className="max-w-4xl mx-auto space-y-12">
                      <div className="space-y-4">
                         <div className="flex items-center gap-3">
                            <div className={`px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border ${currentResult.status === 'streaming' ? 'bg-cyan-500/10 border-cyan-400/30 text-cyan-400' : 'bg-emerald-500/10 border-emerald-400/30 text-emerald-400'}`}>
                               {currentResult.status === 'streaming' ? 'Synthesis in Progress...' : 'Task Complete'}
                            </div>
                         </div>
                         <h1 className="text-4xl md:text-5xl font-black text-white tracking-tighter uppercase leading-tight border-l-4 border-cyan-500 pl-8">{currentResult.query}</h1>
                      </div>

                      {/* Swarm Intelligence Log (HUD overlay style) */}
                      {currentResult.swarmLogs?.length ? (
                        <div className="p-6 rounded-3xl bg-black/60 border border-slate-800/50 font-mono text-[10px] space-y-2 max-h-40 overflow-y-auto custom-scrollbar shadow-inner backdrop-blur-xl">
                           {currentResult.swarmLogs.map((log, i) => (
                              <div key={i} className="flex gap-4 animate-in fade-in slide-in-from-left-2">
                                 <span className="text-cyan-500/60 font-black shrink-0 uppercase tracking-tighter">log_{i}</span>
                                 <span className="text-slate-400 font-medium">{log.split('>')[1] || log}</span>
                              </div>
                           ))}
                        </div>
                      ) : null}

                      {currentResult.answer ? (
                        <div className="p-8 md:p-12 rounded-[3rem] bg-[#070b14]/80 border border-slate-800/60 shadow-2xl backdrop-blur-3xl animate-in fade-in transition-all">
                           <MarkdownContent content={currentResult.answer} />
                        </div>
                      ) : (
                        <div className="py-32 flex flex-col items-center gap-10">
                           <div className="relative">
                              <div className="absolute inset-0 bg-cyan-500/20 blur-3xl rounded-full animate-pulse" />
                              <LoadingSpinner />
                           </div>
                           <div className="space-y-4 text-center">
                              <p className="text-cyan-500 font-black text-[12px] uppercase tracking-[0.5em] animate-pulse">Compiling Proof of Concept</p>
                              {currentResult.swarmLogs?.length ? (
                                <p className="text-slate-500 text-[9px] font-bold uppercase tracking-widest animate-in fade-in">
                                  {currentResult.swarmLogs[currentResult.swarmLogs.length - 1]}
                                </p>
                              ) : (
                                <p className="text-slate-600 text-[9px] font-bold uppercase tracking-widest">Accessing global knowledge clusters...</p>
                              )}
                           </div>
                        </div>
                      )}
                      
                      <div className="pb-40" />
                   </div>
                </div>

                {/* Spatial/Data Enhancement Panel (Right) */}
                {(activeLayout === 'SPATIAL_SPLIT' || activeLayout === 'DATA_FOCUS') && (
                  <div className={`lg:w-1/2 border-l border-slate-800/40 bg-black/20 overflow-hidden flex flex-col transition-all duration-700 animate-in slide-in-from-right-full`}>
                     {activeLayout === 'SPATIAL_SPLIT' ? (
                       <div className="flex-1 flex flex-col">
                          <div className="p-6 border-b border-slate-800/40 bg-black/40 flex items-center justify-between">
                             <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Spatial Intelligence Grid</span>
                             <div className="text-[10px] font-bold text-cyan-400">{currentResult.chunks.filter(c => c.maps).length} Nodes Verified</div>
                          </div>
                          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                             {currentResult.chunks.filter(c => c.maps).map((c, i) => (
                               <div key={i} className="h-80 rounded-[2.5rem] border border-slate-800 overflow-hidden bg-slate-950 relative group shadow-2xl transition-all hover:border-cyan-500/50">
                                  <iframe title={c.maps?.title} width="100%" height="100%" frameBorder="0" src={`https://maps.google.com/maps?q=${encodeURIComponent(c.maps?.title || '')}&t=m&z=15&ie=UTF8&iwloc=&output=embed`} className="grayscale invert contrast-125 opacity-70 group-hover:opacity-100 transition-opacity duration-1000" />
                                  <div className="absolute bottom-4 left-4 p-3 bg-black/90 backdrop-blur-md border border-white/5 rounded-xl text-[9px] font-black uppercase tracking-widest">{c.maps?.title}</div>
                               </div>
                             ))}
                             {currentResult.chunks.filter(c => c.maps).length === 0 && currentResult.status === 'streaming' && (
                               <div className="py-20 flex flex-col items-center gap-6 opacity-40">
                                  <div className="w-12 h-12 rounded-full border border-dashed border-cyan-500 animate-spin-slow flex items-center justify-center">
                                    <div className="w-2 h-2 bg-cyan-500 rounded-full" />
                                  </div>
                                  <p className="text-[9px] font-black uppercase tracking-widest">Scanning Spatial Dimensions...</p>
                               </div>
                             )}
                             {currentResult.chunks.filter(c => c.web).length > 0 && (
                               <div className="space-y-3">
                                  <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest px-2">Web Grounding References</label>
                                  {currentResult.chunks.filter(c => c.web).map((c, i) => (
                                    <a key={i} href={c.web?.uri} target="_blank" rel="noreferrer" className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-cyan-500/30 transition-all group">
                                       <span className="text-[11px] font-bold text-slate-400 group-hover:text-white transition-colors">{c.web?.title}</span>
                                       <ExternalLinkIcon className="w-3.5 h-3.5 text-slate-600 group-hover:text-cyan-400" />
                                    </a>
                                  ))}
                               </div>
                             )}
                          </div>
                       </div>
                     ) : (
                       <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
                          <div className="p-8 rounded-[3rem] bg-black border border-slate-800 shadow-inner">
                             <div className="flex items-center justify-between mb-8 pb-4 border-b border-white/5">
                                <span className="text-[10px] font-black uppercase tracking-widest text-cyan-500">Structured Intelligence Payload</span>
                                <button onClick={() => navigator.clipboard.writeText(JSON.stringify(currentResult.rawJson || {}, null, 2))} className="p-2 hover:bg-cyan-500/10 rounded-lg transition-all"><CopyIcon className="w-4 h-4" /></button>
                             </div>
                             <pre className="text-cyan-400/80 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
                                {JSON.stringify(currentResult.rawJson || { "status": "Analyzing discovered entities..." }, null, 2)}
                             </pre>
                          </div>
                       </div>
                     )}
                  </div>
                )}
             </div>
           )}
        </div>

        {/* Command Nexus (Input) */}
        <div className="absolute bottom-0 left-0 right-0 p-8 md:p-12 bg-gradient-to-t from-[#010409] via-[#010409]/95 to-transparent z-40 pointer-events-none">
           <div className="max-w-4xl mx-auto pointer-events-auto">
              {selectedFile && (
                <div className="flex items-center gap-4 p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-2xl w-fit mb-6 animate-in slide-in-from-bottom-6 backdrop-blur-3xl shadow-xl">
                   <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center border border-white/5 overflow-hidden">
                      {selectedFile.mimeType.startsWith('image/') ? <img src={`data:${selectedFile.mimeType};base64,${selectedFile.data}`} className="w-full h-full object-cover" /> : <DocumentIcon className="w-4 h-4 text-indigo-400" />}
                   </div>
                   <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">{selectedFile.name}</span>
                   <button onClick={() => setSelectedFile(null)} className="p-1.5 hover:bg-red-500/20 rounded-lg text-slate-600 hover:text-red-400 transition-all"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg></button>
                </div>
              )}
              <form onSubmit={handleSearch} className="relative group">
                 <div className="absolute -inset-1.5 bg-gradient-to-r from-cyan-500/20 to-blue-600/20 rounded-[2.5rem] blur-2xl opacity-0 group-focus-within:opacity-100 transition duration-1000" />
                 <div className="relative flex items-center bg-[#0d1117] border border-slate-800 group-focus-within:border-cyan-500/50 rounded-[2.2rem] shadow-2xl p-2 pr-8 transition-all duration-300">
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="w-14 h-14 flex items-center justify-center text-slate-600 hover:text-cyan-400 transition-all shrink-0"><DocumentIcon className="w-6 h-6" /></button>
                    <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if(f) { const reader = new FileReader(); reader.onload=(ev)=>setSelectedFile({ data: (ev.target?.result as string).split(',')[1], mimeType: f.type, name: f.name }); reader.readAsDataURL(f); }}} />
                    <textarea
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch(); } }}
                      rows={1}
                      placeholder={isAutonomous ? "Command the Nexus core..." : "Enter research parameters..."}
                      className="flex-1 bg-transparent border-none focus:ring-0 px-5 py-5 text-white placeholder-slate-800 text-xl font-bold tracking-tight resize-none no-scrollbar min-h-[74px]"
                    />
                    <button type="submit" disabled={!query.trim() && !selectedFile} className={`h-14 px-10 rounded-[1.8rem] font-black transition-all flex items-center gap-4 shrink-0 active:scale-95 ${!query.trim() && !selectedFile ? 'bg-slate-900 text-slate-700 border border-slate-800' : 'bg-white text-black hover:bg-cyan-50 shadow-2xl shadow-white/5'}`}>
                      <span className="hidden sm:inline text-[10px] uppercase tracking-widest">Execute</span>
                      <SearchIcon className="w-6 h-6" />
                    </button>
                 </div>
              </form>
           </div>
        </div>
      </main>
    </div>
  );
};

export default App;
