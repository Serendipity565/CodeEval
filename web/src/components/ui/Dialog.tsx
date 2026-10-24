import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./index";

export default function Dialog({
  title,
  note,
  children,
  onClose,
  wide = false,
  flush = false,
  dismissible = true,
  className = "",
}: {
  title: string;
  note?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  flush?: boolean;
  dismissible?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const noteId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className={`submission-dialog${wide ? " submission-dialog-wide" : ""}${flush ? " submission-dialog-flush" : ""}${className ? ` ${className}` : ""}`}
      aria-labelledby={titleId}
      aria-describedby={note ? noteId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="submission-dialog-surface">
        <header className="submission-dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {note && <p id={noteId}>{note}</p>}
          </div>
          <button
            type="button"
            className="dialog-close"
            onClick={onClose}
            aria-label="关闭弹窗"
            autoFocus
            disabled={!dismissible}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="submission-dialog-body">{children}</div>
      </div>
    </dialog>,
    document.body,
  );
}
