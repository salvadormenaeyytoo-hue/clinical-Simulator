"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { pickRandom } from "@/lib/utils";
import { scoreAttempt } from "@/lib/scoring";

type Mode = "training" | "assessment";
type Decision = "A" | "B" | "C" | "D";

type Props = {
  practice: 1 | 2;
  title: string;
  bank: any;
};

type Msg = { role: "sys" | "pat" | "stu"; text: string };

function buildQuestionBank(practice: 1 | 2) {
  // Preguntes “guiades” per fer la fase d’exploració més robusta sense LLM.
  const common = [
    { id: "demanar_recepta", label: "Puc veure la recepta?" },
    { id: "data_emissio", label: "Quan li han fet la recepta (data)?" },
    { id: "identificacio", label: "Em pot acreditar la identitat (DNI/CIP)?" },
    { id: "posologia", label: "Quina pauta li han indicat (posologia/durada)?" },
    { id: "alergies", label: "Té al·lèrgies o reaccions prèvies?" },
    { id: "altres_meds", label: "Pren altres medicaments o alcohol/substàncies?" }
  ];

  const p2 = [
    { id: "qui_recull", label: "Qui recull el medicament i amb quina acreditació?" },
    { id: "registre", label: "Hi ha obligació de registre/traçabilitat?" },
    { id: "risc", label: "Hi ha algun risc especial (sobredosi, pacient naïf)?" }
  ];

  return practice === 1 ? common : [...common, ...p2];
}

function autoAnswer(caseObj: any, qid: string) {
  // Respostes genèriques basades en flags + escenari, suficients per entrenament.
  const med = caseObj.medication || "el medicament";
  const title = caseObj.title || "el cas";
  const flags: string[] = caseObj.flags || [];

  if (qid === "demanar_recepta") {
    return `Sí. A la recepta hi consta: medicament (${med}) i el cas tracta sobre: ${title}.`;
  }
  if (qid === "data_emissio") {
    if (flags.includes("validesa_temporal")) return "No ho sé exactament… però ja fa bastants dies (potser més d’una setmana).";
    return "Me la van fer fa pocs dies.";
  }
  if (qid === "identificacio") {
    if (flags.includes("identificacio") || flags.includes("identificacio_recull")) return "Avui no ho porto tot… tinc el DNI al mòbil / o no el tinc a sobre.";
    return "Sí, cap problema. Aquí té el meu document.";
  }
  if (qid === "posologia") {
    if (flags.includes("contacte_prescriptor") || flags.includes("gestio_risc")) return "La pauta em sembla rara… no la recordo bé / potser hi ha un error.";
    return "M’han indicat una pauta habitual i clara.";
  }
  if (qid === "registre") {
    if (flags.includes("registre") || flags.includes("control_especial")) return "No ho sé… però em sembla que és d’aquests que es controlen més.";
    return "No n’he sentit a parlar.";
  }
  if (qid === "qui_recull") {
    if (flags.includes("identificacio_recull")) return "Ho recullo jo pel meu familiar. No porto cap autorització…";
    return "Ho recullo jo mateix/a.";
  }
  if (qid === "risc") {
    if (flags.includes("gestio_risc")) return "Això em preocupa… no l’he pres mai / em fa por equivocar-me.";
    return "Cap risc especial que jo sàpiga.";
  }
  if (qid === "alergies") return "No que jo sàpiga.";
  if (qid === "altres_meds") return "Alguna cosa de tant en tant, però res important.";
  return "No ho sé.";
}

