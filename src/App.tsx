import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { inspectH5 } from "./h5";
import { loadSelectedFile } from "./load";
import { cleanupTemporaryStorage, copyToTemporaryStorage } from "./opfs";
import { clampSample, navigationFromKey, shouldIgnoreShortcut } from "./playback";
import { SignalChart } from "./SignalChart";
import type { H5Summary, LoadedDelivery, Locale, Sequence, Taxonomy } from "./types";

const H5Advanced = lazy(() => import("./H5Advanced"));

const COPY = {
  zh: {
    title: "CW12EU-T 数据查看器", subtitle: "本地、只读的客户交付检查工具",
    private: "所选文件仅在此浏览器中处理，不会上传。", drop: "拖放文件到这里，或点击选择",
    support: "支持客户交付 v2 ZIP、HDF5 3.1.0 和客户单 H5 原型", overview: "概览", recordings: "录制与视频",
    hdf5: "HDF5 结构", package: "交付清单", hash: "未自动校验 SHA-256；当前只完成结构和大小检查。",
    noVideo: "训练 HDF5 不含视频或冻结标签名称；可用时间控制和快捷键检查 IMU。", embedded: "客户单 H5 包含视频和冻结标签名称；文件仍只在本机浏览器中读取。",
    loading: "正在本地读取数据…", close: "关闭文件", clear: "清理临时浏览器存储", samples: "样本", sequences: "录制", annotations: "标注",
    duration: "总时长", labels: "当前位置标注", none: "无", accel: "加速度 · m/s²", gyro: "角速度 · rad/s",
    detail: "当前附近", files: "文件清单", advanced: "高级 HDF5 浏览器", selectRecording: "选择录制",
    advancedIntro: "高级结构检查由 H5Web 提供，并在独立视图中打开，避免干扰同步播放。", openAdvanced: "打开高级 HDF5 视图",
    back: "返回数据查看器", play: "播放", pause: "暂停", start: "开头", end: "末尾", previousSecond: "后退 1 秒",
    previousSample: "上一样本", nextSample: "下一样本", nextSecond: "前进 1 秒", timeline: "录制时间轴",
    noVideoPanel: "此 HDF5 没有视频。使用下方时间轴、按钮或键盘浏览 IMU。", shortcuts: "快捷键：←/→ 1 个样本，PageUp/PageDown 1 秒，空格播放/暂停，Home/End 跳到首尾。",
  },
  en: {
    title: "CW12EU-T Data Viewer", subtitle: "Local, read-only customer delivery inspection",
    private: "Selected files are processed only in this browser and are not uploaded.", drop: "Drop a file here, or click to choose",
    support: "Supports client delivery v2 ZIP, HDF5 3.1.0 and the client single-H5 prototype", overview: "Overview", recordings: "Recordings & video",
    hdf5: "HDF5 structure", package: "Package manifest", hash: "SHA-256 was not recomputed automatically; only structure and sizes were checked.",
    noVideo: "A training HDF5 has no video or frozen label names; use the timeline and shortcuts to inspect IMU.", embedded: "The client HDF5 embeds video and frozen label names; it is still read only in your browser.",
    loading: "Reading data locally…", close: "Close file", clear: "Clear temporary browser storage", samples: "Samples", sequences: "Recordings", annotations: "Annotations",
    duration: "Total duration", labels: "Labels at current position", none: "None", accel: "Acceleration · m/s²", gyro: "Angular velocity · rad/s",
    detail: "Around current time", files: "File inventory", advanced: "Advanced HDF5 browser", selectRecording: "Select recording",
    advancedIntro: "H5Web provides advanced structure inspection in a separate view so it does not disrupt synchronized playback.", openAdvanced: "Open advanced HDF5 view",
    back: "Back to data viewer", play: "Play", pause: "Pause", start: "Start", end: "End", previousSecond: "Back 1 second",
    previousSample: "Previous sample", nextSample: "Next sample", nextSecond: "Forward 1 second", timeline: "Recording timeline",
    noVideoPanel: "This HDF5 has no video. Use the timeline, buttons or keyboard to inspect IMU.", shortcuts: "Shortcuts: ←/→ one sample, PageUp/PageDown one second, Space play/pause, Home/End first/last sample.",
  },
};

