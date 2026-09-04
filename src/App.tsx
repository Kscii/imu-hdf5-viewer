import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { inspectH5 } from "./h5";
import { loadSelectedFile } from "./load";
import { cleanupTemporaryStorage, copyToTemporaryStorage } from "./opfs";
import { SignalChart } from "./SignalChart";
import type { H5Summary, LoadedDelivery, Locale, Sequence, Taxonomy } from "./types";

const H5Advanced = lazy(() => import("./H5Advanced"));

const COPY = {
  zh: {
    title: "CW12EU-T 数据查看器", subtitle: "本地、只读的客户交付检查工具",
    private: "所选文件仅在此浏览器中处理，不会上传。", drop: "拖放文件到这里，或点击选择",
    support: "支持客户交付 v2 ZIP 和 HDF5 3.1.0", overview: "概览", recordings: "录制与视频",
    hdf5: "HDF5 结构", package: "交付清单", hash: "未自动校验 SHA-256；当前只完成结构和大小检查。",
    noVideo: "单独 HDF5 不包含视频或冻结标签名称；页面只显示稳定 code。", loading: "正在本地读取数据…",
    close: "关闭文件", clear: "清理临时浏览器存储", samples: "样本", sequences: "录制", annotations: "标注",
    duration: "总时长", labels: "当前位置标注", none: "无", accel: "加速度 · m/s²", gyro: "角速度 · rad/s",
    detail: "当前附近", files: "文件清单", advanced: "高级 HDF5 浏览器", selectRecording: "选择录制",
  },
  en: {
    title: "CW12EU-T Data Viewer", subtitle: "Local, read-only customer delivery inspection",
    private: "Selected files are processed only in this browser and are not uploaded.", drop: "Drop a file here, or click to choose",
    support: "Supports client delivery v2 ZIP and HDF5 3.1.0", overview: "Overview", recordings: "Recordings & video",
    hdf5: "HDF5 structure", package: "Package manifest", hash: "SHA-256 was not recomputed automatically; only structure and sizes were checked.",
    noVideo: "A standalone HDF5 has no video or frozen label names; stable codes are shown.", loading: "Reading data locally…",
    close: "Close file", clear: "Clear temporary browser storage", samples: "Samples", sequences: "Recordings", annotations: "Annotations",
    duration: "Total duration", labels: "Labels at current position", none: "None", accel: "Acceleration · m/s²", gyro: "Angular velocity · rad/s",
    detail: "Around current time", files: "File inventory", advanced: "Advanced HDF5 browser", selectRecording: "Select recording",
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

function VideoPanel({ blob, filename, currentTime, onTime }: { blob: Blob; filename: string; currentTime: number; onTime: (time: number) => void }) {
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
  return <div className="video-panel">
    {url && <video ref={ref} controls src={url} onTimeUpdate={(event) => onTime(event.currentTarget.currentTime)} onError={async () => {
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
  const [selected, setSelected] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [detailSeconds, setDetailSeconds] = useState(5);
  useEffect(() => { void cleanupTemporaryStorage(); }, []);

  const load = async (file: File) => {
    setBusy(true); setError(""); setDelivery(undefined); setSummary(undefined);
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
  const sampleStart = packaged?.manifest.merged_sample_start ?? sequence?.sample_start ?? 0;
  const sampleStop = packaged?.manifest.merged_sample_stop ?? sequence?.sample_stop ?? summary?.sampleCount ?? 0;
  const annotations = useMemo(() => packaged?.view.annotations ?? (summary ? sequenceAnnotations(summary, selected) : []), [packaged, summary, selected]);
  useEffect(() => { setCursor(sampleStart); }, [sampleStart]);
  const relativeCursor = cursor - sampleStart;
  const videoZero = (packaged?.view.sample_zero_video_media_time_ns ?? 0) / 1e9;
  const activeLabels = annotations.filter((item) => item.kind === "activity" ? relativeCursor >= item.start_sample && relativeCursor < item.stop_sample : relativeCursor === item.start_sample);

  if (!delivery || !summary) return <><FilePicker locale={locale} onFile={(file) => void load(file)} />{(busy || error) && <div className={`status-toast ${error ? "error" : ""}`}>{busy ? t.loading : error}</div>}</>;

  return <div className="app-shell">
    <header className="topbar"><div><div className="eyebrow">CW12EU-T · LOCAL VIEWER</div><h1>{t.title}</h1></div>
      <div className="header-actions"><span className="local-pill">● {t.private}</span><button className="secondary" onClick={() => { setDelivery(undefined); setSummary(undefined); }}>{t.close}</button></div></header>
    <div className="warning">{delivery.manifest ? t.hash : t.noVideo}</div>
    <nav className="tabs">{(["overview", "recordings", "hdf5", "package"] as const).map((item) => item !== "package" || delivery.manifest ? <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{t[item]}</button> : null)}</nav>

    {tab === "overview" && <main className="content">
      <section className="metrics"><article><span>{t.samples}</span><strong>{summary.sampleCount.toLocaleString()}</strong></article><article><span>{t.duration}</span><strong>{duration(summary.sampleCount / 25)}</strong></article><article><span>{t.sequences}</span><strong>{summary.sequences.length}</strong></article><article><span>{t.annotations}</span><strong>{summary.annotations.length}</strong></article></section>
      <section className="card"><div className="section-title"><div><span>{t.selectRecording}</span><strong>{sequence?.recording_id}</strong></div><select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>{summary.sequences.map((item, index) => <option key={`${item.recording_id}-${index}`} value={index}>{index.toString().padStart(4, "0")} · {item.participant_id} · {item.recording_id}</option>)}</select></div>
        <SignalChart samples={summary.samples} sampleStart={sampleStart} sampleStop={sampleStop} cursor={cursor} channels={[0,1,2]} annotations={annotations} onSeek={setCursor} ariaLabel={t.accel} /><div className="legend"><span className="ax">ax</span><span className="ay">ay</span><span className="az">az</span><span className="cursor">{(relativeCursor / 25).toFixed(3)} s</span></div></section>
    </main>}

    {tab === "recordings" && <main className="content split">
      <aside className="recording-list">{summary.sequences.map((item, index) => <button key={`${item.recording_id}-${index}`} className={selected === index ? "active" : ""} onClick={() => setSelected(index)}><strong>{index.toString().padStart(4, "0")} · {item.participant_id}</strong><span>{item.recording_id}</span><small>{duration((item.sample_stop-item.sample_start)/25)}</small></button>)}</aside>
      <div className="recording-main">{packaged ? <VideoPanel blob={packaged.video} filename={`${selected}.mp4`} currentTime={videoZero + relativeCursor / 25} onTime={(time) => setCursor(Math.min(sampleStop - 1, Math.max(sampleStart, Math.round(sampleStart + (time - videoZero) * 25))))} /> : <div className="empty-video">{t.noVideo}</div>}
        <section className="card chart-stack"><div className="chart-toolbar"><strong>{t.detail} {detailSeconds} s</strong><div>{[2,5,10].map((value) => <button key={value} className={detailSeconds === value ? "active" : ""} onClick={() => setDetailSeconds(value)}>{value} s</button>)}</div></div>
          <label>{t.accel}</label><label>{t.gyro}</label><SignalChart samples={summary.samples} sampleStart={sampleStart} sampleStop={sampleStop} cursor={cursor} channels={[0,1,2]} annotations={annotations} detailSeconds={detailSeconds} onSeek={setCursor} ariaLabel={t.accel} /><SignalChart samples={summary.samples} sampleStart={sampleStart} sampleStop={sampleStop} cursor={cursor} channels={[3,4,5]} annotations={annotations} detailSeconds={detailSeconds} onSeek={setCursor} ariaLabel={t.gyro} />
          <div className="labels"><strong>{t.labels}</strong>{activeLabels.length ? activeLabels.map((item, index) => <span key={`${item.kind}-${item.start_sample}-${index}`}>{item.kind} · {codeName(packaged?.taxonomy, item.code)}</span>) : <span>{t.none}</span>}</div></section>
      </div>
    </main>}

    {tab === "hdf5" && <main className="content"><section className="card metadata"><h2>{t.advanced}</h2><div className="attributes">{Object.entries(summary.attrs).map(([key,value]) => <div key={key}><span>{key}</span><code>{Array.isArray(value) ? value.join(", ") : String(value)}</code></div>)}</div><div className="h5web"><Suspense fallback={<div className="h5-loading">{t.loading}</div>}><H5Advanced file={delivery.h5File} /></Suspense></div></section></main>}
    {tab === "package" && delivery.manifest && <main className="content"><section className="card"><h2>{t.files}</h2><div className="file-table">{delivery.manifest.files.map((item) => <div key={item.path}><code>{item.path}</code><span>{item.role}</span><span>{(item.size_bytes/1024/1024).toFixed(2)} MiB</span></div>)}</div><details><summary>manifest.json</summary><pre>{JSON.stringify(delivery.manifest, null, 2)}</pre></details></section></main>}
    <footer><span>{delivery.source.name} · {(delivery.source.size/1024/1024).toFixed(1)} MiB</span><button className="link" onClick={() => void cleanupTemporaryStorage()}>{t.clear}</button></footer>
  </div>;
}
