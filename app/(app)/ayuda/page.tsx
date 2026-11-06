import Link from "next/link";
import { miSesion } from "@/lib/sesion";

const Pregunta = ({ t, children }: { t: string; children: React.ReactNode }) => (
  <details className="ver"><summary>{t}</summary><div className="stack" style={{ marginTop: 8 }}>{children}</div></details>
);

export default async function Ayuda() {
  const yo = await miSesion();
  const prof = yo.rol === "profesora";
  return (
    <>
      <div className="head"><h1>Ayuda</h1><p>La app guarda los documentos y mueve el dinero simulado. La contabilidad sigue siendo vuestra: el borrador a mano y el diario en el Excel común.</p></div>
      <section className="card"><h2>El circuito de una compra</h2>
        <ol className="steps">
          <li>Si hace falta, el comprador pide un <Link href="/presupuestos">presupuesto</Link> y negocian.</li>
          <li>El comprador envía el pedido desde <Link href="/operaciones/nuevo">Nuevo pedido</Link>.</li>
          <li>El proveedor lo acepta o lo rechaza en 1 día lectivo, con uno de los motivos de las normas.</li>
          <li>El proveedor entrega y emite el albarán. El comprador lo confirma o lo rechaza.</li>
          <li>El proveedor emite la factura en 2 días lectivos.</li>
          <li>El comprador la revisa con la lista de comprobación y la acepta o la rechaza.</li>
          <li>El comprador deja constancia de sus registros: el borrador manual y el diario de Excel.</li>
          <li>El comprador paga por banco o, si lo acuerdan, la deja a deber.</li>
        </ol>
        <p className="hint" style={{ marginTop: 8 }}>En <Link href="/operaciones">Operaciones</Link> ves lo que te toca. El número junto a cada sección del menú indica cuántas cosas tienes pendientes.</p>
      </section>
      <section className="card"><h2>Preguntas frecuentes</h2>
        <div className="stack">
          <Pregunta t="¿Cómo dejo una factura a deber?"><p>Con la factura aceptada, abre la operación y usa «Dejarlo a deber». Indica el vencimiento, de 5 a 30 días lectivos, y la otra parte tiene que aceptarlo. Después se paga desde <Link href="/deudas">Deudas</Link>, todo de una vez o por partes.</p></Pregunta>
          <Pregunta t="¿Cómo aplico un descuento por volumen?"><p>El proveedor publica sus tramos en <Link href="/deudas">Deudas</Link>, por ejemplo un 2 % desde 5.000 € al mes. Ahí mismo ve lo que lleva cada cliente y emite el rappel como factura rectificativa, que el cliente acepta. Reduce lo que debe o, si ya pagó, le debes tú el abono.</p></Pregunta>
          <Pregunta t="Otro equipo no responde. ¿Qué hago?"><p>Primero reclámalo por escrito con un correo vinculado a la operación. Si vence el plazo, comunica el bloqueo desde la propia operación. La profesora decide: puede autorizar la operación o emitir un documento sustitutorio, y el incumplimiento queda registrado para el equipo responsable.</p></Pregunta>
          <Pregunta t="Me he equivocado en una factura"><p>Si el cliente aún no la ha aceptado, puede rechazarla con el motivo «Documento incorrecto» y emites una versión corregida. Si ya está aceptada, usa una factura rectificativa desde la operación.</p></Pregunta>
          <Pregunta t="No me deja pagar: no hay saldo"><p>Está prohibido quedarse en descubierto sin autorización de la profesora. Puedes acordar dejarlo a deber, pedir un préstamo en <Link href="/financiacion">Financiación</Link> o hablar con ella. Si la empresa se acerca a la insolvencia, tenéis que presentar un plan de viabilidad.</p></Pregunta>
          <Pregunta t="¿Para qué es la pantalla de firmar al entrar?"><p>Si usáis la cuenta del grupo, indica quién eres. Cada documento guarda quién lo elaboró y quién lo revisó, y los roles tienen que rotar. Puedes verlo en <Link href="/rotacion">Rotación de roles</Link>.</p></Pregunta>
          <Pregunta t="¿Cómo cobro mi nómina y hago mis compras?"><p>Cuando la profesora lo active, tu empresa emite tu nómina en <Link href="/nominas">Nóminas</Link> y cobras en <Link href="/personal">Mis finanzas</Link>. Desde ahí compras en la tienda del G6, contratas servicios y pagas vivienda y suministros al G4.</p></Pregunta>
          <Pregunta t="¿Dónde guardo y descargo los documentos?"><p>En <Link href="/archivo">Archivo</Link> está todo lo emitido y recibido. Puedes filtrarlo, descargarlo en Excel o CSV e imprimir cada documento o guardarlo como PDF.</p></Pregunta>
          <Pregunta t="¿Por qué hay secciones sin activar?"><p>IVA, nóminas, financiación y otras partes se activan cuando se explican en clase. En la página de inicio puedes ver cuáles están activas.</p></Pregunta>
        </div>
      </section>
      {prof && (
        <section className="card"><h2>Para la profesora</h2>
          <div className="stack">
            <p>Antes de empezar, carga lo ya hecho en <Link href="/importar">Importar lo ya hecho</Link> e indica el IVA de los artículos en <Link href="/autorizaciones">Autorizaciones</Link>.</p>
            <p>Cada bloque se activa en el <Link href="/">panel</Link> cuando lo expliques. Antes de activar las nóminas, fija los porcentajes en <Link href="/nominas">Nóminas</Link>.</p>
            <p>En <Link href="/seguimiento">Seguimiento</Link> ves las operaciones del punto 6, y en cada operación puedes emitir un documento sustitutorio. Conviene exportar una copia cada semana: el procedimiento está en <code>docs/copias-de-seguridad.md</code>.</p>
          </div>
        </section>
      )}
    </>
  );
}
