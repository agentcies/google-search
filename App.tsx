
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
  { id: 'general', label: 'Omni', desc: 'Strategic' },
  { id: 'financial', label: 'Quant', desc: 'Financial' },
  { id: 'technical', label: 'System', desc: 'Technical' },
  { id: 'market', label: 'Market', desc: 'Consumer' },
];

const SentimentBadge = ({ sentiment }: { sentiment?: string }) => {
  if (!sentiment) return null;
  const colors: Record<string, string> = {
    positive: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    negative: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    neutral: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    mixed: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  };
  return (
    <div className={`px-2 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-widest ${colors[sentiment] || colors.neutral}`}>
      {sentiment}
    </div>
  );
};

const SidebarMapItem = ({ chunk }: { chunk: GroundingChunk }) => {
  const data = chunk.maps;
  if (!data) return null;
  return (
    <div className="group bg-[#0d1117] border border-slate-800 rounded-2xl overflow-hidden transition-all hover:border-cyan-500/40 p-1">
      <div className="aspect-[16/10] relative rounded-xl overflow-hidden bg-slate-950">
        <iframe
          title={data.title}
          width="100%"
          height="100%"
          frameBorder="0"
          src={`https://maps.google.com/maps?q=${encodeURIComponent(data.title)}&t=m&z=15&ie=UTF8&iwloc=&output=embed`}
          className="grayscale invert opacity-60 contrast-125 group-hover:opacity-100 transition-opacity duration-500"
        />
        <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-white/5 rounded-xl" />
      </div>
      <div className="p-3 flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold text-slate-300 truncate">{data.title}</div>
        <a href={data.uri} target="_blank" rel="noreferrer" className="shrink-0 p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-cyan-400 transition-all">
          <ExternalLinkIcon className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [state, setState] = useState<SearchState>({ activeNodeIds: [], history: [], tasks: [], error: null });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [persona, setPersona] = useState<'general' | 'financial' | 'technical' | 'market'>('general');
  const [deepSearch, setDeepSearch] = useState(true);
  const [useMaps, setUseMaps] = useState(false);
  const [viewMode, setViewMode] = useState<'report' | 'map' | 'api'>('report');
  const [selectedFile, setSelectedFile] = useState<FileContext | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('omni_v9');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setState(s => ({ ...s, history: data.history || [], tasks: data.tasks || [] }));
        if (data.history?.length) setSelectedId(data.history[0].id);
      } catch {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('omni_v9', JSON.stringify({ history: state.history.slice(0, 30), tasks: state.tasks }));
  }, [state.history, state.tasks]);

  const parseOutput = (text: string) => {
    const logs: string[] = [];
    let report = "";
    let rawJson = null;
    let inDataBoundary = false;
    const lines = text.split('\n');

    for (const line of lines) {
      if (line.includes('[DATA_BOUNDARY]')) {
        inDataBoundary = true;
        continue;
      }
      if (inDataBoundary) {
        try { rawJson = JSON.parse(line.trim()); } catch {}
        continue;
      }
      if (line.includes('[SWARM_LOG]')) {
        logs.push(line.replace('[SWARM_LOG]', '').trim());
      } else {
        report += line + '\n';
      }
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
      const stream = geminiService.searchStream(activeQuery || "Analyze this request.", { 
        model: 'gemini-3-flash-preview', deepSearch, useMaps, persona 
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
    <div className="flex h-screen bg-[#020617] text-slate-100 selection:bg-cyan-500/30 overflow-hidden font-sans">
      
      {/* Sidebar - Persistent History */}
      <aside className={`fixed lg:static inset-y-0 left-0 w-72 bg-[#070b14]/95 border-r border-slate-800 z-50 transition-transform duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <SearchIcon className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-xs font-black uppercase tracking-widest text-white">OmniSwarm</h2>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2 text-slate-500 hover:text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-4 overflow-y-auto h-[calc(100vh-80px)] space-y-8 custom-scrollbar">
          <button onClick={() => { setSelectedId(null); setIsSidebarOpen(false); }} className="w-full py-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-black uppercase tracking-widest hover:bg-cyan-500/20 transition-all">
            + Ignite New Node
          </button>

          <div className="space-y-4">
            <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest px-2">History</label>
            <div className="space-y-1">
              {state.history.map(h => (
                <button key={h.id} onClick={() => { setSelectedId(h.id); setIsSidebarOpen(false); }} className={`w-full text-left p-3.5 rounded-xl transition-all flex items-center gap-3 group border ${selectedId === h.id ? 'bg-slate-800/80 border-slate-700 shadow-xl' : 'bg-transparent border-transparent hover:bg-slate-800/20'}`}>
                  <div className={`w-1 h-1 rounded-full ${h.status === 'streaming' ? 'bg-cyan-500 animate-pulse' : 'bg-slate-700'}`} />
                  <span className={`text-[11px] font-bold truncate flex-1 ${selectedId === h.id ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'}`}>{h.query}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Terminal Interface */}
      <main className="flex-1 flex flex-col relative bg-[radial-gradient(circle_at_50%_0%,_#0f172a_0%,_transparent_60%)]">
        
        {/* Navigation / Controls */}
        <header className="h-16 border-b border-slate-800/50 flex items-center justify-between px-6 backdrop-blur-3xl sticky top-0 z-40">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-2 text-slate-400"><SearchIcon className="w-5 h-5" /></button>
            <div className="flex bg-black/40 p-1 rounded-lg border border-slate-800">
              {personas.map(p => (
                <button key={p.id} onClick={() => setPersona(p.id as any)} className={`px-4 py-1.5 rounded-md text-[10px] font-black uppercase transition-all ${persona === p.id ? 'bg-slate-800 text-cyan-400' : 'text-slate-600 hover:text-slate-300'}`}>{p.label}</button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
             <div className="flex bg-black/40 p-1 rounded-lg border border-slate-800">
                {(['report', 'map', 'api'] as const).map(mode => (
                  <button key={mode} onClick={() => setViewMode(mode)} className={`px-4 py-1.5 rounded-md text-[10px] font-black uppercase transition-all ${viewMode === mode ? 'bg-slate-800 text-cyan-400' : 'text-slate-600 hover:text-slate-300'}`}>{mode}</button>
                ))}
             </div>
             <button onClick={() => setUseMaps(!useMaps)} className={`px-4 py-1.5 rounded-lg border text-[10px] font-black uppercase transition-all flex items-center gap-2 ${useMaps ? 'bg-blue-500/10 border-blue-500/40 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.1)]' : 'bg-slate-900 border-slate-800 text-slate-600'}`}>
               <MapPinIcon className="w-3.5 h-3.5" /> Maps
             </button>
          </div>
        </header>

        {/* Dynamic Workspace */}
        <div className="flex-1 overflow-y-auto px-6 md:px-12 lg:px-24 py-12 custom-scrollbar space-y-12">
          {!currentResult ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto space-y-10 animate-in fade-in duration-1000">
              <div className="w-20 h-20 rounded-3xl bg-slate-900/50 border border-slate-800 flex items-center justify-center shadow-2xl relative">
                <div className="absolute inset-0 bg-cyan-500/10 blur-3xl animate-pulse" />
                <SearchIcon className="w-10 h-10 text-cyan-500 relative z-10" />
              </div>
              <div className="space-y-4">
                <h2 className="text-4xl md:text-5xl font-black text-white uppercase tracking-tighter">OMNISWARM ENGINE</h2>
                <p className="text-slate-500 text-lg">Hyper-specialized research cluster. Enter mission parameters to ignite sub-agent parallel processing.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                {["Latest AI investment trends in EU", "Detailed hardware specs of PS5 Pro", "Research top fine-dining SF", "Synthesize data on EV battery recycling"].map(s => (
                  <button key={s} onClick={() => { setQuery(s); handleSearch(); }} className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 hover:border-cyan-500/30 transition-all text-left text-xs font-bold text-slate-500 hover:text-white flex items-center gap-3">
                    <span className="text-cyan-500">→</span> {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-6xl mx-auto space-y-12 pb-48">
              
              <div className="flex flex-col gap-6 pt-4">
                 <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                       <div className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-2 border ${currentResult.status === 'streaming' ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
                         <div className={`w-1.5 h-1.5 rounded-full ${currentResult.status === 'streaming' ? 'bg-cyan-400 animate-pulse' : 'bg-emerald-400'}`} />
                         {currentResult.status === 'streaming' ? 'Swarm Working' : 'Complete'}
                       </div>
                       <SentimentBadge sentiment={currentResult.sentiment} />
                    </div>
                    <button onClick={() => currentResult.answer && navigator.clipboard.writeText(currentResult.answer)} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-500 hover:text-white transition-all"><CopyIcon className="w-4 h-4" /></button>
                 </div>
                 <h1 className="text-3xl md:text-5xl font-black text-white tracking-tight uppercase leading-[1.1]">{currentResult.query}</h1>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
                 
                 <div className="lg:col-span-8 space-y-10">
                    
                    {/* Swarm Console */}
                    {(currentResult.swarmLogs?.length || 0) > 0 && (
                      <div className="space-y-3">
                        <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest flex items-center gap-2">
                           <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse" /> Orchestration Log
                        </label>
                        <div className="p-5 rounded-2xl bg-black/60 border border-slate-800/50 font-mono text-[10px] space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar shadow-inner">
                          {currentResult.swarmLogs?.map((log, i) => (
                            <div key={i} className="flex gap-3 animate-in fade-in slide-in-from-left-2 duration-300">
                              <span className="text-cyan-500 font-bold shrink-0">{log.split('>')[0]}</span>
                              <span className="text-slate-400">{log.split('>')[1] || log}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Mission Control Board */}
                    {currentTasks.length > 0 && (
                      <div className="space-y-3">
                        <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Mission Status</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                           {currentTasks.map(t => (
                             <div key={t.id} className={`p-4 rounded-xl border transition-all flex items-center gap-4 ${t.status === 'completed' ? 'bg-emerald-500/5 border-emerald-500/20 opacity-60' : 'bg-[#0d1117] border-slate-800'}`}>
                               <div className={`w-1.5 h-1.5 rounded-full ${t.status === 'completed' ? 'bg-emerald-500' : t.status === 'in_progress' ? 'bg-cyan-500 animate-pulse' : 'bg-slate-700'}`} />
                               <span className="text-[11px] font-bold text-slate-300">{t.description}</span>
                             </div>
                           ))}
                        </div>
                      </div>
                    )}

                    {/* Main Display Area */}
                    <div className="relative min-h-[400px]">
                       {viewMode === 'report' ? (
                         <div className="animate-in fade-in duration-700">
                            {currentResult.answer ? (
                              <div className="p-1 rounded-[2.5rem] bg-gradient-to-b from-slate-800 to-transparent">
                                <div className="p-8 md:p-12 rounded-[2.4rem] bg-[#070b14] backdrop-blur-3xl relative overflow-hidden">
                                  <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none"><SearchIcon className="w-40 h-40" /></div>
                                  <MarkdownContent content={currentResult.answer} />
                                </div>
                              </div>
                            ) : (
                              <div className="py-32 flex flex-col items-center justify-center space-y-6">
                                <LoadingSpinner />
                                <p className="text-cyan-500 font-black text-[10px] uppercase tracking-[0.4em] animate-pulse">Aggregating Swarm Insights...</p>
                              </div>
                            )}
                         </div>
                       ) : viewMode === 'api' ? (
                         <pre className="p-8 rounded-[2.5rem] bg-black border border-slate-800 text-cyan-400/80 font-mono text-xs overflow-x-auto leading-relaxed">
                            {JSON.stringify(currentResult.rawJson || { status: "Generating final extraction..." }, null, 2)}
                         </pre>
                       ) : (
                         <div className="grid grid-cols-1 gap-6">
                            {currentResult.chunks.filter(c => c.maps).map((c, i) => (
                              <div key={i} className="h-[450px] rounded-[2.5rem] border border-slate-800 overflow-hidden bg-slate-950 shadow-2xl">
                                 <iframe
                                  title={c.maps?.title}
                                  width="100%"
                                  height="100%"
                                  frameBorder="0"
                                  src={`https://maps.google.com/maps?q=${encodeURIComponent(c.maps?.title || '')}&t=m&z=17&ie=UTF8&iwloc=&output=embed`}
                                  className="grayscale invert contrast-110 opacity-70 hover:opacity-100 transition-opacity duration-700"
                                />
                              </div>
                            ))}
                         </div>
                       )}
                    </div>
                 </div>

                 {/* Evidence / Grounding Panel */}
                 <div className="lg:col-span-4 space-y-8 sticky top-24">
                    <div className="p-7 rounded-[2.2rem] bg-[#0d1117] border border-slate-800 shadow-2xl space-y-8">
                       <div className="flex items-center justify-between">
                         <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Grounding Nodes</label>
                         <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 text-[9px] font-bold">{currentResult.chunks.length} Detected</span>
                       </div>
                       
                       <div className="space-y-4 max-h-[550px] overflow-y-auto custom-scrollbar pr-1">
                          {currentResult.chunks.map((chunk, i) => {
                            if (chunk.maps) return <SidebarMapItem key={i} chunk={chunk} />;
                            const data = chunk.web;
                            if (!data) return null;
                            return (
                              <a key={i} href={data.uri} target="_blank" rel="noreferrer" className="block p-4 rounded-xl border border-slate-800/50 hover:border-cyan-500/30 bg-black/40 group transition-all animate-in slide-in-from-bottom-2 duration-500">
                                <div className="flex items-center gap-2 mb-2 opacity-50 text-[8px] font-black uppercase tracking-widest group-hover:text-cyan-400">
                                  <ExternalLinkIcon className="w-3 h-3" /> Web Source
                                </div>
                                <div className="text-[11px] font-bold text-slate-300 line-clamp-2 leading-tight group-hover:text-white transition-colors">{data.title}</div>
                              </a>
                            );
                          })}
                          {currentResult.chunks.length === 0 && (
                            <div className="py-24 text-center space-y-5 opacity-30">
                               <div className="w-10 h-10 rounded-full border border-dashed border-slate-800 flex items-center justify-center mx-auto animate-spin-slow">
                                  <div className="w-1.5 h-1.5 bg-slate-500 rounded-full" />
                               </div>
                               <p className="text-[9px] font-black uppercase tracking-[0.3em]">Intercepting Data...</p>
                            </div>
                          )}
                       </div>
                    </div>
                 </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} className="h-64" />
        </div>

        {/* Console / Command Bar */}
        <div className="absolute bottom-0 left-0 right-0 p-8 md:p-12 bg-gradient-to-t from-[#020617] via-[#020617]/90 to-transparent pointer-events-none">
           <div className="max-w-4xl mx-auto pointer-events-auto">
              {selectedFile && (
                <div className="flex items-center gap-3 p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-2xl w-fit mb-5 animate-in slide-in-from-bottom-6 backdrop-blur-xl shadow-2xl">
                   <div className="w-11 h-11 rounded-lg bg-black flex items-center justify-center border border-white/5 overflow-hidden">
                      {selectedFile.mimeType.startsWith('image/') ? <img src={`data:${selectedFile.mimeType};base64,${selectedFile.data}`} className="w-full h-full object-cover" /> : <DocumentIcon className="w-5 h-5 text-indigo-400" />}
                   </div>
                   <div className="text-[10px] font-bold text-cyan-400 pr-5 truncate max-w-[140px]">{selectedFile.name}</div>
                   <button onClick={() => setSelectedFile(null)} className="p-2 hover:bg-red-500/20 rounded-lg text-slate-500 hover:text-red-400 transition-all">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                   </button>
                </div>
              )}

              <form onSubmit={handleSearch} className="relative group">
                 <div className="absolute -inset-1.5 bg-gradient-to-r from-cyan-500/20 to-indigo-600/20 rounded-[2.5rem] blur-2xl opacity-0 group-focus-within:opacity-100 transition duration-1000" />
                 <div className="relative flex items-center bg-[#0d1117] border border-slate-800 group-focus-within:border-cyan-500/40 rounded-[2.2rem] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.8)] p-2 pr-6 transition-all duration-300">
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="w-14 h-14 flex items-center justify-center text-slate-600 hover:text-cyan-400 transition-all shrink-0">
                      <DocumentIcon className="w-6 h-6" />
                    </button>
                    <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if(f) { const reader = new FileReader(); reader.onload=(ev)=>setSelectedFile({ data: (ev.target?.result as string).split(',')[1], mimeType: f.type, name: f.name }); reader.readAsDataURL(f); }}} />
                    <textarea
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch(); } }}
                      rows={1}
                      placeholder={selectedId ? "Request further analysis or refinements..." : "Execute deep research mission..."}
                      className="flex-1 bg-transparent border-none focus:ring-0 px-5 py-5 text-white placeholder-slate-700 text-lg font-bold tracking-tight resize-none no-scrollbar h-full min-h-[64px]"
                    />
                    <button type="submit" disabled={!query.trim() && !selectedFile} className={`h-12 px-8 rounded-2xl font-black transition-all flex items-center gap-3 shrink-0 active:scale-95 ${!query.trim() && !selectedFile ? 'bg-slate-800 text-slate-600' : 'bg-white text-black hover:bg-cyan-50 shadow-2xl'}`}>
                      <span className="hidden sm:inline text-[11px] uppercase tracking-widest">Ignite Swarm</span>
                      <SearchIcon className="w-5 h-5" />
                    </button>
                 </div>
              </form>
              <div className="mt-8 flex justify-center items-center gap-8 opacity-20 pointer-events-none">
                 <p className="text-[9px] font-black uppercase tracking-[0.4em] text-slate-400">Precision Swarm Kernel v8.5</p>
                 <div className="w-1.5 h-1.5 bg-slate-400 rounded-full" />
                 <p className="text-[9px] font-black uppercase tracking-[0.4em] text-slate-400">Grounded Logic Mode</p>
              </div>
           </div>
        </div>
      </main>
    </div>
  );
};

export default App;
