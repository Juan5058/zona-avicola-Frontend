import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService, UserSession } from '../../services/auth';
import { ApiService } from '../../services/api';
import { ToastService } from '../../services/toast';
import { RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MOD_ICON } from '../shared/module-icons';

interface Notif {
  id_notificacion: number;
  titulo: string;
  mensaje: string;
  tipo: 'Info' | 'Alerta' | 'Error';
  leida: boolean;
  fecha: string;
  modulo?: string;
}

const SVG_CHECK  = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const SVG_TRASH  = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
const SVG_INFO   = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
const SVG_WARN   = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
const SVG_ERROR  = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
const SVG_FOLDER = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
const SVG_EMPTY  = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.25"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
const SVG_SHIELD = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
const SVG_USER   = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
const SVG_EYE    = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const SVG_SAVE   = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const SVG_BELL   = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;

// Modulos con control CRUD real en la tabla `permisos` del backend.
// dashboard y manual quedan fuera: siempre visibles segun el rol (ROL_ACCESO en auth.ts).
// configuracion tambien queda fuera: es siempre admin-only, sin toggle configurable.
const MODULOS_CRUD = ['gallinas', 'clasificacion', 'inventario', 'reportes', 'manual'] as const;
type ModuloCrud = typeof MODULOS_CRUD[number];

const ACCIONES: { campo: 'puede_ver' | 'puede_crear' | 'puede_editar' | 'puede_eliminar' | 'puede_descargar'; label: string }[] = [
  { campo: 'puede_ver',       label: 'Ver' },
  { campo: 'puede_crear',     label: 'Crear' },
  { campo: 'puede_editar',    label: 'Editar' },
  { campo: 'puede_eliminar',  label: 'Eliminar' },
  { campo: 'puede_descargar', label: 'Descargar' },
];

// Manual es de solo lectura (no tiene crear/editar/eliminar/descargar en el backend),
// asi que solo se le controla la visibilidad (puede_ver).
const ACCIONES_SOLO_VER = ACCIONES.filter((a) => a.campo === 'puede_ver');

// Reportes no se "crea/edita/elimina": se visualiza y se descarga (PDF/Excel).
const ACCIONES_VER_DESCARGAR = ACCIONES.filter(
  (a) => a.campo === 'puede_ver' || a.campo === 'puede_descargar',
);

// Gallinas, Clasificacion e Inventario son modulos CRUD reales (tienen
// crear/editar/eliminar en la pagina), pero ninguno tiene boton de descarga
// propio, asi que ese toggle no aplica.
const ACCIONES_CRUD_SIN_DESCARGAR = ACCIONES.filter((a) => a.campo !== 'puede_descargar');

const ACCIONES_POR_MODULO: Record<string, typeof ACCIONES> = {
  manual: ACCIONES_SOLO_VER,
  reportes: ACCIONES_VER_DESCARGAR,
  gallinas: ACCIONES_CRUD_SIN_DESCARGAR,
  clasificacion: ACCIONES_CRUD_SIN_DESCARGAR,
  inventario: ACCIONES_CRUD_SIN_DESCARGAR,
};

interface PermisoRow {
  puede_ver: boolean;
  puede_crear: boolean;
  puede_editar: boolean;
  puede_eliminar: boolean;
  puede_descargar: boolean;
}

const PERMISO_VACIO: PermisoRow = {
  puede_ver: false, puede_crear: false, puede_editar: false, puede_eliminar: false, puede_descargar: false,
};

const MODULOS_LABELS: Record<string, string> = {
  dashboard:     'Dashboard',
  gallinas:      'Gallinas',
  clasificacion: 'Clasificacion',
  inventario:    'Inventario',
  reportes:      'Reportes',
  manual:        'Manual',
  configuracion: 'Configuracion',
};

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './header.html',
  styleUrls: ['./header.scss'],
})
export class HeaderComponent implements OnInit, OnDestroy {
  session: UserSession | null = null;
  fechaHora     = '';
  notifOpen     = false;
  profileOpen   = false;
  notifs: Notif[] = [];
  noLeidas      = 0;
  loadingNotifs = false;
  tabActivo: 'todas' | 'noLeidas' = 'todas';
  modRolActivo: 'operador' | 'visitante' = 'operador';
  moduloActivo: ModuloCrud = 'gallinas';

  readonly modulosCrud = MODULOS_CRUD;

  get acciones() {
    return ACCIONES_POR_MODULO[this.moduloActivo] || ACCIONES;
  }

  loadingPermisos   = false;
  guardandoPermisos = false;
  errorPermisos: string | null = null;

  // id_rol real de cada rol (viene de GET /roles), necesario para las llamadas
  // de escritura PATCH /seguridad/permisos/rol/:idRol/modulo/:modulo
  private rolesId: Record<'operador' | 'visitante', number | null> = { operador: null, visitante: null };

  // Permisos reales por rol x modulo, traidos de GET /seguridad/permisos
  permisosPorRol: Record<'operador' | 'visitante', Record<ModuloCrud, PermisoRow>> = {
    operador:   this.permisosVacios(),
    visitante: this.permisosVacios(),
  };

