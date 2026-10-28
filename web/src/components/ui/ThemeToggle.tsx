import { useEffect, useId, useRef, useState } from "react";

type Theme = "system" | "light" | "dark";
const key = "codeeval-theme";
const changeEvent = "codeeval-theme-change";
const modes: Theme[] = ["light", "dark", "system"];
const labels: Record<Theme, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};
let sessionTheme: Theme = "system";
function readTheme(): Theme {
  try {
    const value = localStorage.getItem(key);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return sessionTheme;
  }
}
function ThemeIcon({ mode }: { mode: Theme }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {mode === "system" ? (
        <>
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M8 21h8m-4-4v4" />
        </>
      ) : mode === "light" ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
        </>
      ) : (
        <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />
      )}
    </svg>
  );
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const focusIndex = useRef(0);
  const id = useId();
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    const sync = () => setTheme(readTheme());
    const storage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) sync();
    };
    window.addEventListener("storage", storage);
    window.addEventListener(changeEvent, sync);
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener("storage", storage);
      window.removeEventListener(changeEvent, sync);
    };
  }, [theme]);
  useEffect(() => {
    if (!open) return;
    options.current[focusIndex.current]?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const resize = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", resize);
    };
  }, [open]);
  function choose(next: Theme) {
    sessionTheme = next;
    setTheme(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      /* Keep the session preference usable. */
    }
    window.dispatchEvent(new Event(changeEvent));
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div
      className="theme-menu"
      ref={root}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget as Node)
        )
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="theme-toggle"
        id={`${id}-trigger`}
        title={`外观设置：${labels[theme]}`}
        aria-label={`外观设置，当前${labels[theme]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => {
          focusIndex.current = modes.indexOf(theme);
          setOpen((v) => !v);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            focusIndex.current =
              event.key === "ArrowDown" ? 0 : modes.length - 1;
            setOpen(true);
          }
        }}
      >
        <ThemeIcon mode={theme} />
      </button>
      {open && (
        <div
          className="theme-options"
          id={`${id}-menu`}
          role="menu"
          aria-labelledby={`${id}-trigger`}
          onKeyDown={(event) => {
            const index = options.current.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              trigger.current?.focus();
            } else if (
              ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
            ) {
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? modes.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        modes.length) %
                      modes.length;
              options.current[next]?.focus();
            }
          }}
        >
          {modes.map((mode, index) => (
            <button
              key={mode}
              ref={(node) => {
                options.current[index] = node;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={theme === mode}
              tabIndex={-1}
              onClick={() => choose(mode)}
            >
              <ThemeIcon mode={mode} />
              <span>{labels[mode]}</span>
              {theme === mode && (
                <svg
                  className="theme-check"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="m5 12 4 4L19 6" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
