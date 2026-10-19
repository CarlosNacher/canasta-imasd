// Cálculo del reparto del almuerzo.
// N participantes. El ganador no paga. Los N−1 restantes se numeran desde la cola:
// p = 1 es el último, p = N−1 es el segundo.
//   Paga(p) = PREMIO · (1/2)^p                       para p = 2 … N−1
//   Paga(1) = PREMIO · [ (1/2) + (1/2)^(N−1) ]       (el último se queda el "residuo")
// Los empatados se reparten a partes iguales la suma de lo que pagarían sus puestos.

export const PREMIO = 8;

export const euros = x =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(x);

/** Importe que paga quien ocupa la posición p contada desde la cola (p = 1 es el último). */
export function importeDesdeCola(p, N, premio = PREMIO) {
  if (N < 2 || p < 1 || p > N - 1) return 0;
  let fraccion = Math.pow(0.5, p);
  if (p === 1) fraccion += Math.pow(0.5, N - 1);
  return premio * fraccion;
}

/** Devuelve los uid empatados en el primer puesto (vacío si no hay empate). */
export function candidatosPrimerPuesto(jugadores) {
  if (jugadores.length < 2) return [];
  const max = Math.max(...jugadores.map(j => j.puntos));
  const top = jugadores.filter(j => j.puntos === max);
  return top.length > 1 ? top.map(j => j.uid) : [];
}

/**
 * jugadores: [{ uid, puntos, ... }]
 * ganadorDesempate: uid del vencedor de la muerte súbita (si la hubo)
 * Devuelve { filas, candidatos, ganador, pendienteDesempate }
 * Cada fila: { ...jugador, puesto, importe, esGanador, empatado }
 * importe es null mientras falte resolver la muerte súbita.
 */
export function calcularReparto(jugadores, ganadorDesempate = null, premio = PREMIO) {
  const N = jugadores.length;
  const orden = [...jugadores].sort((a, b) => b.puntos - a.puntos);
  const candidatos = candidatosPrimerPuesto(orden);
  if (N === 0) return { filas: [], candidatos, ganador: null, pendienteDesempate: false };

  let ganador = null;
  if (candidatos.length) {
    if (ganadorDesempate && candidatos.includes(ganadorDesempate)) ganador = ganadorDesempate;
  } else {
    ganador = orden[0].uid;
  }

  // Grupos de jugadores con los mismos puntos (el ganador siempre va solo).
  const grupos = [];
  if (ganador) grupos.push([orden.find(j => j.uid === ganador)]);
  let actual = null;
  for (const j of orden) {
    if (j.uid === ganador) continue;
    if (actual && actual[0].puntos === j.puntos) actual.push(j);
    else { actual = [j]; grupos.push(actual); }
  }

  const filas = [];
  let hueco = 1; // posición en la clasificación (1 = primero)
  grupos.forEach((g, i) => {
    const desde = hueco, hasta = hueco + g.length - 1;
    let importe = null;
    if (ganador) {
      let suma = 0;
      for (let r = desde; r <= hasta; r++) suma += r === 1 ? 0 : importeDesdeCola(N - r + 1, N, premio);
      importe = suma / g.length;
    }
    for (const j of g) {
      filas.push({ ...j, puesto: i + 1, importe, esGanador: j.uid === ganador, empatado: g.length > 1 });
    }
    hueco = hasta + 1;
  });

  return { filas, candidatos, ganador, pendienteDesempate: candidatos.length > 0 && !ganador };
}
