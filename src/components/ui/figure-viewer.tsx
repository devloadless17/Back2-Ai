'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

/**
 * A question's figure, which opens full screen and zooms.
 *
 * It used to be a link to the image in a new tab. In a timed exam that takes
 * the student off the paper, and on a phone a page-sized figure shown at
 * thumbnail width could not be read at all (a biology question showed its
 * whole scanned page at 250px). Here a tap opens a native <dialog> over the
 * question; the figure zooms with the buttons, Ctrl/⌘ + wheel or a pinch, pans
 * by dragging or scrolling, and closes with Esc, × or a tap outside.
 *
 * Labels are read from <html lang> rather than the i18n context because
 * QuestionBody also renders outside the app's provider (marketing previews).
 */

const LABELS = {
  en: { open: 'Open figure full size', zoomIn: 'Zoom in', zoomOut: 'Zoom out', reset: 'Fit to screen', close: 'Close' },
  fr: { open: 'Agrandir la figure', zoomIn: 'Zoomer', zoomOut: 'Dézoomer', reset: 'Ajuster à l’écran', close: 'Fermer' },
  ar: { open: 'تكبير الشكل', zoomIn: 'تكبير', zoomOut: 'تصغير', reset: 'ملاءمة الشاشة', close: 'إغلاق' },
} as const;

type Labels = (typeof LABELS)[keyof typeof LABELS];

const MIN = 1;
const MAX = 6;
const STEP = 1.5;

function labelsFor(): Labels {
  if (typeof document === 'undefined') return LABELS.en;
  const lang = document.documentElement.lang.slice(0, 2) as keyof typeof LABELS;
  return LABELS[lang] ?? LABELS.en;
}

export function FigureViewer({ src, className, wide }: { src: string; className?: string; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(MIN);
  const [labels, setLabels] = useState<Labels>(LABELS.en);

  useEffect(() => setLabels(labelsFor()), []);

  const open = () => {
    setZoom(MIN);
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();

  /** Zoom about the centre of what is on screen, so the part being read stays put. */
  const zoomTo = useCallback((next: number) => {
    const el = stage.current;
    setZoom((current) => {
      const target = Math.min(MAX, Math.max(MIN, next));
      if (el && target !== current) {
        const cx = (el.scrollLeft + el.clientWidth / 2) / current;
        const cy = (el.scrollTop + el.clientHeight / 2) / current;
        requestAnimationFrame(() => {
          el.scrollLeft = cx * target - el.clientWidth / 2;
          el.scrollTop = cy * target - el.clientHeight / 2;
        });
      }
      return target;
    });
  }, []);

  // Ctrl/⌘ + wheel (and a trackpad pinch, which browsers report the same way).
  useEffect(() => {
    const el = stage.current;
    if (!el) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((current) => {
        const target = Math.min(MAX, Math.max(MIN, current * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
        return target;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (zoom === MIN || event.pointerType === 'touch') return; // touch pans natively
    const el = stage.current!;
    drag.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    const el = stage.current!;
    el.scrollLeft = start.left - (event.clientX - start.x);
    el.scrollTop = start.top - (event.clientY - start.y);
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const button =
    'grid h-10 min-w-10 place-items-center rounded-full bg-paper-raised/95 px-3 text-lg text-ink shadow ring-1 ring-rule hover:bg-paper disabled:opacity-40';

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label={labels.open}
        title={labels.open}
        className={cn('group relative cursor-zoom-in', wide && 'w-full', className)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          loading="lazy"
          className={cn('rounded border border-rule bg-paper-raised', wide ? 'w-full' : 'max-h-96 w-auto max-w-full')}
        />
        <span
          aria-hidden
          className="absolute bottom-2 end-2 grid h-8 w-8 place-items-center rounded-full bg-paper-raised/90 text-ink shadow ring-1 ring-rule opacity-80 group-hover:opacity-100"
        >
          ⤢
        </span>
      </button>

      <dialog
        ref={dialog}
        onClick={(event) => {
          // A tap on the backdrop (the dialog itself, not its content) closes it.
          if (event.target === dialog.current) close();
        }}
        className="m-0 h-[100dvh] max-h-none w-screen max-w-none bg-transparent p-0 backdrop:bg-black/80"
      >
        <div className="flex h-full w-full flex-col">
          <div className="flex items-center justify-end gap-2 p-3" dir="ltr">
            <button type="button" className={button} onClick={() => zoomTo(zoom / STEP)} disabled={zoom <= MIN} aria-label={labels.zoomOut} title={labels.zoomOut}>
              −
            </button>
            <span className="min-w-14 text-center text-sm tabular-nums text-white">{Math.round(zoom * 100)}%</span>
            <button type="button" className={button} onClick={() => zoomTo(zoom * STEP)} disabled={zoom >= MAX} aria-label={labels.zoomIn} title={labels.zoomIn}>
              +
            </button>
            <button type="button" className={button} onClick={() => zoomTo(MIN)} disabled={zoom === MIN} aria-label={labels.reset} title={labels.reset}>
              ⤾
            </button>
            <button type="button" className={button} onClick={close} aria-label={labels.close} title={labels.close}>
              ×
            </button>
          </div>

          <div
            ref={stage}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => zoomTo(zoom === MIN ? 2.5 : MIN)}
            className={cn(
              'min-h-0 flex-1 overflow-auto overscroll-contain',
              zoom > MIN ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in',
            )}
            style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
          >
            {/*
              At 100% the figure fits the screen. Zooming widens the box it
              sits in, so the browser's own scrolling does the panning.
            */}
            <div
              className="flex min-h-full items-center justify-center p-4"
              style={{ width: `${zoom * 100}%`, minWidth: '100%' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt=""
                draggable={false}
                className="max-w-full select-none rounded bg-white"
                style={zoom === MIN ? { maxHeight: 'calc(100dvh - 6rem)' } : { width: '100%' }}
              />
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
