// src/services/activePlayersService.ts
// Realistic Active Players Simulation Engine
// Guarantees:
// 1. NEVER below 100 players
// 2. Fluctuates dynamically between 100 and 1,000+
// 3. Occasionally surges past 1,000 (rush hours / peak rounds: 1,020 - 1,480+)
// 4. Smooth natural live jitter (players joining/leaving)
// 5. Admin can also customize the range from Admin Panel if desired

import { useState, useEffect, useRef } from 'react';

const SETTINGS_KEY = 'aviator_active_players_range_v1';

export interface ActivePlayersSettings {
  min: number; // default 100 (strictly >= 100)
  max: number; // default 1250
  allowSurgePast1000: boolean; // default true
}

const DEFAULT_SETTINGS: ActivePlayersSettings = {
  min: 100,
  max: 1250,
  allowSurgePast1000: true,
};

export function getActivePlayersSettings(): ActivePlayersSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      min: Math.max(100, Number(parsed.min) || 100), // Strictly minimum 100!
      max: Math.max(200, Number(parsed.max) || 1250),
      allowSurgePast1000: parsed.allowSurgePast1000 ?? true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveActivePlayersSettings(settings: Partial<ActivePlayersSettings>): void {
  try {
    const current = getActivePlayersSettings();
    const updated: ActivePlayersSettings = {
      min: Math.max(100, settings.min ?? current.min), // Always enforce >= 100
      max: Math.max(200, settings.max ?? current.max),
      allowSurgePast1000: settings.allowSurgePast1000 ?? current.allowSurgePast1000,
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('active_players_settings_changed', { detail: updated }));
  } catch (e) {
    console.error('Failed to save active players settings:', e);
  }
}

/**
 * Generate a new target active player count within the 100 - 1,000+ range.
 */
export function generateTargetPlayerCount(): number {
  const settings = getActivePlayersSettings();
  const min = Math.max(100, settings.min);
  const max = settings.max;

  const rand = Math.random();

  // 22% chance: Peak surge over 1,000 (e.g. 1,020 to 1,450)
  if (settings.allowSurgePast1000 && rand < 0.22) {
    const surgeBase = Math.max(1000, min);
    const surgeTop = Math.max(surgeBase + 50, max > 1000 ? max : 1450);
    return Math.floor(surgeBase + Math.random() * (surgeTop - surgeBase));
  }

  // 35% chance: High activity (500 to 980)
  if (rand < 0.57) {
    const highMin = Math.max(min, 480);
    const highMax = Math.min(max, 990);
    if (highMax > highMin) {
      return Math.floor(highMin + Math.random() * (highMax - highMin));
    }
  }

  // 30% chance: Moderate activity (250 to 480)
  if (rand < 0.87) {
    const medMin = Math.max(min, 220);
    const medMax = Math.min(max, 480);
    if (medMax > medMin) {
      return Math.floor(medMin + Math.random() * (medMax - medMin));
    }
  }

  // 13% chance: Base activity (110 to 220) - strictly >= 100
  const lowMin = Math.max(105, min);
  const lowMax = Math.max(lowMin + 20, Math.min(max, 220));
  return Math.floor(lowMin + Math.random() * (lowMax - lowMin));
}

/**
 * React hook that manages dynamic active player count
 * Guarantees the count never drops below 100,
 * fluctuates naturally every 2-3 seconds,
 * and shifts to new targets across game rounds or time intervals.
 */
export function useActivePlayers(roundId?: number | string) {
  const [count, setCount] = useState<number>(() => generateTargetPlayerCount());
  const targetRef = useRef<number>(count);
  const countRef = useRef<number>(count);

  useEffect(() => {
    countRef.current = count;
  }, [count]);

  // When round changes, pick a new realistic wave of players
  useEffect(() => {
    targetRef.current = generateTargetPlayerCount();
  }, [roundId]);

  // Periodic interval to shift targets naturally every 18-25 seconds
  useEffect(() => {
    const targetInterval = setInterval(() => {
      targetRef.current = generateTargetPlayerCount();
    }, 18000 + Math.random() * 7000);

    return () => clearInterval(targetInterval);
  }, []);

  // Organic live jitter every 2.5 - 3.5 seconds (+3, -2, etc.)
  useEffect(() => {
    const jitterInterval = setInterval(() => {
      const current = countRef.current;
      const target = targetRef.current;
      const settings = getActivePlayersSettings();
      const absoluteMin = Math.max(100, settings.min);

      // Smooth step towards target
      const diff = target - current;
      let step = 0;
      if (Math.abs(diff) > 2) {
        step = Math.sign(diff) * Math.min(Math.abs(diff), Math.floor(Math.random() * 6) + 1);
      }

      // Small natural jitter (-3 to +4 players joining/leaving)
      const randomJitter = Math.floor(Math.random() * 7) - 3;
      let next = current + step + randomJitter;

      // STRICT RULE: Never fall below 100
      if (next < absoluteMin) {
        next = absoluteMin + Math.floor(Math.random() * 12);
      }

      setCount(next);
    }, 2800);

    return () => clearInterval(jitterInterval);
  }, []);

  // Listen for admin settings changes
  useEffect(() => {
    const handleSettingsChange = (e: Event) => {
      const customEvent = e as CustomEvent<ActivePlayersSettings>;
      if (customEvent.detail) {
        const newTarget = generateTargetPlayerCount();
        targetRef.current = newTarget;
        setCount((prev) => Math.max(customEvent.detail.min, prev));
      }
    };

    window.addEventListener('active_players_settings_changed', handleSettingsChange);
    return () => window.removeEventListener('active_players_settings_changed', handleSettingsChange);
  }, []);

  const formattedCount = count.toLocaleString('en-US');
  const isSurge = count >= 1000;

  return {
    count,
    formattedCount,
    isSurge,
  };
}
