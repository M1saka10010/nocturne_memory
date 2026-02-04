import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { getSessions, getSnapshots, getDiff, rollbackResource, approveSnapshot, clearSession } from '../../lib/api';
import SnapshotList from '../../components/SnapshotList';
import SimpleDiff from '../../components/DiffViewer';
import { AlertTriangle, Archive, Check, RefreshCw, RotateCcw, Server, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';

function ReviewPage() {
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);
  const [diffData, setDiffData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [diffError, setDiffError] = useState(null);
  
  // Track the current diff request to avoid race conditions
  const diffRequestRef = React.useRef(0);

  // Load Sessions
  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const list = await getSessions();
      setSessions(list);
      
      // If we have a current session but it's no longer in the list (e.g. it was just cleared)
      // then switch to the next available session or clear selection
      if (currentSessionId && !list.find(s => s.session_id === currentSessionId)) {
        if (list.length > 0) {
          setCurrentSessionId(list[0].session_id);
        } else {
          setCurrentSessionId(null);
        }
        setSelectedSnapshot(null);
      }
      // Initial selection: Select latest session by default if available
      else if (list.length > 0 && !currentSessionId) {
        // Ensure we don't trigger invalid diff loads
        setSelectedSnapshot(null);
        setCurrentSessionId(list[0].session_id);
      }
    } catch (err) {
      setDiffError("Failed to load sessions. Is backend running?");
    }
  };

  // Load Snapshots when session changes
  useEffect(() => {
    if (currentSessionId) {
      // Clear selection when session changes to prevent mismatch
      setSelectedSnapshot(null);
      loadSnapshots(currentSessionId);
    }
  }, [currentSessionId]);

  const loadSnapshots = async (sessionId) => {
    setLoading(true);
    try {
      const list = await getSnapshots(sessionId);
      setSnapshots(list);
      if (list.length > 0) {
        setSelectedSnapshot(list[0]);
      } else {
        setSelectedSnapshot(null);
        setDiffData(null);
      }
    } catch (err) {
      // 404 means no snapshots, which is fine
      if (err.response?.status === 404) {
        setSnapshots([]);
        setSelectedSnapshot(null);
      } else {
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  };

  // Load Diff when snapshot selection changes
  useEffect(() => {
    if (currentSessionId && selectedSnapshot) {
      loadDiff(currentSessionId, selectedSnapshot.resource_id);
    }
  }, [currentSessionId, selectedSnapshot]);

  const loadDiff = async (sessionId, resourceId) => {
    // Increment request ID
    const requestId = ++diffRequestRef.current;
    
    setDiffError(null);
    setDiffData(null); // Clear previous data
    try {
      const data = await getDiff(sessionId, resourceId);
      
      // Only update state if this is still the latest request
      if (requestId === diffRequestRef.current) {
        setDiffData(data);
      }
    } catch (err) {
      // Only update error if this is still the latest request
      if (requestId === diffRequestRef.current) {
        console.error(err);
        setDiffError(err.response?.data?.detail || err.message || "Failed to load diff");
        setDiffData(null);
      }
    }
  };

  const handleRollback = async () => {
    if (!currentSessionId || !selectedSnapshot) return;
    if (!confirm(`Rollback ${selectedSnapshot.resource_id}? This will undo the changes.`)) return;

    try {
      await rollbackResource(currentSessionId, selectedSnapshot.resource_id);
      // After rollback, we remove it from the list (or should we keep it marked?)
      // Usually we treat rollback as "done", so remove from pending review list?
      // Actually, the snapshot still exists unless we delete it.
      // But the API doesn't auto-delete snapshot on rollback.
      // Let's delete the snapshot after rollback to clear the list.
      await approveSnapshot(currentSessionId, selectedSnapshot.resource_id);
      await loadSnapshots(currentSessionId);
      await loadSessions();
    } catch (err) {
      alert("Rollback failed: " + err.message);
    }
  };

  const handleApprove = async () => {
    if (!currentSessionId || !selectedSnapshot) return;
    try {
      await approveSnapshot(currentSessionId, selectedSnapshot.resource_id);
      await loadSnapshots(currentSessionId);
      await loadSessions();
    } catch (err) {
      alert("Approval failed: " + err.message);
    }
  };
  
  const handleClearSession = async () => {
    if (!currentSessionId) return;
    if (!confirm("Approve ALL changes in this session? This clears the review queue.")) return;
    try {
      await clearSession(currentSessionId);
      await loadSessions();
    } catch (err) {
      alert("Clear failed: " + err.message);
    }
  }

  return (
    <div className="flex h-full bg-slate-950 text-slate-200 overflow-hidden font-sans">
      {/* Sidebar */}
      <div className="w-80 flex-shrink-0 border-r border-slate-800 flex flex-col bg-slate-900/50">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-900">
          <h1 className="text-lg font-bold text-indigo-400 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            Memory Review
          </h1>
          <div className="mt-4">
            <label className="text-xs text-slate-500 uppercase font-bold mb-1 block">Session</label>
            <select 
              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm focus:border-indigo-500 outline-none"
              value={currentSessionId || ''}
              onChange={(e) => {
                setSelectedSnapshot(null);
                setCurrentSessionId(e.target.value);
              }}
            >
              {sessions.length === 0 && <option>No sessions</option>}
              {sessions.map(s => (
                <option key={s.session_id} value={s.session_id}>
                  {s.session_id}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Snapshot List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-slate-500 text-sm">Loading...</div>
          ) : (
            <SnapshotList 
              snapshots={snapshots} 
              selectedId={selectedSnapshot?.resource_id} 
              onSelect={setSelectedSnapshot} 
            />
          )}
        </div>
        
        {/* Footer Actions */}
        {snapshots.length > 0 && (
             <div className="p-4 border-t border-slate-800 bg-slate-900">
                 <button 
                    onClick={handleClearSession}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-900/50 hover:bg-emerald-800/50 text-emerald-200 border border-emerald-800 rounded py-2 text-sm transition-colors"
                 >
                     <Check size={16} /> Approve All (Clear)
                 </button>
             </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
        {selectedSnapshot ? (
          <>
            {/* Toolbar */}
            <div className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/30">
              <div className="flex items-center gap-3 overflow-hidden">
                 <div className={clsx(
                    "p-2 rounded-lg",
                    selectedSnapshot.operation_type === 'create' ? "bg-emerald-900/20 text-emerald-400" : "bg-amber-900/20 text-amber-400"
                 )}>
                    {selectedSnapshot.operation_type === 'create' ? <Archive size={20} /> : <RefreshCw size={20} />}
                 </div>
                 <div className="min-w-0">
                    <h2 className="text-lg font-semibold truncate text-slate-100">{selectedSnapshot.resource_id}</h2>
                    <p className="text-xs text-slate-500">{selectedSnapshot.resource_type} • {format(new Date(selectedSnapshot.snapshot_time), 'yyyy-MM-dd HH:mm:ss')}</p>
                 </div>
              </div>
              
              <div className="flex items-center gap-3 flex-shrink-0">
                <button 
                    onClick={handleRollback}
                    className="flex items-center gap-2 px-4 py-2 bg-rose-950/50 hover:bg-rose-900/50 border border-rose-900 text-rose-200 rounded-md transition-colors text-sm font-medium"
                >
                    <RotateCcw size={16} /> Rollback
                </button>
                <button 
                    onClick={handleApprove}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-950/50 hover:bg-indigo-900/50 border border-indigo-900 text-indigo-200 rounded-md transition-colors text-sm font-medium"
                >
                    <Check size={16} /> Approve
                </button>
              </div>
            </div>

            {/* Diff Area */}
            <div className="flex-1 overflow-y-auto p-6">
               {diffError ? (
                   <div className="flex flex-col items-center justify-center h-full text-rose-500 gap-4">
                       <AlertTriangle size={48} className="opacity-50" />
                       <p className="text-lg font-medium">Error Loading Diff</p>
                       <code className="bg-slate-900 p-2 rounded text-sm text-rose-300 font-mono max-w-2xl whitespace-pre-wrap">
                           {diffError}
                       </code>
                       <button 
                           onClick={() => loadDiff(currentSessionId, selectedSnapshot.resource_id)} 
                           className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-slate-200 transition-colors"
                       >
                           Retry
                       </button>
                   </div>
               ) : diffData ? (
                   <div className="max-w-5xl mx-auto">
                       <div className="mb-4 flex items-center gap-2 text-sm text-slate-400">
                           <Server size={14} />
                           <span>Current Diff Status: </span>
                           <span className={diffData.has_changes ? "text-amber-400 font-bold" : "text-slate-500"}>
                               {diffData.diff_summary}
                           </span>
                       </div>
                       
                       {/* Metadata Changes (title, importance, disclosure) */}
                       {diffData.snapshot_data && diffData.current_data && (
                           (() => {
                               const metaKeys = ['title', 'importance', 'disclosure'];
                               const changes = metaKeys.filter(key => {
                                   const oldVal = diffData.snapshot_data[key];
                                   const newVal = diffData.current_data[key];
                                   return JSON.stringify(oldVal) !== JSON.stringify(newVal);
                               });

                               if (changes.length === 0) return null;

                               return (
                                   <div className="mb-6 bg-slate-900/50 rounded border border-slate-800 p-4">
                                       <h3 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                           <ShieldCheck size={14} /> Metadata Changes
                                       </h3>
                                       <div className="space-y-2">
                                           {changes.map(key => {
                                               const oldVal = diffData.snapshot_data[key];
                                               const newVal = diffData.current_data[key];
                                               
                                               return (
                                                   <div key={key} className="grid grid-cols-[120px_1fr_24px_1fr] gap-4 text-sm items-center border-b border-slate-800/50 pb-2 last:border-0 last:pb-0">
                                                       <span className="text-slate-400 font-medium capitalize">{key}</span>
                                                       <div className="text-rose-400/80 bg-rose-950/20 px-2 py-1 rounded truncate font-mono text-xs text-right border border-rose-900/30">
                                                           {oldVal != null ? String(oldVal) : <span className="text-slate-600 italic">empty</span>}
                                                       </div>
                                                       <div className="text-center text-slate-600">→</div>
                                                       <div className="text-emerald-400 bg-emerald-950/20 px-2 py-1 rounded truncate font-mono text-xs border border-emerald-900/30">
                                                           {newVal != null ? String(newVal) : <span className="text-slate-600 italic">empty</span>}
                                                       </div>
                                                   </div>
                                               );
                                           })}
                                       </div>
                                   </div>
                               );
                           })()
                       )}
                       
                       {/* Content Diff */}
                       <SimpleDiff 
                           oldText={diffData.snapshot_data?.content ?? ''} 
                           newText={diffData.current_data?.content ?? ''} 
                       />
                   </div>
               ) : (
                   <div className="flex flex-col items-center justify-center h-full text-slate-600">
                       <div className="animate-pulse">Loading Diff...</div>
                   </div>
               )}
            </div>
          </>
        ) : diffError ? (
          <div className="flex-1 flex flex-col items-center justify-center text-rose-500 gap-4">
            <AlertTriangle size={64} className="opacity-50" />
            <p className="text-lg font-medium">Error</p>
            <p className="text-slate-400">{diffError}</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-600 gap-4">
            <ShieldCheck size={64} className="opacity-20" />
            <p>Select a change to review</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default ReviewPage
