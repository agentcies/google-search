
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { geminiService } from './services/geminiService';
import { SearchResult, SearchState, FileContext, ChatMessage, MissionTask } from './types';
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
  { id: 'general', label: 'Omni', desc: 'Balanced Agent', glossaryKey: 'omniPersona' },
  { id: 'financial', label: 'Quant', desc: 'Market Specialist', glossaryKey: 'quantPersona' },
  { id: 'technical', label: 'System', desc: 'Code & Logic', glossaryKey: 'systemPersona' },
  { id: 'market', label: 'Market', desc: 'Trend Analyst', glossaryKey: 'marketPersona' },
];

const suggestions = [
  "Analyze NVIDIA's 2025 market strategy",
  "Compare high-performance RAG tech stacks",
  "Research EV charging growth in SF",
  "Synthesize room-temp superconductor data"
];

const glossaryTerms: Record<string, string> = {
  omniPersona: "Balanced general-purpose reasoning engine suitable for most tasks.",
  quantPersona: "Specialized in financial markets, metrics, and fiscal cycles.",
  systemPersona: "Logic-first persona optimized for code, benchmarks, and architecture.",
  marketPersona: "Market intelligence specialist focusing on competitors and consumer sentiment.",
  deepSearchMax: "Enables long-form internal reasoning. Better for complex logic but takes more time.",
  deepSearchStd: "Optimized for speed. Direct answers without the extended 'thinking' phase.",
  groundingOn: "Enables real-time Google Maps integration for geographic accuracy.",
  groundingOff: "Standard search without coordinate-specific grounding.",
  viewReport: "Generates a human-readable synthesis report with markdown formatting.",
  viewApi: "Shows the structured JSON output used for programmatic integration.",
  viewCurl: "Provides a terminal command to replicate this search via API.",
  igniteSwarm: "Launches a new parallel reasoning node with current parameters.",
  uploadPayload: "Attaches local files (PDFs, Images, Code) to the swarm's context.",
  historyArchive: "Access previously generated research nodes and datasets.",
  activeQueue: "Track nodes that are actively processing data in parallel.",
  missionControl: "AI-generated objective list to track research progress automatically.",
  glossaryMode: "Toggle visual help tooltips for all interface components."
};

/**
 * Glossary Tooltip Wrapper
 */
const WithGlossary: React.FC<{ 
  term: string; 
  isActive: boolean; 
  children: React.ReactElement; 
  position?: 'top' | 'bottom' | 'left' | 'right' 
}> = ({ term, isActive, children, position = 'bottom' }) => {
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
    <div className="relative inline-block" 
         onMouseEnter={() => setIsHovered(true)} 
         onMouseLeave={() => setIsHovered(false)}>
      {children}
      {isHovered && (
        <div className={`fixed lg:absolute z-[9999] w-48 p-3 rounded-xl bg-slate-900 border border-cyan-500 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl animate-in fade-in zoom-in duration-150 pointer-events-none ${posClasses}`}>
          <div className="absolute inset-0 bg-cyan-500/10 blur-md rounded-xl" />
          <p className="relative text-[10px] font-bold text-cyan-50 leading-relaxed text-center">
            {text}
          </p>
          <div className={`absolute w-2 h-2 bg-slate-900 border-l border-t border-cyan-500 rotate-45 ${
            position === 'bottom' ? '-top-1 left-1/2 -translate-x-1/2' : 
            position === 'top' ? '-bottom-1 left-1/2 -translate-x-1/2' : ''
          }`} />
        </div>
      )}
    </div>
  );
};

