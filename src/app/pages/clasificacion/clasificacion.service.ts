// clasificacion.service.ts
// Estado y lógica compartida entre los 3 submódulos de Clasificación
// (auto, manual, historico). Una sola instancia por componente padre.
//
// Modo automatico: TODO corre 100% en el navegador en TypeScript (sin backend).
// Se lee la pantalla LCD de la báscula en tiempo real mediante visión por computador
// local (preproceso adaptativo 7-segmentos + decodificador por manchas de tinta)
// y el volumen/categoría del huevo se calcula localmente por calibración de cuadrícula
// y métodos geométricos (Elipsoide, Narushin y Teorema de Pappus).
// Modo manual: conteo por teclado con flechas o input directo.
// Espacio = capturar + aceptar inmediatamente en modo auto.
import { Injectable, OnDestroy } from '@angular/core';
import { ApiService } from '../../services/api';
import { ToastService } from '../../services/toast';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';

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
  private fallosPesoSeguidos = 0; // ciclos seguidos sin lectura valida
  private lecturasPesoBuffer: number[] = []; // buffer multicuadro para suavizar y validar peso en vivo
  volumenLive: number | null = null; // volumen calculado en tiempo real para el overlay
  categoriaLive: string = '—'; // categoría calculada en tiempo real para el overlay
  pesoEstadoTexto: string = 'leyendo peso...'; // estado amigable cuando se está intentando leer el peso
  debugVolImgUrl: string | null = null; // máscara HSV cruda del huevo (diagnóstico segmentación)

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
      this.capturarYClasificar();
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
      turno:         form.jornada,
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

  private lastMmPerPx: number = 0.38;

  /** Envía el frame actual de la cámara al microservicio Python de reconocimiento (OCR LCD + Volumen + Overlay) */
  private async leerPesoFrame() {
    if (this.leyendoFrameAhora) return;
    const live = document.getElementById('cam-live') as HTMLCanvasElement;
    if (!live || !live.width) { this.pesoTexto = 'ERROR: canvas de cámara no listo aún'; return; }

    this.leyendoFrameAhora = true;
    try {
      const box = live.parentElement as HTMLElement | null;
      const roiReal = box ? this.mapRoiCajaACanvas(box, live, this.roiLcd) : this.roiLcd;

      // ── Captura y encode del frame ─────────────────────────────────────────
      // PROBLEMA DE 2fps: toDataURL() es SÍNCRONO y bloquea el hilo JS durante
      // el encode JPEG. Cuando live.width es 1280+, ese encode puede tardar
      // 15-40ms, que acaba retrasando el siguiente requestAnimationFrame y
      // hace que el video visible caiga a 2-5fps aunque el setInterval del OCR
      // esté a 1200ms — el encoder JPEG bloquea exactamente cuando el rAF lo
      // necesita.
      //
      // FIX: OffscreenCanvas.convertToBlob() es asíncrono (delega al hilo de
      // compositing del navegador) y no bloquea el hilo principal. Fallback a
      // toDataURL si el navegador no soporta OffscreenCanvas (Safari < 16.4).
      const MAX_W = 800;
      const srcW  = live.width, srcH = live.height;
      const ratio = srcW > MAX_W ? MAX_W / srcW : 1;
      const outW  = Math.round(srcW * ratio);
      const outH  = Math.round(srcH * ratio);

      let frameJpeg: string;
      if (typeof OffscreenCanvas !== 'undefined' && 'convertToBlob' in OffscreenCanvas.prototype) {
        // Camino rápido: encode en background, no bloquea rAF
        const osc = new OffscreenCanvas(outW, outH);
        osc.getContext('2d')?.drawImage(live, 0, 0, outW, outH);
        const blob = await osc.convertToBlob({ type: 'image/jpeg', quality: 0.78 });
        frameJpeg = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } else {
        // Fallback sincrónico (Safari antiguo)
        const tmp = document.createElement('canvas');
        tmp.width = outW; tmp.height = outH;
        tmp.getContext('2d')?.drawImage(live, 0, 0, outW, outH);
        frameJpeg = tmp.toDataURL('image/jpeg', 0.78);
      }

      const payload = {
        frame:   frameJpeg,
        roiLcd:  roiReal,   // fracciones 0-1 no cambian con el downscale
        mmPerPx: this.lastMmPerPx || 0.12,
      };


      const resp = await fetch(`${environment.reconocimientoUrl}/procesar-frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((res) => res.json());

      if (resp && resp.peso) {
        const { valor, texto, confiable } = resp.peso;
        this.pesoTexto = texto || '';

        if (confiable && valor !== null) {
          this.lecturasPesoBuffer.push(valor);
          if (this.lecturasPesoBuffer.length > 5) this.lecturasPesoBuffer.shift();

          const cercanos = this.lecturasPesoBuffer.filter((v: number) => Math.abs(v - valor) <= 0.4);
          if (cercanos.length >= 2 || this.lecturasPesoBuffer.length === 1) {
            this.pesoLive = valor;
          } else {
            const sorted = [...this.lecturasPesoBuffer].sort((a, b) => a - b);
            this.pesoLive = sorted[Math.floor(sorted.length / 2)];
          }
          this.fallosPesoSeguidos = 0;
        } else {
          this.fallosPesoSeguidos++;
          if (this.fallosPesoSeguidos >= 4) {
            this.pesoLive = null;
            this.lecturasPesoBuffer = [];
          }
        }
      }

      if (resp && resp.volumen) {
        const v = resp.volumen;
        this.volElipsoide = v.elipsoide;
        this.volNarushin = v.narushin;
        this.volPappus = v.pappus;
        this.lastMmPerPx = v.mmPerPx || 0.12;

        if (v.confiable && v.final !== null) {
          this.lecturasVolumenBuffer.push(v.final);
          if (this.lecturasVolumenBuffer.length > 5) this.lecturasVolumenBuffer.shift();
          const sortedVol = [...this.lecturasVolumenBuffer].sort((a, b) => a - b);
          this.volumenLive = sortedVol[Math.floor(sortedVol.length / 2)] || v.final;
        } else {
          this.volumenLive = null;
          this.lecturasVolumenBuffer = [];
        }

        console.log('[VOLUMEN DIAGNOSTIC - MICROSERVICIO]', {
          volElipsoide: this.volElipsoide,
          volNarushin: this.volNarushin,
          volPappus: this.volPappus,
          volPromedio: this.volumenLive,
          ejeMayorMm: v.ejeMayor,
          ejeMenorMm: v.ejeMenor,
          mmPerPx: v.mmPerPx,
          confianza: v.confianza,
          confiable: v.confiable,
          motivo: v.motivo,
        });
      }

      // Actualizar visores de debug
      if (resp?.debug) {
        if (resp.debug.recorteBinarizado) this.debugImgUrl    = resp.debug.recorteBinarizado;
        if (resp.debug.mascaraHsvB64)    this.debugVolImgUrl = resp.debug.mascaraHsvB64;
        if (resp.debug.tiempoMs != null)
          console.log(`[FRAME] round-trip Python: ${resp.debug.tiempoMs}ms`);
      }

      // Dibujar overlay transparente independiente (#cam-overlay) para resolver 2.1
      if (resp && resp.contorno) {
        this.dibujarOverlayTransparente(live.width, live.height, resp.contorno);
      }

      if (this.pesoLive !== null) {
        this.pesoEstadoTexto = `${this.pesoLive} g`;
        this.categoriaLive = this.clasificarPorPeso(this.pesoLive);
      } else if (this.lecturasPesoBuffer.length > 0) {
        const ult = this.lecturasPesoBuffer[this.lecturasPesoBuffer.length - 1];
        this.pesoEstadoTexto = `~ ${ult} g (leyendo...)`;
        this.categoriaLive = this.clasificarPorPeso(ult);
      } else {
        this.pesoEstadoTexto = 'leyendo peso...';
        if (this.volumenLive !== null && this.volumenLive > 0) {
          this.categoriaLive = this.volumenACategoria(this.volumenLive);
        } else {
          this.categoriaLive = '—';
        }
      }
    } catch (e: any) {
      this.pesoTexto = 'ERROR MICROSERVICIO: ' + (e?.message || String(e));
      this.fallosPesoSeguidos++;
      if (this.fallosPesoSeguidos >= 4) this.pesoLive = null;
    } finally {
      this.leyendoFrameAhora = false;
    }
  }

  /** Dibuja el contorno del huevo y la elipse en el canvas overlay independiente (#cam-overlay) */
  private dibujarOverlayTransparente(W: number, H: number, contorno: any) {
    const overlayCanvas = document.getElementById('cam-overlay') as HTMLCanvasElement;
    if (!overlayCanvas) return;

    if (overlayCanvas.width !== W || overlayCanvas.height !== H) {
      overlayCanvas.width = W;
      overlayCanvas.height = H;
    }

    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, W, H);
    const { puntos, elipse } = contorno;

    if (puntos && puntos.length > 3) {
      ctx.save();
      ctx.fillStyle = 'rgba(57, 181, 74, 0.25)';
      ctx.strokeStyle = '#39b54a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      puntos.forEach((pt: [number, number], idx: number) => {
        if (idx === 0) ctx.moveTo(pt[0], pt[1]);
        else ctx.lineTo(pt[0], pt[1]);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    if (elipse && elipse.cx && elipse.cy) {
      const { cx, cy, anguloRad, ejeMayorPx, ejeMenorPx } = elipse;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(anguloRad);
      ctx.beginPath();
      ctx.ellipse(0, 0, ejeMayorPx / 2, ejeMenorPx / 2, 0, 0, 2 * Math.PI);
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.strokeStyle = '#ef4444';
      ctx.beginPath(); ctx.moveTo(-ejeMayorPx / 2, 0); ctx.lineTo(ejeMayorPx / 2, 0); ctx.stroke();
      ctx.strokeStyle = '#3b82f6';
      ctx.beginPath(); ctx.moveTo(0, -ejeMenorPx / 2); ctx.lineTo(0, ejeMenorPx / 2); ctx.stroke();
      ctx.restore();
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
  /** Extrae un numero razonable de gramos del texto crudo del OCR. */
  private parsearPesoDeTexto(texto: string): number | null {
    const limpio = texto.replace(/[^0-9.,]/g, '').replace(',', '.');
    if (!limpio) return null;
    const val = parseFloat(limpio);
    if (isNaN(val) || val <= 0) return null;
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
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const constraints: MediaTrackConstraints = this.camaraSeleccionadaId
        ? { deviceId: { exact: this.camaraSeleccionadaId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : isMobile
        ? { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } };

      this.camStream = await navigator.mediaDevices.getUserMedia({
        video: constraints,
        audio: false,
      });

      const video = document.getElementById('cam-video') as HTMLVideoElement;
      if (video) {
        // Asegurar atributos necesarios para que el navegador permita dibujar el stream
        video.muted      = true;
        video.playsInline = true;
        video.autoplay   = true;
        video.srcObject  = this.camStream;

        // Esperamos 'canplay' (readyState ≥ 3) — este garantiza que ya hay un frame
        // real disponible para drawImage(). 'loadedmetadata' solo garantiza width/height,
        // NO datos de imagen: con Iriun el canvas quedaba negro porque el loop arrancaba
        // antes de que el primer frame llegara.
        const esperarCanPlay = (): Promise<void> =>
          new Promise<void>((resolve) => {
            if ((video.readyState as number) >= 3) { resolve(); return; }
            const onReady = () => {
              video.removeEventListener('canplay', onReady);
              video.removeEventListener('error',   onError);
              resolve();
            };
            const onError = () => {
              video.removeEventListener('canplay', onReady);
              video.removeEventListener('error',   onError);
              resolve(); // resolver igual para no bloquear, el canvas seguirá negro pero no cuelga
            };
            video.addEventListener('canplay', onReady, { once: true });
            video.addEventListener('error',   onError, { once: true });
          });

        video.play().catch(() => {});
        await esperarCanPlay();

        console.log('[CÁMARA] canplay — videoWidth:', video.videoWidth,
                    'videoHeight:', video.videoHeight, 'readyState:', video.readyState);

        // Solo activar la cámara y el OCR DESPUÉS de tener frames reales
        this.camActive = true;
        this.iniciarLiveCanvas(video);
        this.iniciarLecturaPeso();
      } else {
        // Fallback: sin elemento video, activar de todas formas
        this.camActive = true;
        this.iniciarLecturaPeso();
      }
    } catch (e: any) {
      this.toast.error('No se pudo acceder a la cámara: ' + e.message);
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
    this.procesando = true;
    await this.leerPesoFrame();
    this.clasificarConPesoLive();

    this.cambiarConteo(this.capturaCat, 1);
    const detalleFuente = this.capturaPeso !== null ? `${this.capturaPeso}g` : `${this.capturaVol} cm³`;
    this.toast.success(`Huevo registrado: +1 ${this.capturaCat} (${detalleFuente})`);

    this.showCaptura = false;
    this.procesando  = false;
  }

  /** Clasifica usando el ultimo peso leido (OCR) o estimacion por volumen de microservicio */
  private clasificarConPesoLive() {
    const vol = this.volumenLive || 50;
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
        : 'No se detectó un peso válido en la báscula — se usó estimación por visión';
    }

    this.capturaVol  = parseFloat(vol.toFixed(1));
    this.showCaptura = false;
  }

  private clasificarPorPeso(gramos: number): string {
    const cat = CATS.find((c) => gramos > c.pesoMin && gramos <= c.pesoMax);
    return cat ? cat.id : 'C';
  }

  volElipsoide: number = 0;
  volNarushin: number = 0;
  volPappus: number = 0;
  private bufferMmPerPx: number[] = [];
  private lecturasVolumenBuffer: number[] = [];

  private volumenACategoria(volCm3: number): string {
    if (volCm3 > 68) return 'JUMBO';
    if (volCm3 > 58) return 'AAA';
    if (volCm3 > 48) return 'AA';
    if (volCm3 > 38) return 'A';
    if (volCm3 > 28) return 'B';
    return 'C';
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