  get permisoActivo(): PermisoRow {
    return this.permisosPorRol[this.modRolActivo][this.moduloActivo];
  }

  private permisosVacios(): Record<ModuloCrud, PermisoRow> {
    return {
      gallinas:      { ...PERMISO_VACIO },
      clasificacion: { ...PERMISO_VACIO },
      inventario:    { ...PERMISO_VACIO },
      reportes:      { ...PERMISO_VACIO },
      manual:        { ...PERMISO_VACIO },
    };
  }

  svgCheck!:  SafeHtml;
  svgTrash!:  SafeHtml;
  svgFolder!: SafeHtml;
  svgEmpty!:  SafeHtml;
  svgSave!:   SafeHtml;
  svgBell!:   SafeHtml;

  private clockInterval: any;
  private pollInterval:  any;

  get leidasCount()    { return this.notifs.filter(n => n.leida).length; }
  get notifsVisibles() { return this.tabActivo === 'noLeidas' ? this.notifs.filter(n => !n.leida) : this.notifs; }
  get isAdmin()        { return this.session?.rol === 'admin'; }
  // El backend solo permite marcar leida / eliminar a Administrador y Operador.
  // Visitante puede ver las notificaciones, pero no tocarlas.
  get puedeGestionarNotifs() { return this.session?.rol === 'admin' || this.session?.rol === 'operador'; }
  get rolLabel() {
    const map: any = { admin: 'Administrador', operador: 'Operador', visitante: 'Visitante' };
    return map[this.session?.rol || ''] || '';
  }
  get rolSvg(): SafeHtml {
    const map: any = { admin: SVG_SHIELD, operador: SVG_USER, visitante: SVG_EYE };
    return this.sanitizer.bypassSecurityTrustHtml(map[this.session?.rol || ''] || SVG_USER);
  }

