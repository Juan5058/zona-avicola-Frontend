// dashboard
import { Component, OnInit, OnDestroy, AfterViewInit, effect, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api';
import { SidebarStateService } from '../../services/sidebar-state';

interface StatCard {
  badge: string;
  num: string;
  title: string;
  sub: string;
  grad: [string, string];
  trend?: { dir: 'up' | 'down' | 'equal'; pct: number };
}

interface ResumenItem {
  texto: string;
  tipo: 'positivo' | 'negativo' | 'neutro';
}

interface ConsumoItem {
  nombre: string;
  kg: number;
  pct: number;
  grupo: 'alimento' | 'inventario';
  unidad?: string;
}


const CARD_GAP    = 12;
const VISIBLE     = 7;
const STORE_KEY   = 'dashboard_state'; // clave localStorage

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.html',
  styleUrl:    './dashboard.scss',
  encapsulation: ViewEncapsulation.None,
})
export class DashboardComponent implements OnInit, OnDestroy, AfterViewInit {

  cards: StatCard[] = [
    { badge: 'Hoy',      num: '—', title: 'Huevos Hoy',  sub: 'Cargando...', grad: ['#39B54A','#2E9940'] },
    { badge: 'Activo',   num: '—', title: 'Lotes Activos',      sub: 'Cargando...', grad: ['#FB8C00','#E65100'] },
    { badge: 'Periodo',  num: '—', title: 'Ingresos',           sub: 'Cargando...', grad: ['#8E24AA','#6A1B9A'] },
    { badge: 'Periodo',  num: '—', title: 'Bajas',              sub: 'Cargando...', grad: ['#E53935','#B71C1C'] },
    { badge: 'Periodo',  num: '—', title: 'Total Clasificados', sub: 'Cargando...', grad: ['#43A047','#1B5E20'] },
    { badge: 'Periodo',  num: '—', title: 'Ventas Gallinas',    sub: 'Cargando...', grad: ['#1E88E5','#1565C0'] },
    { badge: 'Periodo',  num: '—', title: 'Consumo Alimento',   sub: 'Cargando...', grad: ['#F9A825','#F57F17'] },
    { badge: 'Total',    num: '—', title: 'Tratamientos',       sub: 'Cargando...', grad: ['#00ACC1','#00697A'] },
    { badge: 'Promedio', num: '—', title: 'Promedio Diario',    sub: 'Huevos/dia en el periodo', grad: ['#5E35B1','#311B92'] },
    { badge: 'Stock',    num: '—', title: 'Inventario',         sub: 'Cargando...', grad: ['#00897B','#004D40'] },
  ];

  // ── carrusel infinito ─────────────────────────────────────────────────────

  private _carIdx   = VISIBLE;
  transitioning     = true;
  hoverCarousel     = false;
  private autoTimer: any;
  cardW             = 190;
  private visibleCount = VISIBLE;

  get trackCards(): StatCard[] {
    const head = this.cards.slice(-this.visibleCount);
    const tail = this.cards.slice(0, this.visibleCount);
    return [...head, ...this.cards, ...tail];
  }

  trackOffset(): string {
    return `translateX(-${this._carIdx * (this.cardW + CARD_GAP)}px)`;
  }

  get dots() { return Array(this.cards.length).fill(0); }

  get dotActivo(): number {
    return (this._carIdx - this.visibleCount + this.cards.length) % this.cards.length;
  }

  irA(i: number) {
    this.transitioning = true;
    this._carIdx = i + this.visibleCount;
  }

  getRealIndex(trackIdx: number): number {
    return ((trackIdx - this.visibleCount) % this.cards.length + this.cards.length) % this.cards.length;
  }

  next() {
    this.transitioning = true;
    this._carIdx++;
    if (this._carIdx >= this.cards.length + this.visibleCount) {
      setTimeout(() => { this.transitioning = false; this._carIdx = this.visibleCount; }, 410);
    }
  }

  prev() {
    this.transitioning = true;
    this._carIdx--;
    if (this._carIdx < this.visibleCount) {
      setTimeout(() => { this.transitioning = false; this._carIdx = this.cards.length + this.visibleCount - 1; }, 410);
    }
  }

