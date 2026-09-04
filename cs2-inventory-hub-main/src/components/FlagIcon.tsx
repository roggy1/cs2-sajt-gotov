type FlagCode = "gb" | "rs" | "de" | "ru" | "es" | "pt";

interface FlagIconProps {
  code: FlagCode;
  className?: string;
}

/**
 * Small inline SVG flags.
 * Using real SVGs instead of flag emoji because flag emoji don't render
 * as actual flags on Windows (shows letters like "GB" / "RS" instead).
 */
export function FlagIcon({ code, className }: FlagIconProps) {
  const cls = className ?? "h-3.5 w-5 rounded-[2px]";

  if (code === "gb") {
    return (
      <svg viewBox="0 0 60 36" className={cls} aria-hidden="true">
        <rect width="60" height="36" fill="#00247d" />
        <path d="M0 0 60 36M60 0 0 36" stroke="#fff" strokeWidth="6" />
        <path d="M0 0 60 36M60 0 0 36" stroke="#cf142b" strokeWidth="2" />
        <path d="M30 0V36M0 18H60" stroke="#fff" strokeWidth="10" />
        <path d="M30 0V36M0 18H60" stroke="#cf142b" strokeWidth="6" />
      </svg>
    );
  }

  if (code === "rs") {
    return (
      <svg viewBox="0 0 60 36" className={cls} aria-hidden="true">
        <rect width="60" height="12" y="0" fill="#c6363c" />
        <rect width="60" height="12" y="12" fill="#0c4076" />
        <rect width="60" height="12" y="24" fill="#fff" />
      </svg>
    );
  }

  if (code === "de") {
    return (
      <svg viewBox="0 0 60 36" className={cls} aria-hidden="true">
        <rect width="60" height="12" y="0" fill="#000000" />
        <rect width="60" height="12" y="12" fill="#dd0000" />
        <rect width="60" height="12" y="24" fill="#ffce00" />
      </svg>
    );
  }

  if (code === "ru") {
    return (
      <svg viewBox="0 0 60 36" className={cls} aria-hidden="true">
        <rect width="60" height="12" y="0" fill="#ffffff" />
        <rect width="60" height="12" y="12" fill="#0039a6" />
        <rect width="60" height="12" y="24" fill="#d52b1e" />
      </svg>
    );
  }

  if (code === "es") {
    return (
      <svg viewBox="0 0 60 36" className={cls} aria-hidden="true">
        <rect width="60" height="9" y="0" fill="#aa151b" />
        <rect width="60" height="18" y="9" fill="#f1bf00" />
        <rect width="60" height="9" y="27" fill="#aa151b" />
      </svg>
    );
  }

  // Portugal
  return (
    <svg viewBox="0 0 60 36" className={cls} aria-hidden="true">
      <rect width="24" height="36" x="0" fill="#046a38" />
      <rect width="36" height="36" x="24" fill="#da291c" />
    </svg>
  );
}
