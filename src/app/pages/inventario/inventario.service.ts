import { Injectable } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ApiService } from '../../services/api';
import { ToastService } from '../../services/toast';
import { AuthService } from '../../services/auth';
import { SVG_UI_CLOSE } from '../../components/shared/ui-icons';

const CATEGORIAS_DEFAULT: { id: number; nombre: string }[] = [
  { id: 1, nombre: 'Vacunas' },
  { id: 2, nombre: 'Medicamentos' },
  { id: 3, nombre: 'Herramientas' },
  { id: 4, nombre: 'Equipos' },
  { id: 5, nombre: 'Insumos generales' },
];

// Lista unificada: incluye unidades generales y de alimento en un solo lugar
const UNIDADES_DEFAULT = [
  'unidades',
  'kg',
  'litros',
  'cajas',
  'sacos',
  'gramos',
  'libras',
  'metros',
  'dosis',
];
// Subset de UNIDADES_DEFAULT que aplica a alimentos (se usa para filtrar en el selector de alimentos)
const ALIMENTO_UNIDADES = ['kg', 'gramos', 'sacos', 'libras'];
const LS_KEY_INV = 'inventarioOpciones';
const STOCK_ATENCION_FACTOR = 1.5;

// Estado y lógica de negocio de TODO el módulo Inventario (general: catálogo +
// movimientos, alimento: catálogo + movimientos), compartido entre el host
// (inventario.ts) y los subcomponentes General/Alimento. Instancia única por
// árbol gracias a `providers: [InventarioService]` en InventarioComponent.
@Injectable()
export class InventarioService {
  activeTab = 'general';
  subTabGeneral: 'catalogo' | 'movimientos' = 'catalogo';
  subTabAlimento: 'catalogo' | 'movimientos' = 'catalogo';
  isAdmin = false;
  today = new Date().toISOString().split('T')[0];

  readonly stockAtencionFactor = STOCK_ATENCION_FACTOR;

  // opciones dinamicas
  cats: { id: number; nombre: string }[] = [...CATEGORIAS_DEFAULT];
  opcionesUnidades: string[] = [...UNIDADES_DEFAULT];

  // Unidades para alimentos: misma lista que inventario general (una sola fuente de verdad)
  get alimentoUnidades(): string[] {
    return this.opcionesUnidades;
  }

  // modal opciones
  addOpcionVisible = false;
  addOpcionKey = '';
  addOpcionLabel = '';
  addOpcionNuevo = '';

  // ── INVENTARIO GENERAL ──
  inv: any[] = [];
  invFiltered: any[] = [];
  invSearch = '';
  invCatFilter = '';
  invEstadoFilter = '';
  invAlerts: any[] = [];
  invForm: any = this.newInvForm();
  editInvId: any = null;
  invFormTitle = 'Registrar Item';
  invPage: number = 1;
  invPageSize: number = 10;

  // movimientos inventario general (unifica entradas + salidas)
  movTipo: 'entrada' | 'salida' = 'entrada';
  movItem: any = null;
  movItemId = '';
  movCantidad: any = null;
  movCosto: any = null;
  movFecha = this.today;
  movProveedor = '';
  movObs = '';
  editMovInvId: any = null;
  movInvPage: number = 1;
  movInvPageSize: number = 10;
  movFiltroTipo = '';
  movFiltroItem = '';

  // historial unificado general (entradas ajuste + salidas)
  movHistorial: any[] = [];

  // ── GESTION DE ALIMENTO ──
  alimentos: any[] = [];
  lotes: any[] = [];

  // form catalogo alimento (sin stock/costo/proveedor)
  editAlimentoId: any = null;
  alimentoFormTitle = 'Registrar Alimento';
  alimentoNombre = '';
  alimentoMin: any = null;
  alimentoUnidad = 'kg';
  alimentoCosto: any = null;
  alimentoProveedor = '';
  alimentoObs = '';

  // movimientos alimento (unifica entradas + salidas)
  movAlimTipo: 'entrada' | 'salida' = 'entrada';
  movAlim: any = null;
  movAlimId = '';
  movAlimLoteId = '';
  movAlimCantidad: any = null;
  movAlimCosto: any = null;
  movAlimFecha = this.today;
  movAlimObs = '';
  editMovAlimId: any = null;
  movAlimPage: number = 1;
  movAlimPageSize: number = 10;
  movAlimFiltroTipo = '';
  movAlimFiltroId = '';
  salidaStats: any = null;

