// clasificacion.service.ts
// Estado y lógica compartida entre los 3 submódulos de Clasificación
// (auto, manual, historico). Una sola instancia por componente padre.
//
// Modo automatico: TODO corre 100% en el navegador (sin backend todavia).
// Se lee la pantalla LCD de la bascula en tiempo real con Tesseract.js
// (OCR en el cliente, con preproceso de imagen tipo "7 segmentos") y el
// tamano del huevo se estima localmente por color sobre el canvas.
// Cuando el reconocimiento quede estable se migra a un servicio del
// backend (Nest) + Docker, sin tocar la logica de UI de este servicio.
// Modo manual: conteo por teclado con flechas o input directo.
// Enter = capturar + aceptar inmediatamente en modo auto.
import { Injectable, OnDestroy } from '@angular/core';
import { ApiService } from '../../services/api';
import { ToastService } from '../../services/toast';
import { AuthService } from '../../services/auth';

// ─── Constantes ──────────────────────────────────────────────────────────────

export const CATS: CatDef[] = [
  { id: 'JUMBO', label: 'JUMBO', pesoMin: 73, pesoMax: Infinity, color: '#8E24AA' },
  { id: 'AAA',   label: 'AAA',   pesoMin: 63, pesoMax: 73,       color: '#E53935' },
  { id: 'AA',    label: 'AA',    pesoMin: 53, pesoMax: 63,       color: '#FB8C00' },
  { id: 'A',     label: 'A',     pesoMin: 43, pesoMax: 53,       color: '#1E88E5' },
  { id: 'B',     label: 'B',     pesoMin: 33, pesoMax: 43,       color: '#43A047' },
  { id: 'C',     label: 'C',     pesoMin: 0,  pesoMax: 33,       color: '#757575' },
];

export const JORNADAS = ['Manana', 'Tarde'] as const;
export const HUEVOS_POR_PANAL = 30;

// Region de interes donde vive el visor LCD de la gramera dentro del
// encuadre de camara, como fraccion (0-1) del ancho/alto del frame.
// Se ajusta con los controles de calibracion en pantalla y se guarda
// en localStorage para no perderla al recargar.
const ROI_LCD_STORAGE_KEY = 'zona-avicola:roi-lcd';
// Ceñido a mano a los digitos "53.2" del visor real (ver calibracion en la
// conversacion): antes el recuadro cubria toda la pantalla del LCD, con
// casi la mitad izquierda vacia (fondo celeste sin digitos) — eso hacia
// que las franjas fijas del decodificador cayeran en la nada. Este
// recuadro deja solo la zona donde SI hay digitos.
const ROI_LCD_DEFAULT: RoiLcd = { x1: 0.47, y1: 0.885, x2: 0.58, y2: 0.995 };

// CAMBIO DE FONDO (despues de 9 versiones peleando contra la deteccion
// automatica de caracteres sobre un video comprimido y con ruido): la
// bascula esta fija en un soporte, no se reposiciona en cada captura — asi
// que en vez de seguir adivinando donde esta cada digito (ya sea con
// proporciones fijas o "inteligentemente" detectando manchas de tinta,
// que el ruido de compresion de Iriun sigue rompiendo), se calibra a mano
// UNA VEZ: el usuario marca arrastrando 3 lineas divisorias sobre el
// recorte ya binarizado (visualmente mucho mas facil de calibrar que
// mirar el video en vivo) para marcar donde termina cada caracter
// (digito | digito | punto | digito). Esas 3 posiciones (fraccion 0-1 del
// ancho del recorte) se guardan y de ahi en adelante NO se detecta nada:
// solo se busca la tinta real dentro de esas 4 ventanas ya confirmadas.
const DIVISORES_STORAGE_KEY = 'zona-avicola:divisores-digitos';
// Valores de partida razonables (misma proporcion que las franjas viejas:
// digito, digito, punto angosto, digito) — se ajustan arrastrando una vez
// viendo el recorte real y quedan guardados.
const DIVISORES_DEFAULT: [number, number, number] = [0.29, 0.58, 0.71];

// Cada cuanto se intenta leer el peso mientras la camara esta activa (ms).
// Tesseract.js no es gratis en CPU, por eso no se lee cada frame.
const OCR_INTERVALO_MS = 1200;

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface CatDef {
  id: string;
  label: string;
  pesoMin: number;
  pesoMax: number;
  color: string;
}

export interface FormClasificacion {
  lote_id: string;
  jornada: string;
  fecha: string;
  obs: string;
}

export interface RegistroHist {
  _id: number;
  fecha: string;
  lote: string;
  lote_id: number | null;
  jornada: string;
  danados: number;
  total: number;
  modo: string;
  obs: string;
  counts: Record<string, number>;
}

// Region de interes (fraccion 0-1) sobre el frame de camara donde se
// recorta el visor LCD para pasarlo al OCR.
export interface RoiLcd {
  x1: number; y1: number; x2: number; y2: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function rangoPeso(c: CatDef): string {
  return c.pesoMax === Infinity ? `>${c.pesoMin}g` : `${c.pesoMin}–${c.pesoMax}g`;
}

export function calcularPanalesPorCat(counts: Record<string, number | null>) {
  const porCat: Record<string, { completos: number; sobrantes: number }> = {};
  let totalCompletos = 0;
  CATS.forEach((c) => {
    const n = counts[c.id] ?? 0;
    porCat[c.id] = {
      completos: Math.floor(n / HUEVOS_POR_PANAL),
      sobrantes: n % HUEVOS_POR_PANAL,
    };
    totalCompletos += porCat[c.id].completos;
  });
  return { porCat, completos: totalCompletos };
}

export function panalesTotalesDeRegistro(counts: Record<string, number | null>) {
  const r = calcularPanalesPorCat(counts);
  return { completos: r.completos };
}

// ─── Servicio ──────────────────────────────────────────────────────────────

@Injectable()
export class ClasificacionService implements OnDestroy {
  modo: 'auto' | 'manual' = 'auto';

  readonly cats               = CATS;
  readonly jornadas           = JORNADAS;
  readonly rangoPeso          = rangoPeso;
  readonly calcularPanalesPorCat    = calcularPanalesPorCat;
  readonly panalesTotalesDeRegistro = panalesTotalesDeRegistro;
  readonly huevosPorPanal     = HUEVOS_POR_PANAL;

  isAdmin    = false;
  readonly today = new Date().toISOString().split('T')[0];

  counts:  Record<string, number | null> = {};
  danados: number | null = null;

  formAuto:   FormClasificacion = this.newForm();
  formManual: FormClasificacion = this.newForm();
  editId:     number | null = null;
  formTitle   = 'Conteo por Categoria';

  lotes:        any[]           = [];
  historial:    RegistroHist[]  = [];
  histFiltered: RegistroHist[]  = [];
  histSearch    = '';
  histJornada   = '';
  histFechaDesde = '';
  histFechaHasta = '';

  // ── Camara ───────────────────────────────────────────────────────────────
  camStream: MediaStream | null = null;
  camActive = false;
  private liveLoopId: number | null = null;

  // ── Selector de camara ───────────────────────────────────────────────────
  camarasDisponibles:  MediaDeviceInfo[] = [];
  camaraSeleccionadaId = '';
  cargandoCamaras      = false;

  // ── Lectura de peso en tiempo real (lector local de 7 segmentos) ─────────
  ocrListo        = false;   // el lector ya esta listo (no hay carga real, es sincrono)
  ocrCargando     = false;
  leyendoPeso     = false;   // hay un ciclo de lectura activo (camara prendida)
  pesoLive:  number | null = null;  // ultimo peso valido leido del LCD
  pesoTexto  = '';                  // digitos crudos decodificados del visor (debug)
  debugImgUrl: string | null = null; // recorte binarizado + lineas de franja, para calibrar a ojo
  roiLcd: RoiLcd = this.cargarRoiLcd();      // recuadro fijo del visor LCD (unico modo: manual)
  divisoresDigitos: [number, number, number] = this.cargarDivisores(); // 3 cortes calibrados a mano: digito|digito|punto|digito
  calibrandoDigitos = false; // modo calibracion activo (muestra los manejadores arrastrables sobre el recorte)
  private lecturaPesoIntervalId: number | null = null;
  private leyendoFrameAhora = false;
  private fallosPesoSeguidos = 0; // ciclos seguidos sin lectura valida (para saber cuando el peso mostrado ya quedo obsoleto)

  // ── Resultado de la ultima captura ───────────────────────────────────────
  capturaImg:       string       = '';   // base64 — puede ser frame_anotado
  capturaCat:       string       = '';
  capturaPeso:      number | null = null;
  capturaVol:       number       = 0;
  capturaEjeMayor:  number       = 0;
  capturaEjeMenor:  number       = 0;
  capturaConfianza: 'peso' | 'volumen' | 'estimado' = 'volumen';
  capturaError:     string | null = null;
  showCaptura       = false;
  procesando        = false;

  // ── Modal confirmacion ───────────────────────────────────────────────────
  confirmVisible = false;
  confirmMsg     = '';
  private confirmCb: (() => void) | null = null;

  // ── Paginación historial ──────────────────────────────────────────────
  histPage: number = 1;
  histPageSize: number = 10;

  constructor(
    private api:   ApiService,
    private toast: ToastService,
    private auth:  AuthService,
  ) {
    CATS.forEach((c) => (this.counts[c.id] = null));
  }

  ngOnDestroy() {
    this.detenerCamara();
  }

  init() {
    const rol    = this.auth.getSession()?.rol;
    this.isAdmin = rol === 'admin';
    this.cargarLotes();
    this.cargarHistorial();
    this.cargarCamaras();
  }

