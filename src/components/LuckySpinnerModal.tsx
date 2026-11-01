import React, { useState, useEffect, useRef } from 'react';
import { X, Sparkles, Trophy, Gift, ArrowRight, CheckCircle2, Flame, Clock } from 'lucide-react';
import confetti from 'canvas-confetti';
import { soundManager } from '../services/audio';
import {
  WHEEL_SECTORS,
  WheelSector,
  executeLuckySpin,
  isSpinAvailable,
  loadBonusState,
  BonusState,
} from '../services/bonusService';
import { AppUser } from '../services/phoneAuth';

interface LuckySpinnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRewardWon: (amount: number, reason: string) => void;
  currentUser: AppUser | null;
  onOpenStreakHub?: () => void;
}

export const LuckySpinnerModal: React.FC<LuckySpinnerModalProps> = ({
  isOpen,
  onClose,
  onRewardWon,
  currentUser,
  onOpenStreakHub,
}) => {
  const [isSpinning, setIsSpinning] = useState(false);
  const [rotationDegree, setRotationDegree] = useState(0);
  const [wonSector, setWonSector] = useState<WheelSector | null>(null);
  const [wasNearMiss, setWasNearMiss] = useState(false);
  const [hasSpunToday, setHasSpunToday] = useState(false);
  const [bonusState, setBonusState] = useState<BonusState>(() => loadBonusState(currentUser?.uid));
  const tickTimeoutsRef = useRef<number[]>([]);
  const spinTimeoutRef = useRef<any>(null);

  useEffect(() => {
    if (isOpen) {
      const state = loadBonusState(currentUser?.uid);
      setBonusState(state);
      setHasSpunToday(!isSpinAvailable(currentUser?.uid));
      setWonSector(null);
      setWasNearMiss(false);
    }
  }, [isOpen, currentUser]);

  useEffect(() => {
    return () => {
      tickTimeoutsRef.current.forEach(clearTimeout);
      tickTimeoutsRef.current = [];
      if (spinTimeoutRef.current) {
        clearTimeout(spinTimeoutRef.current);
      }
    };
  }, []);

  if (!isOpen) return null;

  const numSectors = WHEEL_SECTORS.length;
  const sectorAngle = 360 / numSectors;

  const triggerConfetti = () => {
    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#ffd700', '#ff0055', '#00e5ff', '#00ff66', '#ffaa00'],
      });
      setTimeout(() => {
        confetti({
          particleCount: 50,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
        });
        confetti({
          particleCount: 50,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
        });
      }, 250);
    } catch {}
  };

  const handleSpin = () => {
    if (isSpinning || hasSpunToday) return;

    soundManager.playClick();
    setIsSpinning(true);
    setWonSector(null);
    setWasNearMiss(false);

    // Clear any previous tick timeouts
    tickTimeoutsRef.current.forEach(clearTimeout);
    tickTimeoutsRef.current = [];

    // Schedule realistic decelerating tick audio matching the 8-second spin
    // Rapid at first, progressively slower and suspenseful in the final 3 seconds
    let currentTime = 40;
    let step = 60;
    while (currentTime < 7800) {
      const delay = currentTime;
      const timeoutId = window.setTimeout(() => {
        soundManager.playWheelTick();
      }, delay);
      tickTimeoutsRef.current.push(timeoutId);

      // Decelerate intervals according to easing
      if (currentTime < 2500) {
        step = 60 + (currentTime / 2500) * 45; // 60ms -> 105ms
      } else if (currentTime < 5000) {
        step = 105 + ((currentTime - 2500) / 2500) * 145; // 105ms -> 250ms
      } else if (currentTime < 7000) {
        step = 250 + ((currentTime - 5000) / 2000) * 260; // 250ms -> 510ms
      } else {
        step = 510 + ((currentTime - 7000) / 1000) * 360; // 510ms -> 870ms (dramatic near-miss clicks)
      }
      currentTime += step;
    }

    // Execute weighted spin calculation (rotates daily between 20, 30, 50, 100, 200 BDT)
    const spinResult = executeLuckySpin(currentUser?.uid);
    setBonusState(spinResult.state);
    if (spinResult.nearMissIPhone) {
      setWasNearMiss(true);
    }

    // Calculate rotation:
    // Sector i center is at angle (i * sectorAngle + sectorAngle / 2)
    // 10 full revolutions gives an 8-second realistic casino wheel spin
    const extraSpins = 10;

    // Near-miss iPhone 17 Pro Max logic:
    // Sector 5 is iPhone 17 Pro Max. Sector 6 is ৳৫০. Sector 4 is ৳১০০.
    // When nearMissIPhone is true, land at (sectorAngle * 6 + 3.5 deg) so it slowly creeps past iPhone 17!
    const targetAngleOnWheel = spinResult.nearMissIPhone
      ? spinResult.sectorIndex * sectorAngle + 3.5
      : spinResult.sectorIndex * sectorAngle + sectorAngle / 2;

    const finalAngle = 360 * extraSpins + (360 - targetAngleOnWheel);

    // Offset from current rotation degree
    const currentBase = Math.floor(rotationDegree / 360) * 360;
    const newRotation = currentBase + finalAngle;

    setRotationDegree(newRotation);

    // Wait for full 8000ms animation to complete
    if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
    spinTimeoutRef.current = setTimeout(() => {
      tickTimeoutsRef.current.forEach(clearTimeout);
      tickTimeoutsRef.current = [];
      setIsSpinning(false);
      setHasSpunToday(true);
      setWonSector(spinResult.sector);

      // Play winning jackpot sound & confetti
      soundManager.playJackpot();
      triggerConfetti();

      // Credit wallet
      onRewardWon(spinResult.amount, 'ডেইলি লাকি স্পিনার বোনাস');
    }, 8000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-4 select-none animate-fadeIn">
      <div 
        className="bg-gradient-to-b from-[#141b2a] via-[#0d121c] to-[#080b12] border-2 border-amber-500/40 rounded-3xl p-5 sm:p-6 max-w-sm sm:max-w-md w-full shadow-[0_0_50px_rgba(245,158,11,0.25)] text-white relative max-h-[92vh] overflow-y-auto overscroll-contain scroll-smooth"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {/* Close Button */}
        <button
          onClick={() => {
            soundManager.playClick();
            onClose();
          }}
          disabled={isSpinning}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed z-20"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Modal Header */}
        <div className="text-center pb-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-amber-500/20 via-rose-500/20 to-amber-500/20 border border-amber-500/50 text-amber-300 text-xs font-bold uppercase tracking-wider mb-2 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            <span>দৈনিক লাকি স্পিনার (Lucky Spin)</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white drop-shadow-md">
            স্পিন করে জিতুন <span className="text-amber-400 font-mono">৳২০ থেকে ৳৫০০</span>!
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            iPhone 17 Pro Max ও নগদ ক্যাশ বোনাস জেতার দৈনিক সুযোগ
          </p>
        </div>

        {/* Wheel Canvas Section */}
        <div className="relative flex flex-col items-center justify-center my-4">
          {/* Neon Pointer Arrow at top */}
          <div className="absolute -top-3.5 z-30 flex flex-col items-center pointer-events-none drop-shadow-[0_4px_12px_rgba(245,158,11,0.9)]">
            <div className="w-0 h-0 border-l-[14px] border-l-transparent border-r-[14px] border-r-transparent border-t-[24px] border-t-amber-400 filter drop-shadow-md" />
            <div className="w-3 h-3 rounded-full bg-amber-200 -mt-7 shadow-inner" />
          </div>

          {/* Golden Outer Ring */}
          <div className="relative p-3 rounded-full bg-gradient-to-tr from-amber-600 via-yellow-400 to-amber-700 shadow-[0_0_35px_rgba(245,158,11,0.4)] border-4 border-amber-300/60">
            {/* Spinning Wheel */}
            <div
              className="w-64 h-64 sm:w-72 sm:h-72 rounded-full relative overflow-hidden shadow-2xl transition-transform"
              style={{
                transform: `rotate(${rotationDegree}deg)`,
                transitionDuration: isSpinning ? '8000ms' : '0ms',
                transitionTimingFunction: 'cubic-bezier(0.12, 0.98, 0.16, 1)',
              }}
            >
              <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
                {WHEEL_SECTORS.map((sector, index) => {
                  const startAngle = index * sectorAngle;
                  const endAngle = startAngle + sectorAngle;
                  const x1 = 50 + 50 * Math.cos((Math.PI * startAngle) / 180);
                  const y1 = 50 + 50 * Math.sin((Math.PI * startAngle) / 180);
                  const x2 = 50 + 50 * Math.cos((Math.PI * endAngle) / 180);
                  const y2 = 50 + 50 * Math.sin((Math.PI * endAngle) / 180);
                  const pathData = `M 50 50 L ${x1} ${y1} A 50 50 0 0 1 ${x2} ${y2} Z`;

                  // Angle for text placement
                  const midAngle = startAngle + sectorAngle / 2;
                  const textRad = (Math.PI * midAngle) / 180;
                  const textX = 50 + 33 * Math.cos(textRad);
                  const textY = 50 + 33 * Math.sin(textRad);

                  return (
                    <g key={sector.id}>
                      <path
                        d={pathData}
                        fill={sector.color}
                        stroke="#0f172a"
                        strokeWidth="1.2"
                      />
                      {sector.isSpecial ? (
                        <g transform={`rotate(${midAngle + 90}, ${textX}, ${textY})`}>
                          {/* Line 1: Ultra-crisp Phone Illustration above text */}
                          <g transform={`translate(${textX - 2.6}, ${textY - 11.2})`}>
                            {/* Outer shadow */}
                            <rect x="-0.4" y="-0.4" width="5.8" height="8.4" rx="1.2" fill="#000000" opacity="0.35" />
                            {/* Titanium Body */}
                            <rect x="0" y="0" width="5.2" height="7.8" rx="1" fill="#0f172a" stroke="#d97706" strokeWidth="0.5" />
                            {/* OLED Screen */}
                            <rect x="0.4" y="0.5" width="4.4" height="6.8" rx="0.6" fill="#0284c7" />
                            {/* Dynamic Island */}
                            <rect x="1.7" y="0.75" width="1.8" height="0.55" rx="0.27" fill="#000000" />
                            {/* Screen Glow Accent */}
                            <circle cx="2.6" cy="3.8" r="1.3" fill="#38bdf8" opacity="0.65" />
                            {/* Home Indicator */}
                            <line x1="1.8" y1="6.8" x2="3.4" y2="6.8" stroke="#ffffff" strokeWidth="0.35" strokeLinecap="round" />
                          </g>

                          {/* Line 2: iPhone 17 */}
                          <text
                            x={textX}
                            y={textY - 0.4}
                            fill="#000000"
                            fontSize="4.3"
                            fontWeight="900"
                            fontFamily="system-ui, -apple-system, sans-serif"
                            textAnchor="middle"
                            dominantBaseline="central"
                            letterSpacing="-0.15"
                          >
                            iPhone 17
                          </text>

                          {/* Line 3: Pro Max */}
                          <text
                            x={textX}
                            y={textY + 4.6}
                            fill="#78350f"
                            fontSize="3.9"
                            fontWeight="900"
                            fontFamily="system-ui, -apple-system, sans-serif"
                            textAnchor="middle"
                            dominantBaseline="central"
                            letterSpacing="-0.1"
                          >
                            Pro Max
                          </text>
                        </g>
                      ) : (
                        <text
                          x={textX}
                          y={textY}
                          fill={sector.textColor}
                          fontSize={sector.amount >= 1000 ? '5.2' : '6.2'}
                          fontWeight="900"
                          fontFamily="monospace"
                          textAnchor="middle"
                          dominantBaseline="central"
                          transform={`rotate(${midAngle + 90}, ${textX}, ${textY})`}
                        >
                          {sector.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>

              {/* Decorative Wheel Rim Lights */}
              <div className="absolute inset-0 rounded-full border-4 border-amber-300/30 pointer-events-none" />
            </div>

            {/* Wheel Center Button / Hub */}
            <div 
              onClick={handleSpin}
              className={`absolute inset-0 m-auto w-16 h-16 sm:w-18 sm:h-18 rounded-full bg-gradient-to-br from-amber-400 via-yellow-300 to-amber-600 border-4 border-[#0c101a] shadow-2xl flex flex-col items-center justify-center z-20 cursor-pointer active:scale-95 transition-transform ${
                isSpinning ? 'pointer-events-none opacity-90' : 'hover:scale-105'
              }`}
            >
              <span className="text-[11px] sm:text-xs font-black uppercase tracking-tight text-slate-950 leading-tight">
                {isSpinning ? '...' : 'SPIN'}
              </span>
              <span className="text-[9px] font-extrabold text-amber-950 leading-tight">
                {isSpinning ? 'ঘুরছে' : 'স্পিন'}
              </span>
            </div>
          </div>
        </div>

        {/* Won Celebration Dialog */}
        {wonSector && (
          <div className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-950/60 via-green-950/50 to-[#0e1622] border-2 border-emerald-500/60 text-center space-y-2 animate-fadeIn shadow-xl shadow-emerald-950/40 my-2">
            {wasNearMiss && (
              <div className="p-2.5 rounded-xl bg-amber-500/20 border border-amber-500/60 text-amber-200 text-xs font-bold flex items-center justify-center gap-1.5 animate-pulse">
                <span>⚡ ইসস! অল্পের জন্য iPhone 17 Pro Max মিস হলো! কিন্তু জিতেছেন ৳{wonSector.amount}!</span>
              </div>
            )}
            <div className="flex items-center justify-center gap-1.5 text-emerald-400 font-black text-sm">
              <Trophy className="w-4 h-4 text-amber-400 animate-bounce" />
              <span>অভিনন্দন! আপনি জিতেছেন!</span>
            </div>
            <div className="text-3xl font-black font-mono text-emerald-300 drop-shadow-md">
              +৳{wonSector.amount}
            </div>
            <p className="text-xs text-slate-300">
              টাকাটি সফলভাবে আপনার একাউন্ট ওয়ালেটে যোগ করে দেওয়া হয়েছে।
            </p>
          </div>
        )}

        {/* Action Button & Status */}
        <div className="space-y-2.5 mt-2">
          {!hasSpunToday ? (
            <button
              onClick={handleSpin}
              disabled={isSpinning}
              className="w-full py-3.5 bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 hover:from-amber-400 hover:to-yellow-300 text-slate-950 font-black text-sm uppercase tracking-wider rounded-2xl shadow-xl shadow-amber-600/30 active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4 text-slate-950 stroke-[2.5]" />
              <span>{isSpinning ? 'ভাগ্যের চাকা ঘুরছে...' : 'এখনই ফ্রি স্পিন করুন (SPIN NOW)'}</span>
            </button>
          ) : (
            <div className="p-3 rounded-2xl bg-[#0e1420] border border-[#233148] text-center space-y-1">
              <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                <span>আজকের ফ্রি স্পিন সম্পন্ন হয়েছে!</span>
              </div>
              <p className="text-[11px] text-slate-400 flex items-center justify-center gap-1 font-mono">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>পরবর্তী ফ্রি স্পিন আগামীকাল পাবেন</span>
              </p>
            </div>
          )}

          {/* Quick link to 7-Day Streak & Daily Bonus Hub */}
          {onOpenStreakHub && (
            <button
              onClick={() => {
                soundManager.playClick();
                onClose();
                onOpenStreakHub();
              }}
              className="w-full py-2.5 rounded-xl bg-[#162030] hover:bg-[#1e2c44] border border-[#253752] text-slate-200 hover:text-white text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Flame className="w-4 h-4 text-rose-400" />
              <span>৭ দিনের স্ট্রিক বোনাস (৳৫০০) প্রগ্রেস দেখুন</span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
