"use client";

import type { SVGProps } from "react";

/** Clothes-hanger mark for the fitting-room opener. */
export function HangerIcon({
  className,
  strokeWidth = 1.75,
  ...props
}: SVGProps<SVGSVGElement> & { strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...props}
    >
      {/* Hook */}
      <path d="M12 3.5a1.75 1.75 0 0 1 1.2 3L12 8" />
      {/* Shoulder bar */}
      <path d="M12 8 4.5 14.5h15L12 8Z" />
      {/* Crossbar */}
      <path d="M4.5 14.5h15" />
    </svg>
  );
}
