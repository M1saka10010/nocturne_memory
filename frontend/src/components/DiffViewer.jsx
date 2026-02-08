import React from 'react';
import { diffLines } from 'diff';
import clsx from 'clsx';

// Nocturne 风格的 DiffViewer
// 抛弃代码编辑器的刚硬，追求“记忆修订”的流动感

const DiffViewer = ({ oldText, newText }) => {
  const safeOld = oldText || '';
  const safeNew = newText || '';
  const diff = diffLines(safeOld, safeNew);

  // 检查是否有变更
  const hasChanges = safeOld !== safeNew;

  return (
    <div className="w-full font-sans text-sm leading-7">
      {!hasChanges && (
        <div className="text-slate-500 italic p-4 text-center border border-dashed border-slate-800 rounded-lg">
          No changes detected in content.
        </div>
      )}

      <div className="space-y-1">
        {diff.map((part, index) => {
          // 样式逻辑：
          // 删除：暗红背景，删除线，文字变暗，表达“被遗忘/被覆盖”
          // 新增：暗青/紫背景，高亮，表达“新生的意志”
          // 不变：默认灰白，安静的背景
          
          if (part.removed) {
            return (
              <div key={index} className="group relative bg-red-950/20 hover:bg-red-950/30 transition-colors border-l-2 border-red-900/50 pl-4 pr-2 py-1 select-text">
                 {/* 删除标记 */}
                <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-red-800 opacity-50 group-hover:opacity-100 transition-opacity"></div>
                <span className="text-red-300/50 line-through decoration-red-800/50 font-mono text-xs block mb-1 opacity-50 select-none">REMOVED</span>
                <span className="text-red-200/60 font-serif whitespace-pre-wrap">{part.value}</span>
              </div>
            );
          }
          
          if (part.added) {
            return (
               <div key={index} className="group relative bg-emerald-950/20 hover:bg-emerald-950/30 transition-colors border-l-2 border-emerald-500/50 pl-4 pr-2 py-2 my-1 rounded-r select-text">
                 <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]"></div>
                 <span className="text-emerald-500/50 font-mono text-xs block mb-1 opacity-70 select-none">ADDED</span>
                 <span className="text-emerald-100 font-medium font-serif whitespace-pre-wrap">{part.value}</span>
               </div>
            );
          }

          // Unchanged
          return (
            <div key={index} className="pl-4 pr-2 py-1 text-slate-400 whitespace-pre-wrap hover:text-slate-300 transition-colors border-l-2 border-transparent">
              {part.value}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// 导出为了兼容原有引用，虽然我们只用这一个
export const SimpleDiff = DiffViewer;
export default DiffViewer;