const SentimentBadge = ({ sentiment }: { sentiment?: string }) => {
  if (!sentiment) return null;
  const config: Record<string, { color: string; icon: string; label: string }> = {
    positive: { color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: '☺', label: 'Positive' },
    negative: { color: 'text-rose-400 bg-rose-500/10 border-rose-500/20', icon: '☹', label: 'Negative' },
    neutral: { color: 'text-slate-400 bg-slate-500/10 border-slate-500/20', icon: '⚲', label: 'Neutral' },
    mixed: { color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', icon: '±', label: 'Mixed' },
  };
  const badge = config[sentiment] || { color: 'text-slate-400 bg-slate-500/10 border-slate-500/20', icon: '?', label: sentiment };
  return (
    <div className={`px-2 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-widest flex items-center gap-1.5 ${badge.color}`}>
      <span className="text-xs leading-none">{badge.icon}</span>
      {badge.label}
    </div>
  );
};

const TaskBoard = ({ tasks, onToggleStatus, glossaryActive }: { tasks: MissionTask[], onToggleStatus: (id: string) => void, glossaryActive: boolean }) => {
  if (tasks.length === 0) return null;
  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-500">
      <div className="flex items-center gap-3">
        <WithGlossary term="missionControl" isActive={glossaryActive} position="right">
          <label className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] cursor-help">Mission Objectives</label>
        </WithGlossary>
        <div className="flex-1 h-px bg-slate-800/50" />
      </div>
      <div className="space-y-2">
        {tasks.map((task) => (
          <div key={task.id} className={`group p-3 rounded-xl border transition-all flex items-center gap-3 ${
            task.status === 'completed' ? 'bg-emerald-500/5 border-emerald-500/20 opacity-60' : 
            task.status === 'in_progress' ? 'bg-cyan-500/5 border-cyan-500/40' : 'bg-slate-900/50 border-slate-800/80 hover:border-slate-700'
          }`}>
            <button 
              onClick={() => onToggleStatus(task.id)}
              className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                task.status === 'completed' ? 'bg-emerald-500 border-emerald-400' : 'border-slate-700 hover:border-cyan-500/50'
              }`}
            >
              {task.status === 'completed' && <svg className="w-2.5 h-2.5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={5}><path d="M5 13l4 4L19 7" /></svg>}
            </button>
            <span className={`text-[10px] font-bold flex-1 ${task.status === 'completed' ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
              {task.description}
            </span>
            <span className={`text-[7px] font-black uppercase tracking-tighter shrink-0 ${
              task.status === 'completed' ? 'text-emerald-500' : 
              task.status === 'in_progress' ? 'text-cyan-500 animate-pulse' : 'text-slate-600'
            }`}>
              {task.status.replace('_', ' ')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [state, setState] = useState<SearchState>({
    activeNodeIds: [],
    history: [],
    tasks: [],
    error: null,
  });
  
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [modelType, setModelType] = useState<'gemini-3-flash-preview' | 'gemini-3-pro-preview'>('gemini-3-flash-preview');
  const [persona, setPersona] = useState<'general' | 'financial' | 'technical' | 'market'>('general');
  const [deepSearch, setDeepSearch] = useState(true);
  const [useMaps, setUseMaps] = useState(false);
  const [viewMode, setViewMode] = useState<'report' | 'api' | 'curl'>('report');
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | undefined>();
  const [selectedFile, setSelectedFile] = useState<FileContext | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, any>>({});
  const [isGlossaryActive, setIsGlossaryActive] = useState(false);

  const resultsEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => console.warn("Geo access restricted.")
      );
    }
    const saved = localStorage.getItem('omniSearch_v7');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setState(prev => ({ ...prev, history: data.history || [], tasks: data.tasks || [] }));
        if (data.history?.length > 0) setSelectedId(data.history[0].id);
      } catch (e) {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('omniSearch_v7', JSON.stringify({ history: state.history.slice(0, 30), tasks: state.tasks }));
  }, [state.history, state.tasks]);

  const scrollToBottom = () => {
    resultsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const processFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = (e.target?.result as string).split(',')[1];
      setSelectedFile({ data: base64, mimeType: file.type, name: file.name });
    };
    reader.readAsDataURL(file);
  };

  const handleTaskAction = (call: any, searchId: string) => {
    const { action, taskId, description, status } = call.args;
    setState(prev => {
      let updatedTasks = [...prev.tasks];
      if (action === 'create') {
        if (!updatedTasks.find(t => t.id === taskId && t.searchId === searchId)) {
          updatedTasks.push({ id: taskId, description: description || '', status: status || 'pending', searchId });
        }
      } else if (action === 'update') {
        updatedTasks = updatedTasks.map(t => (t.id === taskId && t.searchId === searchId) ? { ...t, status: status || t.status, description: description || t.description } : t);
      } else if (action === 'delete') {
        updatedTasks = updatedTasks.filter(t => !(t.id === taskId && t.searchId === searchId));
      }
      return { ...prev, tasks: updatedTasks };
    });
  };

  const parseOrchestration = (text: string, currentStatus: any) => {
    const status = { ...currentStatus };
    const markers = ['[ARCHITECT]', '[RESEARCHER]', '[KERNEL]', '[ANALYST]', '[AUDITOR]'];
    markers.forEach(m => { if(text.includes(m)) status[m.toLowerCase().replace(/[\[\]]/g, '')] = 'active'; });
    
    let report = text;
    let api = null;
    if (text.includes('[DATA_BOUNDARY]')) {
      const parts = text.split('[DATA_BOUNDARY]');
      report = parts[0];
      try {
        const jsonMatch = parts[1].match(/\{[\s\S]*\}/);
        if (jsonMatch) api = JSON.parse(jsonMatch[0]);
      } catch (e) {}
    }
    const cleanedReport = report.replace(/\[ARCHITECT\]|\[RESEARCHER\]|\[KERNEL\]|\[ANALYST\]|\[AUDITOR\]/g, '');
    return { report: cleanedReport, api, status };
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const isFollowUp = !!selectedId;
    const activeQuery = query.trim();
    if (!activeQuery && !selectedFile) return;

    let searchId: string;
    let historyToUse: ChatMessage[] = [];
    const fileToUse = selectedFile;
    setSelectedFile(null);
    setQuery('');

    if (isFollowUp) {
      searchId = selectedId!;
      const existing = state.history.find(h => h.id === searchId);
      if (existing) {
        historyToUse = [...existing.messages, { role: 'model', content: existing.answer }];
      }
    } else {
      searchId = Math.random().toString(36).substring(7);
    }

    const currentTurnQuery = activeQuery || (fileToUse ? `Analyzing ${fileToUse.name}` : "Follow-up Query");

    if (!isFollowUp) {
      const initial: SearchResult = {
        id: searchId, 
        query: currentTurnQuery, 
        answer: '', 
        messages: [],
        chunks: [], 
        timestamp: Date.now(),
        fileContext: fileToUse || undefined,
        status: 'initializing'
      };
      setState(prev => ({
        ...prev,
        activeNodeIds: [...prev.activeNodeIds, searchId],
        history: [initial, ...prev.history],
        error: null
      }));
      setSelectedId(searchId);
    } else {
      setState(prev => ({
        ...prev,
        activeNodeIds: [...prev.activeNodeIds, searchId],
        history: prev.history.map(h => h.id === searchId ? {
          ...h, status: 'streaming',
          messages: [...h.messages, { role: 'user', content: currentTurnQuery }]
        } : h)
      }));
    }
    
    setAgentStatuses(prev => ({ ...prev, [searchId]: { architect: 'idle', researcher: 'idle', kernel: 'idle', analyst: 'idle', auditor: 'idle' } }));

    try {
      const stream = geminiService.searchStream(currentTurnQuery, {
        model: modelType, deepSearch, useMaps, persona, location, fileContext: fileToUse || undefined
      }, historyToUse);
      
      for await (const update of stream) {
        if (update.functionCalls) {
          update.functionCalls.forEach(call => handleTaskAction(call, searchId));
        }
        const { report, api, status } = parseOrchestration(update.text, agentStatuses[searchId] || {});
        setAgentStatuses(prev => ({ ...prev, [searchId]: status }));
        setState(prev => ({
          ...prev,
          history: prev.history.map(h => h.id === searchId ? {
            ...h, answer: report, rawJson: api, chunks: update.chunks, 
            status: update.isComplete ? 'completed' : 'streaming',
            sentiment: api?.sentiment || h.sentiment
          } : h)
        }));
        scrollToBottom();
      }
      setState(prev => ({ ...prev, activeNodeIds: prev.activeNodeIds.filter(id => id !== searchId) }));
    } catch (err: any) {
      setState(prev => ({ ...prev, activeNodeIds: prev.activeNodeIds.filter(id => id !== searchId), error: err.message }));
    }
  };

  const currentResult = useMemo(() => state.history.find(h => h.id === selectedId), [state.history, selectedId]);
  const activeNodes = useMemo(() => state.history.filter(h => state.activeNodeIds.includes(h.id)), [state.history, state.activeNodeIds]);
  const currentTasks = useMemo(() => state.tasks.filter(t => t.searchId === selectedId), [state.tasks, selectedId]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#020617] text-slate-100 font-sans selection:bg-cyan-500/30">
      
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 w-72 lg:static lg:flex flex-col border-r border-slate-800 bg-[#070b14]/95 backdrop-blur-2xl z-50 transition-transform duration-300 transform shadow-2xl ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => { setSelectedId(null); setIsSidebarOpen(false); }}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-600 flex items-center justify-center shadow-lg group-hover:scale-105 transition-all">
              <SearchIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-tight uppercase">OmniSwarm</h1>
              <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">v6.2 Engine</span>
            </div>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-slate-500 p-1">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
          <WithGlossary term="igniteSwarm" isActive={isGlossaryActive} position="right">
            <button onClick={() => { setSelectedId(null); setIsSidebarOpen(false); }} className="w-full py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-black uppercase tracking-widest hover:bg-cyan-500/20 transition-all flex items-center justify-center gap-2">
              New Swarm Node
            </button>
          </WithGlossary>

          <div className="space-y-4">
            <WithGlossary term="activeQueue" isActive={isGlossaryActive} position="right">
              <label className="text-[9px] font-black text-slate-600 uppercase tracking-[0.2em] px-2 cursor-help">Active Node Queue</label>
            </WithGlossary>
            <div className="space-y-1">
              {activeNodes.map(node => (
                <div key={node.id} onClick={() => { setSelectedId(node.id); setIsSidebarOpen(false); }} className={`p-3 border rounded-xl cursor-pointer transition-all ${selectedId === node.id ? 'bg-cyan-500/10 border-cyan-500/40' : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-black text-slate-200 uppercase truncate pr-2">{node.query}</span>
                    <div className="w-1 h-1 bg-cyan-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(6,182,212,1)]" />
                  </div>
                  <div className="h-0.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-cyan-500 w-1/3 animate-progress" />
                  </div>
                </div>
              ))}
              {activeNodes.length === 0 && <p className="text-[9px] text-slate-700 italic px-2">No concurrent nodes active.</p>}
            </div>
          </div>

          <div className="space-y-4">
             <WithGlossary term="historyArchive" isActive={isGlossaryActive} position="right">
               <label className="text-[9px] font-black text-slate-600 uppercase tracking-[0.2em] px-2 cursor-help">Workspace Archive</label>
             </WithGlossary>
             <div className="space-y-1">
                {state.history.filter(h => h.status === 'completed').map(item => (
                  <button key={item.id} onClick={() => { setSelectedId(item.id); setIsSidebarOpen(false); }}
                    className={`w-full text-left p-3 rounded-xl transition-all border group ${selectedId === item.id ? 'bg-cyan-500/5 border-cyan-500/30' : 'bg-transparent border-transparent hover:bg-slate-800/30'}`}>
                    <div className="flex items-center gap-3">
                      <HistoryIcon className="w-3 h-3 text-slate-600 group-hover:text-slate-400" />
                      <span className={`text-[10px] font-bold truncate flex-1 ${selectedId === item.id ? 'text-cyan-400' : 'text-slate-500 group-hover:text-slate-300'}`}>{item.query}</span>
                    </div>
                  </button>
                ))}
             </div>
          </div>
        </div>
      </aside>

      {/* Main Orchestration Engine */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        
        {/* Nav Header - Fixed clipping by removing overflow from central container */}
        <header className="sticky top-0 z-[100] bg-[#020617]/90 backdrop-blur-2xl border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-4">
           <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-2 text-slate-400 hover:text-white transition-all shrink-0">
             <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
           </button>
           
           <div className="flex-1 flex flex-wrap items-center gap-3 justify-center lg:justify-start">
             <div className="flex bg-slate-900/80 p-0.5 rounded-lg border border-slate-800 shadow-inner shrink-0">
                {personas.map(p => (
                  <WithGlossary key={p.id} term={p.glossaryKey} isActive={isGlossaryActive} position="bottom">
                    <button onClick={() => setPersona(p.id as any)} 
                      className={`px-3 py-1 rounded-md text-[9px] font-black uppercase transition-all ${persona === p.id ? 'bg-slate-800 text-cyan-400 border border-slate-700' : 'text-slate-500 hover:text-slate-300 border border-transparent'}`}>
                      {p.label}
                    </button>
                  </WithGlossary>
                ))}
             </div>
             <div className="h-4 w-px bg-slate-800 hidden md:block shrink-0" />
             <div className="flex gap-2 shrink-0">
               <WithGlossary term={deepSearch ? "deepSearchMax" : "deepSearchStd"} isActive={isGlossaryActive} position="bottom">
                 <button onClick={() => setDeepSearch(!deepSearch)} 
                   className={`px-3 py-1 rounded-md border text-[9px] font-black uppercase transition-all flex items-center gap-2 ${deepSearch ? 'border-green-500/30 text-green-400 bg-green-500/10' : 'border-slate-800 text-slate-600'}`}>
                   {deepSearch ? 'Max Depth' : 'Std Depth'}
                 </button>
               </WithGlossary>
               <WithGlossary term={useMaps ? "groundingOn" : "groundingOff"} isActive={isGlossaryActive} position="bottom">
                 <button onClick={() => setUseMaps(!useMaps)} 
                   className={`px-3 py-1 rounded-md border text-[9px] font-black uppercase transition-all flex items-center gap-2 ${useMaps ? 'border-blue-500/30 text-blue-400 bg-blue-500/10' : 'border-slate-800 text-slate-600'}`}>
                   <MapPinIcon className="w-3 h-3" /> Grounding
                 </button>
               </WithGlossary>
             </div>
             <div className="h-4 w-px bg-slate-800 hidden md:block shrink-0" />
             <WithGlossary term="glossaryMode" isActive={isGlossaryActive} position="bottom">
               <button 
                  onClick={() => setIsGlossaryActive(!isGlossaryActive)}
                  className={`px-3 py-1 rounded-md border text-[9px] font-black uppercase transition-all flex items-center gap-2 ${isGlossaryActive ? 'bg-cyan-500 text-black border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)]' : 'bg-slate-900 text-slate-500 border-slate-800 hover:border-slate-700'}`}
               >
                 <span className="text-xs">?</span> {isGlossaryActive ? 'Glossary Active' : 'Glossary Off'}
               </button>
             </WithGlossary>
           </div>
           
           <div className="hidden sm:flex bg-slate-900/80 p-0.5 rounded-lg border border-slate-800 shrink-0">
              {(['report', 'api', 'curl'] as const).map(mode => (
                <WithGlossary key={mode} term={`view${mode.charAt(0).toUpperCase() + mode.slice(1)}`} isActive={isGlossaryActive} position="bottom">
                  <button onClick={() => setViewMode(mode)} 
                    className={`px-3 py-1 rounded-md text-[9px] font-black uppercase transition-all ${viewMode === mode ? 'bg-slate-800 text-cyan-400' : 'text-slate-500 hover:text-slate-300'}`}>
                    {mode}
                  </button>
                </WithGlossary>
              ))}
           </div>
        </header>

        {/* Content View */}
        <div className="flex-1 overflow-y-auto px-4 md:px-12 lg:px-20 py-8 custom-scrollbar bg-[radial-gradient(circle_at_50%_0%,_rgba(6,182,212,0.03),_transparent_80%)]">
          {!currentResult && (
            <div className="max-w-4xl mx-auto h-full flex flex-col items-center justify-center text-center space-y-10 py-10">
               <div className="w-20 h-20 rounded-[2rem] bg-slate-900 border border-slate-800 flex items-center justify-center shadow-2xl relative animate-in zoom-in duration-700">
                  <div className="absolute inset-0 bg-cyan-500/10 blur-3xl rounded-full" />
                  <SearchIcon className="w-10 h-10 text-cyan-500 relative z-10" />
               </div>
               <div className="space-y-4 max-w-xl">
                  <h2 className="text-4xl md:text-5xl font-black text-white uppercase tracking-tighter">OmniSwarm <span className="text-cyan-500">v6</span></h2>
                  <p className="text-slate-500 text-base md:text-lg font-medium leading-relaxed">Agentic Search Engine & Deep Extraction API. Ignite a swarm to synthesize complex information automatically.</p>
               </div>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl px-4">
                  {suggestions.map((s, i) => (
                    <button key={i} onClick={() => setQuery(s)} className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 hover:border-cyan-500/30 transition-all text-xs font-bold text-slate-400 hover:text-slate-100 text-left flex items-center gap-3">
                      <span className="text-cyan-500">→</span>{s}
                    </button>
                  ))}
               </div>
            </div>
          )}

          {currentResult && (
            <div className="max-w-5xl mx-auto space-y-10 pb-48 animate-in fade-in duration-500">
              
              {/* Converstation History */}
              {currentResult.messages.length > 0 && (
                <div className="space-y-6">
                  {currentResult.messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[90%] md:max-w-[75%] p-5 rounded-2xl border ${msg.role === 'user' ? 'bg-slate-900/80 border-slate-800 text-slate-200' : 'bg-[#0b101b]/60 border-slate-800 text-slate-300'}`}>
                        <MarkdownContent content={msg.content} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Output Header */}
              <div className="flex flex-col gap-6 pt-4 border-t border-slate-800/50">
                 <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex flex-wrap gap-2">
                       <div className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[8px] font-black uppercase tracking-widest flex items-center gap-1.5">
                         <div className={`w-1 h-1 rounded-full ${currentResult.status === 'streaming' ? 'bg-cyan-500 animate-pulse' : 'bg-green-500'}`} />
                         {currentResult.status === 'streaming' ? 'Swarm Working' : 'Final Synthesis'}
                       </div>
                       <SentimentBadge sentiment={currentResult.sentiment} />
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { if(currentResult.answer) { navigator.clipboard.writeText(currentResult.answer); } }} className="text-[9px] font-black text-slate-500 uppercase hover:text-white transition-all">Copy Result</button>
                    </div>
                 </div>
                 <h1 className="text-2xl md:text-4xl font-black text-white tracking-tight uppercase leading-none">{currentResult.query}</h1>
              </div>

              {/* Main Content Area */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                 
                 <div className="lg:col-span-8 space-y-8">
                    <TaskBoard tasks={currentTasks} glossaryActive={isGlossaryActive} onToggleStatus={(id) => setState(p => ({...p, tasks: p.tasks.map(t => t.id === id ? {...t, status: t.status === 'completed' ? 'pending' : 'completed'} : t)}))} />
                    
                    <div className="relative bg-[#0b101b]/60 border border-slate-800 rounded-[2rem] p-6 md:p-10 shadow-2xl backdrop-blur-3xl overflow-hidden border-t-white/5">
                       {viewMode === 'report' ? (
                         <div className="animate-in fade-in duration-500">
                            {currentResult.answer ? <MarkdownContent content={currentResult.answer} /> : (
                              <div className="py-20 text-center space-y-6">
                                <LoadingSpinner />
                                <p className="text-cyan-500/60 font-black text-[10px] uppercase tracking-[0.3em] animate-pulse">Orchestrating Cluster Reasoning...</p>
                              </div>
                            )}
                         </div>
                       ) : (
                         <div className="space-y-4">
                           <div className="flex justify-between items-center px-2">
                             <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">{viewMode} Output</span>
                             <button onClick={() => navigator.clipboard.writeText(viewMode === 'api' ? JSON.stringify(currentResult.rawJson, null, 2) : 'curl ...')} className="text-[8px] font-black text-cyan-500 uppercase">Copy</button>
                           </div>
                           <pre className="p-6 bg-black/60 rounded-2xl border border-slate-800 text-cyan-300/80 text-[10px] font-mono overflow-x-auto leading-relaxed custom-scrollbar">
                              {viewMode === 'api' ? (currentResult.rawJson ? JSON.stringify(currentResult.rawJson, null, 2) : "Awaiting final extraction...") : `curl -X POST "https://api.omniswarm.ai/v6/swarm" \\
  -H "Authorization: Bearer ${currentResult.id}" \\
  -d '{"query": "${currentResult.query}"}'`}
                           </pre>
                         </div>
                       )}
                    </div>
                 </div>

                 {/* Sources Sidebar */}
                 <div className="lg:col-span-4 space-y-6">
                    <div className="p-6 bg-slate-900/40 border border-slate-800 rounded-[2rem] space-y-6 shadow-xl backdrop-blur-md sticky top-24">
                       <label className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center justify-between">
                         Neural Evidence 
                         <div className={`w-1.5 h-1.5 rounded-full ${currentResult.chunks.length > 0 ? 'bg-cyan-500' : 'bg-slate-700'} animate-pulse`} />
                       </label>
                       
                       <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
                          {currentResult.chunks.map((chunk, i) => {
                            const data = chunk.web || chunk.maps;
                            if (!data) return null;
                            return (
                              <a key={i} href={data.uri} target="_blank" rel="noreferrer" className="block p-3 rounded-xl border border-slate-800 hover:border-cyan-500/40 bg-slate-900/40 group transition-all">
                                <div className="flex items-center gap-2 mb-1 opacity-50 text-[7px] font-black uppercase tracking-widest group-hover:opacity-100 transition-opacity">
                                  {chunk.maps ? <MapPinIcon className="w-2.5 h-2.5" /> : <ExternalLinkIcon className="w-2.5 h-2.5" />}
                                  {chunk.maps ? 'Map Grounding' : 'Web Resource'}
                                </div>
                                <div className="text-[10px] font-bold text-slate-200 line-clamp-2 leading-tight group-hover:text-cyan-400">{data.title}</div>
                              </a>
                            );
                          })}
                          {currentResult.chunks.length === 0 && (
                            <div className="py-12 text-center opacity-30 text-[9px] font-black uppercase tracking-widest">Awaiting Grounding...</div>
                          )}
                       </div>
                    </div>
                 </div>
              </div>
            </div>
          )}
          
          <div ref={resultsEndRef} className="h-64" />
        </div>

        {/* Input Command Center */}
        <div className="absolute bottom-0 left-0 right-0 p-4 md:p-10 bg-gradient-to-t from-[#020617] via-[#020617]/95 to-transparent z-40">
           <div className="max-w-4xl mx-auto space-y-4">
              {selectedFile && (
                <div className="flex items-center gap-3 p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-2xl w-fit animate-in slide-in-from-bottom-2 shadow-2xl backdrop-blur-xl">
                   <div className="w-10 h-10 rounded-lg bg-black/40 flex items-center justify-center overflow-hidden border border-white/5">
                      {selectedFile.mimeType.startsWith('image/') ? <img src={`data:${selectedFile.mimeType};base64,${selectedFile.data}`} className="w-full h-full object-cover" /> : <DocumentIcon className="w-5 h-5 text-indigo-400" />}
                   </div>
                   <div className="pr-4">
                      <div className="text-[9px] font-black uppercase tracking-widest text-cyan-400">Context Loaded</div>
                      <div className="text-[8px] text-slate-500 font-bold truncate max-w-[150px]">{selectedFile.name}</div>
                   </div>
                   <button onClick={() => setSelectedFile(null)} className="p-1.5 hover:bg-red-500/20 rounded-lg text-slate-500 hover:text-red-400 transition-all">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                   </button>
                </div>
              )}

              <form onSubmit={handleSearch} className="relative group">
                 <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 to-indigo-600 rounded-[2.5rem] blur-xl opacity-5 group-focus-within:opacity-20 transition duration-1000" />
                 <div className="relative flex items-center bg-[#0d131f]/95 backdrop-blur-2xl border border-slate-800 group-focus-within:border-cyan-500/50 rounded-[2rem] shadow-2xl p-1.5 pr-4 transition-all duration-300">
                    <WithGlossary term="uploadPayload" isActive={isGlossaryActive} position="top">
                      <button type="button" onClick={() => fileInputRef.current?.click()} className="w-12 h-12 flex items-center justify-center text-slate-500 hover:text-cyan-400 transition-all shrink-0">
                        <DocumentIcon className="w-6 h-6" />
                      </button>
                    </WithGlossary>
                    <input type="file" ref={fileInputRef} onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }} className="hidden" />
                    <textarea
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch(); } }}
                      rows={1}
                      placeholder={selectedId ? "Follow up..." : "Deep query or mission parameters..."}
                      className="flex-1 bg-transparent border-none focus:ring-0 px-4 py-4 text-slate-100 placeholder-slate-700 text-sm md:text-lg font-bold tracking-tight resize-none no-scrollbar"
                    />
                    <WithGlossary term="igniteSwarm" isActive={isGlossaryActive} position="top">
                      <button
                        type="submit"
                        disabled={(!query.trim() && !selectedFile)}
                        className={`h-11 px-6 rounded-xl font-black transition-all flex items-center gap-3 active:scale-95 shrink-0 ${(!query.trim() && !selectedFile) ? 'bg-slate-800 text-slate-600' : 'bg-white text-black hover:bg-cyan-50 shadow-xl'}`}
                      >
                        <span className="hidden sm:inline text-[10px] uppercase tracking-widest">{selectedId ? 'Continue' : 'Ignite'}</span>
                        <SearchIcon className="w-5 h-5" />
                      </button>
                    </WithGlossary>
                 </div>
              </form>
              <div className="text-center px-4">
                 <p className="text-[8px] md:text-[9px] text-slate-700 font-bold uppercase tracking-[0.3em]">Precision Swarm Engine • Real-time Grounding Active</p>
              </div>
           </div>
        </div>
      </main>
    </div>
  );
};

export default App;
