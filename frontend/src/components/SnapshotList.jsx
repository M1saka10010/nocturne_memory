import React from 'react';
import clsx from 'clsx';
import { Archive, RefreshCw } from 'lucide-react';

// Nocturne 风格的 SnapshotList
// 更加紧凑，更加具有列表感，去掉多余的装饰，强调“时间流”

const SnapshotList = ({ snapshots, selectedId, onSelect }) => {
  if (snapshots.length === 0) {
    return (
      <div className="text-center py-10 text-slate-600 text-xs tracking-wide uppercase">
        Empty Sequence
      </div>
    );
  }

  return (
    <div className="flex flex-col">
        {snapshots.map((snap) => {
        const isSelected = snap.resource_id === selectedId;
        const isCreate = snap.operation_type === 'create';
        const isDelete = snap.operation_type === 'delete';

        return (
            <button
            key={snap.resource_id}
            onClick={() => onSelect(snap)}
            className={clsx(
                "group relative text-left py-3 px-5 border-l-2 transition-all duration-200 outline-none w-full hover:bg-white/[0.02]",
                isSelected 
                ? "border-indigo-500 bg-white/[0.03]" 
                : "border-transparent text-slate-500 hover:text-slate-300"
            )}
            >
            {/* Active Glow Effect */}
            {isSelected && (
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/10 to-transparent pointer-events-none" />
            )}

            <div className="flex items-center gap-3 relative z-10">
                {/* Status Indicator */}
                <div className={clsx(
                    "flex-shrink-0 w-1.5 h-1.5 rounded-full transition-colors",
                    isSelected 
                        ? (isCreate ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" 
                           : isDelete ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]"
                           : "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]")
                        : (isCreate ? "bg-emerald-900" 
                           : isDelete ? "bg-rose-900"
                           : "bg-amber-900")
                )} />
                
                <div className="min-w-0 flex-1">
                    <div className={clsx(
                        "font-medium text-xs truncate transition-colors",
                        isSelected ? "text-slate-200" : "text-slate-400 group-hover:text-slate-300"
                    )}>
                        {snap.resource_id}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className={clsx(
                            "text-[10px] uppercase tracking-wider font-bold",
                            isCreate ? "text-emerald-700" 
                            : isDelete ? "text-rose-700"
                            : "text-amber-700"
                        )}>
                            {isCreate ? "Create" : isDelete ? "Delete" : "Update"}
                        </span>
                        <span className="text-[10px] text-slate-700">
                            {snap.resource_type}
                        </span>
                    </div>
                </div>
                
                {/* Time Indicator (Only show on hover or selected) */}
                <div className={clsx(
                    "text-[10px] font-mono transition-opacity",
                    isSelected ? "text-indigo-400/50 opacity-100" : "text-slate-700 opacity-0 group-hover:opacity-100"
                )}>
                    {new Date(snap.snapshot_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </div>
            </div>
            </button>
        );
        })}
    </div>
  );
};

export default SnapshotList;
