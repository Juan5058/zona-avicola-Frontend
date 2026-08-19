// clasificacion.service.ts
// Estado y lógica compartida entre los 3 submódulos de Clasificación
// (auto, manual, historico). Una sola instancia por componente padre.
//
// Modo automatico: envia frames al servidor Python (localhost:8000) que lee
// la pantalla LCD de la bascula + mide el huevo en la hoja milimetrada.
// Modo manual: conteo por teclado con flechas o input directo.
// Enter = capturar + aceptar inmediatamente en modo auto.
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
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

const PYTHON_API = 'http://127.0.0.1:8001';

// Servidor del modelo YOLO entrenado (deteccion-huevos/server.py) - hace la
// segmentacion real del huevo (contorno, volumen, categoria). El 8001 sigue
// usandose SOLO para leer el peso de la bascula (LCD), eso no se toca.
const PYTHON_API_VISION = 'http://127.0.0.1:8020';

// Resolucion con la que se calibro roi_config.json (python debug_recorte.py
// confirmo 640x480). La camara del navegador pide 1280x720, asi que el
// contorno rojo se reescala proporcionalmente a la resolucion real del canvas.
const ROI_CALIB_W = 640;
const ROI_CALIB_H = 480;

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

// Geometria de la elipse ajustada al huevo, en pixeles del MISMO frame que
// se envio a /clasificar (misma resolucion que el canvas cam-live, no hace
// falta reescalar como con el ROI).
export interface RespuestaElipse {
  cx: number;
  cy: number;
  ancho_px: number;
  alto_px: number;
  angulo_deg: number;
  largo_cm: number;
  diametro_cm: number;
}

// Respuesta del servidor Python
interface RespuestaVision {
  categoria:     string;
  peso_g:        number | null;
  volumen_cm3:   number;
  eje_mayor_mm:  number;
  eje_menor_mm:  number;
  confianza:     'peso' | 'volumen' | 'estimado';
  error:         string | null;
  elipse:        RespuestaElipse | null;
}

// Respuesta del endpoint /roi — coordenadas del recuadro calibrado
interface RespuestaRoi {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Respuesta del servidor YOLO (deteccion-huevos/server.py, puerto 8020)
interface RespuestaVisionYolo {
  huevo_detectado: boolean;
  largo_cm?: number;
  diametro_cm?: number;
  volumen_promedio_cm3?: number;
  categoria?: string;
  clasificado_por?: string;
  contorno?: [number, number][]; // puntos reales del poligono detectado
  elipse?: { cx: number; cy: number; ancho_px: number; alto_px: number; angulo_deg: number };
  error?: string;
}

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
export class ClasificacionService {
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
  calibrando = false;
private roiX = 0;
private roiY = 0;
private roiW = 0;
private roiH = 0;
private roiVideoW = 0;
private roiVideoH = 0;
private roiArrastrando = false;
private roiOffsetX = 0;
private roiOffsetY = 0;
private calibLoopId: number | null = null;

  camStream: MediaStream | null = null;
  camActive = false;
  private liveLoopId: number | null = null;

  // ── Selector de camara ───────────────────────────────────────────────────
  camarasDisponibles:  MediaDeviceInfo[] = [];
  camaraSeleccionadaId = '';
  cargandoCamaras      = false;

  // ── Servidor Python ──────────────────────────────────────────────────────
  servidorActivo    = false;
  verificandoServer = false;

  // ── ROI de calibracion (contorno rojo sobre la vista en vivo) ───────────
  roi: { x: number; y: number; w: number; h: number } | null = null;

  // ── Lectura en vivo (bascula + vision) ───────────────────────────────────
  // Se actualiza sola cada ~800ms mientras la camara esta prendida, no
  // depende de darle clic a "Capturar".
  capturaCat:       string       = '';
  capturaPeso:      number | null = null;
  capturaVol:       number       = 0;
  capturaEjeMayor:  number       = 0;
  capturaEjeMenor:  number       = 0;
  capturaConfianza: 'peso' | 'volumen' | 'estimado' = 'volumen';
  capturaError:     string | null = null;
  // geometria de la elipse del huevo — se dibuja sobre el MISMO canvas del
  // video en vivo (junto al recuadro rojo), no en una imagen aparte
  elipseHuevo:      RespuestaElipse | null = null;
  // contorno REAL detectado por el modelo YOLO (server.py, 8020) — se
  // dibuja tal cual en vez de la elipse aproximada, para que se vea
  // exactamente lo que el modelo esta segmentando
  contornoHuevo:    [number, number][] | null = null;
  servidorVisionActivo = false;
  procesando        = false;   // true durante la captura manual (boton "Capturar")
  guardando         = false;   // feedback visual breve al aceptar con Enter

