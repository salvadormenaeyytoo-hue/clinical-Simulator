import Simulator from "@/components/Simulator";
import bank from "@/data/bank.json";

export default function Practice1() {
  return (
    <Simulator
      practice={1}
      title="Pràctica 1 — Validació formal i requisits legals"
      bank={bank as any}
    />
  );
}
