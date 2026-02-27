"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import overlay from "@/data/rich_dialog_overlay.json";
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

function buildOverlayIndex(ov: any) {
  const idx = new Map<string, any>();
  const cases = ov?.cases || [];
  for (const c of cases) {
    if (c?.case_id && c?.dialog) idx.set(c.case_id, c.dialog);
  }
  return idx;
}

function randFrom<T>(arr: T[] | undefined, fallback: T): T {
  if (!arr || arr.length === 0) return fallback;
  return arr[Math.floor(Math.random() * arr.length)];
}

function mergeDialogIntoCase(caseObj: any, dialog: any) {
  if (!dialog) return caseObj;
  return { ...caseObj, dialog: { ...(caseObj.dialog || {}), ...dialog } };
}

function buildQuestionBank(practice: 1 | 2) {
  const common = [
    { id: "demanar_recepta", label: "Puc veure la recepta?" },
    { id: "data_emissio", label: "Quan li han fet la recepta (data)?" },
    { id: "identificacio", label: "Em pot acreditar la identitat (DNI/CIP)?" },
    { id: "posologia", label: "Quina pauta li han indicat?" },
    { id: "alergies", label: "Té al·lèrgies?" },
    { id: "altres_meds", label: "Pren altres medicaments?" }
  ];

  const p2 = [
    { id: "qui_recull", label: "Qui recull el medicament?" },
    { id: "registre", label: "Cal registre especial?" },
    { id: "risc", label: "Hi ha algun risc especial?" }
  ];

  return practice === 1 ? common : [...common, ...p2];
}

function autoAnswer(caseObj: any, qid: string) {
  const richArr = caseObj?.dialog?.answers?.[qid];
  if (Array.isArray(richArr) && richArr.length > 0) {
    return richArr[Math.floor(Math.random() * richArr.length)];
  }
  return "No ho sé.";
}

export default function Simulator({ practice, title, bank }: Props) {
  const cases = useMemo(() => {
    const b = bank.simulator_bank;
    return practice === 1 ? b.practice_1_cases : b.practice_2_cases;
  }, [practice, bank]);

  const overlayIndex = useMemo(() => buildOverlayIndex(overlay as any), []);

  const [mode, setMode] = useState<Mode>("training");
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(2);
  const [started, setStarted] = useState(false);
  const [caseQueue, setCaseQueue] = useState<any[]>([]);
  const [idx, setIdx] = useState(0);
  const [current, setCurrent] = useState<any | null>(null);
  const [chat, setChat] = useState<Msg[]>([]);
  const [askedIds, setAskedIds] = useState<string[]>([]);
  const [decision, setDecision] = useState<Decision>("A");
  const [justification, setJustification] = useState("");
  const [hintUnlocked, setHintUnlocked] = useState(false);
  const timerRef = useRef<number | null>(null);

  const questions = useMemo(() => buildQuestionBank(practice), [practice]);

  function pickCases(n: number) {
    const pool = cases.filter((c: any) => (c.difficulty || 2) === difficulty);
    const safePool = pool.length ? pool : cases;
    const picked: any[] = [];
    for (let i = 0; i < n; i++) picked.push(pickRandom(safePool));
    return picked;
  }

  function startSession() {
    const q = pickCases(1);
    setCaseQueue(q);
    setIdx(0);
    setStarted(true);
  }

  useEffect(() => {
    if (!started) return;
    const base = caseQueue[idx];
    if (!base) return;

    const dlg = overlayIndex.get(base.case_id);
    const c = mergeDialogIntoCase(base, dlg);
    setCurrent(c);
    setAskedIds([]);
    setDecision("A");
    setJustification("");
    setHintUnlocked(false);

    const openingPatient = c.dialog?.opening_variants
      ? randFrom<string>(c.dialog.opening_variants, `Presento una recepta per ${c.medication}.`)
      : `Presento una recepta per ${c.medication}.`;

    setChat([
      { role: "sys", text: `Cas — ${c.title}` },
      { role: "pat", text: openingPatient }
    ]);

    timerRef.current = window.setTimeout(() => {
      setHintUnlocked(true);
      const pressure = c.dialog?.pressure_60s
        ? randFrom<string>(c.dialog.pressure_60s, "Estic esperant una resposta...")
        : "Estic esperant una resposta...";
      setChat(prev => [...prev, { role: "pat", text: pressure }]);
    }, 60000);

  }, [started, idx, caseQueue, overlayIndex]);

  function ask(qid: string, label: string) {
    if (!current) return;
    setChat(prev => [...prev, { role: "stu", text: label }]);
    setAskedIds(prev => [...prev, qid]);
    setChat(prev => [...prev, { role: "pat", text: autoAnswer(current, qid) }]);
  }

  function useHint() {
    if (!current || !hintUnlocked) return;
    const hintText = current.dialog?.hint_copy || "Revisa normativa aplicable.";
    setChat(prev => [...prev, { role: "sys", text: `Pista: ${hintText}` }]);
  }

  function finishCase() {
    if (!current) return;

    const result = scoreAttempt({
      practice,
      caseObj: current,
      bank,
      decision,
      justification,
      askedQuestionIds: askedIds,
      hintUsed: false,
      inactivityPenaltyApplied: false
    });

    setChat(prev => [
      ...prev,
      { role: "sys", text: `Puntuació: ${result.total}/100` }
    ]);
  }

  return (
    <div className="card" style={{ padding: 18 }}>
      <h1 className="h1">{title}</h1>

      {!started && (
        <button className="btn primary" onClick={startSession}>
          Començar
        </button>
      )}

      {started && current && (
        <>
          <div className="chat card" style={{ marginTop: 12 }}>
            {chat.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.text}
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            {questions.map(q => (
              <button
                key={q.id}
                className="btn"
                onClick={() => ask(q.id, q.label)}
              >
                {q.label}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={useHint} disabled={!hintUnlocked}>
              Consultar pista
            </button>
          </div>

          <div style={{ marginTop: 12 }}>
            <textarea
              className="input"
              rows={3}
              placeholder="Justifica la decisió..."
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={finishCase}>
              Finalitzar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
