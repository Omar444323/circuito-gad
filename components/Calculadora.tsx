"use client";
import { useState } from "react";
import { fmt } from "@/lib/formato";

// Capitalización simple y compuesta para el banco
export function Calculadora() {
  const [c, setC] = useState("10000");
  const [t, setT] = useState("4");
  const [m, setM] = useState("12");
  const capital = Number(c) || 0;
  const i = (Number(t) || 0) / 100;
  const anios = (Number(m) || 0) / 12;
  const simple = capital * (1 + i * anios);
  const compuesta = capital * Math.pow(1 + i, anios);
  return (
    <div className="form">
      <div className="row3">
        <label>Capital €<input className="in" type="number" min="0" step="0.01" value={c} onChange={(e) => setC(e.target.value)} /></label>
        <label>Tipo anual %<input className="in" type="number" min="0" step="0.01" value={t} onChange={(e) => setT(e.target.value)} /></label>
        <label>Meses<input className="in" type="number" min="0" step="1" value={m} onChange={(e) => setM(e.target.value)} /></label>
      </div>
      <div className="tw"><table className="t"><thead><tr><th>Capitalización</th><th className="num">Intereses</th><th className="num">Capital final</th></tr></thead><tbody>
        <tr><td>Simple</td><td className="num">{fmt(simple - capital)}</td><td className="num">{fmt(simple)}</td></tr>
        <tr><td>Compuesta</td><td className="num">{fmt(compuesta - capital)}</td><td className="num">{fmt(compuesta)}</td></tr>
      </tbody></table></div>
    </div>
  );
}
