import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  HeartPulse,
  Activity,
  Thermometer,
  Wind,
  AlertTriangle,
  Users,
  Search,
  Bell,
  ChevronRight,
  Stethoscope,
  BedDouble,
  X,
  WifiOff,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Backend connection config
// ---------------------------------------------------------------------------
// Point these at your FastAPI server (see backend/README.md).
// Defaults assume `uvicorn main:app --port 8000` running on the same
// machine you're viewing this dashboard from.
const API_BASE = "https://health-monitoring-dashboard-backend-production.up.railway.app";
const WS_URL = "wss://health-monitoring-dashboard-backend-production.up.railway.app/ws/vitals";

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
const T = {
  page: "#F4F7F8",
  card: "#FFFFFF",
  ink: "#16232E",
  inkMuted: "#5C7080",
  inkFaint: "#8FA0AC",
  border: "#E1E8EB",
  teal: "#1F6F78",
  tealLight: "#E4F0F0",
  tealDeep: "#123F45",
  green: "#3F8F5F",
  greenLight: "#E7F3EB",
  amber: "#B9791F",
  amberLight: "#FBF0DF",
  red: "#B23A2E",
  redLight: "#FBE7E4",
  slateLine: "#C7D2D6",
};

const FONT_IMPORT_ID = "phm-fonts";
function useFonts() {
  useEffect(() => {
    if (document.getElementById(FONT_IMPORT_ID)) return;
    const link = document.createElement("link");
    link.id = FONT_IMPORT_ID;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap";
    document.head.appendChild(link);
  }, []);
}

// ---------------------------------------------------------------------------
// Vitals classification (mirrors backend vitals_logic.py)
// ---------------------------------------------------------------------------
function vitalStatus(v) {
  const flags = [];
  if (v.hr > 100 || v.hr < 55) flags.push("hr");
  if (v.bpSys > 140 || v.bpSys < 90 || v.bpDia > 90) flags.push("bp");
  if (v.spo2 < 94) flags.push("spo2");
  if (v.temp > 38.0 || v.temp < 36.0) flags.push("temp");
  if (flags.length === 0) return { level: "normal", flags };
  if (flags.length === 1) return { level: "warning", flags };
  return { level: "critical", flags };
}

