import { Injectable } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ApiService } from '../../services/api';
import { ToastService } from '../../services/toast';
import { AuthService } from '../../services/auth';
import { SVG_UI_CLOSE } from '../../components/shared/ui-icons';

// ── Mapeos entre valores de UI y valores esperados por la API ──

// Tipos de tratamiento: UI → API
const TIPO_TO_API: Record<string, string> = {
  Vacunacion: 'Vacunacion',
  Desparasitacion: 'Desparasitacion',
  Antibiotico: 'Antibioticos',
  Vitaminas: 'Vitaminas',
  Otro: 'Revision General',
};

// Tipos de tratamiento: API → UI
const TIPO_FROM_API: Record<string, string> = {
  Vacunacion: 'Vacunacion',
  Desparasitacion: 'Desparasitacion',
  Antibioticos: 'Antibiotico',
  Vitaminas: 'Vitaminas',
  'Revision General': 'Otro',
};

// Clave para persistir opciones dinámicas en localStorage
const LS_KEY = 'gallinasOpciones';

// Estado y lógica de negocio de TODO el módulo Gallinas (lotes, tratamientos,
// mortalidad, ventas), compartido entre el componente host (gallinas.ts) y sus
// 4 subcomponentes de pestaña. Se provee una única instancia por árbol de
// componentes gracias a `providers: [GallinasService]` en GallinasComponent.
@Injectable()
export class GallinasService {
  // Tab activo
  activeTab = 'lotes';

  // Rol del usuario en sesión
  isAdmin = false;


  // Fecha de hoy para valores por defecto de formularios
  today = new Date().toISOString().split('T')[0];

  // ── Opciones dinámicas (se persisten en localStorage) ──
  opciones: {
    razas: string[];
    galpones: string[];
    tiposTrat: string[];
    formasPago: string[];
    estadosLote: string[];
  } = {
    razas: ['Hy-Line Brown', 'Lohmann Brown', 'ISA Brown', 'Bovans Brown', 'Ross 308'],
    galpones: ['Galpon 1', 'Galpon 2', 'Galpon 3'],
    tiposTrat: ['Vacunacion', 'Desparasitacion', 'Antibiotico', 'Vitaminas', 'Otro'],
    formasPago: ['Efectivo', 'Transferencia', 'Cheque', 'Otro'],
    estadosLote: ['Activo', 'Inactivo', 'En cuarentena', 'Vendido'],
  };

  // Catálogo real de causas de mortalidad (tabla `sanidad/causas-mortalidad`
  // en el backend, con FK desde Mortalidad). Ya no vive en localStorage como
  // las demás opciones: se carga y se persiste directo contra la API.
  causasMortalidad: { id_causa: number; nombre: string }[] = [];

  // Estado del modal para gestionar opciones dinámicas
  addOpcionVisible = false;
  addOpcionKey = '';
  addOpcionLabel = '';
  addOpcionNuevo = '';

  // ── LOTES ──
  lotes: any[] = [];
  lotesFiltered: any[] = [];
  loteSearch = '';
  loteForm: any = this.newLoteForm();
  editingLoteId: any = null;
  loteFormTitle = 'Registrar Lote';
  // Paginación
  lotePage: number = 1;
  lotePageSize: number = 10;

  // ── TRATAMIENTOS ──
  trats: any[] = [];
  tratsFiltered: any[] = [];
  tratForm: any = this.newTratForm();
  editingTratId: any = null;
  tratFormTitle = 'Registrar Tratamiento';
  // Filtros
  tratFiltroFecha = '';
  tratFiltroEstado = '';
  // Paginación
  tratPage: number = 1;
  tratPageSize: number = 10;
  // Alertas de próximas dosis (vencidas o en los próximos 3 días)
  alertasTrat: { lote: string; med: string; estado: string; proxima: string }[] = [];