  private liveTimerId: number | null = null;
  private consultando  = false;          // evita solapar peticiones al servidor
  private ultimoPesoGuardado: number | null = null;
  private ultimoGuardadoTimestamp: number | null = null;
  private readonly VENTANA_ANTIDUPLICADO_MS = 1000; 

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
    private http:  HttpClient,
  ) {
    CATS.forEach((c) => (this.counts[c.id] = null));
  }

  init() {
    const rol    = this.auth.getSession()?.rol;
    this.isAdmin = rol === 'admin';
    this.cargarLotes();
    this.cargarHistorial();
    this.verificarServidor();
    this.cargarCamaras();
  }

  // ─── Teclado (llamado desde el padre) ───────────────────────────────────

  onEsc() {
    this.confirmVisible = false;
    this.confirmCb      = null;
  }

  onEnter() {
    if (this.modo === 'auto' && this.camActive && !this.guardando && this.capturaCat) {
      this.aceptarCaptura();
    }
  }

  // ─── Navegacion ────────────────────────────────────────────────────────

  setModo(m: 'auto' | 'manual') {
    this.modo = m;
    if (m !== 'auto' && this.camStream) this.detenerCamara();
    this.resetConteo();
  }

  // ─── Calibracion de posicion del recuadro de peso ───────────────────────

async abrirCalibracion() {
  if (!this.camActive) return;
  try {
    const res: any = await firstValueFrom(this.http.get(`${PYTHON_API}/roi_actual`));
    this.roiX = res.x;
    this.roiY = res.y;
    this.roiW = res.w;
    this.roiH = res.h;
  } catch {
    this.toast.error('No se pudo leer la posicion actual del recuadro');
    return;
  }
  this.calibrando = true;
  setTimeout(() => this.iniciarCalibracionCanvas(), 0);
}

private iniciarCalibracionCanvas() {
  const video   = document.getElementById('cam-video') as HTMLVideoElement;
  const bg      = document.getElementById('cam-calibracion-bg') as HTMLCanvasElement;
  const overlay = document.getElementById('cam-calibracion-overlay') as HTMLCanvasElement;
  if (!video || !bg || !overlay) return;

  this.roiVideoW = video.videoWidth  || 1280;
  this.roiVideoH = video.videoHeight || 720;
  bg.width = overlay.width   = this.roiVideoW;
  bg.height = overlay.height = this.roiVideoH;

  const bgCtx = bg.getContext('2d');
  const ovCtx = overlay.getContext('2d');

  const loop = () => {
    if (!this.calibrando) return;
    if (video.readyState >= 2) bgCtx?.drawImage(video, 0, 0, this.roiVideoW, this.roiVideoH);
    if (ovCtx) {
      ovCtx.clearRect(0, 0, this.roiVideoW, this.roiVideoH);
      ovCtx.strokeStyle = '#00ff00';
      ovCtx.lineWidth = Math.max(2, this.roiVideoW * 0.004);
      ovCtx.strokeRect(this.roiX, this.roiY, this.roiW, this.roiH);
    }
    this.calibLoopId = requestAnimationFrame(loop);
  };
  loop();
}

private roiEventToCanvasCoords(e: MouseEvent): { x: number; y: number } {
  const overlay = e.currentTarget as HTMLCanvasElement;
  const rect = overlay.getBoundingClientRect();
  const scaleX = this.roiVideoW / rect.width;
  const scaleY = this.roiVideoH / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

onRoiMouseDown(e: MouseEvent) {
  const p = this.roiEventToCanvasCoords(e);
  const dentro = p.x >= this.roiX && p.x <= this.roiX + this.roiW &&
                 p.y >= this.roiY && p.y <= this.roiY + this.roiH;
  if (dentro) {
    this.roiArrastrando = true;
    this.roiOffsetX = p.x - this.roiX;
    this.roiOffsetY = p.y - this.roiY;
  }
}

onRoiMouseMove(e: MouseEvent) {
  if (!this.roiArrastrando) return;
  const p = this.roiEventToCanvasCoords(e);
  let nuevoX = p.x - this.roiOffsetX;
  let nuevoY = p.y - this.roiOffsetY;
  nuevoX = Math.max(0, Math.min(nuevoX, this.roiVideoW - this.roiW));
  nuevoY = Math.max(0, Math.min(nuevoY, this.roiVideoH - this.roiH));
  this.roiX = Math.round(nuevoX);
  this.roiY = Math.round(nuevoY);
}

onRoiMouseUp() {
  this.roiArrastrando = false;
}

async guardarCalibracion() {
  try {
    await firstValueFrom(this.http.post(`${PYTHON_API}/mover_roi`, { x: this.roiX, y: this.roiY }));
    this.toast.success('Posicion de la bascula actualizada');
  } catch {
    this.toast.error('No se pudo guardar la nueva posicion');
    return;
  }
  this.cancelarCalibracion();
}

cancelarCalibracion() {
  this.calibrando = false;
  if (this.calibLoopId !== null) {
    cancelAnimationFrame(this.calibLoopId);
    this.calibLoopId = null;
  }
}

  private resetConteo() {
    CATS.forEach((c) => (this.counts[c.id] = null));
    this.danados    = null;
    this.editId     = null;
    this.formTitle  = 'Conteo por Categoria';
    this.capturaCat  = '';
    this.capturaPeso = null;
    this.elipseHuevo = null;
    this.contornoHuevo = null;
    this.ultimoPesoGuardado = null;
    this.ultimoGuardadoTimestamp = null;
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

  // ─── Servidor Python ───────────────────────────────────────────────────

  verificarServidor() {
    this.verificandoServer = true;
    this.http.get(`${PYTHON_API}/ping`).subscribe({
      next: () => {
        this.servidorActivo   = true;
        this.verificandoServer = false;
        this.cargarRoi();
      },
      error: () => {
        this.servidorActivo   = false;
        this.verificandoServer = false;
      },
    });
  }

  /** Trae el ROI calibrado (roi_config.json) para dibujar el contorno rojo
   * sobre la vista en vivo. Se puede volver a llamar tras recalibrar. */
  cargarRoi() {
    this.http.get<RespuestaRoi>(`${PYTHON_API}/roi`).subscribe({
      next: (r) => (this.roi = r),
      error: () => (this.roi = null),
    });
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
      if (this.servidorActivo) this.cargarRoi();
      this.iniciarLoopClasificacion();
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
        canvas.width  = video.videoWidth  || 1280;
        canvas.height = video.videoHeight || 720;
        ctx?.drawImage(video, 0, 0);

        // ── contorno rojo: aqui debe caer el display de la bascula ──
        if (ctx && this.roi) {
          // roi_config.json se calibro a 640x480 (python); reescalamos
          // proporcionalmente a la resolucion real del canvas (ej. 1280x720)
          const escalaX = canvas.width  / ROI_CALIB_W;
          const escalaY = canvas.height / ROI_CALIB_H;
          ctx.save();
          ctx.strokeStyle = '#ff1744';
          ctx.lineWidth = Math.max(2, Math.round(canvas.width / 320));
          ctx.setLineDash([]);
          ctx.strokeRect(
            this.roi.x * escalaX,
            this.roi.y * escalaY,
            this.roi.w * escalaX,
            this.roi.h * escalaY
          );
          ctx.restore();
        }

        // ── contorno amarillo: forma REAL del huevo detectada por YOLO ──
        // Viene en pixeles del MISMO frame que se envio a /detectar-vivo,
        // que siempre tiene la resolucion real del canvas — no necesita
        // reescalarse como el ROI.
        if (ctx && this.contornoHuevo && this.contornoHuevo.length > 2) {
          this.dibujarContornoHuevo(ctx, this.contornoHuevo);
        } else if (ctx && this.elipseHuevo) {
          // fallback por si algun dia vuelve a usarse solo la elipse
          this.dibujarElipseHuevo(ctx, this.elipseHuevo);
        }
      }
      this.liveLoopId = requestAnimationFrame(loop);
    };
    loop();
  }

