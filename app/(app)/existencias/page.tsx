import Link from "next/link";
import { redirect } from "next/navigation";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fmt } from "@/lib/formato";

const CUENTAS: Record<number, string> = { 300: "Mercaderías (300)", 310: "Materias primas (310)", 350: "Productos terminados (350)" };

export default async function Existencias() {
  const yo = await miSesion();
  if (yo.rol !== "profesora") redirect("/");
  const s = await sb();
  const [{ data: empresas }, { data: articulos }, { data: iniciales }, { data: modulo }] = await Promise.all([
    s.from("empresas").select("id, corto").eq("con_almacen", true).order("id"),
    s.from("articulos").select("id, empresa_id, cuenta, valor"),
    s.from("movimientos_almacen").select("articulo_id, entrada_importe").eq("inicial", true),
    s.from("modulos").select("activo").eq("clave", "pmp_oculto").maybeSingle(),
  ]);
  const filas = (empresas ?? []).flatMap((e) => {
    const suyos = (articulos ?? []).filter((a) => a.empresa_id === e.id);
    return [...new Set(suyos.map((a) => a.cuenta))].sort().map((c) => {
      const deCuenta = suyos.filter((a) => a.cuenta === c);
      const actual = deCuenta.reduce((t, a) => t + Number(a.valor), 0);
      const inicial = (iniciales ?? []).filter((m) => deCuenta.some((a) => a.id === m.articulo_id)).reduce((t, m) => t + Number(m.entrada_importe ?? 0), 0);
      return { g: e.id, corto: e.corto, cuenta: c, inicial, actual };
    });
  });
  return (
    <>
      <div className="head"><div><h1>Existencias</h1><p>Valor de los almacenes por empresa y cuenta, frente al saldo inicial del punto 10.</p></div></div>
      <div className={"note " + (modulo?.activo ? "warn" : "info")}>{modulo?.activo ? "Modo práctica activo: el PMP está oculto y lo calculan los grupos." : "El PMP está visible para los grupos."} Se cambia en los módulos del Panel de control.</div>
      <section className="card"><div className="tw"><table className="t"><thead><tr><th>Empresa</th><th>Cuenta</th><th className="num">Saldo inicial</th><th className="num">Valor actual</th><th className="num">Variación</th></tr></thead><tbody>
        {filas.map((f) => <tr key={f.g + "-" + f.cuenta}><td><Link href={"/almacen?empresa=" + f.g}>{f.corto}</Link></td><td className="muted">{CUENTAS[f.cuenta]}</td><td className="num">{fmt(f.inicial)}</td><td className="num">{fmt(f.actual)}</td><td className={"num " + (f.actual - f.inicial < 0 ? "neg" : "pos")}>{fmt(f.actual - f.inicial)}</td></tr>)}
      </tbody></table></div></section>
    </>
  );
}
