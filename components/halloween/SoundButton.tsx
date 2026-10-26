"use client";

import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { isMusicActive, isMusicAvailable, isMusicWanted, setMusicWanted, subscribeSound } from './sound';

const playing = () => isMusicWanted() && isMusicActive();

/**
 * Музыка Halloween в шапке. Вальс включён по умолчанию, кнопка его выключает
 * (выбор запоминается). Пока браузер ждёт первого клика, кнопка показывает
 * «выключено» — и клик по ней как раз запускает музыку.
 */
export default function SoundButton() {
  const [available, setAvailable] = useState(false);
  const [on, setOn] = useState(playing);

  useEffect(() => {
    let alive = true;
    isMusicAvailable().then((ok) => {
      if (alive) setAvailable(ok);
    });
    const unsubscribe = subscribeSound(() => setOn(playing()));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  if (!available) return null;

  const label = on ? 'Halloween-Musik ausschalten' : 'Halloween-Musik einschalten';
  return (
    <button
      type="button"
      data-hw-sound
      onClick={() => setMusicWanted(!on)}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className="flex h-12 w-12 items-center justify-center rounded-full text-gray-700 transition-colors hover:bg-primary-50 hover:text-primary-600"
    >
      {on ? <Volume2 className="h-6 w-6" aria-hidden="true" /> : <VolumeX className="h-6 w-6" aria-hidden="true" />}
    </button>
  );
}