  // ─── Teclado (llamado desde el padre) ───────────────────────────────────

  onEsc() {
    this.confirmVisible = false;
    this.confirmCb      = null;
  }

  onEnter() {
    if (this.modo === 'auto' && this.camActive && !this.procesando) {
      this.showCaptura ? this.aceptarCaptura() : this.capturarYClasificar();
    }
  }

  // ─── Navegacion ────────────────────────────────────────────────────────

  setModo(m: 'auto' | 'manual') {
    this.modo = m;
    if (m !== 'auto' && this.camStream) this.detenerCamara();
    this.resetConteo();
  }

  private resetConteo() {
    CATS.forEach((c) => (this.counts[c.id] = null));
    this.danados    = null;
    this.editId     = null;
    this.formTitle  = 'Conteo por Categoria';
    this.showCaptura = false;
    this.capturaImg  = '';
  }

  // ─── Totales y panales ──────────────────────────────────────────────────

  // Un registro nuevo (editId en null) exige puede_crear; uno existente en
  // edicion exige puede_editar. Reemplaza al viejo isVisitante.
  puedeGuardar(editingId: any): boolean {
    return editingId ? this.auth.puedeEditar('clasificacion') : this.auth.puedeCrear('clasificacion');
  }

  get puedeEditarModulo(): boolean { return this.auth.puedeEditar('clasificacion'); }
  get puedeEliminar(): boolean { return this.auth.puedeEliminar('clasificacion'); }

  get total() {
    return CATS.reduce((s, c) => s + (this.counts[c.id] ?? 0), 0);
  }
  get panalesActuales() {
    return calcularPanalesPorCat(this.counts);
  }
  get panalCompletos() {
    return this.panalesActuales.completos;
  }

  cambiarConteo(catId: string, delta: number) {
    this.counts[catId] = Math.max(0, (this.counts[catId] ?? 0) + delta);
  }

  onInputConteo(catId: string, e: Event) {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    this.counts[catId] = isNaN(v) || v < 0 ? null : v;
  }

  onInputDanados(e: Event) {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    this.danados = isNaN(v) || v < 0 ? null : v;
  }

  // ─── KPIs historial ────────────────────────────────────────────────────

  get kpiTotalHuevos() {
    return this.histFiltered.reduce((s, r) => s + r.total, 0);
  }
  get kpiDanados() {
    return this.histFiltered.reduce((s, r) => s + r.danados, 0);
  }
  get kpiPanales() {
    return this.histFiltered.reduce(
      (s, r) => s + calcularPanalesPorCat(r.counts).completos, 0
    );
  }
  get kpiPanalesPorCat(): Record<string, number> {
    const acc: Record<string, number> = {};
    CATS.forEach((c) => (acc[c.id] = 0));
    this.histFiltered.forEach((r) => {
      const res = calcularPanalesPorCat(r.counts);
      CATS.forEach((c) => { acc[c.id] += res.porCat[c.id]?.completos || 0; });
    });
    return acc;
  }
  get kpiCategoriaDominante(): string {
    const totales: Record<string, number> = {};
    CATS.forEach((c) => (totales[c.id] = 0));
    this.histFiltered.forEach((r) =>
      CATS.forEach((c) => { totales[c.id] += r.counts[c.id] || 0; })
    );
    const top = CATS.reduce((a, b) => (totales[a.id] >= totales[b.id] ? a : b));
    return totales[top.id] > 0 ? top.label : '—';
  }
  get kpiPromedio(): string {
    return !this.histFiltered.length
      ? '0'
      : (this.kpiTotalHuevos / this.histFiltered.length).toFixed(1);
  }

  // ─── Carga de datos ────────────────────────────────────────────────────

  async cargarLotes() {
    try {
      const res: any = await this.api.get('/lotes?page=1&limit=100');
      this.lotes = res.data ?? res;
    } catch {
      this.toast.error('Error al cargar lotes');
    }
  }

  async cargarHistorial() {
    try {
      const data: any[] = await this.api.get('/clasificacion');
      this.historial = data.map((r) => ({
        _id:     r.id_clasificacion,
        fecha:   r.fecha,
        lote:    r.lote?.codigo || '—',
        lote_id: r.lote?.id_lote ?? null,
        jornada: r.jornada || r.turno || '—',
        danados: r.danados || 0,
        total:   r.total   || 0,
        modo:    r.modo    || 'Manual',
        obs:     r.observaciones || '',
        counts:  CATS.reduce((acc, c) => {
          acc[c.id] = r[c.id.toLowerCase()] || 0;
          return acc;
        }, {} as Record<string, number>),
      }));
      this.filtrarHist();
    } catch {
      this.toast.error('Error al cargar historial');
    }
  }

  filtrarHist() {
    const q = this.histSearch.trim().toLowerCase();
    this.histFiltered = this.historial.filter((r) => {
      if (q && !r.lote.toLowerCase().includes(q)) return false;
      if (this.histJornada && r.jornada !== this.histJornada) return false;
      if (this.histFechaDesde && r.fecha.slice(0, 10) < this.histFechaDesde) return false;
      if (this.histFechaHasta && r.fecha.slice(0, 10) > this.histFechaHasta) return false;
      return true;
    });
    this.histPage = 1;
  }

  limpiarFiltros() {
    this.histSearch    = '';
    this.histJornada   = '';
    this.histFechaDesde = '';
    this.histFechaHasta = '';
    this.filtrarHist();
  }

  // ─── Paginación historial ──────────────────────────────────────────────

  get histPage_data(): any[] {
    const start = (+this.histPage - 1) * +this.histPageSize;
    return this.histFiltered.slice(start, start + this.histPageSize);
  }
  get totalPagHist(): number {
    return Math.max(1, Math.ceil(this.histFiltered.length / this.histPageSize));
  }
  pagesArray(total: number): number[] {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  pagesVisibles(total: number, current: number): number[] {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages: number[] = [];
    const delta = 2;
    const left = Math.max(2, current - delta);
    const right = Math.min(total - 1, current + delta);
    pages.push(1);
    if (left > 2) pages.push(-1);
    for (let i = left; i <= right; i++) pages.push(i);
    if (right < total - 1) pages.push(-1);
    pages.push(total);
    return pages;
  }
  onCustomSize(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (!val || val < 1) return;
    this.histPageSize = +val;
    this.histPage = 1;
    (e.target as HTMLInputElement).value = '';
  }
  onChange_histSize(e: Event) {
    const val = parseInt((e.target as HTMLSelectElement).value, 10);
    if (val && val > 0) { this.histPageSize = +val; this.histPage = 1; }
  }

  // ─── Guardar clasificacion ─────────────────────────────────────────────

  async guardarClasificacion() {
    const form = this.modo === 'auto' ? this.formAuto : this.formManual;
    if (this.total === 0)    { this.toast.warning('Agrega al menos un huevo'); return; }
    if (!form.lote_id)       { this.toast.warning('Selecciona un lote');       return; }
    if (!form.jornada)       { this.toast.warning('Selecciona una jornada');   return; }

    const body: Record<string, any> = {
      id_lote:       +form.lote_id,
      jornada:       form.jornada,
      fecha:         form.fecha,
      observaciones: form.obs,
      danados:       this.danados ?? 0,
      modo:          this.modo === 'auto' ? 'Automatico' : 'Manual',
    };
    CATS.forEach((c) => { body[c.id.toLowerCase()] = this.counts[c.id] ?? 0; });

    try {
      const esEdicion = this.editId !== null;
      if (esEdicion) await this.api.patch(`/clasificacion/${this.editId}`, body);
      else           await this.api.post('/clasificacion', body);
      await this.cargarHistorial();
      this.resetConteo();
      if (this.modo === 'auto') this.formAuto   = this.newForm();
      else                      this.formManual = this.newForm();
      this.toast.success(esEdicion ? 'Clasificacion actualizada' : 'Clasificacion guardada');
    } catch (e: any) {
      this.toast.error(e.message || 'Error al guardar');
    }
  }

  editClasificacion(r: RegistroHist) {
    const m = r.modo === 'Automatico' ? 'auto' : 'manual';
    this.setModo(m);
    CATS.forEach((c) => (this.counts[c.id] = r.counts[c.id] || null));
    this.danados = r.danados || null;
    const form: FormClasificacion = {
      lote_id: r.lote_id ? String(r.lote_id) : '',
      jornada: r.jornada !== '—' ? r.jornada : JORNADAS[0],
      fecha:   r.fecha ? r.fecha.slice(0, 10) : this.today,
      obs:     r.obs || '',
    };
    if (m === 'auto') this.formAuto   = form;
    else              this.formManual = form;
    this.editId    = r._id;
    this.formTitle = 'Editando Clasificacion';
  }

  elimClasificacion(r: RegistroHist) {
    this.confirmMsg = `Eliminar el registro del ${this.fmtDate(r.fecha)} — lote ${r.lote}?`;
    this.confirmCb  = async () => {
      try {
        await this.api.delete(`/clasificacion/${r._id}`);
        await this.cargarHistorial();
        this.toast.warning('Registro eliminado');
      } catch {
        this.toast.error('Error al eliminar');
      }
    };
    this.confirmVisible = true;
  }

  // ─── Lectura de peso en tiempo real (Tesseract.js) ──────────────────────
  // Todo corre en el navegador: se recorta el ROI del LCD del frame de
  // camara, se preprocesa a blanco/negro (estilo 7-segmentos) y se pasa
  // por OCR cada OCR_INTERVALO_MS mientras la camara este activa.

  private cargarRoiLcd(): RoiLcd {
    // Antes esto leia el ultimo recuadro guardado en localStorage (del
    // arrastre manual). Se quito esa dependencia: el recuadro ahora es
    // SIEMPRE el de ROI_LCD_DEFAULT, calibrado a mano una sola vez viendo
    // pixel por pixel donde caen los digitos "53.2" en una foto real de la
    // bascula (ver conversacion) — asi no cambia entre sesiones ni entre
    // navegadores, sin arrastre ni panel de ajuste.
    return { ...ROI_LCD_DEFAULT };
  }

  guardarRoiLcd() {
    try {
      localStorage.setItem(ROI_LCD_STORAGE_KEY, JSON.stringify(this.roiLcd));
    } catch { /* almacenamiento no disponible, no es critico */ }
  }

  resetRoiLcd() {
    this.roiLcd = { ...ROI_LCD_DEFAULT };
    this.guardarRoiLcd();
  }

  /** true si el usuario todavia no ha calibrado a mano (sigue en el valor por defecto). */
  get calibracionPendiente(): boolean {
    return this.divisoresDigitos.every((v, i) => Math.abs(v - DIVISORES_DEFAULT[i]) < 0.001);
  }

  private cargarDivisores(): [number, number, number] {
    try {
      const raw = localStorage.getItem(DIVISORES_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length === 3 && arr.every((n) => typeof n === 'number')) {
          return arr as [number, number, number];
        }
      }
    } catch { /* almacenamiento no disponible o dato invalido, usar default */ }
    return [...DIVISORES_DEFAULT];
  }