  /** Dibuja el contorno REAL (poligono) que el modelo YOLO detecto sobre el
   * huevo — esto es lo que pidio el instructor: ver exactamente que esta
   * segmentando el modelo, no una elipse aproximada. */
  private dibujarContornoHuevo(ctx: CanvasRenderingContext2D, puntos: [number, number][]) {
    const AMARILLO = '#ffe600';
    ctx.save();
    ctx.strokeStyle = AMARILLO;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(puntos[0][0], puntos[0][1]);
    for (let i = 1; i < puntos.length; i++) {
      ctx.lineTo(puntos[i][0], puntos[i][1]);
    }
    ctx.closePath();
    ctx.stroke();

    if (this.capturaEjeMayor > 0) {
      const [cx, cy] = puntos.reduce(
        (acc, p) => [acc[0] + p[0] / puntos.length, acc[1] + p[1] / puntos.length],
        [0, 0]
      );
      ctx.font = '13px sans-serif';
      ctx.fillStyle = AMARILLO;
      ctx.fillText(
        `${(this.capturaEjeMayor / 10).toFixed(1)} x ${(this.capturaEjeMenor / 10).toFixed(1)} cm`,
        cx - 40,
        cy
      );
    }
    ctx.restore();
  }

  /** (fallback) Dibuja el contorno amarillo de la elipse ajustada al huevo,
   * mas las lineas de largo/diametro rotuladas en cm. */
  private dibujarElipseHuevo(ctx: CanvasRenderingContext2D, e: RespuestaElipse) {
    const AMARILLO = '#ffe600';
    const radioX = e.ancho_px / 2;
    const radioY = e.alto_px / 2;
    const anguloRad = (e.angulo_deg * Math.PI) / 180;

    ctx.save();
    ctx.strokeStyle = AMARILLO;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(e.cx, e.cy, radioX, radioY, anguloRad, 0, Math.PI * 2);
    ctx.stroke();

    // direccion de cada eje (misma convencion que OpenCV: 'ancho' rota
    // segun angulo, 'alto' va perpendicular)
    const dirAncho: [number, number] = [Math.cos(anguloRad), Math.sin(anguloRad)];
    const dirAlto:  [number, number] = [-Math.sin(anguloRad), Math.cos(anguloRad)];

    const esAnchoMayor = e.ancho_px >= e.alto_px;
    const dirMayor = esAnchoMayor ? dirAncho : dirAlto;
    const dirMenor = esAnchoMayor ? dirAlto  : dirAncho;
    const ejeMayorPx = Math.max(e.ancho_px, e.alto_px);
    const ejeMenorPx = Math.min(e.ancho_px, e.alto_px);

    const linea = (dir: [number, number], largoPx: number, etiqueta: string) => {
      const p1: [number, number] = [e.cx - dir[0] * largoPx / 2, e.cy - dir[1] * largoPx / 2];
      const p2: [number, number] = [e.cx + dir[0] * largoPx / 2, e.cy + dir[1] * largoPx / 2];
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.stroke();
      ctx.font = '13px sans-serif';
      ctx.fillStyle = AMARILLO;
      ctx.fillText(etiqueta, p2[0] + 4, p2[1]);
    };

    linea(dirMayor, ejeMayorPx, `${e.largo_cm.toFixed(1)} cm`);
    linea(dirMenor, ejeMenorPx, `${e.diametro_cm.toFixed(1)} cm`);
    ctx.restore();
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
    this.detenerLoopClasificacion();
    this.camStream?.getTracks().forEach((t) => t.stop());
    this.camStream = null;
    this.camActive = false;
    const video = document.getElementById('cam-video') as HTMLVideoElement;
    if (video) video.srcObject = null;
  }

