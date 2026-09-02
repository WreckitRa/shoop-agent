import type { ReactNode } from "react";

const SVG_CLASS = "absolute inset-0 h-full w-full";

function Wrap({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 300 260" className={SVG_CLASS} aria-hidden>
      {children}
    </svg>
  );
}

export function NoListArt({ id }: { id: string }) {
  switch (id) {
    case "logos":
      return (
        <Wrap>
          <rect x="60" y="80" width="180" height="90" rx="10" fill="#8A8A93" />
          <text
            x="150"
            y="142"
            textAnchor="middle"
            fill="#fff"
            fontFamily="var(--font-archivo), Archivo, sans-serif"
            fontWeight={900}
            fontSize="52"
          >
            LOGO
          </text>
        </Wrap>
      );
    case "tight":
      return (
        <Wrap>
          <path
            d="M150 40 C176 40 188 58 190 82 C192 106 182 124 178 146 C176 168 182 190 184 210 L116 210 C118 190 124 168 122 146 C118 124 108 106 110 82 C112 58 124 40 150 40 Z"
            fill="#8A8A93"
          />
          <path d="M124 96 L176 96 M120 130 L180 130 M124 164 L176 164" stroke="#fff" strokeWidth="2.5" opacity=".55" />
        </Wrap>
      );
    case "short":
      return (
        <Wrap>
          <path d="M150 40 C172 40 184 54 186 74 C188 96 180 112 176 130 L124 130 C120 112 112 96 114 74 C116 54 128 40 150 40 Z" fill="#8A8A93" />
          <path d="M124 128 L176 128 L182 168 L118 168 Z" fill="#B4B4BC" />
          <path d="M132 170 L132 216 M168 170 L168 216" stroke="#C8C8D0" strokeWidth="18" strokeLinecap="round" />
        </Wrap>
      );
    case "neon":
      return (
        <Wrap>
          <rect x="60" y="60" width="80" height="130" rx="8" fill="#CCFF00" />
          <rect x="152" y="60" width="80" height="130" rx="8" fill="#FF00A8" />
        </Wrap>
      );
    case "sheer":
      return (
        <Wrap>
          <rect x="80" y="60" width="140" height="130" rx="10" fill="#8A8A93" opacity=".35" />
          <path d="M96 80 L204 80 M96 110 L204 110 M96 140 L204 140 M96 170 L204 170" stroke="#8A8A93" strokeWidth="2" opacity=".6" />
        </Wrap>
      );
    case "heels":
      return (
        <Wrap>
          <path d="M78 168 L188 168 C200 168 208 158 208 146 L208 120 L96 120 C86 120 78 130 78 142 Z" fill="#8A8A93" />
          <rect x="192" y="168" width="14" height="58" rx="3" fill="#8A8A93" />
        </Wrap>
      );
    case "sleeve":
      return (
        <Wrap>
          <path d="M150 50 C168 50 180 60 184 76 L206 96 L188 116 L182 106 C180 132 180 168 180 200 L120 200 C120 168 120 132 118 106 L112 116 L94 96 L116 76 C120 60 132 50 150 50 Z" fill="#8A8A93" />
          <circle cx="98" cy="140" r="20" fill="none" stroke="#E42831" strokeWidth="4" opacity=".55" />
          <circle cx="202" cy="140" r="20" fill="none" stroke="#E42831" strokeWidth="4" opacity=".55" />
        </Wrap>
      );
    case "crop":
      return (
        <Wrap>
          <path d="M150 50 C172 50 184 62 186 80 C188 98 182 110 180 122 L120 122 C118 110 112 98 114 80 C116 62 128 50 150 50 Z" fill="#8A8A93" />
          <rect x="118" y="150" width="64" height="70" rx="6" fill="#C8C8D0" />
        </Wrap>
      );
    case "ripped":
      return (
        <Wrap>
          <rect x="100" y="55" width="100" height="160" rx="8" fill="#7E8C9E" />
          <path d="M112 100 L142 96 L128 112 L152 108" stroke="#EFEFF0" strokeWidth="7" fill="none" strokeLinecap="round" />
          <path d="M156 148 L188 144 L170 160" stroke="#EFEFF0" strokeWidth="7" fill="none" strokeLinecap="round" />
        </Wrap>
      );
    case "print":
      return (
        <Wrap>
          <rect x="70" y="60" width="160" height="130" rx="10" fill="#C4BCA8" />
          <circle cx="112" cy="100" r="26" fill="#2A2620" />
          <circle cx="186" cy="150" r="30" fill="#2A2620" />
          <path d="M150 60 Q182 96 150 128 Q118 96 150 60 Z" fill="#8C3A2E" />
        </Wrap>
      );
    case "shine":
      return (
        <Wrap>
          <rect x="80" y="60" width="140" height="130" rx="10" fill="#8A8A93" />
          <path d="M92 190 L140 60 L168 60 L108 190 Z" fill="#fff" opacity=".55" />
          <path d="M170 190 L206 92 L220 92 L196 190 Z" fill="#fff" opacity=".35" />
        </Wrap>
      );
    case "fast":
      return (
        <Wrap>
          <path d="M96 90 L204 90 L192 210 L108 210 Z" fill="#8A8A93" />
          <path d="M124 90 C124 62 134 48 150 48 C166 48 176 62 176 90" stroke="#8A8A93" strokeWidth="9" fill="none" />
          <text x="150" y="172" textAnchor="middle" fill="#fff" fontFamily="var(--font-archivo), Archivo, sans-serif" fontWeight={900} fontSize="34">
            £4
          </text>
        </Wrap>
      );
    case "chunky":
      return (
        <Wrap>
          <path d="M62 176 L176 176 C196 176 214 166 226 152 L236 140 L236 190 L62 190 Z" fill="#8A8A93" />
          <path d="M62 176 L62 132 C62 122 72 116 84 118 L124 128 L160 154 L176 176 Z" fill="#C8C8D0" />
        </Wrap>
      );
    case "lowrise":
      return (
        <Wrap>
          <path d="M112 74 L188 74 L184 108 L116 108 Z" fill="#C8C8D0" />
          <path d="M110 106 L190 106 L184 216 L156 216 L150 152 L144 216 L116 216 Z" fill="#7E8C9E" />
        </Wrap>
      );
    case "fur":
      return (
        <Wrap>
          <path d="M150 52 C176 52 196 66 202 88 L216 100 L200 118 C200 148 198 180 198 208 L102 208 C102 180 100 148 100 118 L84 100 L98 88 C104 66 124 52 150 52 Z" fill="#6E5E52" />
          <path d="M118 96 Q130 82 142 96 M158 96 Q170 82 182 96 M126 140 Q138 126 150 140 M150 176 Q162 162 174 176" stroke="#8E7E70" strokeWidth="4" fill="none" />
        </Wrap>
      );
    case "skinny":
      return (
        <Wrap>
          <path d="M118 40 L182 40 L176 216 L160 216 L154 120 L146 216 L124 216 Z" fill="#8A8A93" />
          <path d="M128 86 L172 86 M126 130 L174 130" stroke="#fff" strokeWidth="2" opacity=".4" />
        </Wrap>
      );
    case "shorts":
      return (
        <Wrap>
          <path d="M150 48 C172 48 184 62 186 82 L176 128 L124 128 C116 62 128 48 150 48 Z" fill="#8A8A93" />
          <path d="M124 126 L176 128 L184 196 L154 196 L150 150 L144 196 L116 196 Z" fill="#B4B4BC" />
        </Wrap>
      );
    case "sandals":
      return (
        <Wrap>
          <path d="M70 150 L210 150 C222 150 228 162 220 172 L70 172 Z" fill="#8A8A93" />
          <path d="M96 150 C110 118 150 118 164 150" stroke="#C8C8D0" strokeWidth="10" fill="none" />
        </Wrap>
      );
    default:
      return (
        <Wrap>
          <rect x="70" y="70" width="160" height="120" rx="12" fill="#8A8A93" />
        </Wrap>
      );
  }
}
