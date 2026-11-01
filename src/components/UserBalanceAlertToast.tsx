import React, { useEffect } from 'react';
import { CheckCircle2, Coins, X, XCircle, AlertTriangle, Info, ArrowUpRight } from 'lucide-react';

export interface UserAlertToastData {
  title?: string;
  message: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  details?: string;
}

interface UserBalanceAlertToastProps {
  message: string | UserAlertToastData | null;
  onClose: () => void;
}

export const UserBalanceAlertToast: React.FC<UserBalanceAlertToastProps> = ({
  message,
  onClose,
}) => {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => {
      onClose();
    }, 10000); // 10 seconds auto-dismiss
    return () => clearTimeout(timer);
  }, [message, onClose]);

  if (!message) return null;

  const data: UserAlertToastData =
    typeof message === 'string'
      ? { message, type: 'success', title: 'ব্যালেন্স আপডেট' }
      : message;

  const type = data.type || 'success';

  // Styles based on alert type
  const config = {
    success: {
      bg: 'from-emerald-950/95 via-[#0e2118]/95 to-slate-900/95',
      border: 'border-emerald-500/70',
      shadow: 'shadow-emerald-950/70',
      iconBg: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
      badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      badgeText: 'সফল (Success)',
      Icon: CheckCircle2,
    },
    error: {
      bg: 'from-rose-950/95 via-[#2a0e14]/95 to-slate-900/95',
      border: 'border-rose-500/70',
      shadow: 'shadow-rose-950/70',
      iconBg: 'bg-rose-500/20 text-rose-400 border-rose-500/40',
      badgeBg: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
      badgeText: 'বাতিল (Rejected)',
      Icon: XCircle,
    },
    warning: {
      bg: 'from-amber-950/95 via-[#241a0b]/95 to-slate-900/95',
      border: 'border-amber-500/70',
      shadow: 'shadow-amber-950/70',
      iconBg: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
      badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      badgeText: 'রিফান্ড ও সতর্কতা',
      Icon: AlertTriangle,
    },
    info: {
      bg: 'from-cyan-950/95 via-[#0d202d]/95 to-slate-900/95',
      border: 'border-cyan-500/70',
      shadow: 'shadow-cyan-950/70',
      iconBg: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40',
      badgeBg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
      badgeText: 'নোটিফিকেশন',
      Icon: Info,
    },
  }[type];

  const IconComponent = config.Icon;

  return (
    <div className="fixed top-4 left-3 right-3 sm:left-auto sm:right-4 sm:max-w-md z-60 animate-in fade-in slide-in-from-top-3 duration-300 select-none">
      <div
        className={`bg-gradient-to-r ${config.bg} border ${config.border} rounded-2xl p-4 shadow-2xl ${config.shadow} backdrop-blur-xl flex items-start justify-between gap-3`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-xl ${config.iconBg} border flex items-center justify-center shrink-0 shadow-lg mt-0.5`}
          >
            <IconComponent className="w-5 h-5 animate-pulse" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${config.badgeBg}`}
              >
                {data.title || config.badgeText}
              </span>
              <span className="text-[10px] text-slate-400">লাইভ আপডেট</span>
            </div>
            <p className="text-sm font-bold text-white leading-snug">
              {data.message}
            </p>
            {data.details && (
              <p className="text-xs text-slate-300 bg-black/30 p-2 rounded-xl border border-white/5 mt-1 leading-relaxed">
                {data.details}
              </p>
            )}
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