  constructor(
    private auth: AuthService,
    private api: ApiService,
    private toast: ToastService,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnInit() {
    this.svgCheck  = this.sanitizer.bypassSecurityTrustHtml(SVG_CHECK);
    this.svgTrash  = this.sanitizer.bypassSecurityTrustHtml(SVG_TRASH);
    this.svgFolder = this.sanitizer.bypassSecurityTrustHtml(SVG_FOLDER);
    this.svgEmpty  = this.sanitizer.bypassSecurityTrustHtml(SVG_EMPTY);
    this.svgSave   = this.sanitizer.bypassSecurityTrustHtml(SVG_SAVE);
    this.svgBell   = this.sanitizer.bypassSecurityTrustHtml(SVG_BELL);
    this.session   = this.auth.getSession();
    this.startClock();
    this.cargarContador();
    // ── Polling: actualiza el contador cada 30 s ──────────────────────────────
    this.pollInterval = setInterval(() => this.cargarContador(), 30_000);
    document.addEventListener('click', this.closeAll);
  }

  ngOnDestroy() {
    clearInterval(this.clockInterval);
    clearInterval(this.pollInterval);
    document.removeEventListener('click', this.closeAll);
  }

  closeAll = () => { this.notifOpen = false; this.profileOpen = false; };

  startClock() {
    const tick = () => {
      const now = new Date();
      const f = now.toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const h = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      this.fechaHora = `${f} — ${h}`;
    };
    tick();
    this.clockInterval = setInterval(tick, 1000);
  }

  async cargarContador() {
    try {
      const data: any = await this.api.get('/notificaciones/no-leidas');
      this.noLeidas = data.no_leidas ?? 0;
    } catch {}
  }

  async cargarNotificaciones() {
    this.loadingNotifs = true;
    try {
      this.notifs   = await this.api.get<Notif[]>('/notificaciones');
      this.noLeidas = this.notifs.filter(n => !n.leida).length;
    } catch {
    } finally {
      this.loadingNotifs = false;
    }
  }

  toggleNotif(e: Event) {
    e.stopPropagation();
    this.profileOpen = false;
    this.notifOpen   = !this.notifOpen;
    if (this.notifOpen) this.cargarNotificaciones();
  }

  toggleProfile(e: Event) {
    e.stopPropagation();
    this.notifOpen   = false;
    this.profileOpen = !this.profileOpen;
    if (this.profileOpen) {
      this.modRolActivo = 'operador';
      this.moduloActivo = 'gallinas';
      this.cargarPermisosAdmin();
    }
  }

  /**
   * Trae los permisos reales de todos los roles/modulos desde el backend
   * (GET /roles y GET /seguridad/permisos, ambos restringidos a Administrador)
   * y arma this.permisosPorRol / this.rolesId a partir de la respuesta.
   */
  async cargarPermisosAdmin() {
    this.loadingPermisos = true;
    this.errorPermisos   = null;
    try {
      const [roles, permisos] = await Promise.all([
        this.api.get<any[]>('/roles'),
        this.api.get<any[]>('/seguridad/permisos'),
      ]);

      const idPorNombre: Record<string, number> = {};
      for (const r of roles) idPorNombre[String(r.nombre).toLowerCase()] = r.id_rol;
      this.rolesId = {
        operador:   idPorNombre['operador']   ?? null,
        visitante: idPorNombre['visitante'] ?? null,
      };

      const nuevo = { operador: this.permisosVacios(), visitante: this.permisosVacios() };
      for (const p of permisos) {
        const nombreRol = String(p.rol?.nombre || '').toLowerCase() as 'operador' | 'visitante';
        if (nombreRol !== 'operador' && nombreRol !== 'visitante') continue;
        if (!MODULOS_CRUD.includes(p.modulo)) continue;
        nuevo[nombreRol][p.modulo as ModuloCrud] = {
          puede_ver: !!p.puede_ver,
          puede_crear: !!p.puede_crear,
          puede_editar: !!p.puede_editar,
          puede_eliminar: !!p.puede_eliminar,
          puede_descargar: !!p.puede_descargar,
        };
      }
      this.permisosPorRol = nuevo;
    } catch {
      this.errorPermisos = 'error';
    } finally {
      this.loadingPermisos = false;
    }
  }

  /**
   * Guarda todos los permisos (2 roles x 4 modulos) contra el backend real:
   * PATCH /seguridad/permisos/rol/:idRol/modulo/:modulo
   */
  async guardarPermisos() {
    this.guardandoPermisos = true;
    try {
      const llamadas: Promise<any>[] = [];
      (['operador', 'visitante'] as const).forEach((rol) => {
        const idRol = this.rolesId[rol];
        if (!idRol) return;
        MODULOS_CRUD.forEach((mod) => {
          const valores = this.permisosPorRol[rol][mod];
          llamadas.push(this.api.patch(`/seguridad/permisos/rol/${idRol}/modulo/${mod}`, valores));
        });
      });
      await Promise.all(llamadas);
      this.toast.success('Configuracion guardada');
      this.profileOpen = false;
    } catch {
      this.toast.warning('No se pudo guardar toda la configuracion, intenta de nuevo');
    } finally {
      this.guardandoPermisos = false;
    }
  }

  moduloLabel(mod: string): string { return MODULOS_LABELS[mod] || mod; }
  modIcon(mod: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(MOD_ICON[mod] || SVG_FOLDER);
  }

  async leerNotif(n: Notif) {
    if (!this.puedeGestionarNotifs) return;
    if (!n.leida) {
      n.leida       = true;
      this.noLeidas = this.notifs.filter(x => !x.leida).length;
      try { await this.api.patch(`/notificaciones/${n.id_notificacion}/leer`); } catch {}
    }
  }

  async leerTodas() {
    this.notifs.forEach(n => (n.leida = true));
    this.noLeidas = 0;
    this.toast.info('Todas marcadas como leidas');
    try { await this.api.patch('/notificaciones/leer-todas'); } catch {}
  }

  async borrarTodasLeidas() {
    const leidas = this.notifs.filter(n => n.leida);
    const ids    = leidas.map(n => n.id_notificacion);
    this.notifs  = this.notifs.filter(n => !n.leida);
    this.toast.warning(`${ids.length} notificacion(es) eliminada(s)`);
    // El backend hace borrado suave (marca "borrada" y conserva fecha_borrado),
    // por eso siguen apareciendo en el historial de Configuracion sin
    // necesidad de guardarlas tambien en localStorage.
    try { for (const id of ids) await this.api.delete(`/notificaciones/${id}`); } catch {}
  }

  async eliminarNotif(e: Event, n: Notif) {
    e.stopPropagation();
    if (!n.leida) return;
    this.notifs   = this.notifs.filter(x => x.id_notificacion !== n.id_notificacion);
    this.noLeidas = this.notifs.filter(x => !x.leida).length;
    try { await this.api.delete(`/notificaciones/${n.id_notificacion}`); } catch {}
  }

  // Clase css para el aro de color detras del icono, segun el tipo de notificacion
  // (coincide con .ni-icon-wrap.info / .alerta / .error en header.scss)
  tipoClass(tipo: Notif['tipo']): string {
    const map: Record<Notif['tipo'], string> = { Info: 'info', Alerta: 'alerta', Error: 'error' };
    return map[tipo] || 'info';
  }

  notifSvg(tipo: Notif['tipo']): SafeHtml {
    const map: Record<Notif['tipo'], string> = { Info: SVG_INFO, Alerta: SVG_WARN, Error: SVG_ERROR };
    return this.sanitizer.bypassSecurityTrustHtml(map[tipo] || SVG_INFO);
  }

  // Fecha relativa (hace X min / X h / X d) y, si ya paso mas de una semana, fecha corta
  fmtTime(fecha: string): string {
    const d = new Date(fecha);
    const diffMs  = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1)  return 'Ahora';
    if (diffMin < 60) return `Hace ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `Hace ${diffH} h`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `Hace ${diffD} d`;
    return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
  }
}