  guardarDivisores() {
    try {
      localStorage.setItem(DIVISORES_STORAGE_KEY, JSON.stringify(this.divisoresDigitos));
    } catch { /* almacenamiento no disponible, no es critico */ }
  }

  resetDivisores() {
    this.divisoresDigitos = [...DIVISORES_DEFAULT];
    this.guardarDivisores();
  }

  /**
   * Mueve el divisor `i` (0, 1 o 2) a la fraccion `frac` del ancho del
   * recorte, sin dejar que se cruce con sus vecinos (deja un margen minimo
   * para que ningun caracter quede con ancho cero mientras se arrastra).
   */
  setDivisorDrag(i: number, frac: number) {
    const MARGEN = 0.03;
    const copia: [number, number, number] = [...this.divisoresDigitos];
    const min = i === 0 ? MARGEN : copia[i - 1] + MARGEN;
    const max = i === 2 ? 1 - MARGEN : copia[i + 1] - MARGEN;
    copia[i] = Math.min(max, Math.max(min, frac));
    this.divisoresDigitos = copia;
  }

  /**
   * Fija el ROI a partir de un rectangulo dibujado con el mouse (arrastrar
   * sobre el video). Es la unica forma de calibrar el recuadro del visor.
   */
  setRoiDesdeArrastre(roi: RoiLcd) {
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    this.roiLcd = {
      x1: clamp(Math.min(roi.x1, roi.x2)),
      y1: clamp(Math.min(roi.y1, roi.y2)),
      x2: clamp(Math.max(roi.x1, roi.x2)),
      y2: clamp(Math.max(roi.y1, roi.y2)),
    };
    this.guardarRoiLcd();
  }

  /**
   * Antes esto inicializaba un worker de Tesseract.js (async, con descarga
   * de modelo). Se elimino por completo: Tesseract esta entrenado para
   * fuentes impresas normales y confunde digitos de 7 segmentos entre si
   * (ej. leia "1" en vez de "53.2"). Probar un modelo de 7-segmentos
   * cargado desde un CDN externo tampoco funciono de forma confiable — al
   * no poder validar en vivo si la descarga o el formato del modelo
   * funcionaban en el navegador del usuario, terminaba fallando en
   * silencio y dejando el lector sin ninguna lectura.
   * En su lugar, `leerPesoFrame` decodifica los digitos directamente del
   * recorte binarizado (segmentarYDecodificarDigitos), sin ninguna
   * libreria de OCR ni descarga de red. Esta funcion queda solo para no
   * tener que tocar `iniciarLecturaPeso` — no hace ninguna carga real.
   */
  private async initOcr(): Promise<boolean> {
    this.ocrListo = true;
    return true;
  }

  /** Arranca el ciclo de lectura periodica del LCD. Requiere camara activa. */
  async iniciarLecturaPeso() {
    if (this.lecturaPesoIntervalId !== null) return;
    const ok = await this.initOcr();
    if (!ok) return;
    this.leyendoPeso = true;
    this.lecturaPesoIntervalId = window.setInterval(
      () => this.leerPesoFrame(),
      OCR_INTERVALO_MS,
    );
  }

  detenerLecturaPeso() {
    if (this.lecturaPesoIntervalId !== null) {
      clearInterval(this.lecturaPesoIntervalId);
      this.lecturaPesoIntervalId = null;
    }
    this.leyendoPeso = false;
  }

  /**
   * Convierte un ROI expresado como fraccion (0-1) del contenedor visible
   * (`.cam-box`, tal como el usuario lo arrastro sobre lo que VE en pantalla)
   * al mismo ROI pero expresado como fraccion (0-1) del canvas nativo
   * (`video.videoWidth/videoHeight`).
   *
   * Son distintos en cuanto la resolucion real de la camara no tenga la
   * misma relacion de aspecto que el contenedor (fijo a 16/9 por CSS): el
   * `object-fit: cover` del canvas recorta la imagen para llenar la caja,
   * asi que lo que el usuario ve (y sobre lo que arrastra) es solo una
   * porcion central del canvas real. Si esto no se compensa, el recuadro
   * que se arrastra a mano queda desalineado del area que de verdad se
   * recorta para el OCR — se termina leyendo un pedazo random del video
   * (fondo, marco, etc.) en vez del visor LCD, aunque en pantalla el
   * recuadro se vea bien puesto encima de los digitos.
   */
  private mapRoiCajaACanvas(box: HTMLElement, canvas: HTMLCanvasElement, roi: RoiLcd): RoiLcd {
    const rect = box.getBoundingClientRect();
    const boxW = rect.width, boxH = rect.height;
    const natW = canvas.width, natH = canvas.height;
    if (!boxW || !boxH || !natW || !natH) return roi;

    // Con object-fit:cover, la escala real es la mayor de las dos (para
    // que no queden bordes vacios), y el canvas se centra recortando lo
    // que sobre a cada lado.
    const escala = Math.max(boxW / natW, boxH / natH);
    const visibleW = boxW / escala;   // ancho del canvas nativo que SI se ve
    const visibleH = boxH / escala;   // alto del canvas nativo que SI se ve
    const offX = (natW - visibleW) / 2;
    const offY = (natH - visibleH) / 2;

    const aFraccionCanvas = (f: number, visible: number, off: number, nat: number) =>
      (off + f * visible) / nat;

    return {
      x1: aFraccionCanvas(roi.x1, visibleW, offX, natW),
      y1: aFraccionCanvas(roi.y1, visibleH, offY, natH),
      x2: aFraccionCanvas(roi.x2, visibleW, offX, natW),
      y2: aFraccionCanvas(roi.y2, visibleH, offY, natH),
    };
  }

  /** Recorta el ROI del LCD desde el canvas en vivo, lo binariza y decodifica los digitos localmente. */
  private leerPesoFrame() {
    if (this.leyendoFrameAhora) return;
    const live = document.getElementById('cam-live') as HTMLCanvasElement;
    if (!live || !live.width) { this.pesoTexto = 'ERROR: canvas de camara no listo aun'; return; }

    this.leyendoFrameAhora = true;
    try {
      // Recuadro fijo elegido a mano: se intenta leer SIEMPRE, tenga o no
      // tenga el tono azul encendido — el brillo se atenua cuando el peso
      // lleva un rato estable, pero los digitos siguen ahi, solo mas tenues
      // (la normalizacion de contraste de recortarYBinarizarRoi se encarga
      // de eso).
      // El roiLcd esta guardado como fraccion de lo que se VE en pantalla
      // (la caja .cam-box) — hay que convertirlo a fraccion del canvas
      // nativo antes de recortar, porque object-fit:cover puede hacer que
      // no coincidan (ver mapRoiCajaACanvas).
      const box = live.parentElement as HTMLElement | null;
      const roiReal = box ? this.mapRoiCajaACanvas(box, live, this.roiLcd) : this.roiLcd;
      const roiCanvas = this.recortarYBinarizarRoi(live, roiReal);
      if (!roiCanvas) {
        // Recuadro invalido O sin señal real (pantalla apagada/tapada,
        // filtradas dentro de recortarYBinarizarRoi). Antes esto se salia
        // sin contar el fallo, asi que el peso viejo se quedaba pegado en
        // pantalla para siempre en este caso puntual (a diferencia del
        // caso "se leyo pero fallo el patron", que si contaba). Cuenta
        // igual que cualquier otro fallo, para que tambien se borre tras
        // varios ciclos seguidos.
        this.pesoTexto = 'sin señal (pantalla apagada o recuadro invalido)';
        this.fallosPesoSeguidos++;
        if (this.fallosPesoSeguidos >= 4) this.pesoLive = null;
        return;
      }

      const { valor, texto } = this.segmentarYDecodificarDigitos(roiCanvas);
      this.pesoTexto = texto;
      // Antes, si la lectura fallaba, `pesoLive` simplemente se quedaba con
      // el ultimo valor bueno para siempre — asi que si tapabas la camara o
      // la bascula se apagaba, en pantalla seguia viendose un peso "en vivo"
      // que ya no tenia nada que ver con lo que la camara estaba viendo en
      // ese momento (esto es lo que se vio en la captura con la camara en
      // negro y "73.6 g" pegado ahi). Ahora, tras varios ciclos seguidos
      // sin lectura valida, se borra el peso en vez de dejarlo mostrado
      // como si siguiera siendo valido.
      if (valor !== null) {
        this.pesoLive = valor;
        this.fallosPesoSeguidos = 0;
      } else {
        this.fallosPesoSeguidos++;
        if (this.fallosPesoSeguidos >= 4) this.pesoLive = null;
      }
      // roiCanvas ya trae las lineas de franja dibujadas encima (ver el
      // final de segmentarYDecodificarDigitos) — se expone como imagen para
      // poder calibrar a ojo si una franja cae mal, en vez de adivinar.
      // JPEG en vez de PNG: la compresion PNG es notablemente mas lenta, y
      // esto corre de forma sincrona en el hilo principal cada 1.2s — con
      // PNG eso se podia sentir como una trabada breve cada ciclo. La
      // perdida de calidad de JPEG no importa aca porque la imagen ya es
      // blanco y negro puro (binarizada), no hay gradientes que perder.
      this.debugImgUrl = roiCanvas.toDataURL('image/jpeg', 0.85);
    } catch (e: any) {
      // Antes esto se tragaba el error en silencio ("reintenta en el
      // siguiente ciclo"), lo cual hacia IMPOSIBLE saber si el lector
      // realmente estaba fallando o simplemente no se estaba ejecutando.
      // Ahora el error se muestra en pantalla (pesoTexto) para poder
      // diagnosticar sin depender de la consola del navegador.
      this.pesoTexto = 'ERROR: ' + (e?.message || String(e));
    } finally {
      this.leyendoFrameAhora = false;
    }
  }

