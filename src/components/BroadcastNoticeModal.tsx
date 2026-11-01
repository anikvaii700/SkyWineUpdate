import React from 'react';
import { X, Bell, Sparkles, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { BroadcastNotification } from '../services/notificationService';

interface BroadcastNoticeModalProps {
  notification: BroadcastNotification | null;
  onClose: () => void;
  onOpenBonus?: () => void;
}

export const BroadcastNoticeModal: React.FC<BroadcastNoticeModalProps> = ({
  notification,
  onClose,
  onOpenBonus,
}) => {
  if (!notification) return null;

  const isBonus = notification.type === 'bonus';
  const isAlert = notification.type === 'alert';
  const isUpdate = notification.type === 'update';

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-200 select-none">
      <div className="bg-[#0e1422] border-2 border-amber-500/40 rounded-3xl max-w-sm w-full p-5 text-white shadow-2xl relative overflow-hidden ring-4 ring-amber-500/15">
        {/* Decorative background glow */}
        <div className="absolute -top-16 -right-16 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-32 h-32 bg-rose-500/10 rounded-full blur-2xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="বন্ধ করুন"
          className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full bg-[#182336] hover:bg-[#22314a] text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header Icon */}
        <div className="flex items-center gap-3 mb-3.5">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg shrink-0 ${
              isBonus
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                : isAlert
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                : isUpdate
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
                : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
            }`}
          >
            {isBonus ? (
              <Sparkles className="w-6 h-6 animate-bounce" />
            ) : isAlert ? (
              <AlertTriangle className="w-6 h-6 animate-pulse" />
            ) : (
              <Bell className="w-6 h-6 animate-bounce" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span
                className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                  isBonus
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : isAlert
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                }`}
              >
                {isBonus ? '🎁 স্পেশাল বোনাস' : isAlert ? '⚠️ জরুরী নোটিশ' : isUpdate ? '🚀 নতুন আপডেট' : '📢 নোটিফিকেশন'}
              </span>
              <span className="text-[10px] text-slate-400">এডমিন বার্তা</span>
            </div>
            <h3 className="font-bold text-base text-white mt-0.5 leading-snug">{notification.title}</h3>
          </div>
        </div>

        {/* Message Body */}
        <div className="bg-[#121929] border border-[#202e48] rounded-2xl p-3.5 mb-4 text-xs sm:text-sm text-slate-200 leading-relaxed font-sans max-h-56 overflow-y-auto">
          {notification.message}
        </div>

        {/* Time footer */}
        <div className="flex items-center justify-between text-[11px] text-slate-400 mb-4 px-1">
          <span>প্রেরক: এডমিন প্যানেল</span>
          <span>{new Date(notification.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {isBonus && onOpenBonus ? (
            <button
              onClick={() => {
                onClose();
                onOpenBonus();
              }}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-[#120e00] font-black text-xs shadow-lg shadow-amber-500/20 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-transform"
            >
              <span>বোনাস ক্লেইম করুন</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-[#120e00] font-black text-xs shadow-lg shadow-amber-500/20 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-transform"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>ঠিক আছে, বুঝেছি</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
