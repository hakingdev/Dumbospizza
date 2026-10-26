/** Силуэт летучей мыши с машущими крыльями (взмахи — CSS, см. halloween.css). */
export function Bat({ size, flap = 0.22 }: { size: number; flap?: number }) {
  return (
    <svg
      width={size}
      height={size * 0.375}
      viewBox="0 0 64 24"
      fill="#140c1d"
      className="hw-bat"
      style={{ ['--hw-flap' as any]: `${flap}s` }}
      aria-hidden="true"
    >
      <path className="hw-wing hw-wing-l" d="M30 11C26 7 18 5.5 4 8c4 1.6 6 4.4 6 8 2.6-1.6 5.8-1.2 7.4.8 1.2-2 4.2-2.4 6-1.2.8-2 3.2-2.6 4.6-1.6L30 17Z" />
      <path className="hw-wing hw-wing-r" d="M34 11c4-4 12-5.5 26-3-4 1.6-6 4.4-6 8-2.6-1.6-5.8-1.2-7.4.8-1.2-2-4.2-2.4-6-1.2-.8-2-3.2-2.6-4.6-1.6L34 17Z" />
      <path d="M29.6 9.5 30.4 5.5 31.6 8.8Z M34.4 9.5 33.6 5.5 32.4 8.8Z" />
      <ellipse cx="32" cy="13.5" rx="3.2" ry="5.5" />
    </svg>
  );
}
