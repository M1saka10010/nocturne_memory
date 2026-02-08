import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  ChevronRight, 
  Folder, 
  FileText, 
  Edit3, 
  Save, 
  X, 
  Home, 
  Search, 
  Database, 
  Cpu, 
  Hash, 
  Layers, 
  ArrowLeft
} from 'lucide-react';
import axios from 'axios';
import clsx from 'clsx';

// API Instance
const api = axios.create({ baseURL: '/api' });

// --- Components ---

// 1. Sidebar Item
const SidebarItem = ({ icon: Icon, label, active, onClick, count }) => (
  <button 
    onClick={onClick}
    className={clsx(
      "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 group",
      active 
        ? "bg-indigo-500/10 text-indigo-300 shadow-[0_0_10px_rgba(99,102,241,0.1)]" 
        : "text-slate-500 hover:bg-white/[0.03] hover:text-slate-300"
    )}
  >
    <Icon size={16} className={clsx("transition-colors", active ? "text-indigo-400" : "text-slate-600 group-hover:text-slate-400")} />
    <span className="flex-1 text-left truncate font-medium">{label}</span>
    {count !== undefined && (
      <span className="text-xs bg-slate-800/50 px-1.5 py-0.5 rounded text-slate-600 group-hover:text-slate-500">{count}</span>
    )}
  </button>
);

// 2. Breadcrumb
const Breadcrumb = ({ items, onNavigate }) => (
  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar mask-linear-fade">
    <button 
      onClick={() => onNavigate('')}
      className="p-1.5 rounded-md hover:bg-slate-800/50 text-slate-500 hover:text-indigo-400 transition-colors"
    >
      <Home size={14} />
    </button>
    
    {items.map((crumb, i) => (
      <React.Fragment key={crumb.path}>
        <ChevronRight size={12} className="text-slate-700 flex-shrink-0" />
        <button
          onClick={() => onNavigate(crumb.path)}
          className={clsx(
            "px-2 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap",
            i === items.length - 1
              ? "bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
              : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
          )}
        >
          {crumb.label}
        </button>
      </React.Fragment>
    ))}
  </div>
);

// 3. Node Card (Grid View)
const NodeGridCard = ({ node, onClick }) => (
  <button 
    onClick={onClick}
    className="group relative flex flex-col items-start p-5 bg-[#0A0A12] border border-slate-800/50 hover:border-indigo-500/30 rounded-xl transition-all duration-300 hover:shadow-[0_0_20px_rgba(99,102,241,0.1)] hover:-translate-y-1 text-left w-full h-full overflow-hidden"
  >
    {/* Hover Gradient */}
    <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
    
    <div className="flex items-center gap-3 mb-3 w-full">
      <div className="p-2 rounded-lg bg-slate-900 group-hover:bg-indigo-900/20 text-slate-500 group-hover:text-indigo-400 transition-colors">
         {/* Simple heuristic for icon */}
         {node.children_count > 0 ? <Folder size={18} /> : <FileText size={18} />}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-slate-300 group-hover:text-indigo-200 transition-colors break-words line-clamp-3">
          {node.title || node.name || node.path.split('/').pop()}
        </h3>
        <p className="text-[10px] text-slate-600 font-mono truncate opacity-70 group-hover:opacity-100">
           /{node.path.split('/').pop()}
        </p>
      </div>
    </div>
    
    <div className="w-full flex-1">
        {node.content_snippet ? (
            <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
                {node.content_snippet}
            </p>
        ) : (
            <p className="text-xs text-slate-700 italic">No preview available</p>
        )}
    </div>

    <div className="w-full mt-4 flex items-center justify-between border-t border-slate-800/50 pt-3 opacity-60 group-hover:opacity-100 transition-opacity">
        <span className="text-[10px] text-slate-600 uppercase tracking-wider font-bold">
            {node.type || 'Node'}
        </span>
        <ChevronRight size={12} className="text-indigo-500/50" />
    </div>
  </button>
);


// --- Main Page ---