function statusColors(level) {
  if (level === "critical") return { fg: T.red, bg: T.redLight };
  if (level === "warning") return { fg: T.amber, bg: T.amberLight };
  return { fg: T.green, bg: T.greenLight };
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
function toVitals(raw) {
  // backend uses bp_sys/bp_dia; frontend chart code uses bpSys/bpDia
  return {
    hr: raw.hr,
    bpSys: raw.bp_sys,
    bpDia: raw.bp_dia,
    spo2: raw.spo2,
    temp: raw.temp,
  };
}

async function fetchJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// ECG signature waveform (header motif)
// ---------------------------------------------------------------------------
function EcgWaveform({ color = T.teal, height = 40 }) {
  const path =
    "M0,20 L40,20 L52,20 L58,6 L66,34 L74,2 L82,30 L88,20 L100,20 L140,20 " +
    "L180,20 L192,20 L198,6 L206,34 L214,2 L222,30 L228,20 L240,20 L280,20 " +
    "L320,20 L332,20 L338,6 L346,34 L354,2 L362,30 L368,20 L400,20";
  return (
    <svg viewBox="0 0 400 40" width="100%" height={height} preserveAspectRatio="none" aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          strokeDasharray: 400,
          strokeDashoffset: 400,
          animation: "phm-ecg-draw 2.4s linear infinite",
        }}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Vital card
// ---------------------------------------------------------------------------
function VitalCard({ icon: Icon, label, value, unit, flagged, sub }) {
  const colors = flagged ? statusColors("warning") : { fg: T.teal, bg: T.tealLight };
  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: T.inkMuted, letterSpacing: "0.03em", textTransform: "uppercase" }}>
          {label}
        </span>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            background: colors.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon size={14} color={colors.fg} strokeWidth={2.25} />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 26,
            fontWeight: 600,
            color: flagged ? colors.fg : T.ink,
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        <span style={{ fontSize: 12, color: T.inkFaint }}>{unit}</span>
      </div>
      {sub && <span style={{ fontSize: 11, color: T.inkFaint }}>{sub}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart tooltip
// ---------------------------------------------------------------------------
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      style={{
        background: T.tealDeep,
        color: "#fff",
        borderRadius: 6,
        padding: "6px 10px",
        fontSize: 11,
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      <div style={{ opacity: 0.7, marginBottom: 2 }}>{fmtTime(label)}</div>
      {payload.map((p) => (
        <div key={p.dataKey}>
          {p.name}: {p.value}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Patient list item
// ---------------------------------------------------------------------------
function PatientRow({ patient, active, onSelect }) {
  const colors = statusColors(patient.status);
  return (
    <button
      onClick={() => onSelect(patient.id)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 8,
        border: "none",
        background: active ? T.tealLight : "transparent",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: colors.fg,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 500,
            color: T.ink,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {patient.name}
        </div>
        <div style={{ fontSize: 11.5, color: T.inkMuted }}>
          Rm {patient.room} &middot; {patient.age}y
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 13,
            fontWeight: 600,
            color: colors.fg,
          }}
        >
          {patient.vitals.hr}
        </div>
        <div style={{ fontSize: 10, color: T.inkFaint }}>bpm</div>
      </div>
      <ChevronRight size={14} color={T.inkFaint} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Alert item
// ---------------------------------------------------------------------------
function AlertItem({ alert, onDismiss }) {
  const colors = statusColors(alert.level);
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 8,
        background: colors.bg,
        alignItems: "flex-start",
      }}
    >
      <AlertTriangle size={15} color={colors.fg} style={{ marginTop: 1, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: T.ink, fontWeight: 500 }}>{alert.patientName}</div>
        <div style={{ fontSize: 12, color: T.inkMuted }}>{alert.message}</div>
        <div style={{ fontSize: 10.5, color: T.inkFaint, marginTop: 2 }}>{fmtTime(alert.time)}</div>
      </div>
      <button
        onClick={() => onDismiss(alert.id)}
        aria-label="Dismiss alert"
        style={{
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: T.inkFaint,
          padding: 2,
          flexShrink: 0,
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------
export default function HealthDashboard() {
  useFonts();
  const [patients, setPatients] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState("");
  const [alerts, setAlerts] = useState([]);
  const [clock, setClock] = useState(new Date());
  const [connection, setConnection] = useState("connecting"); // connecting | live | offline
  const [loadError, setLoadError] = useState(null);

  const historyRef = useRef({}); // patientId -> [{t, hr, bpSys, bpDia}]
  const [historyVersion, setHistoryVersion] = useState(0); // bump to force re-render on history mutation
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);

  // ---- initial REST load: patients + alerts -------------------------------
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [patientsData, alertsData] = await Promise.all([
          fetchJson("/api/patients"),
          fetchJson("/api/alerts?dismissed=false"),
        ]);
        if (cancelled) return;
        const normalized = patientsData.map((p) => ({
          id: p.id,
          name: p.name,
          age: p.age,
          room: p.room,
          vitals: toVitals(p.vitals),
          status: p.status,
          flags: p.flags,
        }));
        setPatients(normalized);
        setSelectedId((prev) => prev ?? normalized[0]?.id ?? null);
        setAlerts(
          alertsData.map((a) => ({
            id: a.id,
            patientId: a.patient_id,
            patientName: a.patient_name,
            message: a.message,
            level: a.level,
            time: a.timestamp,
          }))
        );
        setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(err.message || String(err));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- load history for a patient the first time it's viewed --------------
  const ensureHistory = useCallback(async (patientId) => {
    if (historyRef.current[patientId]) return;
    historyRef.current[patientId] = []; // reserve slot to avoid duplicate fetches
    try {
      const rows = await fetchJson(`/api/patients/${patientId}/history?limit=25`);
      historyRef.current[patientId] = rows.map((r) => ({
        t: new Date(r.timestamp).getTime(),
        hr: r.hr,
        bpSys: r.bp_sys,
        bpDia: r.bp_dia,
      }));
      setHistoryVersion((v) => v + 1);
    } catch {
      // leave as empty array; chart will just show nothing until WS ticks arrive
    }
  }, []);

  useEffect(() => {
    if (selectedId != null) ensureHistory(selectedId);
  }, [selectedId, ensureHistory]);

  // ---- WebSocket: live vitals + alerts -------------------------------------
  useEffect(() => {
    let stopped = false;

    function connect() {
      if (stopped) return;
      setConnection("connecting");
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setConnection("live");

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (msg.type === "vitals_update") {
          const vitals = toVitals(msg.vitals);
          setPatients((prev) =>
            prev.map((p) =>
              p.id === msg.patient_id
                ? { ...p, vitals, status: msg.status, flags: msg.flags }
                : p
            )
          );
          if (historyRef.current[msg.patient_id]) {
            const point = { t: new Date(msg.timestamp).getTime(), hr: vitals.hr, bpSys: vitals.bpSys, bpDia: vitals.bpDia };
            historyRef.current[msg.patient_id] = [...historyRef.current[msg.patient_id], point].slice(-25);
            setHistoryVersion((v) => v + 1);
          }
        }

        if (msg.type === "alert") {
          setAlerts((prev) => {
            if (prev.some((a) => a.id === msg.id)) return prev;
            return [
              {
                id: msg.id,
                patientId: msg.patient_id,
                patientName: msg.patient_name,
                message: msg.message,
                level: msg.level,
                time: msg.timestamp,
              },
              ...prev,
            ].slice(0, 20);
          });
        }
      };

      ws.onclose = () => {
        if (stopped) return;
        setConnection("offline");
        reconnectTimer.current = setTimeout(connect, 2500);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, []);

  // ---- clock ---------------------------------------------------------------
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const dismissAlert = useCallback(async (id) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    try {
      await fetch(`${API_BASE}/api/alerts/${id}/dismiss`, { method: "POST" });
    } catch {
      // optimistic removal stays even if the request fails; it'll resync on reload
    }
  }, []);

  const selected = useMemo(
    () => patients.find((p) => p.id === selectedId) || null,
    [patients, selectedId]
  );

  const selectedHistory = useMemo(() => {
    if (selectedId == null) return [];
    // eslint-disable-next-line no-unused-vars
    const _ = historyVersion; // dependency to trigger recompute
    return historyRef.current[selectedId] || [];
  }, [selectedId, historyVersion]);

  const filteredPatients = useMemo(() => {
    if (!query.trim()) return patients;
    const q = query.toLowerCase();
    return patients.filter(
      (p) => p.name.toLowerCase().includes(q) || p.room.toLowerCase().includes(q)
    );
  }, [patients, query]);

  const connectionBadge = {
    live: { label: "Live", color: "#8FE3B0" },
    connecting: { label: "Connecting", color: "#F5D68A" },
    offline: { label: "Reconnecting", color: "#F0A3A0" },
  }[connection];

  if (loadError) {
    return (
      <div
        style={{
          fontFamily: "'IBM Plex Sans', sans-serif",
          background: T.page,
          minHeight: "100%",
          padding: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          color: T.ink,
        }}
      >
        <WifiOff size={28} color={T.red} />
        <div style={{ fontWeight: 600, fontSize: 15 }}>Can't reach the backend</div>
        <div style={{ fontSize: 13, color: T.inkMuted, textAlign: "center", maxWidth: 380 }}>
          Couldn't load data from <code>{API_BASE}</code>. Make sure the FastAPI
          server is running (<code>uvicorn main:app --port 8000</code>) and
          reachable from this browser.
        </div>
        <div style={{ fontSize: 11.5, color: T.inkFaint }}>{loadError}</div>
      </div>
    );
  }

  if (!selected) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: T.inkMuted, fontFamily: "'IBM Plex Sans', sans-serif" }}>
        Loading patients…
      </div>
    );
  }

  const status = vitalStatus(selected.vitals);
  const statusC = statusColors(selected.status || status.level);
  const flags = selected.flags || status.flags;

  return (
    <div
      style={{
        fontFamily: "'IBM Plex Sans', sans-serif",
        background: T.page,
        minHeight: "100%",
        color: T.ink,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        @keyframes phm-ecg-draw {
          0% { stroke-dashoffset: 400; }
          60% { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: -20; }
        }
        .phm-scroll::-webkit-scrollbar { width: 6px; }
        .phm-scroll::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 4px; }
      `}</style>

      {/* Header */}
      <header
        style={{
          background: T.tealDeep,
          color: "#fff",
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: "rgba(255,255,255,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Stethoscope size={17} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "0.01em" }}>
              Providence Health Monitor
            </div>
            <div style={{ fontSize: 11.5, opacity: 0.65 }}>Ward B &middot; ICU Step-Down</div>
          </div>
        </div>
        <div style={{ flex: "1 1 160px", maxWidth: 260, opacity: 0.9 }}>
          <EcgWaveform color="rgba(255,255,255,0.55)" height={30} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: connectionBadge.color }} />
            {connectionBadge.label}
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, opacity: 0.85 }}>
            {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.14)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              DR
            </div>
            <div style={{ fontSize: 12.5 }}>
              <div style={{ fontWeight: 500 }}>Dr. Anya Rahman</div>
              <div style={{ opacity: 0.6, fontSize: 11 }}>Attending</div>
            </div>
          </div>
        </div>
      </header>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Sidebar: patient list */}
        <aside
          style={{
            width: 260,
            flexShrink: 0,
            borderRight: `1px solid ${T.border}`,
            background: T.card,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ padding: "14px 14px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <Users size={14} color={T.inkMuted} />
              <span style={{ fontSize: 12, fontWeight: 500, color: T.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Patients &middot; {patients.length}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                border: `1px solid ${T.border}`,
                borderRadius: 7,
                padding: "6px 8px",
              }}
            >
              <Search size={13} color={T.inkFaint} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or room"
                style={{
                  border: "none",
                  outline: "none",
                  fontSize: 12.5,
                  width: "100%",
                  color: T.ink,
                  background: "transparent",
                }}
              />
            </div>
          </div>
          <div className="phm-scroll" style={{ overflowY: "auto", padding: "0 8px 12px", flex: 1 }}>
            {filteredPatients.map((p) => (
              <PatientRow key={p.id} patient={p} active={p.id === selectedId} onSelect={setSelectedId} />
            ))}
            {filteredPatients.length === 0 && (
              <div style={{ padding: 16, fontSize: 12.5, color: T.inkFaint, textAlign: "center" }}>
                No patients match "{query}".
              </div>
            )}
          </div>
        </aside>

        {/* Main content */}
        <main className="phm-scroll" style={{ flex: 1, overflowY: "auto", padding: 24, minWidth: 0 }}>
          {/* Patient header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 18,
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 19, fontWeight: 600 }}>{selected.name}</div>
              <div style={{ fontSize: 12.5, color: T.inkMuted, display: "flex", gap: 12, marginTop: 2, alignItems: "center" }}>
                <span>{selected.age} years</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <BedDouble size={13} /> Room {selected.room}
                </span>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 20,
                background: statusC.bg,
                color: statusC.fg,
                fontSize: 12.5,
                fontWeight: 500,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: statusC.fg }} />
              {selected.status === "normal" ? "Stable" : selected.status === "warning" ? "Needs attention" : "Critical"}
            </div>
          </div>

          {/* Vital cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <VitalCard
              icon={HeartPulse}
              label="Heart rate"
              value={selected.vitals.hr}
              unit="bpm"
              flagged={flags.includes("hr")}
              sub="Normal 60-100"
            />
            <VitalCard
              icon={Activity}
              label="Blood pressure"
              value={`${selected.vitals.bpSys}/${selected.vitals.bpDia}`}
              unit="mmHg"
              flagged={flags.includes("bp")}
              sub="Normal <120/80"
            />
            <VitalCard
              icon={Wind}
              label="SpO2"
              value={selected.vitals.spo2}
              unit="%"
              flagged={flags.includes("spo2")}
              sub="Normal 95-100"
            />
            <VitalCard
              icon={Thermometer}
              label="Temperature"
              value={selected.vitals.temp}
              unit="&deg;C"
              flagged={flags.includes("temp")}
              sub="Normal 36.1-37.5"
            />
          </div>

          {/* Charts */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: T.inkMuted, marginBottom: 8 }}>
                Heart rate trend
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={selectedHistory} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                  <CartesianGrid stroke={T.slateLine} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="t" tickFormatter={fmtTime} tick={{ fontSize: 10, fill: T.inkFaint }} minTickGap={40} />
                  <YAxis domain={[40, 140]} tick={{ fontSize: 10, fill: T.inkFaint }} width={30} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="hr" name="HR" stroke={T.teal} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: T.inkMuted, marginBottom: 8 }}>
                Blood pressure trend
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={selectedHistory} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                  <CartesianGrid stroke={T.slateLine} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="t" tickFormatter={fmtTime} tick={{ fontSize: 10, fill: T.inkFaint }} minTickGap={40} />
                  <YAxis domain={[50, 170]} tick={{ fontSize: 10, fill: T.inkFaint }} width={30} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="bpSys" name="Systolic" stroke={T.teal} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="bpDia" name="Diastolic" stroke={T.amber} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Alerts */}
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <Bell size={14} color={T.inkMuted} />
              <span style={{ fontSize: 12, fontWeight: 500, color: T.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Live alerts &middot; {alerts.length}
              </span>
            </div>
            {alerts.length === 0 ? (
              <div style={{ fontSize: 12.5, color: T.inkFaint, padding: "6px 2px" }}>
                No active alerts. Vitals are being monitored continuously.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {alerts.map((a) => (
                  <AlertItem key={a.id} alert={a} onDismiss={dismissAlert} />
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