function codeName(taxonomy: Taxonomy | undefined, code: string) {
  return [...(taxonomy?.fall ?? []), ...(taxonomy?.non_fall ?? [])].find((item) => item.code === code)?.name ?? code;
}

function duration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}` : `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

function FilePicker({ locale, onFile }: { locale: Locale; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const t = COPY[locale];
  const [dragging, setDragging] = useState(false);
  return <main className="landing"><section className="hero">
    <div className="eyebrow">CW12EU-T · LOCAL VIEWER</div><h1>{t.title}</h1><p className="subtitle">{t.subtitle}</p>
    <div className="privacy"><span>●</span>{t.private}</div>
    <button className={`drop-zone ${dragging ? "dragging" : ""}`} onClick={() => input.current?.click()}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files[0]) onFile(event.dataTransfer.files[0]); }}>
      <span className="file-icon">H5</span><strong>{t.drop}</strong><small>{t.support}</small>
    </button>
    <input ref={input} hidden type="file" accept=".zip,.h5,application/zip,application/x-hdf5" onChange={(event) => event.target.files?.[0] && onFile(event.target.files[0])} />
  </section></main>;
}

function VideoPanel({ blob, filename, currentTime, playing, onTime, onPlaying }: {
  blob: Blob; filename: string; currentTime: number; playing: boolean;
  onTime: (time: number) => void; onPlaying: (playing: boolean) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState("");
  const [fallback, setFallback] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const direct = URL.createObjectURL(blob);
    setUrl(direct); setFallback(false); setProgress(0);
    return () => URL.revokeObjectURL(direct);
  }, [blob]);
  useEffect(() => {
    const video = ref.current;
    if (video && Number.isFinite(currentTime) && Math.abs(video.currentTime - currentTime) > 0.08) video.currentTime = Math.max(0, currentTime);
  }, [currentTime, url]);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (playing) void video.play().catch(() => onPlaying(false));
    else video.pause();
  }, [playing, onPlaying, url]);
  return <div className="video-panel">
    {url && <video ref={ref} controls src={url} onPlay={() => onPlaying(true)} onPause={() => onPlaying(false)} onEnded={() => onPlaying(false)}
      onTimeUpdate={(event) => onTime(event.currentTarget.currentTime)} onError={async () => {
        if (fallback) return;
        setFallback(true);
        try {
          const stored = await copyToTemporaryStorage(blob, filename, setProgress);
          setUrl((old) => { URL.revokeObjectURL(old); return URL.createObjectURL(stored); });
        } catch (error) { setUrl(""); alert(error instanceof Error ? error.message : String(error)); }
      }} />}
    {fallback && progress < 1 && <div className="progress"><span style={{ width: `${progress * 100}%` }} /></div>}
  </div>;
}

function PlaybackControls({ locale, cursor, start, stop, playing, onPlaying, onSeek }: {
  locale: Locale; cursor: number; start: number; stop: number; playing: boolean;
  onPlaying: (playing: boolean) => void; onSeek: (sample: number) => void;
}) {
  const t = COPY[locale];
  const last = Math.max(start, stop - 1);
  const current = Math.max(0, cursor - start) / 25;
  return <section className="playback" aria-label={t.timeline}>
    <div className="playback-buttons">
      <button onClick={() => onSeek(start)}>{t.start}</button>
      <button onClick={() => onSeek(cursor - 25)} title={t.previousSecond}>−1 s</button>
      <button onClick={() => onSeek(cursor - 1)} title={t.previousSample}>−1</button>
      <button className="play" onClick={() => onPlaying(!playing)}>{playing ? t.pause : t.play}</button>
      <button onClick={() => onSeek(cursor + 1)} title={t.nextSample}>+1</button>
      <button onClick={() => onSeek(cursor + 25)} title={t.nextSecond}>+1 s</button>
      <button onClick={() => onSeek(last)}>{t.end}</button>
    </div>
    <input type="range" min={start} max={last} step={1} value={clampSample(cursor, start, stop)} aria-label={t.timeline}
      onChange={(event) => onSeek(Number(event.target.value))} />
    <output>{duration(current)} / {duration(Math.max(0, stop - start) / 25)} · {cursor - start} / {Math.max(0, stop - start - 1)}</output>
    <small>{t.shortcuts}</small>
  </section>;
}