export default function MemoryBrowser() {
  const [searchParams, setSearchParams] = useSearchParams();
  const domain = searchParams.get('domain') || 'core';
  const path = searchParams.get('path') || '';
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ node: null, children: [], breadcrumbs: [] });
  
  // Edit State
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  // Fetch Data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      setEditing(false);
      try {
        const res = await api.get('/browse/node', { params: { domain, path } });
        setData(res.data);
        setEditContent(res.data.node?.content || '');
      } catch (err) {
        setError(err.response?.data?.detail || err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [domain, path]);

  const navigateTo = (newPath, newDomain) => {
    const params = new URLSearchParams();
    params.set('domain', newDomain || domain);
    if (newPath) params.set('path', newPath);
    setSearchParams(params);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/browse/node', 
        { content: editContent },
        { params: { domain, path } }
      );
      const res = await api.get('/browse/node', { params: { domain, path } });
      setData(res.data);
      setEditing(false);
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const isRoot = !path;

  return (
    <div className="flex h-full bg-[#05050A] text-slate-300 font-sans selection:bg-indigo-500/30 selection:text-indigo-200 overflow-hidden">
      
      {/* 1. Sidebar Navigation */}
      <div className="w-64 flex-shrink-0 bg-[#08080E] border-r border-slate-800/30 flex flex-col">
        <div className="p-5 border-b border-slate-800/30">
          <div className="flex items-center gap-2 text-indigo-400 mb-1">
            <Cpu size={18} />
            <h1 className="font-bold tracking-tight text-sm text-slate-100">Memory Core</h1>
          </div>
          <p className="text-[10px] text-slate-600 pl-6 uppercase tracking-wider">Neural Explorer v2.0</p>
        </div>
        
        <div className="p-3">
             {/* Fake 'Quick Access' for now, could be dynamic later */}
             <div className="mb-4">
                 <h3 className="px-3 text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-2">Domains</h3>
                 <SidebarItem 
                    icon={Database} 
                    label="Core Memory" 
                    active={domain === 'core'} 
                    onClick={() => navigateTo('', 'core')} 
                 />
             </div>
        </div>

        <div className="mt-auto p-4 border-t border-slate-800/30">
             <div className="bg-slate-900/50 rounded p-3 border border-slate-800/50">
                 <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                    <Hash size={12} />
                    <span>Current Path</span>
                 </div>
                 <code className="block text-[10px] font-mono text-indigo-300/80 break-all leading-tight">
                    {domain}://{path || 'root'}
                 </code>
             </div>
        </div>
      </div>

      {/* 2. Main Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#05050A] relative">
         {/* Top Bar */}
         <div className="h-14 flex-shrink-0 border-b border-slate-800/30 flex items-center justify-between px-6 bg-[#05050A]/80 backdrop-blur-md sticky top-0 z-20">
             <Breadcrumb items={data.breadcrumbs} onNavigate={navigateTo} />
             
             <div className="flex items-center gap-2">
                 {/* Search Placeholder */}
                 <div className="relative group">
                     <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 group-hover:text-slate-400 transition-colors" />
                     <input 
                        type="text" 
                        placeholder="Search nodes..." 
                        disabled
                        className="bg-slate-900/50 border border-slate-800 rounded-full py-1.5 pl-9 pr-4 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/50 focus:bg-slate-900 transition-all w-48 cursor-not-allowed opacity-50"
                     />
                 </div>
             </div>
         </div>

         {/* Content Scroll Area */}
         <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            {loading ? (
                <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-600">
                    <div className="w-8 h-8 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
                    <span className="text-xs tracking-widest uppercase">Retrieving Neural Data...</span>
                </div>
            ) : error ? (
                <div className="h-full flex flex-col items-center justify-center text-rose-500 gap-4">
                    <p className="text-lg">Access Denied / Error</p>
                    <p className="text-sm opacity-60">{error}</p>
                    <button onClick={() => navigateTo('')} className="text-xs bg-slate-800 px-4 py-2 rounded hover:text-white transition-colors">Return to Root</button>
                </div>
            ) : (
                <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    
                    {/* Node Header & Content (If not root) */}
                    {!isRoot && data.node && (
                        <div className="space-y-4">
                             {/* Header */}
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h1 className="text-2xl font-bold text-slate-100 tracking-tight mb-2">
                                        {data.node.title || path.split('/').pop()}
                                    </h1>
                                    {data.node.disclosure && (
                                        <div className="inline-flex items-center gap-2 px-2 py-1 bg-amber-950/20 border border-amber-900/30 rounded text-amber-500/80 text-xs">
                                            <span>⚠ Disclosure:</span>
                                            <span className="italic">{data.node.disclosure}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    {editing ? (
                                        <>
                                            <button onClick={() => { setEditing(false); setEditContent(data.node.content); }} className="p-2 hover:bg-slate-800 rounded text-slate-400 transition-colors"><X size={18} /></button>
                                            <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-medium transition-colors shadow-lg shadow-indigo-900/20">
                                                <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
                                            </button>
                                        </>
                                    ) : (
                                        <button onClick={() => setEditing(true)} className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-sm font-medium transition-colors border border-slate-700 hover:border-slate-600">
                                            <Edit3 size={16} /> Edit
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Content Editor / Viewer */}
                            <div className={clsx(
                                "relative rounded-xl border overflow-hidden transition-all duration-300",
                                editing ? "bg-slate-900 border-indigo-500/50 shadow-[0_0_30px_rgba(99,102,241,0.1)]" : "bg-[#0A0A12]/50 border-slate-800/50"
                            )}>
                                {editing ? (
                                    <textarea 
                                        value={editContent}
                                        onChange={e => setEditContent(e.target.value)}
                                        className="w-full h-96 p-6 bg-transparent text-slate-200 font-mono text-sm leading-relaxed focus:outline-none resize-y"
                                        spellCheck={false}
                                    />
                                ) : (
                                    <div className="p-6 md:p-8 prose prose-invert prose-sm max-w-none">
                                        <pre className="whitespace-pre-wrap font-serif text-slate-300 leading-7">{data.node.content}</pre>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Children Grid */}
                    {data.children && data.children.length > 0 && (
                        <div className="space-y-4 pt-4">
                            <div className="flex items-center gap-3 text-slate-500">
                                <h2 className="text-xs font-bold uppercase tracking-widest">
                                    {isRoot ? "Memory Clusters" : "Sub-Nodes"}
                                </h2>
                                <div className="h-px flex-1 bg-slate-800/50"></div>
                                <span className="text-xs bg-slate-800/50 px-2 py-0.5 rounded-full">{data.children.length}</span>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {data.children.map(child => (
                                    <NodeGridCard 
                                        key={child.path} 
                                        node={child} 
                                        onClick={() => navigateTo(child.path)} 
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                    
                    {/* Empty State for Children */}
                    {!loading && !data.children?.length && !data.node && (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-600 gap-4">
                            <Folder size={48} className="opacity-20" />
                            <p className="text-sm">Empty Sector</p>
                        </div>
                    )}
                </div>
            )}
         </div>
      </div>
    </div>
  );
}
