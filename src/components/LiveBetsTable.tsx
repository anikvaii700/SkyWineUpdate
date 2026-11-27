import React, { useState, useEffect } from 'react';
import { LivePlayerBet } from '../types/game';
import { Language, translations } from '../utils/i18n';
import { Trophy, Radio, Flame } from 'lucide-react';
import { useActivePlayers } from '../services/activePlayersService';
import { WHEEL_SECTORS } from '../services/bonusService';
import { soundManager } from '../services/audio';

interface LiveBetsTableProps {
  livePlayers: LivePlayerBet[];
  myBetHistory: Array<{
    id: string;
    amount: number;
    multiplier: number | null;
    winAmount: number | null;
    timestamp: number;
  }>;
  lang: Language;
  onOpenSpinner?: () => void;
  showSpinnerWidget?: boolean;
}

export const LiveBetsTable: React.FC<LiveBetsTableProps> = ({
  livePlayers,
  myBetHistory,
  lang,
  onOpenSpinner,
  showSpinnerWidget = true,
}) => {
  const t = translations[lang];

  // Dynamic realistic active player count (Strictly >= 100, ranges 100 to 1000+, occasionally surges 1000+)
  const { count, formattedCount, isSurge } = useActivePlayers(livePlayers.length);

  // Dynamic Top Win - changes periodically or showcases supreme winner
  const [topWinIndex, setTopWinIndex] = useState<number>(0);
  const topWins = [
    { name: 'Shanto_King', stake: 5000, multiplier: 48.20, win: 241000 },
    { name: 'Rifat_777', stake: 2000, multiplier: 42.10, win: 84200 },
    { name: 'Anik_Boss', stake: 1000, multiplier: 38.65, win: 38650 },
    { name: 'Mehedi_Pro', stake: 3000, multiplier: 21.40, win: 64200 },
    { name: 'Sumon_Dhaka', stake: 1500, multiplier: 18.90, win: 28350 },
  ];

  // Rotate featured top win every 12 seconds so users see real variety of huge wins
  useEffect(() => {
    const timer = setInterval(() => {
      setTopWinIndex((prev) => (prev + 1) % topWins.length);
    }, 12000);
    return () => clearInterval(timer);
  }, [topWins.length]);

  const currentTopWin = topWins[topWinIndex];

  const miniSectorAngle = 360 / WHEEL_SECTORS.length;

  return (
    <div className="bg-[#121824] border border-[#1f2a3e] rounded-2xl p-2.5 sm:p-3.5 shadow-xl select-none">
      {/* Header with Live Players Counter + Mini Rotating Spinner directly below it */}
      <div className="flex items-start justify-between gap-2 border-b border-[#1f2a3e] pb-2.5 mb-2">
        <div className="flex flex-col justify-center self-center min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="text-xs font-black tracking-wide text-white truncate">
              লাইভ প্লেয়ার্স ও বাজি
            </span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 pl-4">
            রিয়েল-টাইম বাজি ও সেরা বিজয়ী
          </span>
        </div>

        {/* Right column: Active Online Players Counter + Rotating Mini Spinner below it */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          {/* Live Active Players Counter: NEVER below 100, ranges 100 - 1000+, occasionally 1000+ */}
          <div
            className={`flex items-center gap-1.5 text-[11px] bg-[#0c1018] px-2.5 py-1 rounded-full border transition-all duration-300 font-mono ${
              isSurge
                ? 'border-amber-500/60 bg-gradient-to-r from-amber-500/10 to-[#0c1018] text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                : 'border-emerald-500/40 text-slate-300 shadow-xs'
            }`}
            title="বর্তমানে অনলাইন সক্রিয় মোট প্লেয়ার সংখ্যা"
          >
            {isSurge ? (
              <Flame className="w-3.5 h-3.5 text-amber-400 animate-bounce" />
            ) : (
              <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            )}
            <span className={`font-black tracking-tight tabular-nums ${isSurge ? 'text-amber-300 text-xs' : 'text-emerald-300 text-xs'}`}>
              {formattedCount}
            </span>
            <span className="text-slate-300 text-[10px]">জন সক্রিয়</span>
          </div>

          {/* Mini Rotating Lucky Spinner Popup directly under the online count */}
          {showSpinnerWidget && onOpenSpinner && (
            <button
              type="button"
              onClick={() => {
                soundManager.playClick();
                onOpenSpinner();
              }}
              aria-label="Spin Now - লাকি স্পিনার খুলুন"
              title="লাকি স্পিনার খুলতে ক্লিক করুন"
              className="group flex flex-col items-center justify-center rounded-xl bg-gradient-to-b from-[#1d172c] to-[#0e1320] border border-amber-400/50 hover:border-amber-300 px-2.5 py-1.5 shadow-[0_4px_14px_rgba(245,158,11,0.24)] hover:shadow-[0_6px_18px_rgba(245,158,11,0.38)] active:scale-95 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 min-w-[68px]"
            >
              {/* Top golden pointer */}
              <span
                aria-hidden="true"
                className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[6px] border-t-amber-300 -mb-1 z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
              />

              {/* Continuously spinning mini lucky wheel */}
              <svg
                viewBox="0 0 100 100"
                className="w-10 h-10 animate-spin-slow drop-shadow-[0_2px_6px_rgba(0,0,0,0.65)]"
                aria-hidden="true"
              >
                <circle cx="50" cy="50" r="47" fill="#1b1528" stroke="#f59e0b" strokeWidth="4" />
                {WHEEL_SECTORS.map((sector, idx) => {
                  const startDeg = idx * miniSectorAngle - 90;
                  const endDeg = (idx + 1) * miniSectorAngle - 90;
                  const startRad = (startDeg * Math.PI) / 180;
                  const endRad = (endDeg * Math.PI) / 180;
                  const r = 44;
                  const x1 = 50 + r * Math.cos(startRad);
                  const y1 = 50 + r * Math.sin(startRad);
                  const x2 = 50 + r * Math.cos(endRad);
                  const y2 = 50 + r * Math.sin(endRad);
                  const pathD = `M 50 50 L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
                  return (
                    <path
                      key={sector.id}
                      d={pathD}
                      fill={sector.color}
                      stroke="#0f172a"
                      strokeWidth="1.2"
                    />
                  );
                })}
                <circle cx="50" cy="50" r="12" fill="#fbbf24" stroke="#78350f" strokeWidth="2.5" />
                <circle cx="50" cy="50" r="4.5" fill="#fffbeb" />
              </svg>

              {/* "Spin Now" text directly underneath the spinning wheel */}
              <span className="mt-1 px-2 py-0.5 rounded-md bg-gradient-to-r from-amber-400 via-yellow-400 to-orange-400 text-[10px] font-black tracking-tight text-slate-950 whitespace-nowrap leading-none shadow-xs group-hover:brightness-110 transition-all">
                Spin Now
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Table Content with no scrollbar lines */}
      <div className="no-scrollbar overflow-x-hidden max-h-[260px] overflow-y-auto relative">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 z-20 bg-[#121824] shadow-xs">
            <tr className="text-slate-400 border-b border-[#1b2333] text-[11px]">
              <th className="py-1.5 font-medium pl-1.5">{t.user}</th>
              <th className="py-1.5 font-medium text-right">{t.betAmount}</th>
              <th className="py-1.5 font-medium text-center">{t.multiplier}</th>
              <th className="py-1.5 font-medium text-right pr-1">{t.winTaka}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#171f2d]">
            {/* 👑 PINNED PERMANENTLY AT THE VERY TOP: সেরা জয় (Top Win) */}
            <tr className="sticky top-[27px] z-10 bg-gradient-to-r from-[#21160a] via-[#1a1309] to-[#121824] border-l-4 border-l-amber-400 shadow-md">
              <td className="py-2.5 pl-1.5 flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center text-[#1a1200] shadow-sm shrink-0">
                  <Trophy className="w-3.5 h-3.5 stroke-[2.5]" />
                </div>
                <div className="min-w-0">
                  <span className="bg-amber-400/25 text-amber-300 border border-amber-400/50 text-[11px] px-2 py-0.5 rounded-full font-black tracking-tight shrink-0 shadow-xs">
                    সেরা জয়
                  </span>
                </div>
              </td>
              <td className="py-2.5 text-right font-mono-numbers text-amber-100 font-bold">
                ৳{currentTopWin.stake.toLocaleString()}
              </td>
              <td className="py-2.5 text-center">
                <span className="px-2 py-0.5 rounded-full text-[11px] font-black font-mono-numbers bg-amber-500/25 text-amber-300 border border-amber-400/60 shadow-[0_0_10px_rgba(251,191,36,0.35)]">
                  {currentTopWin.multiplier.toFixed(2)}x
                </span>
              </td>
              <td className="py-2.5 text-right font-mono-numbers pr-1">
                <span className="text-amber-300 font-black text-xs">
                  +৳{currentTopWin.win.toLocaleString()}
                </span>
              </td>
            </tr>

            {/* LIVE RANDOM PLAYERS BELOW */}
            {livePlayers.map((player) => (
              <tr key={player.id} className="hover:bg-[#161e2c]/40 transition-colors">
                <td className="py-2 pl-1.5 flex items-center gap-1.5">
                  <div className="w-5.5 h-5.5 rounded-full bg-[#1b2538] flex items-center justify-center text-[10px] font-bold text-slate-300 shrink-0">
                    {player.playerName.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-slate-200 font-medium truncate max-w-[95px] text-[11px]">
                    {player.playerName}
                  </span>
                </td>
                <td className="py-2 text-right font-mono-numbers text-slate-300 text-xs">
                  ৳{player.betAmount.toLocaleString()}
                </td>
                <td className="py-2 text-center">
                  {player.cashedOut ? (
                    <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold font-mono-numbers bg-purple-900/40 text-purple-300 border border-purple-700/40">
                      {player.cashedOutMultiplier?.toFixed(2)}x
                    </span>
                  ) : (
                    <span className="text-slate-600 font-mono text-xs">-</span>
                  )}
                </td>
                <td className="py-2 text-right font-mono-numbers pr-1 text-xs">
                  {player.cashedOut ? (
                    <span className="text-emerald-400 font-bold">
                      +৳{(player.winAmount || 0).toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-slate-600">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
