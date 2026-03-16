import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer,
  LineChart, Line, CartesianGrid, PieChart, Pie
} from "recharts";
import {
  Upload, RefreshCw, CheckCircle, XCircle, Layers, TrendingUp, Info,
  FileSpreadsheet, Filter, Calendar, Tag, BarChart3, ChevronDown, ChevronUp
} from "lucide-react";

// ─────────────────────────────────────────────
//  DESIGN TOKENS
// ─────────────────────────────────────────────
const T = {
  bg: "#0D1117", bgCard: "#161B22", bgSurface: "#1C2330",
  bgInput: "#0D1117", bgHover: "#1F2937",
  accent: "#58A6FF", border: "#30363D",
  text: "#E6EDF3", textMuted: "#8B949E", textDim: "#484F58",
  green: "#3FB950", red: "#F85149", orange: "#D29922",
  yellow: "#E3B341", blue: "#58A6FF", purple: "#BC8CFF",
  pink: "#FF7EB3", cyan: "#39D0D8",
  font: "'JetBrains Mono',monospace",
  fontSans: "'DM Sans',sans-serif",
  r: "6px", rLg: "12px"
};

const crdS = {
  background: T.bgCard, border: `1px solid ${T.border}`,
  borderRadius: T.rLg, padding: "18px"
};
const lbS = {
  fontSize: "10px", fontFamily: T.font, color: T.textMuted,
  textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 500,
  display: "flex", alignItems: "center"
};

// ─────────────────────────────────────────────
//  STAT HELPERS
// ─────────────────────────────────────────────
function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}
function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Average Demand Interval
function calcADI(series) {
  const pos = series.map((v, i) => (v > 0 ? i : null)).filter(i => i !== null);
  if (pos.length < 2) return series.length;
  const gaps = [];
  for (let i = 1; i < pos.length; i++) gaps.push(pos[i] - pos[i - 1]);
  return mean(gaps);
}

// CV² of non-zero demand values
function calcCV2(series) {
  const nz = series.filter(v => v > 0);
  if (nz.length < 2) return Infinity;
  const m = mean(nz), s = std(nz);
  return m === 0 ? Infinity : (s / m) ** 2;
}

// Syntetos-Boylan classification
function classify(adi, cv2) {
  if (adi < 1.32 && cv2 < 0.49) return "Smooth";
  if (adi < 1.32 && cv2 >= 0.49) return "Erratic";
  if (adi >= 1.32 && cv2 < 0.49) return "Intermittent";
  return "Lumpy";
}

// Moving average backtest: train 70%, test 30%
function backtestMAPE(series, window = 4) {
  if (series.length < 8) return null;
  const trainEnd = Math.max(window, Math.floor(series.length * 0.7));
  const apes = [];
  for (let t = trainEnd; t < series.length; t++) {
    const w = series.slice(Math.max(0, t - window), t);
    const pred = mean(w);
    const actual = series[t];
    if (actual !== 0) apes.push(Math.abs((actual - pred) / actual));
  }
  return apes.length ? mean(apes) * 100 : null;
}

// Composite Forecastability Score 0–100
function forecastabilityScore(medCV, pctSmooth, mape) {
  const cvScore = Math.max(0, Math.min(100, 100 - medCV * 100));
  const smoothScore = pctSmooth * 100;
  const mapeScore = mape != null ? Math.max(0, Math.min(100, 100 - mape)) : 50;
  return Math.round(cvScore * 0.35 + smoothScore * 0.40 + mapeScore * 0.25);
}

function qualityLabel(score) {
  if (score >= 65) return "GOOD";
  if (score >= 40) return "FAIR";
  return "POOR";
}
function qualityColor(score) {
  if (score >= 65) return T.green;
  if (score >= 40) return T.orange;
  return T.red;
}

// All non-empty subsets of an array
function allSubsets(cols) {
  const result = [];
  for (let mask = 1; mask < (1 << cols.length); mask++) {
    const subset = cols.filter((_, i) => mask & (1 << i));
    result.push(subset);
  }
  return result.sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()));
}

