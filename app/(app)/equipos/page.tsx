import { redirect } from "next/navigation";
import { Form } from "@/components/Form";
import { EquipoEditor } from "@/components/EquipoEditor";
import { altaEnLote, moverAlumno, restablecerClave } from "@/app/acciones";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha } from "@/lib/formato";

export default async function Equipos({ searchParams }: { searchParams: Promise<{ e?: string; log?: string }> }) {
  const yo = await miSesion();
  if (yo.rol !== "profesora") redirect("/");
  const q = await searchParams;
  const g = /^[1-6]$/.test(q.e ?? "") ? Number(q.e) : 1;
  const s = await sb();
  const [{ data: empresas }, { data: gente }] = await Promise.all([
    s.from("empresas").select("id, corto, nombre").eq("tipo", "grupo").order("id"),
    s.from("perfiles").select("*").eq("rol", "alumno").eq("activo", true).order("empresa_id").order("nombre"),
  ]);
  let log = s.from("registro_cambios").select("*, autor:perfiles(nombre)").order("creado_en", { ascending: false }).limit(100);
  if (/^[1-6]$/.test(q.log ?? "")) log = log.eq("empresa_id", Number(q.log));
  const { data: cambios } = await log;
  const corto = (id: number | null) => empresas?.find((e) => e.id === id)?.corto ?? "—";
  return (
    <>
      <div className="head"><h1>Equipos y usuarios</h1><p>Usuarios sin email. Los equipos editan sus propios datos; tú puedes editar cualquiera, mover alumnos y restablecer contraseñas.</p></div>
      <section className="card"><h2>Alumnos</h2>
        <div>{gente?.map((m) => (
          <div className="fila" key={m.id} style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }}>
            <span><strong>{m.nombre}</strong> <span className="mono muted">{m.usuario}</span></span>
            {m.cuenta_grupo ? <span className="chip off">Cuenta del grupo</span> : <Form action={moverAlumno} boton="Mover" clase="btn ghost sm"><input type="hidden" name="perfil" value={m.id} /><select className="in" name="destino" defaultValue={m.empresa_id ?? 1} aria-label="Grupo">{empresas?.map((e) => <option key={e.id} value={e.id}>{e.corto}</option>)}</select></Form>}
            <Form action={restablecerClave} boton="Restablecer contraseña" clase="btn ghost sm"><input type="hidden" name="perfil" value={m.id} /></Form>
          </div>))}</div>
      </section>
      <section className="card"><h2>Altas en lote</h2>
        <Form action={altaEnLote} boton="Crear usuarios"><label>Una persona por línea: Nombre y apellidos;grupo<textarea className="in" name="lista" placeholder={"Ana Pérez Ruiz;1"} required /></label></Form>
      </section>
      <section className="card"><h2>Editar equipo</h2><div className="btns">{empresas?.map((e) => <a key={e.id} className={e.id === g ? "btn sm" : "btn ghost sm"} href={"/equipos?e=" + e.id} style={{ textDecoration: "none" }}>{e.corto}</a>)}</div></section>
      <EquipoEditor empresa={g} />
      <section className="card"><h2>Registro de cambios</h2>
        <div className="btns" style={{ marginBottom: 12 }}><a className="btn ghost sm" href="/equipos" style={{ textDecoration: "none" }}>Todos</a>{empresas?.map((e) => <a key={e.id} className="btn ghost sm" href={"/equipos?log=" + e.id} style={{ textDecoration: "none" }}>{e.corto}</a>)}</div>
        {cambios?.length ? <div className="tw"><table className="t"><thead><tr><th>Fecha</th><th>Equipo</th><th>Qué</th><th>Antes</th><th>Ahora</th><th>Hecho por</th></tr></thead><tbody>{cambios.map((c) => <tr key={c.id}><td className="mono">{fecha(c.creado_en)}</td><td>{corto(c.empresa_id)}</td><td>{c.entidad} · {c.campo}</td><td>{c.valor_anterior ?? "—"}</td><td>{c.valor_nuevo ?? "—"}</td><td>{c.autor?.nombre ?? "—"}</td></tr>)}</tbody></table></div> : <p className="empty">Todavía no hay cambios.</p>}
      </section>
    </>
  );
}