  startCarousel() {
    this.autoTimer = setInterval(() => {
      if (!this.hoverCarousel) this.next();
    }, 2800);
  }

  calcVisibleCount() {
    const vp = document.querySelector('.carousel-viewport') as HTMLElement;
    if (vp) this.cardW = Math.floor((vp.clientWidth - CARD_GAP * (VISIBLE - 1)) / VISIBLE);
    this.visibleCount = VISIBLE;
  }

  // ── filtros — se persisten en localStorage ────────────────────────────────

  private _periodoActivo = 'semana';
  private _fechaIni      = '';
  private _fechaFin      = '';

  get periodoActivo() { return this._periodoActivo; }
  set periodoActivo(v: string) { this._periodoActivo = v; this.guardarEstado(); }

  get fechaIni() { return this._fechaIni; }
  set fechaIni(v: string) { this._fechaIni = v; this.guardarEstado(); }

  get fechaFin() { return this._fechaFin; }
  set fechaFin(v: string) { this._fechaFin = v; this.guardarEstado(); }

  // ── estado general ────────────────────────────────────────────────────────

  ultimaActualizacion: Date | null = null;
  refrescando = false;

  barData:       { label: string; val: number; pct: number }[]                                     = [];
  barAgrupacionMensual: boolean = false;
  mortData:      { label: string; val: number; pct: number }[]                                     = [];
  donutSegments: { label: string; val: number; pct: number; color: string; offset: number }[]      = [];
  donutTotal     = 0;
  lotesActivos:  any[] = [];

  productividadLotes:   { codigo: string; raza: string; cantidad: number; huevosPeriodo: number; tasa: number }[] = [];
  tratamientosProximos: any[] = [];
  inventarioItems:      { nombre: string; stock: number; minimo: number; estado: 'ok' | 'bajo' | 'critico' }[]   = [];
  resumen:              ResumenItem[] = [];
  resumenLimite:        number = 3;
  resumenExpandido:     boolean = false;

  get resumenVisible(): ResumenItem[] {
    return this.resumenExpandido ? this.resumen : this.resumen.slice(0, this.resumenLimite);
  }
  eficienciaDisplay     = '—';

  // ── resumen rapido (finanzas + salud, prioridad baja, vista compacta) ──────
  consumoPorItem:    ConsumoItem[] = [];
  ingresosPeriodo    = 0;
  numVentasPeriodo   = 0;
  tasaMortDisplay    = '0.00';

  sum = (acc: number, b: { val: number }) => acc + b.val;

  private _rawClasif:  any[] = [];
  private _rawVentas:  any[] = [];
  private _rawMort:    any[] = [];
  private _rawConsumo: any[] = [];
  private _rawSalidasInv: any[] = [];
  private _rawTrat:    any[] = [];

  // ── constructor ───────────────────────────────────────────────────────────

  constructor(
    private api: ApiService,
    private sidebarState: SidebarStateService,
  ) {
    effect(() => {
      this.sidebarState.collapsed();
      setTimeout(() => this.calcVisibleCount(), 310);
    });
  }

  // ── persistencia localStorage ─────────────────────────────────────────────

