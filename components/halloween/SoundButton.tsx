"use client";

import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { isMusicAvailable, isMusicWanted, setMusicWanted, subscribeSound } from './sound';

/** Музыка Halloween в шапке: по умолчанию выключена, выбор запоминается. */
export default function SoundButton() {
  const [available, setAvailable] = useState(false);
  const [on, setOn] = useState(isMusicWanted);

  useEffect(() => {
    let alive = true;
    isMusicAvailable().then((ok) => {
      if (alive) setAvailable(ok);
    });
    const unsubscribe = subscribeSound(() => setOn(isMusicWanted()));
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