// Parse currency strings: "$56" → 56
function parseCurrency(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[$,\s]/g, ""));
    return isNaN(n) ? null : n;
  }
  return null;
}

// Sortable date string
function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  if (!isNaN(d)) return d.toISOString();
  return String(v);
}

// ─────────────────────────────────────────────
//  ANALYSIS ENGINE
// ─────────────────────────────────────────────
const CLS_COLORS = { Smooth: T.green, Erratic: T.orange, Intermittent: T.yellow, Lumpy: T.red };

function analyzeLevel(rows, targetCol, dateCol, grainCols, filterCol, filterVal) {
  let filtered = rows;
  if (filterCol && filterVal) {
    filtered = rows.filter(r => String(r[filterCol]) === String(filterVal));
  }

  const levels = [{ key: "Total", cols: [] }];
  if (grainCols.length > 0) {
    allSubsets(grainCols).forEach(subset =>
      levels.push({ key: subset.join(" + "), cols: subset })
    );
  }

  return levels.map(level => {
    const seriesMap = {};
    filtered.forEach(row => {
      const grainKey = level.cols.length
        ? level.cols.map(c => String(row[c] ?? "")).join(" | ")
        : "__total__";
      const date = parseDate(row[dateCol]);
      const qty = parseCurrency(row[targetCol]);
      if (date == null || qty == null) return;
      if (!seriesMap[grainKey]) seriesMap[grainKey] = {};
      seriesMap[grainKey][date] = (seriesMap[grainKey][date] || 0) + qty;
    });

    const seriesArrays = Object.entries(seriesMap).map(([key, dateMap]) => {
      const sorted = Object.entries(dateMap).sort(([a], [b]) => (a < b ? -1 : 1));
      return { key, values: sorted.map(([, v]) => v), dates: sorted.map(([d]) => d) };
    });

    const seriesMetrics = seriesArrays.map(s => {
      const adi = calcADI(s.values);
      const cv2 = calcCV2(s.values);
      const cv = cv2 === Infinity ? 9999 : Math.sqrt(cv2);
      const cls = classify(adi, cv2);
      const mape = backtestMAPE(s.values);
      return { key: s.key, n: s.values.length, adi, cv2, cv, cls, mape, values: s.values, dates: s.dates };
    });

    const valid = seriesMetrics.filter(s => s.n >= 6);
    if (!valid.length) {
      return { level: level.key, cols: level.cols, numSeries: seriesArrays.length, skipped: true, score: 0, seriesMetrics: [] };
    }

    const cvs = valid.map(s => s.cv).filter(v => v < 9999);
    const medCV = cvs.length ? median(cvs) : 1;
    const pctSmooth = valid.filter(s => s.cls === "Smooth").length / valid.length;
    const mapes = valid.map(s => s.mape).filter(v => v != null);
    const avgMAPE = mapes.length ? mean(mapes) : null;
    const score = forecastabilityScore(medCV, pctSmooth, avgMAPE);

    const clsCounts = { Smooth: 0, Erratic: 0, Intermittent: 0, Lumpy: 0 };
    valid.forEach(s => { clsCounts[s.cls] = (clsCounts[s.cls] || 0) + 1; });

    return {
      level: level.key, cols: level.cols,
      numSeries: seriesArrays.length, avgN: Math.round(mean(valid.map(s => s.n))),
      medianCV: +medCV.toFixed(3), pctSmooth: +(pctSmooth * 100).toFixed(1),
      avgMAPE: avgMAPE != null ? +avgMAPE.toFixed(1) : null,
      score, quality: qualityLabel(score), clsCounts,
      seriesMetrics: valid.sort((a, b) => b.n - a.n),
      skipped: false
    };
  }).sort((a, b) => b.score - a.score);
}