  private guardarEstado() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        periodoActivo:     this._periodoActivo,
        fechaIni:          this._fechaIni,
        fechaFin:          this._fechaFin,
      }));
    } catch { /* storage no disponible */ }
  }

  private restaurarEstado() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);

      if (s.periodoActivo) this._periodoActivo = s.periodoActivo;

      // restaurar fechas solo si son validas
      if (s.fechaIni && s.fechaFin) {
        const ini = new Date(s.fechaIni);
        const fin = new Date(s.fechaFin);
        if (!isNaN(ini.getTime()) && !isNaN(fin.getTime())) {
          this._fechaIni = s.fechaIni;
          this._fechaFin = s.fechaFin;
        }
      }

    } catch { /* json invalido, ignorar */ }
  }


  // si no habia estado guardado, calcula fechas por defecto segun el periodo
  private calcFechasPorDefecto() {
    const now = new Date();
    const ini = new Date();
    if (this._periodoActivo === 'semana')   ini.setDate(now.getDate() - 6);
    else if (this._periodoActivo === 'mes') ini.setMonth(now.getMonth() - 1);
    else                                    ini.setFullYear(now.getFullYear() - 1);
    this._fechaIni = ini.toISOString().split('T')[0];
    this._fechaFin = now.toISOString().split('T')[0];
  }

  // ── ciclo de vida ─────────────────────────────────────────────────────────

  ngOnInit() {
    // 1. restaurar estado guardado
    this.restaurarEstado();

    // 2. si las fechas estan vacias (primer uso), calcularlas
    if (!this._fechaIni || !this._fechaFin) {
      this.calcFechasPorDefecto();
      this.guardarEstado();
    }

    this.cargarDashboard();
    this.startCarousel();
    this.calcVisibleCount();
    window.addEventListener('resize', () => this.calcVisibleCount());
  }

  ngAfterViewInit() { setTimeout(() => this.calcVisibleCount(), 0); }

  ngOnDestroy() {
    if (this.autoTimer) clearInterval(this.autoTimer);
    window.removeEventListener('resize', () => this.calcVisibleCount());
  }

  // ── periodo ───────────────────────────────────────────────────────────────

  setPeriod(period: string) {
    const now = new Date();
    const ini = new Date();
    if (period === 'semana')   ini.setDate(now.getDate() - 6);
    else if (period === 'mes') ini.setMonth(now.getMonth() - 1);
    else                       ini.setFullYear(now.getFullYear() - 1);

    // asignar via setters para que se persista
    this._periodoActivo = period;
    this._fechaIni      = ini.toISOString().split('T')[0];
    this._fechaFin      = now.toISOString().split('T')[0];
    this.guardarEstado();

    this.cargarDashboard();
  }

  enRango(fecha: string): boolean {
    const f   = new Date(fecha);
    const ini = new Date(this._fechaIni + 'T00:00:00');
    const fin = new Date(this._fechaFin + 'T23:59:59');
    return f >= ini && f <= fin;
  }

  // ── formato ───────────────────────────────────────────────────────────────

  fmtNum(n: any)   { return Number(n).toLocaleString('es-CO'); }
  fmtMoney(n: any) { return '$' + Number(n).toLocaleString('es-CO'); }
  fmtHora(d: Date) { return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }); }

  calcTrend(actual: number, anterior: number): { dir: 'up' | 'down' | 'equal'; pct: number } {
    if (anterior === 0) return { dir: 'equal', pct: 0 };
    const pct = Math.round(((actual - anterior) / anterior) * 100);
    return { dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'equal', pct: Math.abs(pct) };
  }

  // ── refresh ───────────────────────────────────────────────────────────────

  async refrescar() {
    this.refrescando = true;
    await this.cargarDashboard();
    this.refrescando = false;
  }

  // ── carga principal ───────────────────────────────────────────────────────

  async cargarDashboard() {
    try {
      const [lotesRes, clasificaciones, mortalidad, ventas, consumos, tratamientos, invRes, salidasInvRes] = await Promise.all([
      this.api.get('/lotes?page=1&limit=200'),
          this.api.get('/clasificacion'),
          this.api.get('/mortalidad'),
          this.api.get('/ventas-gallinas'),
          this.api.get('/consumo-alimento').catch(() => []),
          this.api.get('/tratamientos').catch(() => []),
          this.api.get('/inventario').catch(() => []),
          this.api.get('/inventario/salidas').catch(() => []),
        ]);

      const lotes = (lotesRes as any)?.data ?? lotesRes;
      const inv   = (invRes   as any)?.data ?? invRes;
      const salidasInv = (salidasInvRes as any)?.data ?? salidasInvRes;

      this._rawClasif  = clasificaciones as any[];
      // Los registros que llegan de la API traen 'lote' (y a veces 'alimento') como
      // objeto anidado (ej. { id_lote, codigo }), no como texto plano. Si se pasan
      // directo a la tabla del modal, Angular los imprime como "[object Object]".
      // Por eso, apenas llegan, se les agrega un campo plano listo para mostrar
      // (mismo patron que ya usan gallinas.ts / inventario.ts / reportes.ts),
      // sin tocar los campos originales que usan los calculos de totales.
      this._rawVentas  = (ventas as any[]).map((r: any) => ({
        ...r,
        lote_codigo: r.lote?.codigo || r.codigo_lote || '—',
      }));
      this._rawMort    = (mortalidad as any[]).map((r: any) => ({
        ...r,
        lote_codigo: r.lote?.codigo || r.codigo_lote || '—',
        causa_texto: typeof r.causa === 'string' ? r.causa : (r.causa?.nombre || r.causa?.descripcion || 'No especificada'),
      }));
      this._rawSalidasInv = salidasInv as any[];
      this._rawConsumo = (consumos as any[]).map((r: any) => ({
        ...r,
        lote_codigo: r.lote?.codigo || r.codigo_lote || '—',
        alimento_nombre: r.alimento?.nombre || r.tipo_alimento || (typeof r.alimento === 'string' ? r.alimento : '—'),
      }));
      this._rawTrat    = (tratamientos as any[]).map((r: any) => ({
        ...r,
        lote_codigo: r.lote?.codigo || r.codigo_lote || '—',
        tipo_texto: r.tipo_tratamiento || r.tipo || r.descripcion || '—',
      }));
      this.ultimaActualizacion = new Date();

      const hoy = new Date().toISOString().split('T')[0];

      const huevosHoy = (clasificaciones as any[])
        .filter(c => new Date(c.fecha).toISOString().split('T')[0] === hoy)
        .reduce((s: number, c: any) => s + (c.total || 0), 0);

      const clasifPeriodo   = (clasificaciones as any[]).filter(c => this.enRango(c.fecha));
      const ventasPeriodo   = (ventas as any[]).filter(v => this.enRango(v.fecha));
      const mortPeriodo     = (mortalidad as any[]).filter(m => this.enRango(m.fecha));
      const consumosPeriodo = (consumos as any[]).filter((c: any) => this.enRango(c.fecha));

      const ingresos       = ventasPeriodo.reduce((s: number, v: any) => s + Number(v.total || v.cantidad * v.precio_unitario || 0), 0);
      const bajas          = mortPeriodo.reduce((s: number, m: any) => s + (m.cantidad || 0), 0);
      const clasificados   = clasifPeriodo.reduce((s: number, c: any) => s + (c.total || 0), 0);
      const totalKgConsumo = consumosPeriodo.reduce((s: number, c: any) => s + Number(c.cantidad_consumida || 0), 0);

      const diasPeriodo    = Math.max(1, Math.round((new Date(this._fechaFin).getTime() - new Date(this._fechaIni).getTime()) / 86400000) + 1);
      const promedioDiarioRaw = clasificados / diasPeriodo;
      // con promedios menores a 1 (rangos largos, pocos huevos) un Math.round simple colapsa a "0"
      // aunque si haya produccion real, asi que mostramos 1 decimal en ese caso
      const promedioDiario = promedioDiarioRaw >= 1
        ? String(Math.round(promedioDiarioRaw))
        : promedioDiarioRaw.toFixed(1);
      const totalAves      = (lotes as any[]).reduce((s: number, l: any) => s + (l.cantidad || 0), 0);
      const tasaMort       = totalAves > 0 ? ((bajas / totalAves) * 100).toFixed(2) : '0.00';

      // resumen rapido — finanzas y salud (vista compacta al pie)
      this.ingresosPeriodo  = ingresos;
      this.numVentasPeriodo = ventasPeriodo.length;
      this.tasaMortDisplay  = tasaMort;

      // consumo de alimento (kg) — backend devuelve la relacion completa en "alimento" (objeto),
      // el nombre real vive en alimento.nombre
      const consumoAlimentoMap: Record<string, { cantidad: number; unidad: string }> = {};
      consumosPeriodo.forEach((c: any) => {
        const nombre = c.alimento?.nombre || c.tipo_alimento || 'Otro';
        if (!consumoAlimentoMap[nombre]) consumoAlimentoMap[nombre] = { cantidad: 0, unidad: 'kg' };
        consumoAlimentoMap[nombre].cantidad += Number(c.cantidad_consumida || 0);
      });

      // consumo de inventario general (desinfectante, vacunas, insumos, etc.) — viene de /inventario/salidas,
      // mismo patron de relacion anidada: item.nombre / item.unidad
      const salidasInvPeriodo = this._rawSalidasInv.filter((s: any) => this.enRango(s.fecha));
      const consumoInvMap: Record<string, { cantidad: number; unidad: string }> = {};
      salidasInvPeriodo.forEach((s: any) => {
        const nombre = s.item?.nombre || 'Otro';
        const unidad = s.item?.unidad || 'u';
        if (!consumoInvMap[nombre]) consumoInvMap[nombre] = { cantidad: 0, unidad };
        consumoInvMap[nombre].cantidad += Number(s.cantidad || 0);
      });

      const todosLosValores = [
        ...Object.values(consumoAlimentoMap).map(v => v.cantidad),
        ...Object.values(consumoInvMap).map(v => v.cantidad),
      ];
      const consumoMax = Math.max(...todosLosValores, 1);

      const itemsAlimento: ConsumoItem[] = Object.entries(consumoAlimentoMap)
        .map(([nombre, { cantidad, unidad }]) => ({
          nombre, kg: cantidad, unidad,
          pct: Math.round((cantidad / consumoMax) * 100),
          grupo: 'alimento' as const,
        }))
        .sort((a, b) => b.kg - a.kg);

      const itemsInventario: ConsumoItem[] = Object.entries(consumoInvMap)
        .map(([nombre, { cantidad, unidad }]) => ({
          nombre, kg: cantidad, unidad,
          pct: Math.round((cantidad / consumoMax) * 100),
          grupo: 'inventario' as const,
        }))
        .sort((a, b) => b.kg - a.kg);

      // alimento primero (suele ser el de mayor volumen e interes diario), luego insumos generales
      this.consumoPorItem = [...itemsAlimento.slice(0, 4), ...itemsInventario.slice(0, 4)];

      const efNum = clasificados > 0 && totalKgConsumo > 0
        ? (totalKgConsumo / clasificados * 1000).toFixed(1) : null;
      this.eficienciaDisplay = efNum ? `${efNum} g` : '—';

      // cards
      this.cards[0].num = this.fmtNum(huevosHoy);
      this.cards[0].sub = huevosHoy > 0 ? `${this.fmtNum(huevosHoy)} huevos hoy` : 'Sin registros hoy';
      this.cards[1].num = String((lotes as any[]).length);
      this.cards[1].sub = `${this.fmtNum(totalAves)} aves en total`;
      this.cards[2].num = this.fmtMoney(ingresos);
      this.cards[2].sub = `${ventasPeriodo.length} ventas en el periodo`;
      this.cards[3].num = this.fmtNum(bajas);
      this.cards[3].sub = bajas > 0 ? `Tasa: ${tasaMort}% del total` : 'Sin bajas registradas';
      this.cards[4].num = this.fmtNum(clasificados);
      this.cards[4].sub = 'Huevos clasificados en el periodo';
      this.cards[5].num = String(ventasPeriodo.length);
      this.cards[5].sub = `${this.fmtMoney(ingresos)} en ventas`;
      this.cards[6].num = `${this.fmtNum(totalKgConsumo)} kg`;
      this.cards[6].sub = efNum ? `${efNum} g/huevo` : `${consumosPeriodo.length} registros`;
      this.cards[7].num = String((tratamientos as any[]).length);
      this.cards[7].sub = `${(tratamientos as any[]).length} tratamientos registrados`;
      this.cards[8].num = promedioDiario;
      this.cards[8].sub = `En ${diasPeriodo} dias del periodo`;

      const invItems  = inv as any[];
      const stockBajo = invItems.filter((i: any) => (i.stock_actual ?? 0) <= (i.stock_minimo ?? 0)).length;
      this.cards[9].num = String(invItems.length);
      this.cards[9].sub = stockBajo > 0 ? `${stockBajo} item(s) con stock bajo` : 'Todos en niveles normales';

      // tendencias
      const iniAnt = new Date(this._fechaIni); iniAnt.setDate(iniAnt.getDate() - diasPeriodo);
      const finAnt = new Date(this._fechaIni); finAnt.setDate(finAnt.getDate() - 1);
      const enRangoAnt = (f: string) => { const d = new Date(f); return d >= iniAnt && d <= finAnt; };

      const clasificadosAnt = (clasificaciones as any[]).filter(c => enRangoAnt(c.fecha)).reduce((s: number, c: any) => s + (c.total || 0), 0);
      const bajasAnt        = (mortalidad as any[]).filter(m => enRangoAnt(m.fecha)).reduce((s: number, m: any) => s + (m.cantidad || 0), 0);
      const ingresosAnt     = (ventas as any[]).filter(v => enRangoAnt(v.fecha)).reduce((s: number, v: any) => s + Number(v.total || v.cantidad * v.precio_unitario || 0), 0);

      this.cards[0].trend = this.calcTrend(huevosHoy, 0);
      this.cards[2].trend = this.calcTrend(ingresos, ingresosAnt);
      this.cards[3].trend = this.calcTrend(bajas, bajasAnt);
      this.cards[4].trend = this.calcTrend(clasificados, clasificadosAnt);

      // productividad por lote
      const lotesConHuevos = (lotes as any[]).map((l: any) => {
        const huevosDeLote = clasifPeriodo
          .filter((c: any) =>
            c.id_lote === l.id_lote ||
            c.lote_id === l.id_lote ||
            c.codigo_lote === l.codigo ||
            c.lote === l.codigo
          )
          .reduce((s: number, c: any) => s + (c.total || 0), 0);
        return {
          codigo:        l.codigo,
          raza:          l.raza || 'Sin raza',
          cantidad:      l.cantidad || 0,
          huevosPeriodo: huevosDeLote,
        };
      });
      // tasa = porcentaje relativo al lote que mas produjo en el periodo (no contra un ideal teorico),
      // asi el ranking siempre tiene sentido visual sin importar si el rango es de dias o de un año
      const maxHuevos = Math.max(...lotesConHuevos.map(l => l.huevosPeriodo), 0);
      this.productividadLotes = lotesConHuevos
        .map(l => ({
          ...l,
          tasa: maxHuevos > 0 ? Math.round((l.huevosPeriodo / maxHuevos) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.tasa - a.tasa);

      // tratamientos proximos 30 dias
      const hoyDate = new Date();
      const en30    = new Date(); en30.setDate(hoyDate.getDate() + 30);
      this.tratamientosProximos = (tratamientos as any[])
        .filter((t: any) => { const f = new Date(t.fecha_aplicacion || t.fecha || ''); return f >= hoyDate && f <= en30; })
        .sort((a: any, b: any) => new Date(a.fecha_aplicacion || a.fecha).getTime() - new Date(b.fecha_aplicacion || b.fecha).getTime())
        .slice(0, 5);

      // inventario semaforo
      this.inventarioItems = invItems.map((i: any) => {
        const stock  = i.stock_actual ?? 0;
        const minimo = i.stock_minimo ?? 0;
        const estado = stock === 0 ? 'critico' : stock <= minimo ? 'bajo' : 'ok';
        return { nombre: i.nombre || i.producto || 'Item', stock, minimo, estado };
      });

      this.buildResumen({ clasificados, clasificadosAnt, bajas, bajasAnt, ingresos, ingresosAnt, stockBajo, eficiencia: efNum, diasPeriodo });

      this.lotesActivos = lotes as any[];
      this.buildBarChart(clasifPeriodo);
      this.buildMortChart(mortPeriodo);
      this.buildDonut(clasifPeriodo);
    } catch (e) {
      console.error(e);
    }
  }

  // ── resumen textual ───────────────────────────────────────────────────────

  buildResumen(d: {
    clasificados: number; clasificadosAnt: number;
    bajas: number; bajasAnt: number;
    ingresos: number; ingresosAnt: number;
    stockBajo: number; eficiencia: string | null; diasPeriodo: number;
  }) {
    const items: ResumenItem[] = [];
    const label = this._periodoActivo === 'semana' ? 'semana' : this._periodoActivo === 'mes' ? 'mes' : 'año';

    if (d.clasificadosAnt > 0) {
      const pct  = Math.abs(Math.round(((d.clasificados - d.clasificadosAnt) / d.clasificadosAnt) * 100));
      const sube = d.clasificados >= d.clasificadosAnt;
      items.push({
        texto: sube
          ? `Produccion subio ${pct}% vs el ${label} anterior — ${this.fmtNum(d.clasificados)} huevos clasificados.`
          : `Produccion bajo ${pct}% vs el ${label} anterior — ${this.fmtNum(d.clasificados)} huevos clasificados.`,
        tipo: sube ? 'positivo' : 'negativo',
      });
    } else if (d.clasificados > 0) {
      items.push({ texto: `Se clasificaron ${this.fmtNum(d.clasificados)} huevos en este ${label}.`, tipo: 'neutro' });
    }

    if (d.bajas > 0) {
      const pct  = d.bajasAnt > 0 ? Math.abs(Math.round(((d.bajas - d.bajasAnt) / d.bajasAnt) * 100)) : null;
      const sube = pct !== null && d.bajas > d.bajasAnt;
      items.push({
        texto: pct !== null
          ? `Mortalidad ${sube ? 'aumento' : 'disminuyo'} ${pct}% vs el ${label} anterior — ${this.fmtNum(d.bajas)} bajas.`
          : `Se registraron ${this.fmtNum(d.bajas)} bajas en el ${label}.`,
        tipo: sube ? 'negativo' : d.bajas > 5 ? 'negativo' : 'neutro',
      });
    } else {
      items.push({ texto: `Sin bajas registradas en este ${label}.`, tipo: 'positivo' });
    }

    if (d.ingresos > 0 && d.ingresosAnt > 0) {
      const pct  = Math.abs(Math.round(((d.ingresos - d.ingresosAnt) / d.ingresosAnt) * 100));
      const sube = d.ingresos >= d.ingresosAnt;
      items.push({
        texto: `Ingresos ${sube ? 'aumentaron' : 'disminuyeron'} ${pct}% — ${this.fmtMoney(d.ingresos)} este ${label}.`,
        tipo: sube ? 'positivo' : 'negativo',
      });
    }

    if (d.stockBajo > 0) {
      items.push({ texto: `${d.stockBajo} producto(s) con stock bajo o critico. Revisar inventario.`, tipo: 'negativo' });
    }

    if (d.eficiencia) {
      items.push({ texto: `Eficiencia de conversion: ${d.eficiencia} g de alimento por huevo producido.`, tipo: 'neutro' });
    }

    const peso: Record<string, number> = { negativo: 0, positivo: 1, neutro: 2 };
    items.sort((a, b) => peso[a.tipo] - peso[b.tipo]);

    this.resumenExpandido = false;
    this.resumen = items;
  }

  toggleResumen() {
    this.resumenExpandido = !this.resumenExpandido;
  }

  // ── graficas ──────────────────────────────────────────────────────────────

  buildBarChart(clasifPeriodo: any[]) {
    const ini  = new Date(this._fechaIni + 'T00:00:00');
    const fin  = new Date(this._fechaFin + 'T23:59:59');
    const diff = Math.round((fin.getTime() - ini.getTime()) / 86400000) + 1;

    // rangos largos (ej. Año) se agrupan por mes para que se vea todo el periodo
    if (diff > 35) {
      this.barAgrupacionMensual = true;
      this.buildBarChartMensual(clasifPeriodo, ini, fin);
      return;
    }
    this.barAgrupacionMensual = false;

    const grupos: Record<string, number> = {};
    for (let i = 0; i < diff; i++) {
      const d = new Date(ini); d.setDate(ini.getDate() + i);
      grupos[d.toISOString().split('T')[0]] = 0;
    }
    clasifPeriodo.forEach(c => {
      const k = new Date(c.fecha).toISOString().split('T')[0];
      if (k in grupos) grupos[k] += c.total || 0;
    });
    const keys   = Object.keys(grupos).sort();
    const vals   = keys.map(k => grupos[k]);
    const maxVal = Math.max(...vals, 1);
    this.barData = keys.map((k, i) => ({
      label: new Date(k + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }),
      val: vals[i], pct: Math.round((vals[i] / maxVal) * 100),
    }));
  }

  buildBarChartMensual(clasifPeriodo: any[], ini: Date, fin: Date) {
    const grupos: Record<string, number> = {};
    const orden: string[] = [];
    const cursor = new Date(ini.getFullYear(), ini.getMonth(), 1);
    const limite = new Date(fin.getFullYear(), fin.getMonth(), 1);
    while (cursor <= limite && orden.length < 24) {
      const k = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      grupos[k] = 0;
      orden.push(k);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    clasifPeriodo.forEach(c => {
      const f = new Date(c.fecha);
      const k = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
      if (k in grupos) grupos[k] += c.total || 0;
    });
    const vals   = orden.map(k => grupos[k]);
    const maxVal = Math.max(...vals, 1);
    this.barData = orden.map((k, i) => {
      const [y, m] = k.split('-').map(Number);
      const label  = new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
      return { label, val: vals[i], pct: Math.round((vals[i] / maxVal) * 100) };
    });
  }

  buildMortChart(mortPeriodo: any[]) {
    const ini    = new Date(this._fechaIni + 'T00:00:00');
    const fin    = new Date(this._fechaFin + 'T23:59:59');
    const diff   = Math.round((fin.getTime() - ini.getTime()) / 86400000) + 1;
    const grupos: Record<string, number> = {};
    for (let i = 0; i < Math.min(diff, 60); i++) {
      const d = new Date(ini); d.setDate(ini.getDate() + i);
      grupos[d.toISOString().split('T')[0]] = 0;
    }
    mortPeriodo.forEach(m => {
      const k = new Date(m.fecha).toISOString().split('T')[0];
      if (k in grupos) grupos[k] += m.cantidad || 0;
    });
    const keys   = Object.keys(grupos).sort();
    const vals   = keys.map(k => grupos[k]);
    const maxVal = Math.max(...vals, 1);
    this.mortData = keys.map((k, i) => ({
      label: new Date(k + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }),
      val: vals[i], pct: Math.round((vals[i] / maxVal) * 100),
    }));
  }

  buildDonut(clasifPeriodo: any[]) {
    const t: any = { JUMBO: 0, AAA: 0, AA: 0, A: 0, B: 0, C: 0 };
    clasifPeriodo.forEach(c => {
      t.JUMBO += c.jumbo || 0; t.AAA += c.aaa || 0; t.AA += c.aa || 0;
      t.A     += c.a    || 0; t.B   += c.b   || 0; t.C  += c.c  || 0;
    });
    const total     = Object.values(t).reduce((s: any, v: any) => s + v, 0) as number;
    this.donutTotal = total;
    const colores   = ['#8E24AA','#E53935','#FB8C00','#1E88E5','#43A047','#757575'];
    let offset      = 0;
    this.donutSegments = Object.entries(t)
      .filter(([, v]) => (v as number) > 0)
      .map(([label, val], i) => {
        const pct = ((val as number) / total) * 100;
        const seg = { label, val: val as number, pct, color: colores[i], offset };
        offset += pct;
        return seg;
      });
  }

  // ── helpers visuales ──────────────────────────────────────────────────────

  getCardStyle(c: StatCard) { return { background: `linear-gradient(135deg,${c.grad[0]},${c.grad[1]})` }; }

  getTarifColor(tasa: number): string {
    if (tasa >= 70) return '#16a34a';
    if (tasa >= 40) return '#d97706';
    return '#dc2626';
  }

  // mini sparkline de mortalidad para la vista compacta del resumen rapido
  get miniSparkMort(): { pct: number }[] {
    const last = this.mortData.slice(-7);
    const max  = Math.max(...last.map(m => m.val), 1);
    return last.map(m => ({ pct: Math.max(8, Math.round((m.val / max) * 100)) }));
  }

  fmtFecha(f: string): string {
    // La API a veces manda solo la fecha ("2026-07-08") y a veces un timestamp
    // completo ("2026-07-08T00:00:00.000Z"). Antes se le pegaba "T12:00:00" al
    // valor tal cual llegaba, y si ya traia hora eso formaba una fecha invalida
    // ("...000ZT12:00:00" no es una fecha real). Por eso primero se recorta a
    // solo la parte de la fecha y despues se arma la hora fija de mediodia
    // (evita que el cambio de horario corra el dia al formatear).
    if (!f) return '—';
    const soloFecha = String(f).split('T')[0];
    const d = new Date(soloFecha + 'T12:00:00');
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  }

  diasPara(f: string): number {
    if (!f) return 0;
    const hoy   = new Date(); hoy.setHours(0,0,0,0);
    const soloFecha = String(f).split('T')[0];
    const fecha = new Date(soloFecha + 'T12:00:00');
    if (isNaN(fecha.getTime())) return 0;
    return Math.round((fecha.getTime() - hoy.getTime()) / 86400000);
  }
}