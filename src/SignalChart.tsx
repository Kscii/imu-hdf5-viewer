import { useEffect, useRef } from "react";
import type { Annotation } from "./types";

const COLORS = ["#ff5d73", "#48d597", "#62a4ff", "#ffb33d", "#bf72ff", "#20c8d9"];

interface Props {
  samples: Float32Array;
  sampleStart: number;
  sampleStop: number;
  cursor: number;
  channels: number[];
  annotations?: Annotation[];
  detailSeconds?: number;
  onSeek: (sample: number) => void;
  ariaLabel: string;
}

export function SignalChart({ samples, sampleStart, sampleStop, cursor, channels, annotations = [], detailSeconds, onSeek, ariaLabel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boundsRef = useRef({ left: sampleStart, right: sampleStop });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const paint = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const width = rect.width;
      const height = rect.height;
      ctx.clearRect(0, 0, width, height);
      const pad = { left: 48, right: 12, top: 12, bottom: 24 };
      const plotW = Math.max(1, width - pad.left - pad.right);
      const plotH = Math.max(1, height - pad.top - pad.bottom);
      const half = detailSeconds ? Math.max(1, Math.round(detailSeconds * 25 / 2)) : 0;
      const initialLeft = detailSeconds ? Math.max(sampleStart, cursor - half) : sampleStart;
      const right = detailSeconds ? Math.min(sampleStop, initialLeft + half * 2) : sampleStop;
      const left = detailSeconds ? Math.max(sampleStart, right - half * 2) : initialLeft;
      boundsRef.current = { left, right };
      const span = Math.max(1, right - left);
      const x = (sample: number) => pad.left + ((sample - left) / span) * plotW;

      ctx.fillStyle = "#08172b";
      ctx.fillRect(pad.left, pad.top, plotW, plotH);
      for (const annotation of annotations) {
        if (annotation.kind !== "activity" && annotation.kind !== "exclude") continue;
        const a = sampleStart + annotation.start_sample;
        const b = sampleStart + annotation.stop_sample;
        if (b < left || a > right) continue;
        ctx.fillStyle = annotation.kind === "exclude" ? "rgba(148,163,184,.16)" : annotation.code.includes("fall") ? "rgba(244,63,94,.18)" : "rgba(45,212,191,.10)";
        ctx.fillRect(x(Math.max(a, left)), pad.top, Math.max(1, x(Math.min(b, right)) - x(Math.max(a, left))), plotH);
      }
      ctx.strokeStyle = "#2b405e";
      ctx.lineWidth = 1;
      ctx.fillStyle = "#8094b0";
      ctx.font = "11px ui-monospace, monospace";
      for (let i = 0; i <= 4; i += 1) {
        const yy = pad.top + (plotH * i) / 4;
        ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(width - pad.right, yy); ctx.stroke();
      }
      let min = Infinity;
      let max = -Infinity;
      const pointLimit = Math.max(1, Math.floor(plotW * 1.5));
      const step = Math.max(1, Math.floor(span / pointLimit));
      for (let index = left; index < right; index += step) {
        for (const channel of channels) {
          const value = samples[index * 6 + channel];
          if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
        }
      }
      if (!Number.isFinite(min) || !Number.isFinite(max)) { min = -1; max = 1; }
      if (max - min < 1e-6) { min -= 1; max += 1; }
      const margin = (max - min) * 0.08;
      min -= margin; max += margin;
      const y = (value: number) => pad.top + (1 - (value - min) / (max - min)) * plotH;
      ctx.fillText(max.toFixed(2), 4, pad.top + 4);
      ctx.fillText(min.toFixed(2), 4, pad.top + plotH);
      for (const channel of channels) {
        ctx.strokeStyle = COLORS[channel];
        ctx.lineWidth = 1.35;
        ctx.beginPath();
        let first = true;
        for (let index = left; index < right; index += step) {
          const value = samples[index * 6 + channel];
          if (!Number.isFinite(value)) continue;
          if (first) { ctx.moveTo(x(index), y(value)); first = false; } else ctx.lineTo(x(index), y(value));
        }
        ctx.stroke();
      }
      for (const annotation of annotations) {
        if (annotation.kind !== "impact" && annotation.kind !== "onset") continue;
        const at = sampleStart + annotation.start_sample;
        if (at < left || at > right) continue;
        ctx.strokeStyle = annotation.kind === "impact" ? "#ffd631" : "#ff8c42";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x(at), pad.top); ctx.lineTo(x(at), pad.top + plotH); ctx.stroke();
        ctx.setLineDash([]);
      }
      const cursorX = x(Math.min(right, Math.max(left, cursor)));
      ctx.strokeStyle = "#f8fafc";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cursorX, pad.top); ctx.lineTo(cursorX, pad.top + plotH); ctx.stroke();
      ctx.fillStyle = "#c5d5e9";
      ctx.fillText(`${(left / 25).toFixed(1)} s`, pad.left, height - 6);
      const end = `${(right / 25).toFixed(1)} s`;
      ctx.fillText(end, width - pad.right - ctx.measureText(end).width, height - 6);
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [samples, sampleStart, sampleStop, cursor, channels, annotations, detailSeconds]);

  return <canvas ref={canvasRef} className="signal-chart" aria-label={ariaLabel} onClick={(event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left - 48) / Math.max(1, rect.width - 60)));
    const { left, right } = boundsRef.current;
    onSeek(Math.min(sampleStop - 1, Math.max(sampleStart, Math.round(left + ratio * (right - left)))));
  }} />;
}