  // Catálogo alimentos paginado
  alimentoSearch = '';
  alimentoPage: number = 1;
  alimentoPageSize: number = 10;
  alimentosFiltered: any[] = [];

  onCustomSize(tabla: string, e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (!val || val < 1) return;
    if (tabla === 'inv') { this.invPageSize = +val; this.invPage = 1; }
    else if (tabla === 'movInv') { this.movInvPageSize = +val; this.movInvPage = 1; }
    else if (tabla === 'movAlim') { this.movAlimPageSize = +val; this.movAlimPage = 1; }
    else if (tabla === 'alimento') { this.alimentoPageSize = +val; this.alimentoPage = 1; }
    (e.target as HTMLInputElement).value = '';
  }

  filterAlimentos() {
    const q = this.alimentoSearch.trim().toLowerCase();
    this.alimentosFiltered = q
      ? this.alimentos.filter((a: any) => a.nombre.toLowerCase().includes(q))
      : [...this.alimentos];
    this.alimentoPage = 1;
  }

  get alimentosPage(): any[] {
    return this.paginar(this.alimentosFiltered, this.alimentoPage, this.alimentoPageSize);
  }
  get totalPagAlimentos(): number {
    return this.totalPags(this.alimentosFiltered, this.alimentoPageSize);
  }

  // historial unificado alimento
  movAlimHistorial: any[] = [];

  // modal confirmacion
  confirmVisible = false;
  confirmMsg = '';
  private confirmCb: (() => void) | null = null;