  // ─── Lectura en vivo (loop continuo) ────────────────────────────────────

  /** Arranca el sondeo periodico al servidor mientras la camara este activa. */
  private iniciarLoopClasificacion() {
    this.detenerLoopClasificacion();
    const tick = () => {
      if (!this.camActive) return;
      if (this.servidorActivo && !this.consultando) {
        this.consultarServidor();
      } else if (!this.servidorActivo) {
        // servidor caido: estimacion local por color, sigue en vivo igual
        const canvas = document.getElementById('cam-canvas') as HTMLCanvasElement;
        const video  = document.getElementById('cam-video')  as HTMLVideoElement;
        if (canvas && video && video.readyState >= 2) {
          canvas.width  = video.videoWidth  || 1280;
          canvas.height = video.videoHeight || 720;
          canvas.getContext('2d')?.drawImage(video, 0, 0);
          this.clasificarLocal(canvas);
        }
      }
      this.liveTimerId = window.setTimeout(tick, 800);
    };
    tick();
  }

  private detenerLoopClasificacion() {
    if (this.liveTimerId !== null) {
      clearTimeout(this.liveTimerId);
      this.liveTimerId = null;
    }
  }

  /** Toma un frame actual y lo manda a los 2 servidores — se llama sola cada 800ms.
   *  - 8001 (bascula): SOLO se usa para leer el peso del LCD, no se toca su logica.
   *  - 8020 (YOLO):     hace la deteccion real del huevo — contorno, volumen,
   *                      categoria. Si hay peso valido de la bascula, se lo
   *                      mandamos para que clasifique con peso + volumen. */
  private async consultarServidor() {
    const video  = document.getElementById('cam-video')  as HTMLVideoElement;
    const canvas = document.getElementById('cam-canvas') as HTMLCanvasElement;
    if (!video || !canvas || video.readyState < 2) return;

    canvas.width  = video.videoWidth  || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const frame = canvas.toDataURL('image/jpeg', 0.85);

    this.consultando = true;

    // 1) Bascula (8001) — solo para el peso del LCD
    let pesoBascula: number | null = null;
    try {
      const resBascula = await firstValueFrom(
        this.http.post<RespuestaVision>(`${PYTHON_API}/clasificar`, { frame })
      );
      pesoBascula = resBascula.peso_g;
    } catch {
      this.servidorActivo = false;
    }

    // 2) Modelo YOLO (8020) — deteccion real: contorno, volumen, categoria
    try {
      const resVision = await firstValueFrom(
        this.http.post<RespuestaVisionYolo>(`${PYTHON_API_VISION}/detectar-vivo`, {
          frame,
          peso_g: pesoBascula ?? undefined,
        })
      );
      this.servidorVisionActivo = true;

      if (!resVision.huevo_detectado) {
        this.capturaError  = 'No se detecta huevo en la imagen';
        this.contornoHuevo = null;
        this.elipseHuevo   = null;
      } else {
        this.capturaCat       = resVision.categoria ?? '';
        this.capturaPeso      = pesoBascula;
        this.capturaVol       = resVision.volumen_promedio_cm3 ?? 0;
        this.capturaEjeMayor  = Math.round((resVision.largo_cm ?? 0) * 100) / 10;   // cm -> mm, 1 decimal
        this.capturaEjeMenor  = Math.round((resVision.diametro_cm ?? 0) * 100) / 10;
        this.capturaConfianza = pesoBascula ? 'peso' : 'volumen';
        this.capturaError     = null;
        this.contornoHuevo    = resVision.contorno ?? null;
        this.elipseHuevo      = null; // ya no se usa la aproximacion, se dibuja el contorno real
      }
    } catch {
      this.servidorVisionActivo = false;
      this.toast.error('Servidor de deteccion (modelo) no responde — revisa que server.py este activo en :8020');
    }

    this.consultando = false;
  }

