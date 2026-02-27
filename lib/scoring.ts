import { clamp, containsAny, normalizeText, uniq } from "./utils";

type Weights = { decision: number; detection: number; justification: number; questioning: number; professionalism: number };
type Penalties = { hint: number; inactivity_timeout: number; critical_error: number };

export type ScoreInput = {
  practice: 1 | 2;
  caseObj: any;
  bank: any;
  decision: "A" | "B" | "C" | "D";
  justification: string;
  askedQuestionIds: string[];
  hintUsed: boolean;
  inactivityPenaltyApplied: boolean;
};

export type ScoreOutput = {
  total: number;
  breakdown: Record<string, number>;
  passed: boolean;
  notes: { good: string[]; bad: string[]; correct: string[]; inspection: string };
  criticalHit: boolean;
};

function scoreDecision(decision: string, correct: string[], conditionalOk: boolean) {
  if (correct.includes(decision)) return 30;
  // "parcial": si no és correcta però és prudent (D o C quan correcte era D/C)
  if (conditionalOk) return 15;
  return 0;
}

function computeConceptHits(justification: string, conceptGroups: Record<string, string[]>) {
  const hits: string[] = [];
  for (const [id, syns] of Object.entries(conceptGroups || {})) {
    if (containsAny(justification, syns)) hits.push(id);
  }
  return hits;
}

export function scoreAttempt(input: ScoreInput): ScoreOutput {
  const weights: Weights = input.bank.simulator_bank.evaluation_model.weights;
  const penalties: Penalties = input.bank.simulator_bank.evaluation_model.global_penalties;

  const correct = input.caseObj.correct_decision as string[];
  const conditionalLogic = (input.caseObj.conditional_logic || "") as string;

  // Heurística simple de "parcial": si la resposta és prudent (D) quan correcte era C, o C quan correcte era D.
  const conditionalOk =
    (input.decision === "D" && correct.includes("C")) ||
    (input.decision === "C" && correct.includes("D"));

  const decisionPts = clamp(scoreDecision(input.decision, correct, conditionalOk), 0, weights.decision);

  // Detection: segons flags (fins 30, 10 per flag si justificació toca el concepte)
  const flags: string[] = input.caseObj.flags || [];
  const dict = input.practice === 1 ? input.bank.simulator_bank.concept_dictionaries.practice_1 : input.bank.simulator_bank.concept_dictionaries.practice_2;

  const mandatoryGroups = dict.mandatory || {};
  const hits = computeConceptHits(input.justification, mandatoryGroups);

  let detectionPts = 0;
  for (const f of flags) {
    // map simple: si el flag coincideix amb un id de concepte o està mencionat textualment
    const fNorm = normalizeText(f);
    const hit = hits.includes(f) || normalizeText(input.justification).includes(fNorm.replace(/_/g, " "));
    if (hit) detectionPts += 10;
  }
  detectionPts = clamp(detectionPts, 0, weights.detection);

  // Justification: obligatori (14) + desitjable (6) aproximat via mandatory hits
  const mandatoryHitCount = hits.length;
  const justificationBase = clamp(Math.round((mandatoryHitCount / Math.max(1, Object.keys(mandatoryGroups).length)) * 14), 0, 14);

  // Bonus desitjable: si menciona “seguretat/risc/prudencia/contactar”
  const desirableSyns = ["seguretat", "risc", "prudencia", "contactar", "verificar", "registre", "tracabilitat"];
  const desirablePts = containsAny(input.justification, desirableSyns) ? 6 : 0;

  let justificationPts = clamp(justificationBase + desirablePts, 0, weights.justification);

  // Critical patterns
  const criticalPatterns: string[] = dict.critical_patterns || [];
  const criticalHit = containsAny(input.justification, criticalPatterns);

  // Questioning: si ha “preguntat” elements clau
  const asked = uniq(input.askedQuestionIds);
  let questioningPts = 0;
  if (asked.length >= 4) questioningPts = 10;
  else if (asked.length >= 2) questioningPts = 6;
  else if (asked.length >= 1) questioningPts = 3;

  // Professionalism: heurística per “no cedir pressió” + proposta alternativa
  let professionalismPts = 6;
  const proSyns = ["explico", "informo", "alternativa", "derivo", "contacto", "verificar", "criteri", "seguretat"];
  if (containsAny(input.justification, proSyns)) professionalismPts = 10;

  // Penalitzacions
  let penalty = 0;
  if (input.hintUsed) penalty += Math.abs(penalties.hint);
  if (input.inactivityPenaltyApplied) penalty += Math.abs(penalties.inactivity_timeout);
  if (criticalHit) penalty += Math.abs(penalties.critical_error);

  // Total
  const totalRaw = decisionPts + detectionPts + justificationPts + questioningPts + professionalismPts;
  const total = clamp(totalRaw - penalty, 0, 100);

  const passed = total >= 70 && decisionPts >= 15 && !criticalHit;

  // Feedback textual
  const good: string[] = [];
  const bad: string[] = [];
  const correctNotes: string[] = [];

  if (decisionPts === 30) good.push("Decisió final correcta.");
  else if (decisionPts === 15) good.push("Decisió prudent però millorable (faltava condició o verificació).");
  else bad.push("Decisió final incorrecta per aquest escenari.");

  if (detectionPts >= 20) good.push("Has identificat elements clau del conflicte.");
  else bad.push("Falten verificacions clau (requisits, validesa, identitat, registre...).");

  if (justificationPts >= 14) good.push("Justificació ben raonada amb conceptes normatius rellevants.");
  else bad.push("Justificació massa genèrica o sense conceptes imprescindibles.");

  if (input.hintUsed) bad.push("Has utilitzat pista (penalització aplicada).");
  if (criticalHit) bad.push("S'ha detectat un patró d'error crític a la justificació.");

  correctNotes.push(`Resposta esperada: ${correct.join(" / ")}.`);
  if (input.caseObj.conditional_logic) correctNotes.push(`Condició: ${input.caseObj.conditional_logic}`);

  const inspection = input.caseObj.inspection_note || "En inspecció, es valora especialment la diligència, traçabilitat i compliment de requisits.";

  return {
    total,
    breakdown: {
      decision: decisionPts,
      detection: detectionPts,
      justification: justificationPts,
      questioning: questioningPts,
      professionalism: professionalismPts,
      penalty
    },
    passed,
    notes: { good, bad, correct: correctNotes, inspection },
    criticalHit
  };
}
