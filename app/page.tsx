export default function Home() {
  return (
    <div className="card" style={{ padding: 18 }}>
      <h1 className="h1">Simulador de dispensació</h1>
      <p className="small" style={{ marginTop: 8 }}>
        Tria pràctica:
      </p>
      <div className="row" style={{ marginTop: 12 }}>
        <a className="btn primary" href="/practica-1">Pràctica 1</a>
        <a className="btn primary" href="/practica-2">Pràctica 2</a>
      </div>
      <hr />
      <p className="small">
        Mode Entrenament: feedback immediat. Mode Avaluació: 5 o 10 casos + informe final.
        A 60s apareix una intervenció del pacient i es desbloqueja la pista (penalitza).
      </p>
    </div>
  );
}