  // Ícono SVG compartido para los 4 botones "Limpiar" de los filtros
  svgClose: SafeHtml;

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private auth: AuthService,
    private sanitizer: DomSanitizer,
  ) {
    this.svgClose = this.sanitizer.bypassSecurityTrustHtml(SVG_UI_CLOSE);
  }

  // Llamado desde InventarioComponent.ngOnInit() — un servicio no tiene
  // ciclo de vida OnInit propio, así que el host dispara la carga inicial.
  init() {
    const rol = this.auth.getSession()?.rol;
    this.isAdmin = rol === 'admin';
    this.cargarOpciones();
    this.cargarTodo();
  }

  // Cierra modales al presionar Escape (disparado por InventarioComponent,
  // que sí puede usar @HostListener; el servicio solo expone el método).
  onEsc() {
    this.addOpcionVisible = false;
    this.confirmVisible = false;
  }

  setTab(t: string) {
    this.activeTab = t;
  }

  // ── OPCIONES DINAMICAS ──
  cargarOpciones() {
    try {
      const saved = localStorage.getItem(LS_KEY_INV);
      if (!saved) return;
      const p = JSON.parse(saved);
      if (p.unidades) this.opcionesUnidades = [...new Set([...UNIDADES_DEFAULT, ...p.unidades])];
      // Nota: unidadesAlim ya no se guarda por separado; se derivan de opcionesUnidades
      if (p.categorias) {
        const nextId = Math.max(...this.cats.map((c) => c.id)) + 1;
        p.categorias.forEach((nombre: string, i: number) => {
          if (!this.cats.find((c) => c.nombre === nombre)) {
            this.cats.push({ id: nextId + i, nombre });
          }
        });
      }
    } catch {
      /* ignorar JSON invalido */
    }
  }

  guardarOpciones() {
    const extraUnidades = this.opcionesUnidades.filter((u) => !UNIDADES_DEFAULT.includes(u));
    const extraCats = this.cats
      .filter((c) => c.id > CATEGORIAS_DEFAULT.length)
      .map((c) => c.nombre);
    localStorage.setItem(
      LS_KEY_INV,
      JSON.stringify({
        unidades: extraUnidades,
        categorias: extraCats,
      }),
    );
  }

  abrirAddOpcion(key: string, label: string) {
    this.addOpcionKey = key;
    this.addOpcionLabel = label;
    this.addOpcionNuevo = '';
    this.addOpcionVisible = true;
  }

  confirmarAddOpcion() {
    const val = this.addOpcionNuevo.trim();
    if (!val) return;
    if (this.addOpcionKey === 'unidades' && !this.opcionesUnidades.includes(val)) {
      this.opcionesUnidades.push(val);
      this.guardarOpciones();
      this.toast.success(`Unidad "${val}" anadida`);
    } else if (this.addOpcionKey === 'unidadesAlim' && !this.opcionesUnidades.includes(val)) {
      // Las unidades de alimento se agregan a la lista general unificada
      this.opcionesUnidades.push(val);
      this.guardarOpciones();
      this.toast.success(`Unidad "${val}" anadida`);
    } else if (this.addOpcionKey === 'categorias' && !this.cats.find((c) => c.nombre === val)) {
      const nextId = Math.max(...this.cats.map((c) => c.id)) + 1;
      this.cats.push({ id: nextId, nombre: val });
      this.guardarOpciones();
      this.toast.success(`Categoria "${val}" anadida`);
    }
    this.addOpcionNuevo = '';
  }

  eliminarOpcionUnidad(val: string) {
    if (UNIDADES_DEFAULT.includes(val)) {
      this.toast.warning('No se puede eliminar una unidad predeterminada');
      return;
    }
    this.opcionesUnidades = this.opcionesUnidades.filter((u) => u !== val);
    this.guardarOpciones();
    this.toast.warning(`"${val}" eliminado`);
  }

  eliminarOpcionCat(cat: { id: number; nombre: string }) {
    if (cat.id <= CATEGORIAS_DEFAULT.length) {
      this.toast.warning('No se puede eliminar una categoria predeterminada');
      return;
    }
    this.cats = this.cats.filter((c) => c.id !== cat.id);
    this.guardarOpciones();
    this.toast.warning(`"${cat.nombre}" eliminado`);
  }

  getOpcionesModal(): string[] {
    if (this.addOpcionKey === 'unidades') return this.opcionesUnidades;
    if (this.addOpcionKey === 'categorias') return this.cats.map((c) => c.nombre);
    if (this.addOpcionKey === 'unidadesAlim') return this.alimentoUnidades;
    return [];
  }

  eliminarOpcionModal(val: string) {
    if (this.addOpcionKey === 'unidades') {
      this.eliminarOpcionUnidad(val);
      return;
    }
    if (this.addOpcionKey === 'unidadesAlim') {
      if (ALIMENTO_UNIDADES.includes(val) || UNIDADES_DEFAULT.includes(val)) {
        this.toast.warning('No se puede eliminar una unidad predeterminada');
        return;
      }
      this.opcionesUnidades = this.opcionesUnidades.filter((u) => u !== val);
      this.guardarOpciones();
      this.toast.warning(`"${val}" eliminado`);
      return;
    }
    const cat = this.cats.find((c) => c.nombre === val);
    if (cat) this.eliminarOpcionCat(cat);
  }

  // ── CARGA INICIAL ──
  async cargarTodo() {
    await Promise.all([
      this.cargarInventario(),
      this.cargarMovHistorial(),
      this.cargarAlimentos(),
      this.cargarLotes(),
      this.cargarMovAlimHistorial(),
    ]);
  }

  // ── FACTORIES ──
  newInvForm() {
    return { nombre: '', cat_id: '', min: null, unidad: 'unidades', costo: null, proveedor: '', obs: '' };
  }

  // ── HELPERS ──
  fmtNum(n: any) {
    return Number(n).toLocaleString('es-CO');
  }
  fmtMoney(n: any) {
    return '$' + Number(n).toLocaleString('es-CO');
  }
  fmtDate(d: string) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  paginar<T>(arr: T[], page: number, size: number): T[] {
    return arr.slice((page - 1) * size, page * size);
  }
  totalPags(arr: any[], size: number): number {
    return Math.max(1, Math.ceil(arr.length / size));
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

  // ── KPIs INVENTARIO GENERAL ──
  get kpiTotal(): number {
    return this.inv.length;
  }
  get kpiValorTotal(): string {
    return this.fmtMoney(this.inv.reduce((s, r) => s + r.cant * (r.costo || 0), 0));
  }
  get kpiBajos(): number {
    return this.inv.filter((r) => r.cant <= r.min * STOCK_ATENCION_FACTOR && r.cant > r.min).length;
  }
  get kpiCriticos(): number {
    return this.inv.filter((r) => r.cant <= r.min).length;
  }

  // ── KPIs ALIMENTOS ──
  get kpiAlimentos(): number {
    return this.alimentos.length;
  }
  get kpiStockAlim(): string {
    return (
      this.fmtNum(this.alimentos.reduce((s: number, a: any) => s + (a.stock_actual || 0), 0)) +
      ' kg'
    );
  }
  get kpiConsumoMes(): string {
    const hoy = new Date();
    const mes = this.movAlimHistorial.filter((s) => {
      if (s.tipo !== 'salida') return false;
      const f = new Date(s.fecha);
      return f.getMonth() === hoy.getMonth() && f.getFullYear() === hoy.getFullYear();
    });
    return this.fmtNum(mes.reduce((s, c) => s + +c.cantidad, 0)) + ' kg';
  }
  get kpiAlimCriticos(): number {
    return this.alimentos.filter((a: any) => (a.stock_actual || 0) <= (a.stock_minimo || 0)).length;
  }

  // ── INVENTARIO GENERAL ──
  async cargarInventario() {
    try {
      const res: any = await this.api.get(
        `/inventario?page=${this.invPage}&limit=${this.invPageSize}`,
      );
      const data = res.data ?? res;
      this.inv = data.map((r: any) => ({
        _id: r.id_item,
        nombre: r.nombre,
        cat: r.categoria?.nombre || '—',
        cat_id: r.categoria?.id_categoria,
        cant: r.stock_actual,
        min: r.stock_minimo,
        unidad: r.unidad || 'unidades',
        costo: r.precio || 0,
        obs: r.observaciones || '',
      }));
      this.filterInv();
      this.invAlerts = this.inv.filter((r) => r.cant <= r.min * STOCK_ATENCION_FACTOR);
    } catch {
      this.toast.error('Error al cargar inventario');
    }
  }

  getEstado(item: any): { label: string; cls: string; key: string } {
    if (item.cant <= item.min) return { label: 'Critico', cls: 'badge-red', key: 'critico' };
    if (item.cant <= item.min * STOCK_ATENCION_FACTOR)
      return { label: 'Atencion', cls: 'badge-orange', key: 'atencion' };
    return { label: 'OK', cls: 'badge-green', key: 'ok' };
  }

  getStockColor(item: any): string {
    if (item.cant <= item.min) return '#E53935';
    if (item.cant <= item.min * STOCK_ATENCION_FACTOR) return '#e65100';
    return '#2e9940';
  }

  filterInv() {
    const q = this.invSearch.toLowerCase();
    const cat = this.invCatFilter;
    const est = this.invEstadoFilter;
    this.invFiltered = this.inv.filter((r) => {
      const matchQ = !q || r.nombre.toLowerCase().includes(q);
      const matchCat = !cat || r.cat === cat;
      const matchEst = !est || this.getEstado(r).key === est;
      return matchQ && matchCat && matchEst;
    });
    this.invPage = 1;
  }

  get invPage_data(): any[] {
    return this.paginar(this.invFiltered, this.invPage, this.invPageSize);
  }
  get totalPagInv(): number {
    return this.totalPags(this.invFiltered, this.invPageSize);
  }
  // Un registro nuevo (editingId en null) exige puede_crear; uno existente
  // en edicion exige puede_editar. Reemplaza al viejo isVisitante.
  puedeGuardar(editingId: any): boolean {
    return editingId ? this.auth.puedeEditar('inventario') : this.auth.puedeCrear('inventario');
  }

  get puedeEditarModulo(): boolean { return this.auth.puedeEditar('inventario'); }

  get puedeEliminar(): boolean {
    return this.auth.puedeEliminar('inventario');
  }
  get valorTotalFiltrado(): string {
    return this.fmtMoney(this.invFiltered.reduce((s, r) => s + r.cant * (r.costo || 0), 0));
  }

  async guardarInv() {
    if (!this.invForm.nombre) {
      this.toast.error('Ingresa el nombre');
      return;
    }
    if (!this.invForm.cat_id) {
      this.toast.error('Selecciona una categoria');
      return;
    }
    const body = {
      nombre: this.invForm.nombre,
      id_categoria: +this.invForm.cat_id,
      stock_actual: 0,
      stock_minimo: +this.invForm.min || 0,
      precio: +this.invForm.costo || 0,
      proveedor: this.invForm.proveedor || '',
      unidad: this.invForm.unidad,
      observaciones: this.invForm.obs || '',
    };
    try {
      if (this.editInvId) await this.api.patch(`/inventario/${this.editInvId}`, body);
      else await this.api.post('/inventario', body);
      await this.cargarInventario();
      this.invForm = this.newInvForm();
      this.editInvId = null;
      this.invFormTitle = 'Registrar Item';
      this.toast.success('Guardado correctamente');
    } catch (e: any) {
      this.toast.error(e.message || 'Error');
    }
  }

  editInv(r: any) {
    this.invForm = {
      nombre: r.nombre,
      cat_id: r.cat_id || '',
      min: r.min,
      unidad: r.unidad,
      costo: r.costo ?? null,
      proveedor: r.proveedor || '',
      obs: r.obs,
    };
    this.editInvId = r._id;
    this.invFormTitle = 'Editar Item';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  elimInv(r: any) {
    this.confirmMsg = `¿Desactivar <strong>${r.nombre}</strong>?`;
    this.confirmCb = async () => {
      try {
        await this.api.delete(`/inventario/${r._id}`);
        await this.cargarInventario();
        this.toast.warning('Item desactivado');
      } catch {
        this.toast.error('Error');
      }
    };
    this.confirmVisible = true;
  }

  // ── MOVIMIENTOS INVENTARIO GENERAL ──

  // navegar desde la tabla del catalogo
  irAMovimiento(item: any, tipo: 'entrada' | 'salida') {
    this.movTipo = tipo;
    this.movItem = item;
    this.movItemId = item._id;
    this.movCantidad = null;
    this.movFecha = this.today;
    this.movObs = '';
    this.editMovInvId = null;
    this.subTabGeneral = 'movimientos';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  onMovItemChange() {
    this.movItem = this.inv.find((r) => r._id == this.movItemId) || null;
  }

  limpiarMovInv() {
    this.movItem = null;
    this.movItemId = '';
    this.movCantidad = null;
    this.movFecha = this.today;
    this.movObs = '';
    this.editMovInvId = null;
  }

  async cargarMovHistorial() {
    try {
      const [salidas, entradas] = await Promise.all([
        this.api.get<any[]>('/inventario/salidas'),
        this.api.get<any[]>('/inventario/entradas'),
      ]);
      const sal = salidas.map((r: any) => ({
        _id: r.id_salida,
        tipo: 'salida',
        fecha: r.fecha,
        nombre: r.item?.nombre || '—',
        unidad: r.item?.unidad || '',
        item_id: r.item?.id_item,
        cantidad: r.cantidad,
        costo: 0,
        obs: r.motivo || r.observaciones || '',
      }));
      const ent = entradas.map((r: any) => ({
        _id: r.id_entrada,
        tipo: 'entrada',
        fecha: r.fecha,
        nombre: r.item?.nombre || '—',
        unidad: r.unidad?.abreviatura || '',
        item_id: r.item?.id_item,
        cantidad: r.cantidad,
        costo: r.costo_unitario || 0,
        obs: r.observaciones || '',
      }));
      this.movHistorial = [...sal, ...ent].sort(
        (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime(),
      );
    } catch {
      /* endpoint puede no existir aun */
    }
  }

  get movHistorialFiltrado(): any[] {
    return this.movHistorial.filter((r) => {
      const matchTipo = !this.movFiltroTipo || r.tipo === this.movFiltroTipo;
      const matchItem = !this.movFiltroItem || r.item_id == this.movFiltroItem;
      return matchTipo && matchItem;
    });
  }
  get movHistorialPage(): any[] {
    return this.paginar(this.movHistorialFiltrado, this.movInvPage, this.movInvPageSize);
  }
  get totalPagMovInv(): number {
    return this.totalPags(this.movHistorialFiltrado, this.movInvPageSize);
  }

  async guardarMovimientoInv() {
    if (!this.movItem && !this.movItemId) {
      this.toast.error('Selecciona un item');
      return;
    }
    if (!this.movItem) this.onMovItemChange();
    if (!this.movCantidad || +this.movCantidad <= 0) {
      this.toast.error('Cantidad invalida');
      return;
    }

    if (this.movTipo === 'entrada') {
      const body: any = {
        id_item: +this.movItem._id,
        cantidad: +this.movCantidad,
        observaciones: this.movObs || '',
      };
      try {
        if (this.editMovInvId)
          await this.api.patch(`/inventario/entradas/${this.editMovInvId}`, body);
        else await this.api.post('/inventario/entradas', body);
        await this.cargarInventario();
        await this.cargarMovHistorial();
        this.toast.success(
          `Entrada registrada: +${this.movCantidad} ${this.movItem?.unidad || ''}`,
        );
        this.limpiarMovInv();
      } catch (e: any) {
        this.toast.error(e.message || 'Error');
      }
    } else {
      // salida: endpoint /inventario/salidas
      const itemSel = this.movItem;
      if (itemSel && +this.movCantidad > itemSel.cant) {
        this.toast.error('Cantidad mayor al stock disponible');
        return;
      }
      const body = {
        id_item: +this.movItem._id,
        cantidad: +this.movCantidad,
        fecha: this.movFecha,
        observaciones: this.movObs || '',
      };
      try {
        if (this.editMovInvId)
          await this.api.patch(`/inventario/salidas/${this.editMovInvId}`, body);
        else await this.api.post('/inventario/salidas', body);
        await this.cargarMovHistorial();
        await this.cargarInventario();
        this.toast.success('Salida registrada');
        this.limpiarMovInv();
      } catch (e: any) {
        this.toast.error(e.message || 'Error');
      }
    }
  }

  editMovInv(r: any) {
    this.movTipo = r.tipo;
    this.movItemId = r.item_id;
    this.movItem = this.inv.find((x) => x._id == r.item_id) || null;
    this.movCantidad = r.cantidad;
    this.movFecha = r.fecha?.split('T')[0] || this.today;
    this.movObs = r.obs;
    this.editMovInvId = r._id;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  elimMovInv(r: any) {
    this.confirmMsg = '¿Eliminar este movimiento?';
    this.confirmCb = async () => {
      try {
        if (r.tipo === 'salida') await this.api.delete(`/inventario/salidas/${r._id}`);
        else await this.api.delete(`/inventario/entradas/${r._id}`);
        await this.cargarMovHistorial();
        await this.cargarInventario();
        this.toast.warning('Eliminado');
      } catch {
        this.toast.error('Error');
      }
    };
    this.confirmVisible = true;
  }

  // ── ALIMENTOS ──
  async cargarAlimentos() {
    try {
      this.alimentos = await this.api.get<any[]>('/alimentos');
      this.filterAlimentos();
    } catch {
      this.toast.error('Error al cargar alimentos');
    }
  }

  async cargarLotes() {
    try {
      const res: any = await this.api.get('/lotes?page=1&limit=100');
      this.lotes = res.data ?? res;
    } catch {
      this.toast.error('Error al cargar lotes');
    }
  }

  getAlimColor(a: any): string {
    if ((a.stock_actual || 0) <= (a.stock_minimo || 0)) return '#E53935';
    if ((a.stock_actual || 0) <= (a.stock_minimo || 0) * STOCK_ATENCION_FACTOR) return '#e65100';
    return '#2e9940';
  }

  getAlimColorBadge(a: any): string {
    if ((a.stock_actual || 0) <= (a.stock_minimo || 0)) return 'badge-red';
    if ((a.stock_actual || 0) <= (a.stock_minimo || 0) * STOCK_ATENCION_FACTOR)
      return 'badge-orange';
    return 'badge-green';
  }

  getAlimEstado(a: any): string {
    if ((a.stock_actual || 0) <= (a.stock_minimo || 0)) return 'Critico';
    if ((a.stock_actual || 0) <= (a.stock_minimo || 0) * STOCK_ATENCION_FACTOR) return 'Atencion';
    return 'OK';
  }

  editAlimentoInline(a: any) {
    this.editAlimentoId = a.id_alimento;
    this.alimentoFormTitle = 'Editar Alimento';
    this.alimentoNombre = a.nombre || '';
    this.alimentoMin = a.stock_minimo ?? null;
    this.alimentoUnidad = a.unidad || 'kg';
    this.alimentoCosto = a.costo_unitario ?? null;
    this.alimentoProveedor = a.proveedor || '';
    this.alimentoObs = a.observaciones || '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  limpiarFormAlimento() {
    this.editAlimentoId = null;
    this.alimentoFormTitle = 'Registrar Alimento';
    this.alimentoNombre = '';
    this.alimentoMin = null;
    this.alimentoUnidad = 'kg';
    this.alimentoCosto = null;
    this.alimentoProveedor = '';
    this.alimentoObs = '';
  }

  async guardarAlimento() {
    if (!this.alimentoNombre) {
      this.toast.error('Ingresa el nombre');
      return;
    }
    const body: any = {
      nombre: this.alimentoNombre,
      stock_actual: 0,
      stock_minimo: +this.alimentoMin || 0,
      unidad: this.alimentoUnidad,
      costo_unitario: +this.alimentoCosto || 0,
      proveedor: this.alimentoProveedor || '',
      observaciones: this.alimentoObs || '',
    };
    try {
      if (this.editAlimentoId) await this.api.patch(`/alimentos/${this.editAlimentoId}`, body);
      else await this.api.post('/alimentos', body);
      await this.cargarAlimentos();
      this.limpiarFormAlimento();
      this.toast.success('Alimento guardado');
    } catch (e: any) {
      this.toast.error(e.message || 'Error');
    }
  }

  elimAlimento(a: any) {
    this.confirmMsg = `¿Eliminar el alimento <strong>${a.nombre}</strong>?`;
    this.confirmCb = async () => {
      try {
        await this.api.delete(`/alimentos/${a.id_alimento}`);
        await this.cargarAlimentos();
        this.toast.warning('Alimento eliminado');
      } catch {
        this.toast.error('Error');
      }
    };
    this.confirmVisible = true;
  }

  // ── MOVIMIENTOS ALIMENTO ──

  irAMovAlimento(a: any, tipo: 'entrada' | 'salida') {
    this.movAlimTipo = tipo;
    this.movAlim = a;
    this.movAlimId = a.id_alimento;
    this.movAlimLoteId = '';
    this.movAlimCantidad = null;
    this.movAlimCosto = null;
    this.movAlimFecha = this.today;
    this.movAlimObs = '';
    this.editMovAlimId = null;
    this.subTabAlimento = 'movimientos';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  onMovAlimChange() {
    this.movAlim = this.alimentos.find((a) => a.id_alimento == this.movAlimId) || null;
  }

  limpiarMovAlim() {
    this.movAlim = null;
    this.movAlimId = '';
    this.movAlimLoteId = '';
    this.movAlimCantidad = null;
    this.movAlimCosto = null;
    this.movAlimFecha = this.today;
    this.movAlimObs = '';
    this.editMovAlimId = null;
  }

  async cargarMovAlimHistorial() {
    try {
      const entradas: any[] = await this.api.get('/entradas-alimento');
      const salidas: any[] = await this.api.get('/consumo-alimento');

      const ent = entradas.map((r) => ({
        _id: r.id_entrada,
        tipo: 'entrada',
        fecha: r.fecha,
        alimento: r.alimento?.nombre || '—',
        alimento_id: r.alimento?.id_alimento,
        cantidad: r.cantidad,
        costo: r.costo_unitario || 0,
        obs: r.observaciones || '',
        lote: null,
        lote_id: null,
      }));

      const sal = salidas.map((r) => ({
        _id: r.id_consumo,
        tipo: 'salida',
        fecha: r.fecha,
        alimento: r.alimento?.nombre || '—',
        alimento_id: r.alimento?.id_alimento,
        cantidad: r.cantidad_consumida,
        costo: r.costo_unitario || 0,
        obs: '',
        lote: r.lote?.codigo || null,
        lote_id: r.lote?.id_lote || null,
      }));

      this.movAlimHistorial = [...ent, ...sal].sort(
        (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime(),
      );

      const totalKg = sal.reduce((s, r) => s + +r.cantidad, 0);
      const totalCost = sal.reduce((s, r) => s + r.costo * +r.cantidad, 0);
      this.salidaStats = {
        kg: this.fmtNum(totalKg),
        costo: this.fmtMoney(totalCost),
        registros: sal.length,
      };
    } catch {
      this.toast.error('Error al cargar movimientos de alimento');
    }
  }

  get movAlimHistorialFiltrado(): any[] {
    return this.movAlimHistorial.filter((r) => {
      const matchTipo = !this.movAlimFiltroTipo || r.tipo === this.movAlimFiltroTipo;
      const matchAlim = !this.movAlimFiltroId || r.alimento_id == this.movAlimFiltroId;
      return matchTipo && matchAlim;
    });
  }
  get movAlimHistorialPage(): any[] {
    return this.paginar(this.movAlimHistorialFiltrado, this.movAlimPage, this.movAlimPageSize);
  }
  get totalPagMovAlim(): number {
    return this.totalPags(this.movAlimHistorialFiltrado, this.movAlimPageSize);
  }

  async guardarMovAlim() {
    if (!this.movAlim && !this.movAlimId) {
      this.toast.error('Selecciona un alimento');
      return;
    }
    if (!this.movAlim) this.onMovAlimChange();
    if (!this.movAlimCantidad || +this.movAlimCantidad <= 0) {
      this.toast.error('Cantidad invalida');
      return;
    }

    if (this.movAlimTipo === 'entrada') {
      const body = {
        id_alimento: +this.movAlim.id_alimento,
        cantidad: +this.movAlimCantidad,
        costo_unitario: +this.movAlimCosto || 0,
        fecha: this.movAlimFecha,
        observaciones: this.movAlimObs || '',
      };
      try {
        if (this.editMovAlimId)
          await this.api.patch(`/entradas-alimento/${this.editMovAlimId}`, body);
        else await this.api.post('/entradas-alimento', body);
        await this.cargarMovAlimHistorial();
        await this.cargarAlimentos();
        this.toast.success('Entrada registrada');
        this.limpiarMovAlim();
      } catch (e: any) {
        this.toast.error(e.message || 'Error');
      }
    } else {
      if (!this.movAlimLoteId) {
        this.toast.error('Selecciona un lote');
        return;
      }
      const body = {
        id_lote: +this.movAlimLoteId,
        id_alimento: +this.movAlim.id_alimento,
        cantidad_consumida: +this.movAlimCantidad,
        costo_unitario: +this.movAlimCosto || 0,
        fecha: this.movAlimFecha,
      };
      try {
        if (this.editMovAlimId)
          await this.api.patch(`/consumo-alimento/${this.editMovAlimId}`, body);
        else await this.api.post('/consumo-alimento', body);
        await this.cargarMovAlimHistorial();
        await this.cargarAlimentos();
        this.toast.success('Consumo registrado');
        this.limpiarMovAlim();
      } catch (e: any) {
        this.toast.error(e.message || 'Error');
      }
    }
  }

  editMovAlim(r: any) {
    this.movAlimTipo = r.tipo;
    this.movAlimId = r.alimento_id;
    this.movAlim = this.alimentos.find((a) => a.id_alimento == r.alimento_id) || null;
    this.movAlimLoteId = r.lote_id || '';
    this.movAlimCantidad = r.cantidad;
    this.movAlimCosto = r.costo;
    this.movAlimFecha = r.fecha?.split('T')[0] || this.today;
    this.movAlimObs = r.obs || '';
    this.editMovAlimId = r._id;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  elimMovAlim(r: any) {
    this.confirmMsg = '¿Eliminar este movimiento?';
    this.confirmCb = async () => {
      try {
        if (r.tipo === 'entrada') await this.api.delete(`/entradas-alimento/${r._id}`);
        else await this.api.delete(`/consumo-alimento/${r._id}`);
        await this.cargarMovAlimHistorial();
        await this.cargarAlimentos();
        this.toast.warning('Eliminado');
      } catch {
        this.toast.error('Error');
      }
    };
    this.confirmVisible = true;
  }

  // ── MODAL CONFIRMACION ──
  confirmYes() {
    this.confirmVisible = false;
    if (this.confirmCb) {
      this.confirmCb();
      this.confirmCb = null;
    }
  }
  confirmNo() {
    this.confirmVisible = false;
    this.confirmCb = null;
  }
  onChange_invSize(e: Event) {
    const val = parseInt((e.target as HTMLSelectElement).value, 10);
    if (val && val > 0) { this.invPageSize = +val; this.invPage = 1; }
  }
  onChange_movInvSize(e: Event) {
    const val = parseInt((e.target as HTMLSelectElement).value, 10);
    if (val && val > 0) { this.movInvPageSize = +val; this.movInvPage = 1; }
  }
  onChange_alimentoSize(e: Event) {
    const val = parseInt((e.target as HTMLSelectElement).value, 10);
    if (val && val > 0) { this.alimentoPageSize = +val; this.alimentoPage = 1; }
  }
  onChange_movAlimSize(e: Event) {
    const val = parseInt((e.target as HTMLSelectElement).value, 10);
    if (val && val > 0) { this.movAlimPageSize = +val; this.movAlimPage = 1; }
  }
}