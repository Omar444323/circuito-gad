import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fmt } from "@/lib/formato";

export default async function MiCuenta() {
  const yo = await miSesion();
  const s = await sb();
  const [{ data: e }, { data: movs }] = await Promise.all([
    s.from("empresas").select("iban").eq("id", yo.empresa_id ?? 0).maybeSingle(),
    s.from("movimientos_banco").select("*").eq("empresa_id", yo.empresa_id ?? 0).order("id", { ascending: false }),
  ]);
  return (
    <>
      <div className="head"><h1>Mi cuenta bancaria</h1><p>Todos los cobros y pagos pasan por aquí; no se usa efectivo. IBAN <span className="mono">{e?.iban}</span></p></div>
      <section className="card"><h2>Extracto</h2><div className="tw"><table className="t"><thead><tr><th>Fecha</th><th>Concepto</th><th>Justificante</th><th className="num">Importe</th><th className="num">Saldo</th></tr></thead><tbody>
        {movs?.map((m) => <tr key={m.id}><td className="mono">{fecha(m.fecha)}</td><td>{m.concepto}</td><td className="mono">{m.justificante ?? "—"}</td><td className={"num " + (m.importe < 0 ? "neg" : "pos")}>{fmt(m.importe)}</td><td className="num">{fmt(m.saldo)}</td></tr>)}
      </tbody></table></div></section>
    </>
  );
}
