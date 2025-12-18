
import React, { useState, useEffect, useRef } from 'react';
import { geminiService } from './services/geminiService';
import { SearchResult, SearchState, FileContext } from './types';
import { 
  SearchIcon, 
  HistoryIcon, 
  ExternalLinkIcon, 
  CopyIcon, 
  LoadingSpinner,
  PhotoIcon,
  DocumentIcon,
  CodeIcon,
  MapPinIcon
} from './components/Icons';
import MarkdownContent from './components/MarkdownContent';

interface DiagnosticError {
  message: string;
  code: string;
  timestamp: number;
}

const App: React.FC = () => {
  const [state, setState] = useState<SearchState>({
    isSearching: false,
    currentResult: null,
    history: [],
    error: null,
  });
  const [diagnostic, setDiagnostic] = useState<DiagnosticError | null>(null);
  const [query, setQuery] = useState('');
  const [modelType, setModelType] = useState<'gemini-3-flash-preview' | 'gemini-3-pro-preview'>('gemini-3-flash-preview');
  const [deepSearch, setDeepSearch] = useState(true);
  const [useMaps, setUseMaps] = useState(false);
  const [viewMode, setViewMode] = useState<'report' | 'api'>('report');
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | undefined>();
  const [selectedFile, setSelectedFile] = useState<FileContext | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lastRequest, setLastRequest] = useState<{ query: string, file: FileContext | null, useMaps: boolean } | null>(null);
  
  // Agent States
  const [agentStatus, setAgentStatus] = useState({
    architect: 'idle',
    researcher: 'idle',
    analyst: 'idle',
    auditor: 'idle'
  });

  const resultsEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => console.warn("Geo-grounding offline.")
      );
    }
    
    const savedHistory = localStorage.getItem('omniSearch_v4');
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        setState(prev => ({ ...prev, history: parsed }));
      } catch (e) {
        console.error("Recovery failed.");
      }
    }
  }, []);

  useEffect(() => {
    if (state.history.length > 0) {
      localStorage.setItem('omniSearch_v4', JSON.stringify(state.history.slice(0, 30)));
    }
  }, [state.history]);

  const scrollToBottom = () => {
    resultsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const copyToClipboard = (text: any) => {
    const stringToCopy = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
    navigator.clipboard.writeText(stringToCopy).catch(err => console.error('Copy failed: ', err));
  };

  const processFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64String = event.target?.result as string;
      setSelectedFile({
        data: base64String.split(',')[1],
        mimeType: file.type,
        name: file.name
      });
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1 || items[i].type === 'application/pdf') {
        const file = items[i].getAsFile();
        if (file) processFile(file);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const parseOrchestration = (text: string) => {
    const status = { ...agentStatus };
    if (text.includes('[ARCHITECT]')) status.architect = 'active';
    if (text.includes('[RESEARCHER]')) {
      status.architect = 'complete';
      status.researcher = 'active';
    }
    if (text.includes('[ANALYST]')) {
      status.researcher = 'complete';
      status.analyst = 'active';
    }
    if (text.includes('[AUDITOR]')) {
      status.analyst = 'complete';
      status.auditor = 'active';
    }
    if (text.includes('[DATA_BOUNDARY]')) {
      status.auditor = 'complete';
    }
    setAgentStatus(status);

    let cleanReport = text;
    let apiData = null;

    if (text.includes('[DATA_BOUNDARY]')) {
      const parts = text.split('[DATA_BOUNDARY]');
      cleanReport = parts[0];
      try {
        const jsonMatch = parts[1].match(/\{[\s\S]*\}/);
        if (jsonMatch) apiData = JSON.parse(jsonMatch[0]);
      } catch (e) {}
    }

    cleanReport = cleanReport.replace(/\[ARCHITECT\]|\[RESEARCHER\]|\[ANALYST\]|\[AUDITOR\]/g, '');

    return { report: cleanReport, api: apiData };
  };

  const handleSearch = async (e?: React.FormEvent, customQuery?: string, customFile?: FileContext | null) => {
    const activeQuery = customQuery || query;
    const filePayload = customFile !== undefined ? customFile : selectedFile;
    if (!activeQuery.trim() && !filePayload) return;
    if (e) e.preventDefault();

    setAgentStatus({ architect: 'active', researcher: 'idle', analyst: 'idle', auditor: 'idle' });
    setDiagnostic(null);
    
    const searchId = Math.random().toString(36).substring(7);
    const initialResult: SearchResult = {
      id: searchId,
      query: activeQuery || (filePayload ? `Analysis of ${filePayload.name}` : "Multimodal Extraction"),
      answer: '',
      chunks: [],
      timestamp: Date.now(),
      fileContext: filePayload || undefined
    };

    setState(prev => ({ ...prev, isSearching: true, error: null, currentResult: initialResult }));
    setQuery('');
    setLastRequest({ query: activeQuery, file: filePayload, useMaps });
    setSelectedFile(null);

    try {
      const stream = geminiService.searchStream(activeQuery || "Extract all data and synthesize key findings from the provided document.", {
        model: modelType,
        deepSearch,
        useMaps,
        location,
        fileContext: filePayload || undefined
      });
      
      for await (const update of stream) {
        const { report, api } = parseOrchestration(update.text);
        setState(prev => {
          const updatedResult = {
            ...initialResult,
            answer: report,
            rawJson: api,
            chunks: update.chunks
          };
          
          return {
            ...prev,
            currentResult: updatedResult,
            history: update.isComplete 
              ? [updatedResult, ...prev.history.filter(h => h.id !== searchId)] 
              : prev.history
          };
        });
        scrollToBottom();
      }

      setState(prev => ({ ...prev, isSearching: false }));
    } catch (err: any) {
      setState(prev => ({ ...prev, isSearching: false, error: err.message || "Neural swarm failed." }));
      setDiagnostic({ message: err.originalError || err.message, code: err.code || "SWARM_ERROR", timestamp: Date.now() });
    }
  };

  const handleRetry = () => {
    if (lastRequest) handleSearch(undefined, lastRequest.query, lastRequest.file);
  };

  const isImage = (mimeType?: string) => mimeType?.startsWith('image/');

  return (
    <div 
      className="flex h-screen overflow-hidden bg-[#020617] text-slate-100 font-sans selection:bg-cyan-500/30"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-[100] bg-cyan-500/10 backdrop-blur-md border-4 border-dashed border-cyan-500 flex items-center justify-center pointer-events-none">
          <div className="text-center space-y-4">
            <DocumentIcon className="w-24 h-24 text-cyan-400 mx-auto animate-bounce" />
            <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Drop file for agentic analysis</h2>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className="hidden lg:flex flex-col w-80 border-r border-slate-800 bg-[#070b14]/80 backdrop-blur-2xl z-30 shadow-[10px_0_30px_rgba(0,0,0,0.5)]">
        <div className="p-8 border-b border-slate-800 space-y-6">
          <div className="flex items-center gap-4 group cursor-pointer" onClick={() => window.location.reload()}>
            <div className="relative">
              <div className="absolute -inset-2 bg-cyan-500/20 rounded-xl blur-lg group-hover:bg-cyan-500/40 transition-all"></div>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-600 flex items-center justify-center shadow-2xl relative border border-white/10">
                <SearchIcon className="w-7 h-7 text-white" />
              </div>
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter uppercase text-white">OmniSearch</h1>
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${state.isSearching ? 'bg-cyan-500' : 'bg-green-500'}`}></div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{state.isSearching ? 'Engaged' : 'Online'}</span>
              </div>
            </div>
          </div>

          <div className="space-y-3">
             <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em] px-1">Interface Mode</label>
             <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={() => setViewMode('report')}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all border ${viewMode === 'report' ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-400' : 'bg-slate-800/40 border-slate-700 text-slate-500'}`}
                >
                  Report
                </button>
                <button 
                  onClick={() => setViewMode('api')}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all border ${viewMode === 'api' ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-400' : 'bg-slate-800/40 border-slate-700 text-slate-500'}`}
                >
                  API JSON
                </button>
             </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
          {state.isSearching && (
            <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-500">
              <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em] px-1 flex items-center justify-between">
                Active Swarm
                <span className="w-10 h-[1px] bg-slate-800"></span>
              </label>
              <div className="space-y-3">
                {[
                  { id: 'architect', name: 'Architect', desc: 'Strategy Formation' },
                  { id: 'researcher', name: 'Researcher', desc: 'Neural Grounding' },
                  { id: 'analyst', name: 'Analyst', desc: 'Data Synthesis' },
                  { id: 'auditor', name: 'Auditor', desc: 'JSON Finalization' }
                ].map(agent => (
                  <div key={agent.id} className={`flex items-center gap-3 p-3 rounded-2xl border transition-all ${agentStatus[agent.id as keyof typeof agentStatus] === 'active' ? 'bg-cyan-500/5 border-cyan-500/30' : 'bg-slate-900/40 border-slate-800 opacity-40'}`}>
                    <div className={`w-2 h-2 rounded-full ${agentStatus[agent.id as keyof typeof agentStatus] === 'active' ? 'bg-cyan-500 animate-ping' : agentStatus[agent.id as keyof typeof agentStatus] === 'complete' ? 'bg-green-500' : 'bg-slate-700'}`}></div>
                    <div>
                      <div className="text-[11px] font-black text-slate-200 uppercase">{agent.name}</div>
                      <div className="text-[9px] text-slate-500 font-medium">{agentStatus[agent.id as keyof typeof agentStatus] === 'active' ? agent.desc : 'Standby'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
             <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em] px-1">Synthesis History</label>
             <div className="space-y-2">
                {state.history.map(item => (
                  <button 
                    key={item.id}
                    onClick={() => setState(prev => ({ ...prev, currentResult: item, error: null }))}
                    className={`w-full text-left p-4 rounded-2xl transition-all border group overflow-hidden ${state.currentResult?.id === item.id ? 'bg-cyan-500/5 border-cyan-500/20' : 'bg-transparent border-transparent hover:bg-slate-800/30'}`}
                  >
                    <div className="flex items-center gap-3">
                      {item.fileContext ? (
                        isImage(item.fileContext.mimeType) ? <PhotoIcon className="w-3 h-3 text-cyan-400" /> : <DocumentIcon className="w-3 h-3 text-indigo-400" />
                      ) : <SearchIcon className="w-3 h-3 text-slate-600" />}
                      <span className={`text-[11px] font-bold truncate flex-1 ${state.currentResult?.id === item.id ? 'text-cyan-400' : 'text-slate-400 group-hover:text-slate-200'}`}>{item.query}</span>
                    </div>
                  </button>
                ))}
             </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden bg-[radial-gradient(circle_at_50%_0%,_rgba(6,182,212,0.03),_transparent_70%)]">
        <header className="sticky top-0 z-40 bg-[#020617]/50 backdrop-blur-xl border-b border-slate-800 px-8 py-4 flex items-center justify-between">
           <div className="flex items-center gap-4">
             <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800">
                <button onClick={() => setModelType('gemini-3-flash-preview')} className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${modelType === 'gemini-3-flash-preview' ? 'bg-slate-800 text-cyan-400' : 'text-slate-500'}`}>Flash</button>
                <button onClick={() => setModelType('gemini-3-pro-preview')} className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${modelType === 'gemini-3-pro-preview' ? 'bg-slate-800 text-cyan-400' : 'text-slate-500'}`}>Pro</button>
             </div>
             <button onClick={() => setDeepSearch(!deepSearch)} className={`px-4 py-1.5 rounded-xl border text-[10px] font-black uppercase transition-all flex items-center gap-2 ${deepSearch ? 'border-green-500/30 text-green-400 bg-green-500/5' : 'border-slate-700 text-slate-500'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${deepSearch ? 'bg-green-500 animate-pulse' : 'bg-slate-600'}`}></div>
                Swarm Strength
             </button>
             <button onClick={() => setUseMaps(!useMaps)} className={`px-4 py-1.5 rounded-xl border text-[10px] font-black uppercase transition-all flex items-center gap-2 ${useMaps ? 'border-blue-500/30 text-blue-400 bg-blue-500/5' : 'border-slate-700 text-slate-500'}`}>
                <MapPinIcon className={`w-3.5 h-3.5 ${useMaps ? 'text-blue-400' : 'text-slate-600'}`} />
                Maps Grounding
             </button>
           </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 md:px-16 lg:px-24 py-12 custom-scrollbar scroll-smooth">
          {state.error && (
            <div className="max-w-3xl mx-auto mb-12 animate-in slide-in-from-top-4 duration-500">
              <div className="relative bg-[#0b0e14] border border-red-500/30 rounded-[2.5rem] p-8 md:p-12 shadow-2xl">
                <div className="flex flex-col md:flex-row items-center gap-8">
                  <div className="w-20 h-20 rounded-3xl bg-red-500/10 flex items-center justify-center border border-red-500/20 shrink-0">
                    <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  </div>
                  <div className="flex-1 space-y-4">
                    <h3 className="text-2xl font-black text-white uppercase tracking-tight">System Outage</h3>
                    <p className="text-slate-400">{state.error}</p>
                    {diagnostic && <div className="p-4 bg-black/40 rounded-2xl border border-slate-800 font-mono text-[9px] text-slate-500">{diagnostic.message}</div>}
                  </div>
                  <button onClick={handleRetry} className="px-8 py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-2xl text-xs font-black text-red-400 transition-all uppercase">Retry</button>
                </div>
              </div>
            </div>
          )}

          {!state.currentResult && !state.isSearching && !state.error && (
            <div className="max-w-4xl mx-auto h-full flex flex-col items-center justify-center text-center space-y-12">
               <div className="relative group">
                  <div className="absolute -inset-10 bg-cyan-500/10 rounded-full blur-3xl animate-pulse"></div>
                  <div className="w-24 h-24 rounded-[2.5rem] bg-slate-900 border border-slate-800 flex items-center justify-center shadow-2xl relative z-10">
                     <SearchIcon className="w-12 h-12 text-cyan-500" />
                  </div>
               </div>
               <div className="space-y-6 relative z-10">
                  <h2 className="text-5xl md:text-7xl font-black text-white tracking-tighter leading-none uppercase">Agentic <span className="text-cyan-500">Multimodal</span></h2>
                  <p className="text-slate-500 text-xl font-medium max-w-2xl mx-auto">Upload documents or images for deep agentic analysis and real-time grounding.</p>
               </div>
            </div>
          )}

          {state.currentResult && !state.error && (
            <div className="max-w-5xl mx-auto space-y-12 pb-48">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 border-b border-slate-800 pb-12">
                 <div className="space-y-6 flex-1">
                    <div className="flex flex-wrap gap-2">
                       <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.2em] border ${modelType === 'gemini-3-pro-preview' ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'}`}>{modelType === 'gemini-3-pro-preview' ? 'Quantum Pro' : 'Neural Flash'}</span>
                       {state.currentResult.fileContext && (
                         <span className={`px-3 py-1 rounded-full ${isImage(state.currentResult.fileContext.mimeType) ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'} text-[9px] font-black uppercase tracking-[0.2em]`}>
                           {isImage(state.currentResult.fileContext.mimeType) ? 'Visual Data' : 'Document Context'}
                         </span>
                       )}
                    </div>
                    <h1 className="text-4xl md:text-6xl font-black text-white tracking-tight leading-[1.1]">{state.currentResult.query}</h1>
                 </div>
                 {state.currentResult.fileContext && (
                    <div className="relative group p-1 bg-gradient-to-br from-cyan-500 to-indigo-600 rounded-3xl shrink-0">
                       {isImage(state.currentResult.fileContext.mimeType) ? (
                         <img src={`data:${state.currentResult.fileContext.mimeType};base64,${state.currentResult.fileContext.data}`} className="w-40 h-40 object-cover rounded-[1.4rem]" alt="Visual Context" />
                       ) : (
                         <div className="w-40 h-40 bg-slate-900 rounded-[1.4rem] flex flex-col items-center justify-center p-4 text-center">
                            <DocumentIcon className="w-12 h-12 text-indigo-500 mb-2" />
                            <span className="text-[9px] font-black text-slate-400 uppercase truncate w-full">{state.currentResult.fileContext.name || 'Document'}</span>
                         </div>
                       )}
                    </div>
                 )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                 <div className="lg:col-span-3 space-y-8">
                    <div className="relative bg-[#0b101b]/80 border border-slate-800/80 rounded-[3rem] p-10 md:p-16 shadow-2xl backdrop-blur-xl">
                       <div className="flex items-center justify-between mb-12">
                          <div className="flex gap-4">
                             <button onClick={() => setViewMode('report')} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${viewMode === 'report' ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20' : 'bg-slate-900 text-slate-500'}`}>Report</button>
                             <button onClick={() => setViewMode('api')} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${viewMode === 'api' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'bg-slate-900 text-slate-500'}`}>API JSON</button>
                          </div>
                          <div className="text-[9px] font-bold text-slate-600 font-mono">ID: {state.currentResult.id}</div>
                       </div>

                       {viewMode === 'report' ? (
                         <div className="animate-in fade-in duration-1000">
                            {state.currentResult.answer ? <MarkdownContent content={state.currentResult.answer} /> : <div className="py-20 flex flex-col items-center gap-8"><LoadingSpinner /><p className="text-cyan-400 font-black text-xs uppercase tracking-widest animate-pulse">Running Neural Swarm...</p></div>}
                         </div>
                       ) : (
                         <div className="animate-in slide-in-from-bottom-4">
                            {state.currentResult.rawJson ? (
                               <pre className="p-8 bg-black/60 rounded-[2rem] border border-slate-800 text-cyan-300/90 text-xs font-mono overflow-x-auto custom-scrollbar leading-relaxed">
                                  {JSON.stringify(state.currentResult.rawJson, null, 2)}
                               </pre>
                            ) : <div className="py-32 text-center text-slate-600 text-xs font-black uppercase tracking-widest">Awaiting synthesis...</div>}
                         </div>
                       )}
                    </div>
                 </div>

                 <div className="space-y-6">
                    <div className="p-6 bg-[#0b101b] border border-slate-800 rounded-3xl space-y-6">
                       <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em] flex items-center justify-between">Verified Chunks <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse"></div></label>
                       <div className="space-y-3">
                          {state.currentResult.chunks.length > 0 ? state.currentResult.chunks.map((chunk, i) => {
                            const data = chunk.web || chunk.maps;
                            if (!data) return null;
                            const isMap = !!chunk.maps;
                            return (
                             <a key={i} href={data.uri} target="_blank" rel="noreferrer" className="block p-3 rounded-xl bg-slate-900/50 border border-slate-800 hover:border-cyan-500/30 transition-all group">
                                <div className="flex items-center gap-2 mb-1">
                                   {isMap ? <MapPinIcon className="w-2.5 h-2.5 text-blue-500" /> : <ExternalLinkIcon className="w-2.5 h-2.5 text-cyan-500" />}
                                   <span className="text-[8px] font-black text-slate-600 uppercase">{isMap ? 'Map Source' : 'External Source'}</span>
                                </div>
                                <div className="text-[10px] font-bold text-slate-300 group-hover:text-white truncate">{data.title}</div>
                             </a>
                            );
                          }) : <div className="text-[10px] text-slate-700 italic px-2">Searching live web...</div>}
                       </div>
                    </div>
                 </div>
              </div>
            </div>
          )}
          
          <div ref={resultsEndRef} className="h-40" />
        </div>

        {/* Command Input Area */}
        <div className="absolute bottom-0 left-0 right-0 p-8 md:p-12 bg-gradient-to-t from-[#020617] via-[#020617]/95 to-transparent z-50">
           <div className="max-w-4xl mx-auto space-y-6">
              {selectedFile && (
                <div className={`flex items-center gap-4 p-3 ${isImage(selectedFile.mimeType) ? 'bg-cyan-500/10 border-cyan-500/20' : 'bg-indigo-500/10 border-indigo-500/20'} border rounded-2xl w-fit animate-in zoom-in duration-300`}>
                   {isImage(selectedFile.mimeType) ? (
                     <img src={`data:${selectedFile.mimeType};base64,${selectedFile.data}`} className="w-12 h-12 rounded-xl object-cover border border-white/10" alt="Buffer" />
                   ) : (
                     <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center">
                        <DocumentIcon className="w-6 h-6 text-indigo-500" />
                     </div>
                   )}
                   <div>
                      <div className={`text-[10px] font-black ${isImage(selectedFile.mimeType) ? 'text-cyan-400' : 'text-indigo-400'} uppercase tracking-widest`}>
                        {isImage(selectedFile.mimeType) ? 'Visual Guard Active' : 'Document Guard Active'}
                      </div>
                      <div className="text-[8px] text-slate-500 uppercase font-bold truncate max-w-[200px]">{selectedFile.name}</div>
                   </div>
                   <button onClick={() => setSelectedFile(null)} className="ml-4 p-1.5 hover:bg-red-500/20 rounded-lg text-slate-500 hover:text-red-400 transition-all">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                   </button>
                </div>
              )}

              <form onSubmit={handleSearch} className="relative group">
                 <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 to-indigo-600 rounded-[2.5rem] blur opacity-10 group-focus-within:opacity-40 transition duration-500"></div>
                 <div className="relative flex items-center bg-[#0d131f] border border-slate-800 group-focus-within:border-cyan-500/50 rounded-[2.5rem] shadow-2xl transition-all p-2 pr-4">
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="w-14 h-14 flex items-center justify-center text-slate-600 hover:text-cyan-400 transition-colors">
                      <DocumentIcon className="w-7 h-7" />
                    </button>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileUpload} 
                      accept="image/*,application/pdf,text/plain,text/csv" 
                      className="hidden" 
                    />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onPaste={handlePaste}
                      placeholder="Upload file or input extraction parameters..."
                      disabled={state.isSearching}
                      className="flex-1 bg-transparent border-none focus:ring-0 px-4 py-6 text-slate-100 placeholder-slate-800 text-xl font-black tracking-tight"
                    />
                    <button
                      type="submit"
                      disabled={(!query.trim() && !selectedFile) || state.isSearching}
                      className={`px-10 py-5 rounded-[1.8rem] font-black transition-all flex items-center gap-4 active:scale-95 ${(!query.trim() && !selectedFile) || state.isSearching ? 'bg-slate-800 text-slate-600' : 'bg-white text-black hover:bg-cyan-50 shadow-xl'}`}
                    >
                      {state.isSearching ? <LoadingSpinner /> : <><span className="hidden sm:inline text-[11px] uppercase tracking-widest">Execute Swarm</span><SearchIcon className="w-5 h-5" /></>}
                    </button>
                 </div>
              </form>
              <div className="text-center">
                 <p className="text-[9px] text-slate-700 font-bold uppercase tracking-[0.3em]">Drop PDF/Images, Paste, or Input text to begin extraction</p>
              </div>
           </div>
        </div>
      </main>
    </div>
  );
};

export default App;
