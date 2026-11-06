"use client";

export function BotonImprimir() {
  return <button type="button" className="btn" onClick={() => window.print()}>Imprimir o guardar como PDF</button>;
}