// ─────────────────────────────────────────────
//  UI COMPONENTS
// ─────────────────────────────────────────────
function Badge({ text, color }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 7px", borderRadius: "4px",
      background: color + "20", color,
      fontFamily: T.font, fontSize: "9px", fontWeight: 700,
      textTransform: "uppercase", letterSpacing: ".06em"
    }}>{text}</span>
  );
}

function Sel({ label, value, options, onChange, width = "180px" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {label && <div style={{ ...lbS, display: "block" }}>{label}</div>}
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: T.r,
        color: T.text, fontFamily: T.fontSans, fontSize: "12px",
        padding: "6px 10px", width, cursor: "pointer", outline: "none"
      }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function MultiCheck({ options, selected, onToggle }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {options.map(o => {
        const active = selected.includes(o.value);
        return (
          <button key={o.value} onClick={() => onToggle(o.value)} style={{
            padding: "4px 10px", borderRadius: "6px", cursor: "pointer",
            border: `1px solid ${active ? T.accent : T.border}`,
            background: active ? T.accent + "20" : "transparent",
            color: active ? T.accent : T.textMuted,
            fontFamily: T.fontSans, fontSize: "11px", fontWeight: active ? 600 : 400
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
//  SCREEN 1: UPLOAD
// ─────────────────────────────────────────────
function UploadScreen({ onData }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);

  function handleFile(file) {
    setError(null);
    const ext = file.name.split(".").pop().toLowerCase();
    if (["csv", "txt"].includes(ext)) {
      Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: r => {
          if (!r.data.length) { setError("CSV has no rows"); return; }
          onData(r.data, file.name);
        },
        error: e => setError(e.message)
      });
    } else if (["xlsx", "xls", "xlsm"].includes(ext)) {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(e.target.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
          if (!rows.length) { setError("Sheet has no rows"); return; }
          onData(rows, file.name);
        } catch (err) { setError(err.message); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      setError("Please upload a .xlsx, .xls, or .csv file");
    }
  }

  function onDrop(e) {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  return (
    <div style={{
      minHeight: "100vh", background: T.bg, display: "flex",
      alignItems: "center", justifyContent: "center", fontFamily: T.fontSans
    }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}select option{background:${T.bgCard};color:${T.text}}`}</style>
      <div style={{ textAlign: "center", maxWidth: 520, padding: "0 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 8 }}>
          <Layers size={22} style={{ color: T.accent }} />
          <span style={{ fontSize: 22, fontWeight: 700, color: T.text }}>Right Level to Forecast</span>
        </div>
        <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 32, lineHeight: 1.6 }}>
          Upload historical demand data to discover which aggregation level yields the most accurate and stable forecasts.
        </p>

        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          style={{
            border: `2px dashed ${dragging ? T.accent : T.border}`,
            borderRadius: T.rLg, padding: "48px 32px", cursor: "pointer",
            background: dragging ? T.accent + "08" : T.bgCard,
            transition: "all .15s"
          }}
          onClick={() => document.getElementById("file-input").click()}
        >
          <FileSpreadsheet size={32} style={{ color: dragging ? T.accent : T.textMuted, marginBottom: 12 }} />
          <div style={{ color: T.text, fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
            Drop your file here or click to browse
          </div>
          <div style={{ color: T.textMuted, fontSize: 12 }}>.xlsx · .xls · .csv</div>
          <input id="file-input" type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
            onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
        </div>

        {error && (
          <div style={{ marginTop: 16, color: T.red, fontSize: 12, fontFamily: T.font, display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
            <XCircle size={12} />{error}
          </div>
        )}

        <div style={{ marginTop: 24, padding: "12px 16px", background: T.bgSurface, borderRadius: T.r, textAlign: "left" }}>
          <div style={{ ...lbS, marginBottom: 8, display: "flex" }}><Info size={10} style={{ marginRight: 4 }} />Expected data format</div>
          <div style={{ fontFamily: T.font, fontSize: "10px", color: T.textMuted, lineHeight: 1.8 }}>
            Date column · Quantity / demand column · Dimension columns (e.g. Customer, Part, Region)
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  SCREEN 2: CONFIGURE
// ─────────────────────────────────────────────
function ConfigScreen({ rows, fileName, onRun, onBack }) {
  const cols = Object.keys(rows[0] || {});

  function detectDate() {
    return cols.find(c => /date|week|period|time|day|month/i.test(c)) || cols[0];
  }
  function detectTarget() {
    const numeric = cols.filter(c => {
      const vals = rows.slice(0, 20).map(r => parseCurrency(r[c]));
      return vals.filter(v => v != null && !isNaN(v)).length >= 10;
    });
    return numeric.find(c => /qty|quant|demand|sales|volume|amount/i.test(c)) || numeric[0] || cols[0];
  }
  function detectGrains() {
    return cols.filter(c => {
      const vals = new Set(rows.slice(0, 200).map(r => r[c]));
      return vals.size >= 2 && vals.size <= 200 &&
        !/date|time|week|period|qty|quant|demand|sales|cost|price|amount/i.test(c);
    });
  }
  function detectFilterCol() {
    return cols.find(c => {
      const vals = new Set(rows.map(r => r[c]));
      return vals.size <= 10 && /header|category|type|class|flag|kind/i.test(c);
    }) || "";
  }

  const [dateCol, setDateCol] = useState(() => detectDate());
  const [targetCol, setTargetCol] = useState(() => detectTarget());
  const [grainCols, setGrainCols] = useState(() => detectGrains());
  const [filterCol, setFilterCol] = useState(() => detectFilterCol());
  const [filterVal, setFilterVal] = useState("");

  const filterVals = useMemo(() => {
    if (!filterCol) return [];
    return [...new Set(rows.map(r => String(r[filterCol])))].sort();
  }, [filterCol, rows]);

  useMemo(() => {
    if (filterVals.length && !filterVal) setFilterVal(filterVals[0]);
  }, [filterVals]);

  function toggleGrain(col) {
    setGrainCols(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);
  }

  const colOptions = cols.map(c => ({ value: c, label: c }));

  const effectiveRows = useMemo(() => {
    if (!filterCol || !filterVal) return rows.length;
    return rows.filter(r => String(r[filterCol]) === filterVal).length;
  }, [rows, filterCol, filterVal]);

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.fontSans, padding: "32px 24px" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}select option{background:${T.bgCard};color:${T.text}}`}</style>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <Layers size={18} style={{ color: T.accent }} />
          <span style={{ fontSize: 16, fontWeight: 700, color: T.text }}>Right Level to Forecast</span>
          <span style={{ color: T.textMuted, fontSize: 12 }}>— Configure</span>
          <button onClick={onBack} style={{
            marginLeft: "auto", background: "transparent", border: `1px solid ${T.border}`,
            borderRadius: T.r, color: T.textMuted, cursor: "pointer", padding: "4px 10px",
            fontSize: 11, fontFamily: T.fontSans, display: "flex", alignItems: "center", gap: 4
          }}><RefreshCw size={11} /> Back</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24, padding: "10px 14px", background: T.bgSurface, borderRadius: T.r, border: `1px solid ${T.border}` }}>
          <FileSpreadsheet size={14} style={{ color: T.accent }} />
          <span style={{ color: T.text, fontSize: 12, fontWeight: 600 }}>{fileName}</span>
          <span style={{ color: T.textMuted, fontSize: 11 }}>— {rows.length.toLocaleString()} rows · {cols.length} columns</span>
        </div>

        <div style={{ display: "grid", gap: 16 }}>

          {/* Filter */}
          <div style={crdS}>
            <div style={{ ...lbS, marginBottom: 12 }}><Filter size={11} style={{ marginRight: 4 }} />Row Filter <span style={{ color: T.textDim, marginLeft: 4 }}>(optional)</span></div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <Sel label="Filter column" value={filterCol} width="200px"
                options={[{ value: "", label: "— none —" }, ...colOptions]}
                onChange={v => { setFilterCol(v); setFilterVal(""); }} />
              {filterCol && filterVals.length > 0 && (
                <Sel label="Filter value" value={filterVal} width="200px"
                  options={filterVals.map(v => ({ value: v, label: v }))}
                  onChange={setFilterVal} />
              )}
            </div>
            {filterCol && filterVal && (
              <div style={{ marginTop: 10, fontSize: 11, color: T.textMuted, display: "flex", alignItems: "center", gap: 4 }}>
                <CheckCircle size={11} style={{ color: T.green }} />
                {effectiveRows.toLocaleString()} rows match this filter
              </div>
            )}
          </div>

          {/* Date + Target */}
          <div style={crdS}>
            <div style={{ ...lbS, marginBottom: 12 }}><Calendar size={11} style={{ marginRight: 4 }} />Date & Target Column</div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <Sel label="Date column" value={dateCol} options={colOptions} onChange={setDateCol} />
              <Sel label="Target (value to forecast)" value={targetCol} options={colOptions} onChange={setTargetCol} width="220px" />
            </div>
          </div>

          {/* Grain columns */}
          <div style={crdS}>
            <div style={{ ...lbS, marginBottom: 10 }}><Tag size={11} style={{ marginRight: 4 }} />Grain / Dimension Columns</div>
            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 12, lineHeight: 1.6 }}>
              Select dimension columns that define your hierarchy (e.g. Customer, Part, Region). Every combination will be tested.
            </div>
            <MultiCheck
              options={cols.filter(c => c !== dateCol && c !== targetCol && c !== filterCol).map(c => ({ value: c, label: c }))}
              selected={grainCols}
              onToggle={toggleGrain}
            />
            {grainCols.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 11, color: T.textMuted, display: "flex", alignItems: "center", gap: 4 }}>
                <Info size={11} />
                Will test {2 ** grainCols.length} levels (Total + {allSubsets(grainCols).length} grain combos)
              </div>
            )}
          </div>

          <button
            onClick={() => onRun({ rows, dateCol, targetCol, grainCols, filterCol, filterVal, fileName })}
            disabled={!dateCol || !targetCol}
            style={{
              background: T.accent, color: "#fff", border: "none", borderRadius: T.r,
              padding: "12px 24px", cursor: "pointer", fontFamily: T.fontSans,
              fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center",
              gap: 8, justifyContent: "center",
              opacity: (!dateCol || !targetCol) ? 0.5 : 1
            }}
          >
            <BarChart3 size={15} /> Analyze Forecast Levels
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  SCREEN 3: DASHBOARD
// ─────────────────────────────────────────────
function Dashboard({ config, onReset }) {
  const { rows, dateCol, targetCol, grainCols, filterCol, filterVal, fileName } = config;

  const results = useMemo(
    () => analyzeLevel(rows, targetCol, dateCol, grainCols, filterCol, filterVal),
    [rows, targetCol, dateCol, grainCols, filterCol, filterVal]
  );

  const best = results.find(r => !r.skipped);
  const [selected, setSelected] = useState(null);
  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState("desc");

  const sorted = useMemo(() => {
    return [...results].sort((a, b) => {
      const av = a[sortKey] ?? (sortDir === "desc" ? -Infinity : Infinity);
      const bv = b[sortKey] ?? (sortDir === "desc" ? -Infinity : Infinity);
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [results, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  function SortIcon({ k }) {
    if (sortKey !== k) return null;
    return sortDir === "desc" ? <ChevronDown size={10} /> : <ChevronUp size={10} />;
  }

  const drillSeries = useMemo(() => {
    if (!selected || selected.skipped || !selected.seriesMetrics.length) return null;
    const top = selected.seriesMetrics[0];
    return { ...top, chartData: top.values.map((v, i) => ({ i, actual: v })) };
  }, [selected]);

  const barData = results
    .filter(r => !r.skipped)
    .map(r => ({
      name: r.level.length > 22 ? r.level.slice(0, 20) + "…" : r.level,
      score: r.score, color: qualityColor(r.score)
    }));

  const thS = (key) => ({
    padding: "6px 10px", textAlign: "right", cursor: "pointer",
    color: sortKey === key ? T.accent : T.textMuted,
    fontFamily: T.font, fontSize: "9px", textTransform: "uppercase",
    letterSpacing: ".06em", userSelect: "none", whiteSpace: "nowrap",
    background: T.bgSurface
  });
  const tdS = {
    padding: "7px 10px", textAlign: "right",
    fontFamily: T.font, fontSize: "11px", color: T.text,
    borderTop: `1px solid ${T.border}20`
  };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.fontSans }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:${T.bg}}::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}select option{background:${T.bgCard};color:${T.text}}`}</style>

      {/* Header */}
      <div style={{ background: T.bgCard, borderBottom: `1px solid ${T.border}`, padding: "10px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Layers size={15} style={{ color: T.accent }} />
          <span style={{ fontSize: 14, fontWeight: 700 }}>Right Level to Forecast</span>
          <span style={{ color: T.textMuted, fontSize: 11, marginLeft: 4 }}>— {fileName}</span>
        </div>
        <button onClick={onReset} style={{
          background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: "6px",
          padding: "5px 10px", cursor: "pointer", color: T.textMuted,
          fontFamily: T.fontSans, fontSize: "11px", display: "flex", alignItems: "center", gap: 4
        }}><RefreshCw size={11} /> New File</button>
      </div>

      <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Recommendation banner */}
        {best && (
          <div style={{
            background: qualityColor(best.score) + "10",
            border: `1px solid ${qualityColor(best.score)}40`,
            borderRadius: T.rLg, padding: "14px 18px",
            display: "flex", alignItems: "flex-start", gap: 12
          }}>
            <TrendingUp size={18} style={{ color: qualityColor(best.score), marginTop: 1, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 4 }}>
                Recommended level: <span style={{ color: qualityColor(best.score) }}>{best.level}</span>
              </div>
              <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.7 }}>
                Forecastability Score <b style={{ color: T.text }}>{best.score}/100</b> ·{" "}
                {best.numSeries} series · Median CV {best.medianCV} ·{" "}
                {best.pctSmooth}% smooth demand
                {best.avgMAPE != null && ` · avg MAPE ${best.avgMAPE}%`}
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>

          {/* Ranked Table */}
          <div style={crdS}>
            <div style={{ ...lbS, marginBottom: 10 }}><BarChart3 size={11} style={{ marginRight: 4 }} />Forecast Level Rankings — click a row to drill down</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}>
                <thead>
                  <tr>
                    <th style={{ ...thS("level"), textAlign: "left" }} onClick={() => toggleSort("level")}>
                      Level <SortIcon k="level" />
                    </th>
                    <th style={thS("numSeries")} onClick={() => toggleSort("numSeries")}># Series <SortIcon k="numSeries" /></th>
                    <th style={thS("avgN")} onClick={() => toggleSort("avgN")}>Avg N <SortIcon k="avgN" /></th>
                    <th style={thS("medianCV")} onClick={() => toggleSort("medianCV")}>Median CV <SortIcon k="medianCV" /></th>
                    <th style={thS("pctSmooth")} onClick={() => toggleSort("pctSmooth")}>% Smooth <SortIcon k="pctSmooth" /></th>
                    <th style={thS("avgMAPE")} onClick={() => toggleSort("avgMAPE")}>MAPE% <SortIcon k="avgMAPE" /></th>
                    <th style={thS("score")} onClick={() => toggleSort("score")}>Score <SortIcon k="score" /></th>
                    <th style={{ ...thS("quality"), textAlign: "center" }}>Quality</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => {
                    const sel = selected?.level === r.level;
                    return (
                      <tr key={r.level}
                        onClick={() => setSelected(sel ? null : r)}
                        style={{
                          background: sel ? T.accent + "12" : i % 2 === 0 ? "transparent" : T.bgSurface + "60",
                          cursor: "pointer"
                        }}
                      >
                        <td style={{ ...tdS, textAlign: "left", color: sel ? T.accent : r.level === "Total" ? T.purple : T.text, fontWeight: sel ? 600 : 400 }}>
                          {r.level}
                        </td>
                        <td style={tdS}>{r.skipped ? "—" : r.numSeries}</td>
                        <td style={tdS}>{r.skipped ? "—" : r.avgN}</td>
                        <td style={{ ...tdS, color: r.skipped ? T.textDim : r.medianCV < 0.3 ? T.green : r.medianCV < 0.6 ? T.orange : T.red }}>
                          {r.skipped ? "—" : r.medianCV}
                        </td>
                        <td style={{ ...tdS, color: r.skipped ? T.textDim : r.pctSmooth >= 70 ? T.green : r.pctSmooth >= 40 ? T.orange : T.red }}>
                          {r.skipped ? "—" : `${r.pctSmooth}%`}
                        </td>
                        <td style={tdS}>
                          {r.skipped
                            ? <Badge text="Too few rows" color={T.textDim} />
                            : r.avgMAPE != null ? `${r.avgMAPE}%` : "—"}
                        </td>
                        <td style={{ ...tdS, color: r.skipped ? T.textDim : qualityColor(r.score), fontWeight: 700 }}>
                          {r.skipped ? "—" : r.score}
                        </td>
                        <td style={{ ...tdS, textAlign: "center" }}>
                          <Badge text={r.skipped ? "SKIP" : r.quality} color={r.skipped ? T.textDim : qualityColor(r.score)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Bar chart */}
            <div style={crdS}>
              <div style={{ ...lbS, marginBottom: 12 }}>Forecastability Score by Level</div>
              <ResponsiveContainer width="100%" height={Math.max(160, barData.length * 32)}>
                <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                  <XAxis type="number" domain={[0, 100]} tick={{ fontFamily: T.font, fontSize: 9, fill: T.textMuted }} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontFamily: T.font, fontSize: 9, fill: T.textMuted }} />
                  <Tooltip
                    contentStyle={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: T.r, fontFamily: T.font, fontSize: 11 }}
                    formatter={v => [`${v} / 100`, "Score"]}
                  />
                  <Bar dataKey="score" radius={3}>
                    {barData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Score legend */}
            <div style={{ ...crdS, padding: "12px 16px" }}>
              <div style={{ ...lbS, marginBottom: 8 }}>Score Guide</div>
              {[
                ["GOOD", "≥ 65", T.green, "Stable demand, easy to forecast"],
                ["FAIR", "40–64", T.orange, "Moderate noise, monitor closely"],
                ["POOR", "< 40", T.red, "High noise or sparse demand"]
              ].map(([q, range, c, desc]) => (
                <div key={q} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <Badge text={q} color={c} />
                  <span style={{ fontFamily: T.font, fontSize: 10, color: T.textMuted }}>{range} — {desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Drill-down */}
        {selected && !selected.skipped && (
          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16 }}>

            {/* Demand classification pie */}
            <div style={crdS}>
              <div style={{ ...lbS, marginBottom: 10 }}>
                Demand Classification — <span style={{ color: T.accent }}>{selected.level}</span>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <ResponsiveContainer width={110} height={110}>
                  <PieChart>
                    <Pie
                      data={Object.entries(selected.clsCounts).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }))}
                      cx="50%" cy="50%" outerRadius={50} dataKey="value"
                    >
                      {Object.entries(selected.clsCounts).filter(([, v]) => v > 0).map(([cls]) => (
                        <Cell key={cls} fill={CLS_COLORS[cls]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: T.bgCard, border: `1px solid ${T.border}`, fontFamily: T.font, fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div>
                  {Object.entries(selected.clsCounts).filter(([, v]) => v > 0).map(([cls, n]) => (
                    <div key={cls} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: CLS_COLORS[cls], flexShrink: 0 }} />
                      <span style={{ fontFamily: T.font, fontSize: 10, color: T.text }}>{cls}</span>
                      <span style={{ fontFamily: T.font, fontSize: 10, color: T.textMuted }}>{n}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 10, color: T.textDim, lineHeight: 1.7, fontFamily: T.font }}>
                Smooth = ADI&lt;1.32 &amp; CV²&lt;0.49<br />
                Erratic = ADI&lt;1.32 &amp; CV²≥0.49<br />
                Intermittent = ADI≥1.32 &amp; CV²&lt;0.49<br />
                Lumpy = ADI≥1.32 &amp; CV²≥0.49
              </div>
            </div>

            {/* Sample series line chart */}
            <div style={crdS}>
              <div style={{ ...lbS, marginBottom: 10 }}>
                Top-Volume Series — <span style={{ color: T.accent }}>{selected.level}</span>
              </div>
              {drillSeries ? (
                <>
                  <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span><b style={{ color: T.text }}>{drillSeries.key}</b></span>
                    <span>N={drillSeries.n}</span>
                    <span>CV={drillSeries.cv < 9999 ? drillSeries.cv.toFixed(3) : "∞"}</span>
                    <span>ADI={drillSeries.adi.toFixed(2)}</span>
                    <Badge text={drillSeries.cls} color={CLS_COLORS[drillSeries.cls]} />
                    {drillSeries.mape != null && <span>MAPE={drillSeries.mape.toFixed(1)}%</span>}
                  </div>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={drillSeries.chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={T.border} strokeDasharray="3 3" />
                      <XAxis dataKey="i" tick={{ fontFamily: T.font, fontSize: 9, fill: T.textMuted }}
                        interval={Math.max(0, Math.floor(drillSeries.chartData.length / 8) - 1)} />
                      <YAxis tick={{ fontFamily: T.font, fontSize: 9, fill: T.textMuted }} width={40} />
                      <Tooltip
                        contentStyle={{ background: T.bgCard, border: `1px solid ${T.border}`, fontFamily: T.font, fontSize: 11 }}
                        formatter={v => [v?.toFixed ? v.toFixed(1) : v, targetCol]}
                      />
                      <Line type="monotone" dataKey="actual" stroke={T.accent} dot={false} strokeWidth={1.5} />
                    </LineChart>
                  </ResponsiveContainer>
                </>
              ) : (
                <div style={{ color: T.textMuted, fontSize: 12, textAlign: "center", padding: "40px 0" }}>No series data</div>
              )}
            </div>
          </div>
        )}

        {/* Methodology note */}
        <div style={{ ...crdS, padding: "12px 16px" }}>
          <div style={{ ...lbS, marginBottom: 8 }}><Info size={10} style={{ marginRight: 4 }} />How the Forecastability Score is calculated</div>
          <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.8 }}>
            <b style={{ color: T.text }}>Median CV (35%)</b> — Coefficient of variation per series. Lower = more stable demand = easier to forecast.<br />
            <b style={{ color: T.text }}>% Smooth series (40%)</b> — Share of series classified "Smooth" by the Syntetos-Boylan matrix (ADI &lt; 1.32, CV² &lt; 0.49). Higher = better.<br />
            <b style={{ color: T.text }}>Backtest MAPE (25%)</b> — 4-period moving average holdout error (train 70% / test 30%). Lower = higher score.
          </div>
        </div>

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  ROOT APP
// ─────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("upload");
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [runConfig, setRunConfig] = useState(null);

  function handleData(data, name) { setRows(data); setFileName(name); setScreen("config"); }
  function handleRun(cfg) { setRunConfig(cfg); setScreen("results"); }
  function handleReset() { setRows(null); setFileName(""); setRunConfig(null); setScreen("upload"); }

  if (screen === "upload") return <UploadScreen onData={handleData} />;
  if (screen === "config") return <ConfigScreen rows={rows} fileName={fileName} onRun={handleRun} onBack={handleReset} />;
  if (screen === "results") return <Dashboard config={runConfig} onReset={handleReset} />;
  return null;
}