  /**
   * Decodifica los digitos de 7 segmentos directamente del recorte ya
   * binarizado (fondo blanco, digitos negros), sin ninguna libreria de OCR.
   * Funciona 100% local: no depende de internet ni de un modelo externo.
   *
   * 1. Proyeccion vertical: cuenta pixeles negros por columna para separar
   *    el recorte en "blobs" (rachas de columnas con contenido, separadas
   *    por huecos en blanco) — cada blob es un digito o un punto decimal.
   * 2. Un blob se clasifica como punto decimal si es chato (mucho menos
   *    alto que los demas blobs del mismo recorte).
   * 3. Para cada blob-digito se muestrean 7 zonas rectangulares (una por
   *    segmento a-g) y se decide si el segmento esta "encendido" segun la
   *    proporcion de pixeles negros que caen dentro de esa zona.
   * 4. El patron de 7 bits se compara contra la tabla estandar de 7
   *    segmentos para obtener el digito 0-9.
   */
  private segmentarYDecodificarDigitos(bin: HTMLCanvasElement): { valor: number | null; texto: string } {
    const ctx = bin.getContext('2d');
    const W = bin.width, H = bin.height;
    if (!ctx || W < 4 || H < 4) return { valor: null, texto: '' };
    const imageData = ctx.getImageData(0, 0, W, H);
    const { data } = imageData;
    const esNegro = (x: number, y: number) => data[(y * W + x) * 4] < 128;

    // Despeluce a nivel de PIXEL (esto es lo que fallo la ultima vez, no la
    // idea de las manchas). La binarizacion por rango local que se metio
    // para arreglar poca luz es mas sensible: cualquier pixel de ruido del
    // sensor (aislado, sin trazo real alrededor) ahora tambien pasa el
    // umbral, y quedaba como una mancha propia — de ahi los montones de
    // rayitas verdes y el "..........1...." (casi todo leido como puntos
    // sueltos). Un pixel negro real de un digito SIEMPRE tiene varios
    // vecinos negros pegados (es un trazo, no un punto); un pixel de ruido
    // esta solo. Se blanquea cualquier pixel negro con menos de 2 vecinos
    // negros en su entorno 3x3 — no cambia el ancho/alto de ningun trazo
    // real, solo quita las motas sueltas antes de agrupar en manchas.
    const negroCrudo = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) negroCrudo[y * W + x] = esNegro(x, y) ? 1 : 0;
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!negroCrudo[y * W + x]) continue;
        let vecinos = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
            if (negroCrudo[ny * W + nx]) vecinos++;
          }
        }
        if (vecinos < 2) {
          const i = (y * W + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 255;
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);

    // Anula filas contaminadas por el marco/sombra fisico del LCD. El
    // primer intento borraba filas con >85% de negro en todo el ancho, pero
    // la sombra no es pareja: tiene un nucleo bien solido y bordes que se
    // desvanecen (quedan en 40-60% de negro) — un umbral fijo dejaba esos
    // bordes sin borrar, y eso bastaba para seguir arruinando el alto
    // calculado del digito. Se detecta con histeresis (como se separan
    // bordes fuertes de debiles en vision por computador): primero se
    // marca el nucleo bien solido (>=75% negro de lado a lado, algo que
    // ningun digito real hace), y desde ahi se "contagia" a las filas
    // vecinas mientras sigan teniendo bastante negro (>=35%) — así se
    // agarra el desvanecido completo del marco sin tocar filas de digitos
    // sueltas en otra parte del recorte (que nunca llegan a tocar ese
    // nucleo).
    const UMBRAL_NUCLEO = 0.75, UMBRAL_CONTAGIO = 0.35;
    const densidadFila = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      let n = 0;
      for (let x = 0; x < W; x++) if (esNegro(x, y)) n++;
      densidadFila[y] = n / W;
    }
    const filaContaminada = new Uint8Array(H);
    for (let y = 0; y < H; y++) if (densidadFila[y] >= UMBRAL_NUCLEO) filaContaminada[y] = 1;
    let cambio = true;
    while (cambio) {
      cambio = false;
      for (let y = 0; y < H; y++) {
        if (filaContaminada[y]) continue;
        if (densidadFila[y] < UMBRAL_CONTAGIO) continue;
        const vecinoContaminado = (y > 0 && filaContaminada[y - 1]) || (y < H - 1 && filaContaminada[y + 1]);
        if (vecinoContaminado) { filaContaminada[y] = 1; cambio = true; }
      }
    }
    // Colchon de seguridad: la fila justo pegada a una zona de marco ya
    // detectada (una fila de transicion/antialias, ni bien solida ni con
    // suficiente densidad como para contagiarse) se cuenta tambien, aunque
    // su propia densidad no llegue al umbral. No hay riesgo de comerse
    // digitos reales con esto: entre el marco y el cuerpo del digito
    // siempre hay una franja en blanco de por medio (nunca quedan pegados),
    // asi que expandir 2 filas sigue cayendo en esa franja vacia.
    {
      const original = filaContaminada.slice();
      for (let y = 0; y < H; y++) {
        if (!original[y]) continue;
        for (const dy of [-2, -1, 1, 2]) {
          const ny = y + dy;
          if (ny >= 0 && ny < H) filaContaminada[ny] = 1;
        }
      }
    }
    for (let y = 0; y < H; y++) {
      if (!filaContaminada[y]) continue;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    // CAMBIO DE FONDO: se quitan las lineas por completo, sin excepcion.
    // Ninguna posicion (fija, calibrada, o calibrada-con-margen) sirve si
    // un solo caracter puede no estar donde "deberia" — asi que se deja de
    // usar posicion para lo que sea. En su lugar: se etiquetan TODAS las
    // manchas de tinta del recorte (flood fill 8-conexo), se descartan las
    // demasiado bajas para ser un digito, y de las que quedan se arma la
    // lista de digitos por AREA — con un paso extra: si dos digitos quedan
    // pegados en una sola mancha (le puede pasar a la conexion de 8
    // direcciones cuando los digitos casi se tocan), esa mancha ancha se
    // separa internamente ANTES de elegir cuales son los digitos, en vez
    // de asumir a ciegas que siempre hay exactamente 3 manchas sueltas.
    const totalPx = W * H;
    const AREA_MIN = Math.max(6, Math.round(totalPx * 0.0006));
    interface Mancha { x1: number; x2: number; y1: number; y2: number; area: number; }
    const crudas = this.etiquetarManchas(esNegro, W, H, AREA_MIN);
    // Descarta manchas con forma de linea delgada y larga (un reflejo/
    // brillo alargado sobre el borde de la carcasa, una rayita del marco)
    // ANTES de usarlas para nada — si una de estas se cuela, puede volverse
    // la mancha "mas alta" del recorte y hacer que los digitos reales (mas
    // cortos que ella) queden por debajo del umbral y se descarten, aunque
    // sean el trazo correcto. La primera version de este filtro usaba un
    // ancho absoluto ("<=3px") — eso deja pasar cualquier brillo/gancho
    // moderadamente grueso (que fue exactamente el caso: la ultima prueba
    // seguia sin agarrar el numero porque el gancho de la carcasa no medía
    // 3px). El filtro correcto es por PROPORCION, no por pixeles absolutos:
    // ningun trazo de un digito real es 8 veces mas largo que ancho (ni al
    // reves) — un reflejo/borde de carcasa si.
    const RATIO_LINEA = 8;
    // Descarta tambien cualquier mancha que TOQUE el borde izquierdo o
    // derecho del recorte (columna 0 o W-1). Un digito real, si el
    // recuadro esta razonablemente calibrado, siempre tiene algo de
    // margen blanco a los lados — lo unico que llega literalmente hasta
    // el borde es algo que la camara alcanzo a agarrar A MEDIAS (la
    // esquina de un boton, el canto de la carcasa) porque el recuadro le
    // quedo justo ahi. Esto es lo que se colaba como "gancho" a la
    // derecha en la ultima captura: no es una linea delgada (por eso el
    // filtro de arriba no lo agarraba), pero sí toca el borde.
    const todas0sinFiltroAltura = crudas.filter((m) => {
      const anchoM = m.x2 - m.x1 + 1, altoM = m.y2 - m.y1 + 1;
      const esLineaDelgada = Math.max(anchoM, altoM) / Math.max(1, Math.min(anchoM, altoM)) > RATIO_LINEA;
      const tocaBorde = m.x1 <= 0 || m.x2 >= W - 1;
      return !esLineaDelgada && !tocaBorde;
    });

    // Filtro por ALINEACION VERTICAL: los digitos reales de un mismo
    // numero SIEMPRE comparten la misma linea de base (el "piso" de cada
    // caracter, y2, cae en la misma fila aproximada) — asi varien un poco
    // de alto entre si segun la forma del digito. Un icono fijo de la
    // pantalla que no es parte del numero (bateria, señal de estabilidad,
    // etc.) casi siempre esta en otra franja, tipicamente mas arriba. Esta
    // marquita aparecio en la MISMA posicion (arriba a la izquierda) en
    // varias capturas seguidas — eso ya no es ruido de un frame suelto, es
    // parte fija de lo que ve la camara, y ni el filtro de forma ni el de
    // area lo agarraban porque no es ni delgado ni chico de mas.
    const y2s = todas0sinFiltroAltura.map((m) => m.y2).sort((a, b) => a - b);
    const y2Mediana = y2s.length ? y2s[Math.floor(y2s.length / 2)] : 0;
    const altoRefAlineacion = todas0sinFiltroAltura.length
      ? todas0sinFiltroAltura.map((m) => m.y2 - m.y1 + 1).sort((a, b) => a - b)[Math.floor(todas0sinFiltroAltura.length / 2)]
      : 0;
    const TOLERANCIA_BASE = Math.max(3, Math.round(altoRefAlineacion * 0.4));
    const todas0 = todas0sinFiltroAltura.filter((m) => Math.abs(m.y2 - y2Mediana) <= TOLERANCIA_BASE);

    // Une manchas CHICAS (fragmentos/basura) con la mancha GRANDE mas
    // cercana — nunca dos manchas grandes entre si. Esto es a proposito
    // asimetrico: la primera version unia cualquier par que quedara cerca,
    // y eso fue justo lo que hizo que "5" y "3" (dos digitos de verdad) se
    // pegaran en un solo bloque — habia una mota de ruido diminuta justo
    // en el medio de los dos que actuo de puente, y una fusion en cadena
    // termino uniendolo todo. Un digito real siempre tiene un area
    // considerable (cientos de pixeles a esta resolucion); un fragmento
    // suelto (un trozo de trazo que el despeluce corto, una mota) es
    // chico. Dos manchas grandes cerca una de otra son casi siempre DOS
    // digitos que de verdad estan pegados — a esos los separa el paso de
    // "valle" mas abajo, no esta union.
    const areasOrd = todas0.map((m) => m.area).sort((a, b) => a - b);
    const areaMediana = areasOrd.length ? areasOrd[Math.floor(areasOrd.length / 2)] : 0;
    const UMBRAL_GRANDE = Math.max(AREA_MIN * 3, areaMediana * 0.45);
    const altoRef0 = todas0.length
      ? todas0.map((m) => m.y2 - m.y1 + 1).sort((a, b) => a - b)[Math.floor(todas0.length / 2)]
      : 0;
    const MARGEN_UNION = Math.max(3, Math.round(altoRef0 * 0.3));
    const grandes = todas0.filter((m) => m.area >= UMBRAL_GRANDE).map((m) => ({ ...m }));
    const chicas = todas0.filter((m) => m.area < UMBRAL_GRANDE);
    const distancia = (a: Mancha, b: Mancha) => {
      const dx = Math.max(0, Math.max(a.x1, b.x1) - Math.min(a.x2, b.x2));
      const dy = Math.max(0, Math.max(a.y1, b.y1) - Math.min(a.y2, b.y2));
      return Math.max(dx, dy);
    };
    for (const c of chicas) {
      let mejorI = -1, mejorD = Infinity;
      for (let i = 0; i < grandes.length; i++) {
        const d = distancia(c, grandes[i]);
        if (d < mejorD) { mejorD = d; mejorI = i; }
      }
      if (mejorI >= 0 && mejorD <= MARGEN_UNION) {
        const g = grandes[mejorI];
        grandes[mejorI] = {
          x1: Math.min(g.x1, c.x1), x2: Math.max(g.x2, c.x2),
          y1: Math.min(g.y1, c.y1), y2: Math.max(g.y2, c.y2),
          area: g.area + c.area,
        };
      }
      // si no hay ninguna mancha grande lo bastante cerca, se descarta el
      // fragmento (es ruido suelto, no se puede armar un digito con eso solo)
    }
    const todas = grandes;

    let texto = '';
    let huboFallo = false;
    if (!todas.length) {
      texto = '';
      huboFallo = true;
    } else {
      // Alto de referencia para decidir "esto es lo bastante alto para ser
      // un digito": ANTES se usaba el maximo (Math.max) de todas las
      // manchas — un solo artefacto que se cuele (un gancho, un trozo de
      // carcasa) infla ese maximo de un solo golpe, y entonces LOS DIGITOS
      // REALES (mas cortos que el artefacto) quedan por debajo del umbral
      // y se descartan — que es justo lo que paso: "7.8" en vez de "53.3"
      // porque una de las manchas reales se cayo del corte por esto. La
      // MEDIANA no se deja mover por un solo outlier (haria falta que la
      // mitad de las manchas fueran artefactos altos para desviarla), asi
      // que es la referencia mas segura para esto.
      const altosOrdenados = todas.map((m) => m.y2 - m.y1 + 1).sort((a, b) => a - b);
      const altoRef = altosOrdenados[Math.floor(altosOrdenados.length / 2)];
      // Solo manchas razonablemente altas pueden ser un digito (esto es lo
      // que separa un digito real de una mota de ruido, sin importar el
      // area — una mota chata y ancha no cuenta aunque pese bastante).
      const candidatasDigito = todas.filter((m) => (m.y2 - m.y1 + 1) >= altoRef * 0.5);
      const base = candidatasDigito.length ? candidatasDigito : todas;

      // Ancho tipico de UN digito: mediana de las candidatas que NO son
      // sospechosamente anchas (para que una mancha ya fusionada no
      // distorsione la referencia contra la que se mide a si misma).
      const anchos = base.map((m) => m.x2 - m.x1 + 1).sort((a, b) => a - b);
      const anchoTipico = anchos.length ? anchos[Math.floor(anchos.length / 2)] : altoRef * 0.65;

      // Separa cualquier mancha mas ancha de lo normal en N pedazos,
      // buscando el "valle" (columna con menos tinta) cerca de cada
      // posicion interna esperada — igual que se hizo antes para separar
      // digitos pegados, pero ahora aplicado solo donde de verdad hace
      // falta (mancha ancha), no a cada mancha.
      const piezas: Mancha[] = [];
      for (const m of base) {
        const ancho = m.x2 - m.x1 + 1;
        // Solo se separa si es CLARAMENTE mas ancha de lo normal (60% de
        // margen) — con un umbral apenas por encima de 1x, un digito
        // normal (que siempre varia un poco de ancho segun cual sea) se
        // partia de mas por error, y sus dos mitades terminaban compitiendo
        // como si fueran dos digitos distintos.
        const n = ancho > anchoTipico * 1.6 ? Math.max(1, Math.round(ancho / anchoTipico)) : 1;
        if (n <= 1) { piezas.push(m); continue; }
        const densidadCol = new Int32Array(ancho);
        for (let x = m.x1; x <= m.x2; x++) {
          let cnt = 0;
          for (let y = m.y1; y <= m.y2; y++) if (esNegro(x, y)) cnt++;
          densidadCol[x - m.x1] = cnt;
        }
        const cortes: number[] = [];
        for (let k = 1; k < n; k++) {
          const idealRel = Math.round((k / n) * ancho);
          const ventana = Math.max(2, Math.round(anchoTipico * 0.25));
          let mejorRel = Math.min(ancho - 1, Math.max(0, idealRel));
          let mejorDensidad = densidadCol[mejorRel];
          for (let dx = -ventana; dx <= ventana; dx++) {
            const rel = idealRel + dx;
            if (rel < 0 || rel >= ancho) continue;
            if (densidadCol[rel] < mejorDensidad) { mejorDensidad = densidadCol[rel]; mejorRel = rel; }
          }
          const anterior = cortes.length ? cortes[cortes.length - 1] : 0;
          cortes.push(Math.max(mejorRel, anterior + 1));
        }
        // Area REAL de cada pedazo (suma de su propia franja de densidad),
        // no la del bloque original completo — copiar el area completa a
        // cada mitad las inflaba por igual y podian ganarle el puesto a un
        // digito real que estaba solo, sin fusionar.
        const areaEnRango = (rIni: number, rFin: number) => {
          let s = 0;
          for (let r = rIni; r <= rFin; r++) s += densidadCol[r];
          return s;
        };
        let inicio = m.x1, inicioRel = 0;
        for (const corte of cortes) {
          const xCorte = m.x1 + corte;
          piezas.push({ x1: inicio, x2: xCorte, y1: m.y1, y2: m.y2, area: areaEnRango(inicioRel, corte) });
          inicio = xCorte + 1; inicioRel = corte + 1;
        }
        piezas.push({ x1: inicio, x2: m.x2, y1: m.y1, y2: m.y2, area: areaEnRango(inicioRel, ancho - 1) });
      }

      // Ya no se toman exactamente 3 piezas ni se busca una mancha que
      // "parezca" el punto decimal — la bascula siempre muestra el mismo
      // formato (algunos digitos enteros + UN SOLO decimal: X.X, XX.X,
      // XXX.X segun el peso), asi que el punto no hace falta verlo en la
      // imagen: SIEMPRE va antes del ultimo digito, sin importar cuantos
      // digitos haya en total. Buscar una mancha chata que pareciera punto
      // era la parte mas fragil de todo esto — se quita por completo.
      // Maximo 4 digitos (bascula no pasa de 3 enteros + 1 decimal); si
      // sobran piezas (ruido que paso el filtro de alto), se quedan las de
      // mas area.
      const digitos = piezas
        .sort((a, b) => b.area - a.area)
        .slice(0, 4)
        .sort((a, b) => a.x1 - b.x1);

      // Filtro de sensatez final: dentro del grupo de hasta 4 elegidos,
      // cualquiera cuya area sea muy chica comparada con la mediana del
      // grupo se descarta. Esto es lo que faltaba: si por casualidad solo
      // habia 4 manchas en total (3 digitos reales + 1 fragmento que no
      // alcanzo a fusionarse), el slice(0,4) se quedaba con las 4 SIN
      // IMPORTAR que tan chica fuera la ultima — un digito real no varia
      // tanto de area entre si en la misma lectura.
      const areasDigitos = digitos.map((m) => m.area).sort((a, b) => a - b);
      const areaMedianaDigitos = areasDigitos.length
        ? areasDigitos[Math.floor(areasDigitos.length / 2)]
        : 0;
      const digitosFiltrados = digitos.filter((m) => m.area >= areaMedianaDigitos * 0.3);
      const digitosFinal = digitosFiltrados.length >= 2 ? digitosFiltrados : digitos;

      if (digitosFinal.length >= 2) {
        const digitosTexto: string[] = [];
        for (const m of digitosFinal) {
          // El bbox vertical se recalcula sobre la pieza real (por si al
          // partir una mancha fusionada el alto de cada mitad no es
          // exactamente el de la mancha completa).
          let y1 = H, y2 = -1;
          for (let x = m.x1; x <= m.x2; x++) {
            for (let y = 0; y < H; y++) {
              if (esNegro(x, y)) { if (y < y1) y1 = y; if (y > y2) y2 = y; }
            }
          }
          if (y2 < y1) { y1 = m.y1; y2 = m.y2; }
          const { digito, patron } = this.decodificarDigito(esNegro, m.x1, m.x2, y1, y2);
          if (digito === null) {
            digitosTexto.push(`[${patron}]`);
            huboFallo = true;
          } else {
            digitosTexto.push(digito);
          }
        }
        // El punto va antes del ultimo digito, siempre — es el formato de
        // la bascula, no algo que dependa de lo que se vea en la imagen.
        texto = digitosTexto.slice(0, -1).join('') + '.' + digitosTexto[digitosTexto.length - 1];

        // Dibuja recuadros verdes sobre lo que se leyo como digito — sin
        // lineas de corte ni marca de punto, porque ninguno de los dos
        // hace falta ya.
        ctx.lineWidth = Math.max(1, Math.round(W / 200));
        ctx.strokeStyle = '#33d17a';
        for (const m of digitosFinal) ctx.strokeRect(m.x1, m.y1, Math.max(1, m.x2 - m.x1), Math.max(1, m.y2 - m.y1));
      } else {
        huboFallo = true;
      }
    }
    const debug = `auto ${texto} [build v26-alineacion-vertical]`;

    let valor = huboFallo ? null : this.parsearPesoDeTexto(texto);
    // Filtro de sensatez por dominio: esto pesa huevos, no cualquier cosa.
    // Ni el huevo mas grande real llega a 120g, y no existe un huevo de
    // pocos gramos tampoco — así que un numero fuera de ese rango no es
    // "un huevo raro", es la señal mas clara de que el lector conto mal
    // la cantidad de digitos (le agrego uno de mas, como en "557.8" o
    // "727.3" en vez de "55.7"/"72.7"). En vez de mostrar un numero con
    // cara de valido pero imposible para un huevo, se descarta aqui —
    // esto no arregla la deteccion en si, pero evita que un fallo de
    // deteccion se disfrace de lectura real.
    if (valor !== null && (valor < 10 || valor > 120)) valor = null;

    return { valor, texto: debug };
  }

  /**
   * Etiqueta TODAS las manchas de tinta conexas (flood fill 8-conexo, con
   * diagonales) en todo el recorte, sin restringir a ninguna zona ni
   * posicion. Se usan 8 direcciones y no 4: en un digito de 7 segmentos,
   * dos trazos que se juntan en una esquina muchas veces solo se tocan en
   * diagonal — con 4 direcciones cada digito se partia en 2-3 manchas
   * sueltas (una por segmento), y entonces "las mas grandes" dejaban de
   * ser digitos completos. Descarta solo las demasiado chicas para ser
   * cualquier caracter (area minima).
   */
  private etiquetarManchas(
    esNegro: (x: number, y: number) => boolean,
    W: number, H: number, areaMin: number,
  ): { x1: number; x2: number; y1: number; y2: number; area: number }[] {
    const visitado = new Uint8Array(W * H);
    const manchas: { x1: number; x2: number; y1: number; y2: number; area: number }[] = [];
    const stackX: number[] = [];
    const stackY: number[] = [];
    for (let y0 = 0; y0 < H; y0++) {
      for (let x0 = 0; x0 < W; x0++) {
        const li0 = y0 * W + x0;
        if (visitado[li0] || !esNegro(x0, y0)) continue;
        stackX.length = 0; stackY.length = 0;
        stackX.push(x0); stackY.push(y0);
        visitado[li0] = 1;
        let minX = x0, maxX = x0, minY = y0, maxY = y0, area = 0;
        while (stackX.length) {
          const cx = stackX.pop()!, cy = stackY.pop()!;
          area++;
          if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
          const vecinos: [number, number][] = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1], [cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1], [cx + 1, cy + 1]];
          for (const [nx, ny] of vecinos) {
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
            const nli = ny * W + nx;
            if (visitado[nli] || !esNegro(nx, ny)) continue;
            visitado[nli] = 1;
            stackX.push(nx); stackY.push(ny);
          }
        }
        if (area >= areaMin) manchas.push({ x1: minX, x2: maxX, y1: minY, y2: maxY, area });
      }
    }
    return manchas;
  }

  /**
   * Busca dentro de una ventana [xIni, xFin] x [0, H) la mejor mancha de
   * tinta conexa (flood fill 4-conexo): la de mayor area, y si hay empate,
   * la mas cercana al centro esperado. Devuelve null si no hay ninguna
   * mancha de tamano razonable en la ventana (caracter apagado/ausente).
   * Esto es lo que permite que un corrimiento leve de camara/bascula no
   * rompa la lectura: no se corta en una posicion exacta, se busca la
   * tinta real dentro de un margen alrededor de la posicion calibrada.
   */
  private buscarMejorManchaEnVentana(
    esNegro: (x: number, y: number) => boolean,
    W: number, H: number,
    xIni: number, xFin: number, centroEsperado: number, areaMin: number,
  ): { x1: number; x2: number; y1: number; y2: number } | null {
    const anchoV = xFin - xIni + 1;
    if (anchoV <= 0) return null;
    const visitado = new Uint8Array(anchoV * H);
    const idxLocal = (x: number, y: number) => y * anchoV + (x - xIni);
    let mejor: { x1: number; x2: number; y1: number; y2: number; area: number; centro: number } | null = null;
    const stackX: number[] = [];
    const stackY: number[] = [];
    for (let y0 = 0; y0 < H; y0++) {
      for (let x0 = xIni; x0 <= xFin; x0++) {
        const li0 = idxLocal(x0, y0);
        if (visitado[li0] || !esNegro(x0, y0)) continue;
        stackX.length = 0; stackY.length = 0;
        stackX.push(x0); stackY.push(y0);
        visitado[li0] = 1;
        let minX = x0, maxX = x0, minY = y0, maxY = y0, area = 0;
        while (stackX.length) {
          const cx = stackX.pop()!, cy = stackY.pop()!;
          area++;
          if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
          const vecinos: [number, number][] = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1], [cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1], [cx + 1, cy + 1]];
          for (const [nx, ny] of vecinos) {
            if (nx < xIni || nx > xFin || ny < 0 || ny >= H) continue;
            const nli = idxLocal(nx, ny);
            if (visitado[nli] || !esNegro(nx, ny)) continue;
            visitado[nli] = 1;
            stackX.push(nx); stackY.push(ny);
          }
        }
        if (area < areaMin) continue;
        const centro = (minX + maxX) / 2;
        const mejorAhora = !mejor
          || area > mejor.area
          || (area === mejor.area && Math.abs(centro - centroEsperado) < Math.abs(mejor.centro - centroEsperado));
        if (mejorAhora) mejor = { x1: minX, x2: maxX, y1: minY, y2: maxY, area, centro };
      }
    }
    return mejor ? { x1: mejor.x1, x2: mejor.x2, y1: mejor.y1, y2: mejor.y2 } : null;
  }

  /** Muestrea las 7 zonas de segmento dentro del bbox del digito y arma el patron a-g. */
  private decodificarDigito(
    esNegro: (x: number, y: number) => boolean,
    x1: number, x2: number, y1: number, y2: number,
  ): { digito: string | null; patron: string } {
    const w = x2 - x1 + 1, h = y2 - y1 + 1;
    const patronVacio = '0000000';
    if (w < 2 || h < 4) return { digito: null, patron: patronVacio };

    // Proporcion de negro dentro de una subregion (fraccion 0-1 del bbox)
    const ratio = (fx1: number, fx2: number, fy1: number, fy2: number): number => {
      const rx1 = x1 + Math.round(fx1 * w), rx2 = x1 + Math.round(fx2 * w);
      const ry1 = y1 + Math.round(fy1 * h), ry2 = y1 + Math.round(fy2 * h);
      let n = 0, total = 0;
      for (let x = rx1; x <= rx2; x++) {
        for (let y = ry1; y <= ry2; y++) { total++; if (esNegro(x, y)) n++; }
      }
      return total ? n / total : 0;
    };

    const UMBRAL = 0.35;
    const a = ratio(0.25, 0.75, 0.00, 0.15) > UMBRAL; // arriba
    const f = ratio(0.00, 0.30, 0.12, 0.48) > UMBRAL; // arriba-izquierda
    const b = ratio(0.70, 1.00, 0.12, 0.48) > UMBRAL; // arriba-derecha
    const g = ratio(0.20, 0.80, 0.42, 0.58) > UMBRAL; // medio
    const e = ratio(0.00, 0.30, 0.52, 0.88) > UMBRAL; // abajo-izquierda
    const c = ratio(0.70, 1.00, 0.52, 0.88) > UMBRAL; // abajo-derecha
    const d = ratio(0.25, 0.75, 0.85, 1.00) > UMBRAL; // abajo

    const patron = `${a?1:0}${b?1:0}${c?1:0}${d?1:0}${e?1:0}${f?1:0}${g?1:0}`;
    const TABLA: Record<string, string> = {
      '1111110': '0', '0110000': '1', '1101101': '2', '1111001': '3',
      '0110011': '4', '1011011': '5', '1011111': '6', '1110000': '7',
      '1111111': '8', '1111011': '9',
    };
    if (TABLA[patron]) return { digito: TABLA[patron], patron };

    // Coincidencia exacta no encontrada: probamos con tolerancia de UN
    // segmento de diferencia (umbral limite, camara con ruido, etc.) en vez
    // de descartar el digito por completo.
    let mejorDig: string | null = null, mejorDist = 99;
    for (const pat of Object.keys(TABLA)) {
      let dist = 0;
      for (let i = 0; i < 7; i++) if (pat[i] !== patron[i]) dist++;
      if (dist < mejorDist) { mejorDist = dist; mejorDig = TABLA[pat]; }
    }
    if (mejorDist <= 1) return { digito: mejorDig, patron };
    return { digito: null, patron };
  }

  /**
   * Recorta el ROI (fraccion 0-1) y binariza con umbral ADAPTATIVO por
   * bloques locales (no un promedio global). Esto es lo que permite
   * aguantar reflejos de luz sobre parte del visor, poca luz o luz pareja,
   * porque cada zona del recorte se compara contra su propio entorno en
   * vez de contra un unico promedio de toda la imagen.
   */
  private recortarYBinarizarRoi(src: HTMLCanvasElement, roi: RoiLcd): HTMLCanvasElement | null {
    const w = src.width, h = src.height;
    const x1 = Math.round(roi.x1 * w), y1 = Math.round(roi.y1 * h);
    const x2 = Math.round(roi.x2 * w), y2 = Math.round(roi.y2 * h);
    const rw = x2 - x1, rh = y2 - y1;
    if (rw < 10 || rh < 10) return null;

    // Recorte a escala 3x — ayuda mucho al OCR con displays pequenos
    const escala = 3;
    const out = document.createElement('canvas');
    out.width  = rw * escala;
    out.height = rh * escala;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(src, x1, y1, rw, rh, 0, 0, out.width, out.height);

    const img  = ctx.getImageData(0, 0, out.width, out.height);
    const data = img.data;
    const W = out.width, H = out.height;

    // Escala de "gris": se usa el canal VERDE solo, no la luminancia
    // ponderada normal (0.299R+0.587G+0.114B). El visor retroilumina en
    // azul/cian, y ese es justo el canal que se satura (clipping/bloom del
    // sensor) cuando el brillo sube fuerte — con brillo azul intenso, el
    // canal B del fondo Y del digito pueden llegar juntos a 255, borrando
    // el contraste justo donde mas se necesita. El canal verde separa
    // mejor tinta de fondo en un visor cian (el fondo tiene bastante
    // verde, la tinta casi nada) y se satura mucho menos que el azul,
    // asi que aguanta mejor el brillo fuerte sin perder el digito.
    const grises = new Float32Array(W * H);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      grises[p] = data[i + 1];
    }

    // Estiramiento de contraste por PERCENTIL (no min/max crudo). Con poca
    // luz el sensor mete ruido (algun pixel aislado muy oscuro o un reflejo
    // puntual muy claro), y un solo pixel extremo bastaba para fijar
    // grisMin/grisMax y arruinar el estiramiento completo — por eso "con
    // poca luz no se ve": el rango util real (digito vs fondo) quedaba
    // comprimido en unos pocos niveles de gris. Usando el percentil 3 y 97
    // en vez del minimo/maximo absoluto, unos pocos pixeles de ruido ya no
    // pueden descalibrar el estiramiento.
    const histograma = new Uint32Array(256);
    for (let p = 0; p < grises.length; p++) histograma[Math.max(0, Math.min(255, grises[p] | 0))]++;
    const objetivoBajo = grises.length * 0.03, objetivoAlto = grises.length * 0.97;
    let acumHist = 0, grisMin = 0, grisMax = 255;
    for (let v = 0; v < 256; v++) {
      acumHist += histograma[v];
      if (acumHist >= objetivoBajo) { grisMin = v; break; }
    }
    acumHist = 0;
    for (let v = 255; v >= 0; v--) {
      acumHist += histograma[v];
      if (acumHist >= grises.length - objetivoAlto) { grisMax = v; break; }
    }
    // Si no hay señal real en todo el recorte (pantalla apagada, camara
    // tapada, visor completamente a oscuras) el rango util del percentil
    // 3-97 queda muy chico — es SOLO ruido de sensor, no contraste real de
    // digito contra fondo. Antes esto seguia de largo: el umbral por
    // bloque (punto medio local) igual encontraba "algo" de contraste
    // dentro del ruido y lo leia con confianza como si fueran digitos
    // reales (fue como salio "258.2 g" de una pantalla en negro). Un
    // visor con digitos reales, prendido o no, siempre tiene un salto
    // fuerte entre tinta y fondo — bastante mas que esto. Si no se
    // alcanza, se corta aqui: no hay nada que leer, y es mejor no leer
    // nada que inventar un numero con cara de valido.
    if (grisMax - grisMin < 35) return null;
    const rangoGris = Math.max(1, grisMax - grisMin); // evita division por cero en recortes planos
    for (let p = 0; p < grises.length; p++) {
      grises[p] = Math.max(0, Math.min(255, ((grises[p] - grisMin) / rangoGris) * 255));
    }

    // Minimo y maximo LOCAL por bloques (no solo el promedio) — cada pixel
    // se compara contra el contraste real de su propio vecindario, no
    // contra un margen fijo en niveles de gris. Esto es la otra mitad del
    // arreglo de poca luz: antes el umbral era "promedio local - 10", un
    // margen absoluto que en poca luz (donde digito y fondo quedan mas
    // parecidos entre si) sencillamente no alcanzaba. Ahora el umbral es el
    // punto medio entre lo mas oscuro y lo mas claro QUE HAYA en ese
    // bloque, sin importar si esa diferencia es de 150 niveles (luz fuerte)
    // o de solo 20 (poca luz) — mientras exista algo de contraste local, se
    // detecta igual.
    const bloque = Math.max(6, Math.round(W / 12));
    const minLocal = new Float32Array(W * H);
    const maxLocal = new Float32Array(W * H);
    for (let by = 0; by < H; by += bloque) {
      for (let bx = 0; bx < W; bx += bloque) {
        const bw = Math.min(bloque, W - bx), bh = Math.min(bloque, H - by);
        let lo = 255, hi = 0;
        for (let y = by; y < by + bh; y++) {
          for (let x = bx; x < bx + bw; x++) {
            const v = grises[y * W + x];
            if (v < lo) lo = v; if (v > hi) hi = v;
          }
        }
        for (let y = by; y < by + bh; y++) {
          for (let x = bx; x < bx + bw; x++) { minLocal[y * W + x] = lo; maxLocal[y * W + x] = hi; }
        }
      }
    }

    // Polaridad: los digitos SIEMPRE son la parte mas oscura que su entorno
    // local (navy sobre fondo cian o gris claro), en las dos condiciones de
    // luz que hemos visto (pantalla brillante recien encendida y atenuada
    // en reposo). Antes esto se decidia contando cuantos pixeles del
    // recorte completo eran "claros" vs "oscuros" — con el recuadro viejo
    // (mucho fondo de sobra) eso funcionaba, pero al ceñir el recuadro solo
    // a los digitos, un reflejo/brillo grande en una esquina puede volverse
    // la mayoria del recorte y voltear la polaridad, invirtiendo toda la
    // imagen (fondo entero en negro, digitos como ruido blanco — es
    // exactamente lo que se vio con la pantalla brillante). Se quita ese
    // conteo global: siempre "oscuro respecto al contraste local" = digito.
    const digitosClaros = false;
    // Bloques sin contraste real (lo-hi por debajo de esto) son fondo plano
    // o ruido de sensor sin señal — se dejan en blanco en vez de arriesgarse
    // a que el ruido se lea como digito. Subido de 12 a 30: con 12, un
    // simple degradado de brillo del propio fondo (el resplandor del
    // retroiluminado LED, mas fuerte de un lado del visor que del otro) ya
    // contaba como "contraste real" y una franja entera de fondo se leia
    // como si fuera tinta — eso es lo que se vio en la ultima prueba: el
    // recorte se veia hecho un mosaico invertido, con manchas gigantes que
    // se comian mas de un digito entero, en vez de fondo blanco limpio con
    // los digitos sueltos.
    const CONTRASTE_MINIMO = 30;

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const contraste = maxLocal[p] - minLocal[p];
      let esDigito = false;
      if (contraste >= CONTRASTE_MINIMO) {
        // El umbral ya no es el punto medio exacto — se corre un poco hacia
        // el lado oscuro (42% en vez de 50%). Un degradado suave de fondo
        // dentro de un bloque puede alcanzar el minimo de contraste sin ser
        // en realidad un digito; exigir que el pixel este claramente del
        // lado oscuro (no solo un poco mas oscuro que el punto medio) deja
        // pasar el digito real (que sí tiene contraste fuerte y consistente)
        // sin dejar que el ruido leve de fondo se cuele.
        const umbral = minLocal[p] + contraste * 0.42;
        esDigito = digitosClaros ? grises[p] > umbral : grises[p] < umbral;
      }
      const v = esDigito ? 0 : 255; // texto negro sobre fondo blanco para el OCR
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);

    // Margen blanco alrededor del recorte binarizado: si los digitos tocan
    // el borde de la imagen, Tesseract tiende a recortarlos o confundirlos
    // (p. ej. un "5" pegado al borde izquierdo puede leerse como "1" al
    // perder el trazo superior). Un margen generoso evita eso.
    const margen = Math.round(Math.max(out.width, out.height) * 0.15);
    const conMargen = document.createElement('canvas');
    conMargen.width  = out.width  + margen * 2;
    conMargen.height = out.height + margen * 2;
    const ctxMargen = conMargen.getContext('2d');
    if (!ctxMargen) return out;
    ctxMargen.fillStyle = '#fff';
    ctxMargen.fillRect(0, 0, conMargen.width, conMargen.height);
    ctxMargen.drawImage(out, margen, margen);
    return conMargen;
  }

  /** Extrae un numero razonable de gramos del texto crudo del OCR. */
  private parsearPesoDeTexto(texto: string): number | null {
    const limpio = texto.replace(/[^0-9.,]/g, '').replace(',', '.');
    if (!limpio) return null;
    const val = parseFloat(limpio);
    if (isNaN(val) || val <= 0) return null;
    // La bascula muestra gramos directo (ej. 54.6) — filtra lecturas absurdas
    if (val > 2000) return null;
    return Math.round(val * 10) / 10;
  }

  // ─── Selector de camara ────────────────────────────────────────────────

  async cargarCamaras() {
    this.cargandoCamaras = true;
    try {
      const tmpStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      tmpStream.getTracks().forEach((t) => t.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.camarasDisponibles = devices.filter((d) => d.kind === 'videoinput');
      // Preferir Iriun > DroidCam > primera disponible
      const preferida = this.camarasDisponibles.find((d) =>
        d.label.toLowerCase().includes('iriun') ||
        d.label.toLowerCase().includes('droidcam')
      );
      this.camaraSeleccionadaId =
        preferida?.deviceId ?? this.camarasDisponibles[0]?.deviceId ?? '';
    } catch {
      this.toast.error('No se pudo acceder a camaras');
    }
    this.cargandoCamaras = false;
  }

  labelCamara(d: MediaDeviceInfo, i: number): string {
    return d.label || `Camara ${i + 1}`;
  }

  // ─── Camara ────────────────────────────────────────────────────────────

  async iniciarCamara() {
    try {
      const constraints: MediaTrackConstraints = this.camaraSeleccionadaId
        ? { deviceId: { exact: this.camaraSeleccionadaId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } };

      this.camStream = await navigator.mediaDevices.getUserMedia({
        video: constraints,
        audio: false,
      });

      const video = document.getElementById('cam-video') as HTMLVideoElement;
      if (video) {
        video.srcObject = this.camStream;
        video.onloadedmetadata = () => {
          video.play().catch(() => {});
          this.iniciarLiveCanvas(video);
        };
      }
      this.camActive = true;
      this.iniciarLecturaPeso();
    } catch (e: any) {
      this.toast.error('No se pudo acceder a la camara: ' + e.message);
    }
  }

  private iniciarLiveCanvas(video: HTMLVideoElement) {
    const canvas = document.getElementById('cam-live') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const loop = () => {
      if (!this.camActive) return;
      if (video.readyState >= 2) {
        // Redimensionar el canvas (asignar .width/.height) hace que el
        // navegador lo reconstruya por dentro — es una operacion cara, y
        // antes se hacia en CADA cuadro (60 veces por segundo) aunque el
        // tamano del video casi nunca cambie despues de arrancar la
        // camara. Eso solo hacia falta la primera vez (o si de verdad
        // cambia, por ejemplo al cambiar de camara). Ahora solo se
        // reasigna cuando el tamano real difiere del que ya tiene el
        // canvas — el resto de los cuadros solo dibujan, que es barato.
        const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
        if (canvas.width !== vw || canvas.height !== vh) {
          canvas.width = vw;
          canvas.height = vh;
        }
        ctx?.drawImage(video, 0, 0);
      }
      this.liveLoopId = requestAnimationFrame(loop);
    };
    loop();
  }

  async cambiarCamara() {
    if (!this.camActive) return;
    this.detenerCamara();
    await this.iniciarCamara();
  }

  detenerCamara() {
    if (this.liveLoopId !== null) {
      cancelAnimationFrame(this.liveLoopId);
      this.liveLoopId = null;
    }
    this.camStream?.getTracks().forEach((t) => t.stop());
    this.camStream = null;
    this.camActive = false;
    this.detenerLecturaPeso();
    this.pesoLive = null;
    const video = document.getElementById('cam-video') as HTMLVideoElement;
    if (video) video.srcObject = null;
  }

  // ─── Captura y clasificacion ────────────────────────────────────────────

  async capturarYClasificar() {
    const video  = document.getElementById('cam-video')  as HTMLVideoElement;
    const canvas = document.getElementById('cam-canvas') as HTMLCanvasElement;
    if (!video || !canvas) return;

    canvas.width  = video.videoWidth  || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d')?.drawImage(video, 0, 0);

    this.capturaImg = canvas.toDataURL('image/jpeg', 0.92);

    this.procesando = true;
    // Forzar una lectura fresca del LCD justo en el instante de la captura,
    // ademas de la que ya viene corriendo en segundo plano cada intervalo.
    this.leerPesoFrame();
    this.clasificarConPesoLive(canvas);
    this.procesando = false;
  }

  /** Clasifica usando el ultimo peso leido del LCD (peso) + color del huevo (volumen, respaldo). */
  private clasificarConPesoLive(canvas: HTMLCanvasElement) {
    const vol = this.estimarVolumenLocal(canvas);
    const peso = this.pesoLive;

    if (peso !== null && peso >= 10 && peso <= 200) {
      this.capturaCat       = this.clasificarPorPeso(peso);
      this.capturaPeso      = peso;
      this.capturaConfianza = 'peso';
      this.capturaError     = null;
    } else {
      this.capturaCat       = this.volumenACategoria(vol);
      this.capturaPeso      = null;
      this.capturaConfianza = peso !== null ? 'volumen' : 'estimado';
      this.capturaError     = peso !== null
        ? `Peso fuera de rango (${peso}g) — se uso volumen`
        : 'No se detecto un peso valido en la bascula — se uso estimacion por color';
    }

    this.capturaVol      = parseFloat(vol.toFixed(1));
    this.capturaEjeMayor = 0;
    this.capturaEjeMenor = 0;
    this.showCaptura     = true;
  }

  private clasificarPorPeso(gramos: number): string {
    const cat = CATS.find((c) => gramos > c.pesoMin && gramos <= c.pesoMax);
    return cat ? cat.id : 'C';
  }

  private estimarVolumenLocal(canvas: HTMLCanvasElement): number {
    const ctx = canvas.getContext('2d');
    if (!ctx) return 50;
    const img  = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = img.data;
    let minX = canvas.width, maxX = 0, minY = canvas.height, maxY = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 180 && g > 150 && b > 120 && Math.abs(r - g) < 60) {
        const px = (i / 4) % canvas.width;
        const py = Math.floor(i / 4 / canvas.width);
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        n++;
      }
    }
    if (n < 500) return 50;
    const a = ((maxX - minX) / 2) * 0.05;
    const b = ((maxY - minY) / 2) * 0.05;
    return Math.min(Math.max((4 / 3) * Math.PI * a * b * b, 20), 90);
  }

  private volumenACategoria(vol: number): string {
    if (vol > 68) return 'JUMBO';
    if (vol > 58) return 'AAA';
    if (vol > 48) return 'AA';
    if (vol > 38) return 'A';
    if (vol > 28) return 'B';
    return 'C';
  }

  aceptarCaptura() {
    this.cambiarConteo(this.capturaCat, 1);
    this.showCaptura = false;
    this.capturaImg  = '';
    this.toast.success(`${this.capturaCat} registrado`);
  }

  // ─── Helpers UI ────────────────────────────────────────────────────────

  fmtDate(d: string): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }

  getCatColor(catId: string): string {
    return CATS.find((c) => c.id === catId)?.color || '#333';
  }

  /** Etiqueta de confianza para mostrar en el resultado */
  labelConfianza(c: 'peso' | 'volumen' | 'estimado'): string {
    return c === 'peso' ? 'Bascula (OCR)' : c === 'volumen' ? 'Estimado por color' : 'Estimado';
  }

  confirmYes() {
    this.confirmVisible = false;
    this.confirmCb?.();
    this.confirmCb = null;
  }
  confirmNo() {
    this.confirmVisible = false;
    this.confirmCb = null;
  }

  private newForm(): FormClasificacion {
    return { lote_id: '', jornada: JORNADAS[0], fecha: this.today, obs: '' };
  }
}
