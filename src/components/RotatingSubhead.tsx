'use client';

import { useEffect, useState } from 'react';

const PHRASE_ENTRIES = [
  { text: 'the truth…', colorClass: 'text-red-600' },
  { text: 'the best advice…', colorClass: 'text-green-600' },
  { text: 'the right answer…', colorClass: 'text-purple-600' },
  { text: 'the honest pick…', colorClass: 'text-blue-600' },
] as const;

export function RotatingSubhead() {
  const [index, setIndex] = useState(0);
  const [opacity, setOpacity] = useState(1);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const interval = window.setInterval(() => {
      setOpacity(0);
      window.setTimeout(() => {
        setIndex((prev) => (prev + 1) % PHRASE_ENTRIES.length);
        setOpacity(1);
      }, 400);
    }, 4000);
    return () => window.clearInterval(interval);
  }, [reduceMotion]);

  const longest = PHRASE_ENTRIES.reduce(
    (a, p) => (p.text.length > a.length ? p.text : a),
    '',
  );
  const displayedIndex = reduceMotion ? 0 : index;
  const current = PHRASE_ENTRIES[displayedIndex];

  return (
    <p className="shoop-rotating-subhead mx-auto mb-5 mt-2 min-w-0 max-w-[min(640px,100%)] w-full shrink-0 text-center text-[15px] font-normal leading-[22px] text-ink-secondary [overflow-wrap:anywhere] md:mb-5 md:mt-2 md:whitespace-nowrap">
      Ask me anything. I&apos;ll search every store and give you{' '}
      <span className="relative inline-block align-bottom">
        <span className="invisible font-bold">{longest}</span>
        <span
          className={`absolute left-0 top-0 whitespace-nowrap font-bold transition-opacity duration-[400ms] ease-out ${current.colorClass}`}
          style={{ opacity }}
        >
          {current.text}
        </span>
      </span>
    </p>
  );
}