  /** Boton "Capturar" (respaldo manual): fuerza una lectura inmediata. */
  async capturarYClasificar() {
    if (!this.camActive) return;
    this.procesando = true;
    if (this.servidorActivo) {
      await this.consultarServidor();
    } else {
      const canvas = document.getElementById('cam-canvas') as HTMLCanvasElement;
      const video  = document.getElementById('cam-video')  as HTMLVideoElement;
      if (canvas && video) {
        canvas.width  = video.videoWidth  || 1280;
        canvas.height = video.videoHeight || 720;
        canvas.getContext('2d')?.drawImage(video, 0, 0);
        this.clasificarLocal(canvas);
      }
    }
    this.procesando = false;
  }

  private clasificarLocal(canvas: HTMLCanvasElement) {
    const vol         = this.estimarVolumenLocal(canvas);
    this.capturaCat   = this.volumenACategoria(vol);
    this.capturaPeso  = null;
    this.capturaVol   = parseFloat(vol.toFixed(1));
    this.capturaEjeMayor = 0;
    this.capturaEjeMenor = 0;
    this.capturaConfianza = 'estimado';
    this.capturaError = 'Servidor no disponible — estimacion local por color';
    this.elipseHuevo = null;   // sin servidor no hay geometria real que dibujar
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
  if (!this.capturaCat) return;

  // Anti-duplicado: solo bloquea si es el MISMO peso Y paso muy poco
  // tiempo desde el ultimo guardado (senal de que sigue siendo el mismo
  // huevo fisico sobre la bascula). Si ya pasaron los 3 segundos, se
  // asume que pudo haberse retirado y puede ser un huevo distinto,
  // aunque coincida el peso.
  const mismoPeso = this.capturaPeso !== null && this.capturaPeso === this.ultimoPesoGuardado;
  const pocoTiempo = this.ultimoGuardadoTimestamp !== null &&
    (Date.now() - this.ultimoGuardadoTimestamp) < this.VENTANA_ANTIDUPLICADO_MS;

  if (mismoPeso && pocoTiempo) {
    this.toast.error('Ese peso ya fue registrado — retira el huevo de la bascula');
    return;
  }

  this.cambiarConteo(this.capturaCat, 1);
  this.ultimoPesoGuardado = this.capturaPeso;
  this.ultimoGuardadoTimestamp = Date.now();
  this.guardando = true;
  setTimeout(() => (this.guardando = false), 500);
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
    return c === 'peso' ? 'Bascula' : c === 'volumen' ? 'Vision' : 'Estimado';
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