  // ── MORTALIDAD ──
  morts: any[] = [];
  mortsFiltered: any[] = [];
  mortForm: any = this.newMortForm();
  editingMortId: any = null;
  mortFormTitle = 'Registrar Mortalidad';
  mortTotal = 0;
  // Filtros
  mortFiltroFecha = '';
  mortFiltroCausa = '';
  // Paginación
  mortPage: number = 1;
  mortPageSize: number = 10;

  // ── VENTAS ──
  ventas: any[] = [];
  ventasFiltered: any[] = [];
  ventaSearch = '';
  ventaForm: any = this.newVentaForm();
  editingVentaId: any = null;
  ventaFormTitle = 'Registrar Venta';
  ventaTotal = '$0';
  ventasTotales: any = null;
  // Paginación
  ventaPage: number = 1;
  ventaPageSize: number = 10;

  // ── HISTORIAL de lote (modal) ──
  historialVisible = false;
  historialLote: any = null;
  historialTrats: any[] = [];
  historialMorts: any[] = [];

  // ── Modal de confirmación de eliminación ──
  confirmVisible = false;
  confirmMsg = '';
  private confirmCb: (() => void) | null = null;

  // Ícono SVG compartido para los botones "Limpiar" de los 4 filtros
  svgClose: SafeHtml;

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private auth: AuthService,
    private sanitizer: DomSanitizer,
  ) {
    this.svgClose = this.sanitizer.bypassSecurityTrustHtml(SVG_UI_CLOSE);
  }

  // Llamado desde GallinasComponent.ngOnInit() — un servicio no tiene
  // ciclo de vida OnInit propio, así que el host dispara la carga inicial.
  init() {
    const rol = this.auth.getSession()?.rol;
    this.isAdmin     = rol === 'admin';
    this.cargarOpciones();
    this.cargarCausasMortalidad();
    this.cargarTodo();
  }

  // Un registro nuevo (editingXxxId en null) exige puede_crear; uno existente
  // en edicion exige puede_editar. Reemplaza al viejo isVisitante, que atava
  // "crear" al permiso de "editar".
  puedeGuardar(editingId: any): boolean {
    return editingId ? this.auth.puedeEditar('gallinas') : this.auth.puedeCrear('gallinas');
  }

  get puedeEditarModulo(): boolean { return this.auth.puedeEditar('gallinas'); }
  get puedeEliminar(): boolean { return this.auth.puedeEliminar('gallinas'); }

  // Cierra modales al presionar Escape (disparado por GallinasComponent, que
  // sí puede usar @HostListener; el servicio solo expone el método).
  onEsc() {
    this.historialVisible = false;
    this.addOpcionVisible = false;
    this.confirmVisible = false;
  }

  // ══════════════════════════════════════
  // OPCIONES DINÁMICAS
  // ══════════════════════════════════════

  // Carga opciones guardadas y las combina con los defaults
  cargarOpciones() {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const parsed: Record<string, string[]> = JSON.parse(saved);
        (Object.keys(parsed) as Array<keyof typeof this.opciones>).forEach((k) => {
          if (this.opciones[k]) {
            // Combina sin duplicados: defaults primero, luego las guardadas
            this.opciones[k] = [...new Set([...this.opciones[k], ...parsed[k]])] as string[];
          }
        });
      }
    } catch {
      // Si hay error de parseo simplemente se usan los defaults
    }
  }

  // Persiste el estado actual de opciones en localStorage
  guardarOpciones() {
    localStorage.setItem(LS_KEY, JSON.stringify(this.opciones));
  }

  // Carga el catálogo real de causas de mortalidad desde el backend
  // (tabla con FK, ya no vive en localStorage como las demás opciones)
  async cargarCausasMortalidad() {
    try {
      this.causasMortalidad = await this.api.get('/sanidad/causas-mortalidad');
    } catch {
      this.toast.error('Error al cargar causas de mortalidad');
    }
  }

  // Abre el modal para gestionar opciones de un campo específico
  abrirAddOpcion(key: string, label: string) {
    this.addOpcionKey = key;
    this.addOpcionLabel = label;
    this.addOpcionNuevo = '';
    this.addOpcionVisible = true;
  }

  // Agrega la nueva opción si no existe ya. 'causasMort' es un caso especial:
  // en vez de guardarse en localStorage, se crea contra el catálogo real
  // (sanidad/causas-mortalidad) porque Mortalidad la referencia por FK.
  async confirmarAddOpcion() {
    const val = this.addOpcionNuevo.trim();
    if (!val) return;

    if (this.addOpcionKey === 'causasMort') {
      try {
        await this.api.post('/sanidad/causas-mortalidad', { nombre: val });
        await this.cargarCausasMortalidad();
        this.toast.success(`"${val}" añadido`);
      } catch (e: any) {
        this.toast.error(e.message || 'Error al crear la causa');
      }
      this.addOpcionNuevo = '';
      return;
    }

    const key = this.addOpcionKey as keyof typeof this.opciones;
    if (!this.opciones[key].includes(val)) {
      (this.opciones[key] as string[]).push(val);
      this.guardarOpciones();
      this.toast.success(`"${val}" añadido`);
    }
    this.addOpcionNuevo = '';
  }

  // Devuelve el array de opciones para usar en el template
  getOpciones(key: string): string[] {
    if (key === 'causasMort') return this.causasMortalidad.map((c) => c.nombre);
    return this.opciones[key as keyof typeof this.opciones] || [];
  }

  // Elimina una opción de la lista y persiste el cambio. 'causasMort' borra
  // contra la API real (por id_causa), las demás siguen siendo locales.
  async eliminarOpcion(key: string, valor: string) {
    if (key === 'causasMort') {
      const item = this.causasMortalidad.find((c) => c.nombre === valor);
      if (!item) return;
      try {
        await this.api.delete(`/sanidad/causas-mortalidad/${item.id_causa}`);
        await this.cargarCausasMortalidad();
        this.toast.warning(`"${valor}" eliminado`);
      } catch (e: any) {
        this.toast.error(e.message || 'Error al eliminar (puede estar en uso)');
      }
      return;
    }

    const k = key as keyof typeof this.opciones;
    const arr = this.opciones[k] as string[];
    const idx = arr.indexOf(valor);
    if (idx > -1) {
      arr.splice(idx, 1);
      this.guardarOpciones();
      this.toast.warning(`"${valor}" eliminado`);
    }
  }

  // ══════════════════════════════════════
  // CARGA GENERAL
  // ══════════════════════════════════════

  // Carga todos los módulos en paralelo
  async cargarTodo() {
    await Promise.all([
      this.cargarLotes(),
      this.cargarTrats(),
      this.cargarMorts(),
      this.cargarVentas(),
    ]);
  }

  // ══════════════════════════════════════
  // FACTORIES DE FORMULARIOS
  // ══════════════════════════════════════

  newLoteForm() {
    return {
      id: '',
      raza: '',
      cant: '',
      fecha: new Date().toISOString().split('T')[0],
      edad: '',
      galpon: '',
      estado: 'Activo',
      obs: '',
    };
  }

  newTratForm() {
    return {
      lote_id: '',
      tipo: 'Vacunacion',
      med: '',
      dosis: '',
      fecha: new Date().toISOString().split('T')[0],
      proxima: '',
      vet: '',
      obs: '',
    };
  }

  newMortForm() {
    return {
      lote_id: '',
      fecha: new Date().toISOString().split('T')[0],
      cant: '',
      causa_id: '',
      obs: '',
    };
  }

  newVentaForm() {
    return {
      cliente: '',
      fecha: new Date().toISOString().split('T')[0],
      lote_id: '',
      cant: '',
      precio: '',
      pago: 'Efectivo',
      obs: '',
    };
  }

  // ══════════════════════════════════════
  // UTILIDADES
  // ══════════════════════════════════════

  // Formatea número con separador de miles (es-CO)
  fmtNum(n: any) {
    return Number(n).toLocaleString('es-CO');
  }

  // Formatea valor monetario con símbolo $
  fmtMoney(n: any) {
    return '$' + Number(n).toLocaleString('es-CO');
  }

  // Formatea fecha ISO a día/mes/año en español
  fmtDate(d: string) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  // Cambia el tab activo
  setTab(tab: string) {
    this.activeTab = tab;
  }

  // ── Paginación genérica ──

  paginar<T>(arr: T[], page: number, size: number): T[] {
    const start = (page - 1) * size;
    return arr.slice(start, start + size);
  }

  totalPaginas(arr: any[], size: number): number {
    return Math.max(1, Math.ceil(arr.length / size));
  }

  pagesArray(total: number): number[] {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  /** Devuelve los números de página a mostrar (máx 5 visibles + -1 como separador "…") */
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

  onCustomSize(tabla: string, e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (!val || val < 1) return;
    if (tabla === 'lote') { this.lotePageSize = +val; this.lotePage = 1; }
    else if (tabla === 'trat') { this.tratPageSize = +val; this.tratPage = 1; }
    else if (tabla === 'mort') { this.mortPageSize = +val; this.mortPage = 1; }
    else if (tabla === 'venta') { this.ventaPageSize = +val; this.ventaPage = 1; }
    (e.target as HTMLInputElement).value = '';
  }
  // Calcula aves vivas de un lote: cantidad inicial menos total de bajas registradas
  avesVivas(lote: any): number {
    const bajas = this.morts.filter((m) => m.lote_id === lote._id).reduce((s, m) => s + m.cant, 0);
    return Math.max(0, (lote.cant || 0) - bajas);
  }

  // ══════════════════════════════════════
  // LOTES
  // ══════════════════════════════════════

  async cargarLotes() {
    try {
      const res: any = await this.api.get(
        `/lotes?page=${this.lotePage}&limit=${this.lotePageSize}`,
      );
      const data = res.data ?? res;
      this.lotes = data.map((r: any) => ({
        _id: r.id_lote,
        id: r.codigo,
        raza: r.raza || '',
        cant: r.cantidad,
        fecha: r.fecha,
        edad: r.edad || 0,
        galpon: r.galpon_nombre || '',
        estado: r.estado,
        obs: r.observaciones || '',
      }));
      this.filterLotes();
    } catch {
      this.toast.error('Error al cargar lotes');
    }
  }

  // Filtra lotes por ID, raza o galpón
  filterLotes() {
    const q = this.loteSearch.toLowerCase();
    this.lotesFiltered = this.lotes.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.raza.toLowerCase().includes(q) ||
        (r.galpon || '').toLowerCase().includes(q),
    );
    this.lotePage = 1;
  }

  get lotesPage(): any[] {
    return this.paginar(this.lotesFiltered, this.lotePage, this.lotePageSize);
  }

  get totalPagLotes(): number {
    return this.totalPaginas(this.lotesFiltered, this.lotePageSize);
  }

  async guardarLote() {
    // Validaciones de campos obligatorios
    if (!this.loteForm.id) {
      this.toast.error('Ingresa el ID del lote');
      return;
    }
    if (!this.loteForm.raza) {
      this.toast.error('Selecciona una raza');
      return;
    }
    if (!this.loteForm.cant || +this.loteForm.cant <= 0) {
      this.toast.error('Cantidad inválida');
      return;
    }

    // Mapea campos de UI al cuerpo esperado por la API
    const body = {
      codigo: this.loteForm.id,
      nombre: this.loteForm.id,
      raza: this.loteForm.raza,
      cantidad: +this.loteForm.cant,
      fecha: this.loteForm.fecha,
      edad: +this.loteForm.edad || null,
      galpon_nombre: this.loteForm.galpon,
      estado: this.loteForm.estado,
      observaciones: this.loteForm.obs,
    };

    try {
      if (this.editingLoteId) {
        await this.api.patch(`/lotes/${this.editingLoteId}`, body);
      } else {
        await this.api.post('/lotes', body);
      }
      await this.cargarLotes();
      this.loteForm = this.newLoteForm();
      this.editingLoteId = null;
      this.loteFormTitle = 'Registrar Lote';
      this.toast.success('Lote guardado exitosamente');
    } catch (e: any) {
      this.toast.error(e.message || 'Error al guardar');
    }
  }

  // Carga el lote seleccionado en el formulario para edición
  editLote(r: any) {
    this.loteForm = {
      id: r.id,
      raza: r.raza,
      cant: r.cant,
      fecha: r.fecha?.split('T')[0] || this.today,
      edad: r.edad,
      galpon: r.galpon,
      estado: r.estado,
      obs: r.obs,
    };
    this.editingLoteId = r._id;
    this.loteFormTitle = 'Editar Lote';
    this.activeTab = 'lotes';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  elimLote(r: any) {
    this.confirmMsg = `¿Eliminar el lote <strong>${r.id}</strong>?`;
    this.confirmCb = async () => {
      try {
        await this.api.delete(`/lotes/${r._id}`);
        await this.cargarLotes();
        this.toast.warning('Lote eliminado');
      } catch {
        this.toast.error('Error al eliminar');
      }
    };
    this.confirmVisible = true;
  }

  // Abre el modal de historial del lote (tratamientos + bajas)
  verHistorial(lote: any) {
    this.historialLote = lote;
    this.historialTrats = this.trats.filter((t) => t.lote_id === lote._id);
    this.historialMorts = this.morts.filter((m) => m.lote_id === lote._id);
    this.historialVisible = true;
  }

  // Total de bajas del lote en historial
  get historialMortTotal(): number {
    return this.historialMorts.reduce((s, m) => s + m.cant, 0);
  }

  // ══════════════════════════════════════
  // TRATAMIENTOS
  // ══════════════════════════════════════

  async cargarTrats() {
    try {
      const data: any[] = await this.api.get('/tratamientos');
      // Mapea respuesta de la API y aplica conversión de tipo con TIPO_FROM_API
      this.trats = data.map((r) => ({
        _id: r.id_tratamiento,
        lote: r.lote?.codigo || '',
        lote_id: r.lote?.id_lote,
        tipo: TIPO_FROM_API[r.tipo_tratamiento] || r.tipo_tratamiento,
        med: r.medicamento || '',
        dosis: r.dosis || '',
        fecha: r.fecha,
        proxima: r.fecha_proxima_dosis,
        vet: r.veterinario || '',
        obs: r.descripcion || '',
      }));
      this.calcAlertasTrat();
      this.filterTrats();
    } catch {
      this.toast.error('Error al cargar tratamientos');
    }
  }

  // Calcula alertas de próximas dosis: vencidas (< 0 días) o urgentes (0-3 días)
  calcAlertasTrat() {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    this.alertasTrat = this.trats
      .filter((t) => t.proxima)
      .map((t) => {
        const prox = new Date(t.proxima);
        prox.setHours(0, 0, 0, 0);
        const diff = Math.ceil((prox.getTime() - hoy.getTime()) / 86400000);
        if (diff < 0) return { lote: t.lote, med: t.med, estado: 'vencido', proxima: t.proxima };
        if (diff <= 3) return { lote: t.lote, med: t.med, estado: 'urgente', proxima: t.proxima };
        return null;
      })
      .filter(Boolean) as any[];
  }

  // Filtra tratamientos por mes y/o tipo
  filterTrats() {
    let arr = [...this.trats];
    if (this.tratFiltroFecha) {
      arr = arr.filter((r) => r.fecha?.startsWith(this.tratFiltroFecha));
    }
    if (this.tratFiltroEstado) {
      arr = arr.filter((r) => r.tipo.toLowerCase().includes(this.tratFiltroEstado.toLowerCase()));
    }
    this.tratsFiltered = arr;
    this.tratPage = 1;
  }

  get tratsPage(): any[] {
    return this.paginar(this.tratsFiltered, this.tratPage, this.tratPageSize);
  }

  get totalPagTrats(): number {
    return this.totalPaginas(this.tratsFiltered, this.tratPageSize);
  }

  // Devuelve el estado de una próxima dosis: 'vencido', 'urgente' o ''
  estadoProxima(proxima: string): string {
    if (!proxima) return '';
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const prox = new Date(proxima);
    prox.setHours(0, 0, 0, 0);
    const diff = Math.ceil((prox.getTime() - hoy.getTime()) / 86400000);
    if (diff < 0) return 'vencido';
    if (diff <= 3) return 'urgente';
    return '';
  }

  async guardarTrat() {
    if (!this.tratForm.med) {
      this.toast.error('Ingresa el medicamento');
      return;
    }

    // Convierte el tipo de UI a valor esperado por la API
    const body = {
      id_lote: +this.tratForm.lote_id,
      tipo_tratamiento: TIPO_TO_API[this.tratForm.tipo] || 'Revision General',
      medicamento: this.tratForm.med,
      dosis: this.tratForm.dosis,
      veterinario: this.tratForm.vet,
      descripcion: this.tratForm.obs,
      fecha_proxima_dosis: this.tratForm.proxima || null,
    };

    try {
      if (this.editingTratId) {
        await this.api.patch(`/tratamientos/${this.editingTratId}`, body);
      } else {
        await this.api.post('/tratamientos', body);
      }
      await this.cargarTrats();
      this.tratForm = this.newTratForm();
      this.editingTratId = null;
      this.tratFormTitle = 'Registrar Tratamiento';
      this.toast.success('Tratamiento guardado');
    } catch (e: any) {
      this.toast.error(e.message || 'Error al guardar');
    }
  }

  // Carga el tratamiento seleccionado en el formulario para edición
  editTrat(r: any) {
    this.tratForm = {
      lote_id: r.lote_id,
      tipo: r.tipo, // ya viene mapeado desde cargarTrats()
      med: r.med,
      dosis: r.dosis,
      fecha: r.fecha?.split('T')[0] || this.today,
      proxima: r.proxima?.split('T')[0] || '',
      vet: r.vet,
      obs: r.obs,
    };
    this.editingTratId = r._id;
    this.tratFormTitle = 'Editar Tratamiento';
    this.activeTab = 'tratamiento';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  elimTrat(r: any) {
    this.confirmMsg = '¿Eliminar este tratamiento?';
    this.confirmCb = async () => {
      try {
        await this.api.delete(`/tratamientos/${r._id}`);
        await this.cargarTrats();
        this.toast.warning('Eliminado');
      } catch {
        this.toast.error('Error');
      }
    };
    this.confirmVisible = true;
  }

  // ══════════════════════════════════════
  // MORTALIDAD
  // ══════════════════════════════════════

  async cargarMorts() {
    try {
      const data: any[] = await this.api.get('/mortalidad');
      // La causa ahora es un objeto {id_causa, nombre} (catálogo real vía FK,
      // ya no un enum de texto plano) → se aplana igual que lote/registradoPor.
      this.morts = data.map((r) => ({
        _id: r.id_mortalidad,
        fecha: r.fecha,
        lote: r.lote?.codigo || '',
        lote_id: r.lote?.id_lote,
        cant: r.cantidad,
        causa: r.causa?.nombre || '',
        causa_id: r.causa?.id_causa,
        obs: r.observaciones || '',
      }));
      // Acumulado total de bajas
      this.mortTotal = this.morts.reduce((s, r) => s + r.cant, 0);
      this.filterMorts();
    } catch {
      this.toast.error('Error al cargar mortalidad');
    }
  }

  // Filtra registros de mortalidad por mes y/o causa
  filterMorts() {
    let arr = [...this.morts];
    if (this.mortFiltroFecha) {
      arr = arr.filter((r) => r.fecha?.startsWith(this.mortFiltroFecha));
    }
    if (this.mortFiltroCausa) {
      arr = arr.filter((r) => r.causa.toLowerCase().includes(this.mortFiltroCausa.toLowerCase()));
    }
    this.mortsFiltered = arr;
    this.mortPage = 1;
  }

  get mortsPage(): any[] {
    return this.paginar(this.mortsFiltered, this.mortPage, this.mortPageSize);
  }

  get totalPagMorts(): number {
    return this.totalPaginas(this.mortsFiltered, this.mortPageSize);
  }

  async guardarMort() {
    if (!this.mortForm.cant || +this.mortForm.cant <= 0) {
      this.toast.error('Ingresa una cantidad');
      return;
    }
    if (!this.mortForm.causa_id) {
      this.toast.error('Selecciona una causa');
      return;
    }

    // La causa ahora se manda por id (FK al catálogo real), no como texto
    const body = {
      id_lote: +this.mortForm.lote_id,
      cantidad: +this.mortForm.cant,
      id_causa: +this.mortForm.causa_id,
      observaciones: this.mortForm.obs,
    };

    try {
      if (this.editingMortId) {
        await this.api.patch(`/mortalidad/${this.editingMortId}`, body);
      } else {
        await this.api.post('/mortalidad', body);
      }
      await this.cargarMorts();
      this.mortForm = this.newMortForm();
      this.editingMortId = null;
      this.mortFormTitle = 'Registrar Mortalidad';
      this.toast.success('Mortalidad registrada');
    } catch (e: any) {
      this.toast.error(e.message || 'Error');
    }
  }

  // Carga el registro de mortalidad seleccionado para edición
  editMort(r: any) {
    this.mortForm = {
      lote_id: r.lote_id,
      fecha: r.fecha?.split('T')[0] || this.today,
      cant: r.cant,
      causa_id: r.causa_id, // ya viene mapeado desde cargarMorts()
      obs: r.obs,
    };
    this.editingMortId = r._id;
    this.mortFormTitle = 'Editar Mortalidad';
    this.activeTab = 'mortalidad';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  elimMort(r: any) {
    this.confirmMsg = '¿Eliminar este registro?';
    this.confirmCb = async () => {
      try {
        await this.api.delete(`/mortalidad/${r._id}`);
        await this.cargarMorts();
        this.toast.warning('Eliminado');
      } catch {
        this.toast.error('Error');
      }
    };
    this.confirmVisible = true;
  }

  // ══════════════════════════════════════
  // VENTAS
  // ══════════════════════════════════════

  async cargarVentas() {
    try {
      const data: any[] = await this.api.get('/ventas-gallinas');
      this.ventas = data.map((r) => ({
        _id: r.id_venta,
        fecha: r.fecha,
        cliente: r.cliente || '',
        lote: r.lote?.codigo || '',
        lote_id: r.lote?.id_lote,
        cant: r.cantidad,
        precio: r.precio_unitario,
        pago: r.forma_pago || '',
        obs: r.observaciones || '',
      }));

      // Calcula totales acumulados de todas las ventas
      const totalDinero = this.ventas.reduce((s, r) => s + r.cant * r.precio, 0);
      const totalGallinas = this.ventas.reduce((s, r) => s + r.cant, 0);
      this.ventasTotales = {
        dinero: this.fmtMoney(totalDinero),
        gallinas: this.fmtNum(totalGallinas),
        transacciones: this.ventas.length,
      };
      this.filterVentas(); // aplica filtro activo tras recargar
    } catch {
      this.toast.error('Error al cargar ventas');
    }
  }

  // Filtra ventas por cliente, lote o forma de pago
  filterVentas() {
    const q = this.ventaSearch.toLowerCase();
    this.ventasFiltered = this.ventas.filter(
      (r) =>
        r.cliente.toLowerCase().includes(q) ||
        (r.lote || '').toLowerCase().includes(q) ||
        (r.pago || '').toLowerCase().includes(q),
    );
    this.ventaPage = 1;
  }

  get ventasPage(): any[] {
    return this.paginar(this.ventasFiltered, this.ventaPage, this.ventaPageSize);
  }

  get totalPagVentas(): number {
    return this.totalPaginas(this.ventasFiltered, this.ventaPageSize);
  }

  // Recalcula el total de venta al cambiar cantidad o precio unitario
  calcVentaTotal() {
    const t = (+this.ventaForm.cant || 0) * (+this.ventaForm.precio || 0);
    this.ventaTotal = this.fmtMoney(t);
  }

  async guardarVenta() {
    if (!this.ventaForm.cliente) {
      this.toast.error('Ingresa el cliente');
      return;
    }
    if (!this.ventaForm.cant || +this.ventaForm.cant <= 0) {
      this.toast.error('Cantidad inválida');
      return;
    }
    if (!this.ventaForm.precio || +this.ventaForm.precio <= 0) {
      this.toast.error('Precio inválido');
      return;
    }

    const body = {
      id_lote: +this.ventaForm.lote_id,
      cantidad: +this.ventaForm.cant,
      precio_unitario: +this.ventaForm.precio,
      cliente: this.ventaForm.cliente,
      forma_pago: this.ventaForm.pago,
      observaciones: this.ventaForm.obs,
    };

    try {
      if (this.editingVentaId) {
        await this.api.patch(`/ventas-gallinas/${this.editingVentaId}`, body);
      } else {
        await this.api.post('/ventas-gallinas', body);
      }
      await this.cargarVentas();
      this.ventaForm = this.newVentaForm();
      this.editingVentaId = null;
      this.ventaFormTitle = 'Registrar Venta';
      this.ventaTotal = '$0';
      this.toast.success('Venta registrada exitosamente');
    } catch (e: any) {
      this.toast.error(e.message || 'Error');
    }
  }

  // Carga la venta seleccionada en el formulario para edición
  editVenta(r: any) {
    this.ventaForm = {
      cliente: r.cliente,
      fecha: r.fecha?.split('T')[0] || this.today,
      lote_id: r.lote_id,
      cant: r.cant,
      precio: r.precio,
      pago: r.pago,
      obs: r.obs,
    };
    this.calcVentaTotal();
    this.editingVentaId = r._id;
    this.ventaFormTitle = 'Editar Venta';
    this.activeTab = 'ventas';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  elimVenta(r: any) {
    this.confirmMsg = '¿Eliminar esta venta?';
    this.confirmCb = async () => {
      try {
        await this.api.delete(`/ventas-gallinas/${r._id}`);
        await this.cargarVentas();
        this.toast.warning('Eliminado');
      } catch {
        this.toast.error('Error');
      }
    };
    this.confirmVisible = true;
  }

  // ══════════════════════════════════════
  // MODAL DE CONFIRMACIÓN
  // ══════════════════════════════════════

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
  onChange_loteSize(e: Event) {
    const val = parseInt((e.target as HTMLSelectElement).value, 10);
    if (val && val > 0) { this.lotePageSize = +val; this.lotePage = 1; }
  }
  onChange_tratSize(e: Event) {
    const val = parseInt((e.target as HTMLSelectElement).value, 10);
    if (val && val > 0) { this.tratPageSize = +val; this.tratPage = 1; }
  }
  onChange_mortSize(e: Event) {
    const val = parseInt((e.target as HTMLSelectElement).value, 10);
    if (val && val > 0) { this.mortPageSize = +val; this.mortPage = 1; }
  }
  onChange_ventaSize(e: Event) {
    const val = parseInt((e.target as HTMLSelectElement).value, 10);
    if (val && val > 0) { this.ventaPageSize = +val; this.ventaPage = 1; }
  }
}