function sequenceAnnotations(summary: H5Summary, sequenceIndex: number) {
  return summary.annotations.filter((item) => item.sequence_index === sequenceIndex);
}

export default function ViewerApp() {
  const locale: Locale = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  const t = COPY[locale];
  const [delivery, setDelivery] = useState<LoadedDelivery>();
  const [summary, setSummary] = useState<H5Summary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"overview" | "recordings" | "hdf5" | "package">("overview");
  const [advanced, setAdvanced] = useState(false);
  const [selected, setSelected] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [detailSeconds, setDetailSeconds] = useState(5);
  useEffect(() => { void cleanupTemporaryStorage(); }, []);

  const load = async (file: File) => {
    setBusy(true); setError(""); setDelivery(undefined); setSummary(undefined); setAdvanced(false);
    try {
      await cleanupTemporaryStorage();
      const next = await loadSelectedFile(file);
      const h5 = await inspectH5(next.h5File);
      const finalStop = next.manifest?.recordings.at(-1)?.merged_sample_stop;
      if (finalStop !== undefined && h5.sampleCount !== finalStop) throw new Error("HDF5 sample count does not match the package manifest");
      setDelivery(next); setSummary(h5); setSelected(0); setCursor(h5.sequences[0]?.sample_start ?? 0); setTab("overview");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const sequence: Sequence | undefined = summary?.sequences[selected];
  const packaged = delivery?.recordings.find((item) => item.manifest.sequence_index === selected);
  const embeddedVideo = summary?.embedded?.videos.find((item) => item.sequence_index === selected);
  const embeddedTaxonomy = useMemo<Taxonomy | undefined>(() => {
    const embedded = summary?.embedded;
    const version = embedded?.sequenceTaxonomies.find((item) => item.sequence_index === selected);
    if (!embedded || !version) return undefined;
    const entries = embedded.labels.filter((item) => item.taxonomy_id === version.taxonomy_id && item.taxonomy_version === version.taxonomy_version);
    return {
      schema_version: "cw12eu_activity_taxonomy_v1",
      taxonomy_id: version.taxonomy_id,
      version: version.taxonomy_version,
      fall: entries.filter((item) => item.is_fall).map(({ code, name, active }) => ({ code, name, active })),
      non_fall: entries.filter((item) => !item.is_fall).map(({ code, name, active }) => ({ code, name, active })),
    };
  }, [summary?.embedded, selected]);
  const media = useMemo(() => {
    if (packaged) return { blob: packaged.video, taxonomy: packaged.taxonomy, videoZero: packaged.view.sample_zero_video_media_time_ns / 1e9 };
    if (embeddedVideo && delivery) return {
      blob: delivery.source.slice(embeddedVideo.file_offset, embeddedVideo.file_offset + embeddedVideo.byte_length, embeddedVideo.content_type),
      taxonomy: embeddedTaxonomy,
      videoZero: embeddedVideo.sample_zero_video_media_time_ns / 1e9,
    };
    return undefined;
  }, [delivery, embeddedTaxonomy, embeddedVideo, packaged]);
  const sampleStart = packaged?.manifest.merged_sample_start ?? sequence?.sample_start ?? 0;
  const sampleStop = packaged?.manifest.merged_sample_stop ?? sequence?.sample_stop ?? summary?.sampleCount ?? 0;
  const seek = useCallback((sample: number) => setCursor(clampSample(sample, sampleStart, sampleStop)), [sampleStart, sampleStop]);
  const annotations = useMemo(() => packaged?.view.annotations ?? (summary ? sequenceAnnotations(summary, selected) : []), [packaged, summary, selected]);
  useEffect(() => { setCursor(sampleStart); setPlaying(false); }, [sampleStart]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcut(event.target) || advanced) return;
      const delta = navigationFromKey(event.key);
      if (delta !== undefined) { event.preventDefault(); setPlaying(false); seek(cursor + delta); }
      else if (event.key === " ") { event.preventDefault(); setPlaying((value) => !value); }
      else if (event.key === "Home") { event.preventDefault(); setPlaying(false); seek(sampleStart); }
      else if (event.key === "End") { event.preventDefault(); setPlaying(false); seek(sampleStop - 1); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [advanced, cursor, sampleStart, sampleStop, seek]);
  useEffect(() => {
    if (!playing || media || sampleStop <= sampleStart) return;
    const timer = window.setInterval(() => {
      setCursor((value) => {
        if (value >= sampleStop - 1) { setPlaying(false); return sampleStop - 1; }
        return value + 1;
      });
    }, 40);
    return () => window.clearInterval(timer);
  }, [media, playing, sampleStart, sampleStop]);
  const relativeCursor = cursor - sampleStart;
  const activeLabels = annotations.filter((item) => item.kind === "activity" ? relativeCursor >= item.start_sample && relativeCursor < item.stop_sample : relativeCursor === item.start_sample);

  if (!delivery || !summary) return <><FilePicker locale={locale} onFile={(file) => void load(file)} />{(busy || error) && <div className={`status-toast ${error ? "error" : ""}`}>{busy ? t.loading : error}</div>}</>;

  const close = () => { setPlaying(false); setDelivery(undefined); setSummary(undefined); setAdvanced(false); };
  if (advanced) return <div className="advanced-shell">
    <header className="advanced-header"><div><div className="eyebrow">CW12EU-T · HDF5</div><h1>{t.advanced}</h1></div><button className="secondary" onClick={() => setAdvanced(false)}>{t.back}</button></header>
    <main className="advanced-stage"><Suspense fallback={<div className="h5-loading">{t.loading}</div>}><H5Advanced file={delivery.h5File} /></Suspense></main>
  </div>;

  return <div className="app-shell">
    <header className="topbar"><div><div className="eyebrow">CW12EU-T · LOCAL VIEWER</div><h1>{t.title}</h1></div>
      <div className="header-actions"><span className="local-pill">● {t.private}</span><button className="secondary" onClick={close}>{t.close}</button></div></header>
    <div className="warning">{delivery.manifest ? t.hash : summary.embedded ? t.embedded : t.noVideo}</div>
    <nav className="tabs">{(["overview", "recordings", "hdf5", "package"] as const).map((item) => item !== "package" || delivery.manifest ? <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{t[item]}</button> : null)}</nav>

    {tab === "overview" && <main className="content">
      <section className="metrics"><article><span>{t.samples}</span><strong>{summary.sampleCount.toLocaleString()}</strong></article><article><span>{t.duration}</span><strong>{duration(summary.sampleCount / 25)}</strong></article><article><span>{t.sequences}</span><strong>{summary.sequences.length}</strong></article><article><span>{t.annotations}</span><strong>{summary.annotations.length}</strong></article></section>
      <section className="card"><div className="section-title"><div><span>{t.selectRecording}</span><strong>{sequence?.recording_id}</strong></div><select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>{summary.sequences.map((item, index) => <option key={`${item.recording_id}-${index}`} value={index}>{index.toString().padStart(4, "0")} · {item.participant_id} · {item.recording_id}</option>)}</select></div>
        <SignalChart samples={summary.samples} sampleStart={sampleStart} sampleStop={sampleStop} cursor={cursor} channels={[0,1,2]} annotations={annotations} onSeek={seek} ariaLabel={t.accel} /><div className="legend"><span className="ax">ax</span><span className="ay">ay</span><span className="az">az</span><span className="cursor">{(relativeCursor / 25).toFixed(3)} s</span></div></section>
    </main>}

    {tab === "recordings" && <main className="content split">
      <aside className="recording-list">{summary.sequences.map((item, index) => <button key={`${item.recording_id}-${index}`} className={selected === index ? "active" : ""} onClick={() => setSelected(index)}><strong>{index.toString().padStart(4, "0")} · {item.participant_id}</strong><span>{item.recording_id}</span><small>{duration((item.sample_stop-item.sample_start)/25)}</small></button>)}</aside>
      <div className="recording-main">{media ? <VideoPanel blob={media.blob} filename={`${selected}.mp4`} currentTime={media.videoZero + relativeCursor / 25} playing={playing} onPlaying={setPlaying}
        onTime={(time) => seek(sampleStart + (time - media.videoZero) * 25)} /> : <div className="empty-video compact"><strong>{t.noVideoPanel}</strong></div>}
        <PlaybackControls locale={locale} cursor={cursor} start={sampleStart} stop={sampleStop} playing={playing} onPlaying={setPlaying} onSeek={(sample) => { setPlaying(false); seek(sample); }} />
        <section className="card chart-stack"><div className="chart-toolbar"><strong>{t.detail} {detailSeconds} s</strong><div>{[2,5,10].map((value) => <button key={value} className={detailSeconds === value ? "active" : ""} onClick={() => setDetailSeconds(value)}>{value} s</button>)}</div></div>
          <label>{t.accel}</label><label>{t.gyro}</label><SignalChart samples={summary.samples} sampleStart={sampleStart} sampleStop={sampleStop} cursor={cursor} channels={[0,1,2]} annotations={annotations} detailSeconds={detailSeconds} onSeek={seek} ariaLabel={t.accel} /><SignalChart samples={summary.samples} sampleStart={sampleStart} sampleStop={sampleStop} cursor={cursor} channels={[3,4,5]} annotations={annotations} detailSeconds={detailSeconds} onSeek={seek} ariaLabel={t.gyro} />
          <div className="labels"><strong>{t.labels}</strong>{activeLabels.length ? activeLabels.map((item, index) => <span key={`${item.kind}-${item.start_sample}-${index}`}>{item.kind} · {codeName(media?.taxonomy, item.code)}</span>) : <span>{t.none}</span>}</div></section>
      </div>
    </main>}

    {tab === "hdf5" && <main className="content"><section className="card metadata"><h2>{t.advanced}</h2><p className="muted">{t.advancedIntro}</p><div className="attributes">{Object.entries(summary.attrs).map(([key,value]) => <div key={key}><span>{key}</span><code>{Array.isArray(value) ? value.join(", ") : String(value)}</code></div>)}</div><button className="primary-action" onClick={() => setAdvanced(true)}>{t.openAdvanced}</button></section></main>}
    {tab === "package" && delivery.manifest && <main className="content"><section className="card"><h2>{t.files}</h2><div className="file-table">{delivery.manifest.files.map((item) => <div key={item.path}><code>{item.path}</code><span>{item.role}</span><span>{(item.size_bytes/1024/1024).toFixed(2)} MiB</span></div>)}</div><details><summary>manifest.json</summary><pre>{JSON.stringify(delivery.manifest, null, 2)}</pre></details></section></main>}
    <footer><span>{delivery.source.name} · {(delivery.source.size/1024/1024).toFixed(1)} MiB</span><button className="link" onClick={() => void cleanupTemporaryStorage()}>{t.clear}</button></footer>
  </div>;
}