export default function Simulator({ practice, title, bank }: Props) {
  const cases = useMemo(() => {
    const b = bank.simulator_bank;
    return practice === 1 ? b.practice_1_cases : b.practice_2_cases;
  }, [practice, bank]);

  const [mode, setMode] = useState<Mode>("training");
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(2);
  const [count, setCount] = useState<5 | 10>(5);

  const [started, setStarted] = useState(false);
  const [caseQueue, setCaseQueue] = useState<any[]>([]);
  const [idx, setIdx] = useState(0);
  const [current, setCurrent] = useState<any | null>(null);

  const [chat, setChat] = useState<Msg[]>([]);
  const [askedIds, setAskedIds] = useState<string[]>([]);
  const [decision, setDecision] = useState<Decision>("A");
  const [justification, setJustification] = useState("");
  const [hintUnlocked, setHintUnlocked] = useState(false);
  const [hintUsed, setHintUsed] = useState(false);
  const [nudgeSent, setNudgeSent] = useState(false);
  const [inactivityPenalty, setInactivityPenalty] = useState(false);

  const [showResult, setShowResult] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  // Assessment tracking
  const [scores, setScores] = useState<{ case_id: string; total: number; passed: boolean }[]>([]);
  const [failedCaseIds, setFailedCaseIds] = useState<string[]>([]);
  const [assessmentDone, setAssessmentDone] = useState(false);

  const timerRef = useRef<number | null>(null);

  const questions = useMemo(() => buildQuestionBank(practice), [practice]);

  function resetCaseState() {
    setChat([]);
    setAskedIds([]);
    setDecision("A");
    setJustification("");
    setHintUnlocked(false);
    setHintUsed(false);
    setNudgeSent(false);
    setInactivityPenalty(false);
    setShowResult(false);
    setResult(null);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function pickCases(n: number) {
    const pool = cases.filter((c: any) => (c.difficulty || 2) === difficulty);
    const safePool = pool.length ? pool : cases; // fallback si no hi ha d’aquella dificultat
    const picked: any[] = [];
    for (let i = 0; i < n; i++) picked.push(pickRandom(safePool));
    return picked;
  }

  function startSession() {
    setAssessmentDone(false);
    setScores([]);
    setFailedCaseIds([]);
    const q = mode === "training" ? pickCases(1) : pickCases(count);
    setCaseQueue(q);
    setIdx(0);
    setStarted(true);
  }

  // Load current case when queue/idx changes
  useEffect(() => {
    if (!started) return;
    const c = caseQueue[idx];
    if (!c) return;
    setCurrent(c);
    resetCaseState();

    const opening: Msg[] = [
      { role: "sys", text: `Cas ${mode === "training" ? "" : `${idx + 1}/${caseQueue.length}`} — ${c.title}` },
      { role: "pat", text: `Presento una recepta per ${c.medication}. ${c.scenario_summary}` }
    ];
    setChat(opening);

    // 60s nudge + unlock hint
    timerRef.current = window.setTimeout(() => {
      setHintUnlocked(true);
      setNudgeSent(true);
      setInactivityPenalty(prev => prev || (askedIds.length === 0 && justification.trim().length === 0));
      setChat(prev => [
        ...prev,
        { role: "pat", text: "Eh… està tot bé? Estic esperant una resposta…" }
      ]);
    }, 60000);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, idx, caseQueue]);

  function ask(qid: string, label: string) {
    if (!current) return;
    setChat(prev => [...prev, { role: "stu", text: label }]);
    setAskedIds(prev => [...prev, qid]);
    setChat(prev => [...prev, { role: "pat", text: autoAnswer(current, qid) }]);
  }

  function useHint() {
    if (!current || !hintUnlocked) return;
    setHintUsed(true);
    setChat(prev => [...prev, { role: "sys", text: `Pista: ${current.timeout_hint || "Revisa normativa aplicable (BOE/CIMA) i requisits essencials."}` }]);
  }

  function finishCase() {
    if (!current) return;

    const attempt = scoreAttempt({
      practice,
      caseObj: current,
      bank,
      decision,
      justification,
      askedQuestionIds: askedIds,
      hintUsed,
      inactivityPenaltyApplied: inactivityPenalty
    });

    setResult(attempt);
    setShowResult(true);

    if (mode === "assessment") {
      const row = { case_id: current.case_id, total: attempt.total, passed: attempt.passed };
      setScores(prev => [...prev, row]);
      if (!attempt.passed) setFailedCaseIds(prev => [...prev, current.case_id]);
    }
  }

  function nextCaseOrFinish() {
    if (mode === "training") {
      // new random training case
      const q = pickCases(1);
      setCaseQueue(q);
      setIdx(0);
      setStarted(true);
      return;
    }

    if (idx + 1 < caseQueue.length) {
      setIdx(idx + 1);
    } else {
      setAssessmentDone(true);
    }
  }

  function retryFailedOnly() {
    // Re-genera cua només amb els fallats (mateixos IDs, però pot ser que apareguin repetits a pool; triem exactes)
    const idSet = new Set(failedCaseIds);
    const pool = cases.filter((c: any) => idSet.has(c.case_id));
    setCaseQueue(pool.length ? pool : []);
    setIdx(0);
    setAssessmentDone(false);
    setScores([]);
    setFailedCaseIds([]);
    setStarted(true);
  }

  const assessmentSummary = useMemo(() => {
    if (mode !== "assessment" || !assessmentDone) return null;
    const total = scores.reduce((a, b) => a + b.total, 0);
    const avg = scores.length ? Math.round(total / scores.length) : 0;
    const passedCount = scores.filter(s => s.passed).length;
    return { avg, passedCount, totalCases: scores.length };
  }, [mode, assessmentDone, scores]);

  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 className="h1">{title}</h1>
          <div className="small" style={{ marginTop: 6 }}>
            URL: /practica-{practice} · Mode híbrid · Intervenció 60s + pista
          </div>
        </div>
        <a className="btn" href="/">Inici</a>
      </div>

      {!started && (
        <>
          <hr />
          <div className="row">
            <span className="pill"><strong>Mode</strong> {mode === "training" ? "Entrenament" : "Avaluació"}</span>
            <span className="pill"><strong>Dificultat</strong> {difficulty}</span>
            {mode === "assessment" && <span className="pill"><strong>Casos</strong> {count}</span>}
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button className={`btn ${mode === "training" ? "primary" : ""}`} onClick={() => setMode("training")}>
              Entrenament
            </button>
            <button className={`btn ${mode === "assessment" ? "primary" : ""}`} onClick={() => setMode("assessment")}>
              Avaluació
            </button>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button className={`btn ${difficulty === 1 ? "primary" : ""}`} onClick={() => setDifficulty(1)}>Nivell 1</button>
            <button className={`btn ${difficulty === 2 ? "primary" : ""}`} onClick={() => setDifficulty(2)}>Nivell 2</button>
            <button className={`btn ${difficulty === 3 ? "primary" : ""}`} onClick={() => setDifficulty(3)}>Nivell 3</button>
          </div>

          {mode === "assessment" && (
            <div className="row" style={{ marginTop: 12 }}>
              <button className={`btn ${count === 5 ? "primary" : ""}`} onClick={() => setCount(5)}>5 casos</button>
              <button className={`btn ${count === 10 ? "primary" : ""}`} onClick={() => setCount(10)}>10 casos</button>
            </div>
          )}

          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={startSession}>Començar</button>
          </div>
        </>
      )}

      {started && current && !assessmentDone && (
        <>
          <hr />
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div className="row">
              <span className="pill"><strong>Cas</strong> {current.case_id}</span>
              <span className="pill"><strong>Dificultat</strong> {current.difficulty}</span>
              {mode === "assessment" && (
                <span className="pill"><strong>Progrés</strong> {idx + 1}/{caseQueue.length}</span>
              )}
            </div>
            <div className="row">
              <button className="btn" onClick={() => { setStarted(false); resetCaseState(); }}>
                Sortir
              </button>
            </div>
          </div>

          <div className="chat card" style={{ marginTop: 12 }}>
            {chat.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.text}
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 14, marginTop: 12 }}>
            <div className="h2">Exploració (fes preguntes)</div>
            <div className="row" style={{ marginTop: 10 }}>
              {questions.map(q => (
                <button
                  key={q.id}
                  className="btn"
                  onClick={() => ask(q.id, q.label)}
                  disabled={showResult}
                  title="Afegeix una pregunta al diàleg"
                >
                  {q.label}
                </button>
              ))}
            </div>

            <div className="row" style={{ marginTop: 12, alignItems: "center" }}>
              <button className="btn" onClick={useHint} disabled={!hintUnlocked || showResult}>
                {hintUnlocked ? (hintUsed ? "Pista utilitzada" : "Consultar pista (−5)") : "Pista (després de 60s)"}
              </button>
              {nudgeSent && <span className="small">Intervenció del pacient activada.</span>}
            </div>

            <hr />

            <div className="h2">Decisió final</div>
            <div className="row" style={{ marginTop: 10 }}>
              {(["A", "B", "C", "D"] as Decision[]).map(opt => (
                <button
                  key={opt}
                  className={`btn ${decision === opt ? "primary" : ""}`}
                  onClick={() => setDecision(opt)}
                  disabled={showResult}
                >
                  {opt === "A" && "A) Dispenso"}
                  {opt === "B" && "B) No dispenso"}
                  {opt === "C" && "C) Dispenso condicionadament"}
                  {opt === "D" && "D) Contacto amb el prescriptor"}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 10 }}>
              <textarea
                className="input"
                rows={3}
                placeholder="Justifica breument (2–3 frases)."
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                disabled={showResult}
              />
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="btn primary"
                onClick={finishCase}
                disabled={showResult || justification.trim().length < 10}
                title="Cal una justificació mínima"
              >
                Finalitzar cas
              </button>
            </div>
          </div>

          {showResult && result && (
            <div className="card" style={{ padding: 14, marginTop: 12 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div className="h2">Resultat</div>
                <span className="pill"><strong>Puntuació</strong> {result.total}/100</span>
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <span className="pill"><strong>Decisió</strong> {result.breakdown.decision}</span>
                <span className="pill"><strong>Detecció</strong> {result.breakdown.detection}</span>
                <span className="pill"><strong>Justificació</strong> {result.breakdown.justification}</span>
                <span className="pill"><strong>Preguntes</strong> {result.breakdown.questioning}</span>
                <span className="pill"><strong>Professionalitat</strong> {result.breakdown.professionalism}</span>
                <span className="pill"><strong>Penalització</strong> {result.breakdown.penalty}</span>
              </div>

              <hr />

              <div className="h2">Què has fet bé</div>
              <ul>
                {result.notes.good.map((t: string, i: number) => <li key={i}>{t}</li>)}
              </ul>

              <div className="h2">Què cal millorar</div>
              <ul>
                {result.notes.bad.map((t: string, i: number) => <li key={i}>{t}</li>)}
              </ul>

              <div className="h2">Resposta correcta raonada</div>
              <ul>
                {result.notes.correct.map((t: string, i: number) => <li key={i}>{t}</li>)}
              </ul>

              <div className="h2">Si arribés a inspecció farmacèutica…</div>
              <p className="small">{result.notes.inspection}</p>

              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn primary" onClick={nextCaseOrFinish}>
                  {mode === "assessment" ? "Següent" : "Nou cas"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {started && assessmentDone && mode === "assessment" && (
        <>
          <hr />
          <div className="card" style={{ padding: 14 }}>
            <h2 className="h2">Informe final (pantalla)</h2>
            {assessmentSummary && (
              <div className="row" style={{ marginTop: 10 }}>
                <span className="pill"><strong>Mitjana</strong> {assessmentSummary.avg}/100</span>
                <span className="pill"><strong>Superats</strong> {assessmentSummary.passedCount}/{assessmentSummary.totalCases}</span>
                <span className="pill"><strong>No superats</strong> {failedCaseIds.length}</span>
              </div>
            )}

            <hr />
            <div className="h2">Detall per cas</div>
            <ul>
              {scores.map((s, i) => (
                <li key={i}>
                  {s.case_id}: {s.total}/100 {s.passed ? "✅" : "❌"}
                </li>
              ))}
            </ul>

            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={() => { setStarted(false); }}>
                Tornar al menú
              </button>
              <button className="btn" onClick={retryFailedOnly} disabled={failedCaseIds.length === 0}>
                Reintentar només els no superats
              </button>
            </div>

            <p className="small" style={{ marginTop: 10 }}>
              Nota: no es desa cap registre permanent (només càlcul temporal durant l’avaluació).
            </p>
          </div>
        </>
      )}
    </div>
  );
}
