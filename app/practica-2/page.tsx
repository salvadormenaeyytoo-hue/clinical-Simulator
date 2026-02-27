import Simulator from "@/components/Simulator";
import bank from "@/data/bank.json";

export default function Practice2() {
  return (
    <Simulator
      practice={2}
      title="Pràctica 2 — Decisions complexes i control especial"
      bank={bank as any}
    />
  );
}
