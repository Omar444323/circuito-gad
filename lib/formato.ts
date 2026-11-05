const eur = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });
export const fmt = (n: number | string) => {
  const v = Number(n);
  return (v < 0 ? "−" : "") + eur.format(Math.abs(v)) + " €";
};
export const fecha = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
export const pmp = (n: number) => n.toFixed(4).replace(".", ",");
