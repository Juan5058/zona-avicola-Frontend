import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { config } from '../config';

export interface UserSession {
  nombre: string;
  rol: 'admin' | 'operador' | 'visitante';
}

export interface PermisoModulo {
  modulo: string;
  puede_ver: boolean;
  puede_crear: boolean;
  puede_editar: boolean;
  puede_eliminar: boolean;
  puede_descargar: boolean;
}

const ROL_ACCESO: Record<string, string[]> = {
  admin:     ['dashboard', 'gallinas', 'clasificacion', 'inventario', 'reportes', 'manual', 'configuracion'],
  operador:  ['dashboard', 'gallinas', 'clasificacion', 'inventario', 'reportes', 'manual', 'configuracion'],
  visitante: ['dashboard', 'gallinas', 'clasificacion', 'inventario', 'reportes', 'manual'],
};

// Modulos sin control de permisos CRUD (siempre visibles para todos los usuarios autenticados).
const MODULOS_SIN_PERMISO = ['dashboard', 'manual'];

// Cache de los permisos reales del rol autenticado, traidos del backend en el login.
// Esto no es editable desde el cliente: se sobreescribe por completo cada vez
// que se inicia sesion con lo que responde la API.
const PERMISOS_BACKEND_KEY = 'za_permisos_backend';

@Injectable({ providedIn: 'root' })
export class AuthService {
  constructor(private router: Router) {}

  getToken(): string | null {
    return sessionStorage.getItem('za_token');
  }

  getSession(): UserSession | null {
    try {
      const s = sessionStorage.getItem('za_user');
      if (!s) return null;
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  isLoggedIn(): boolean {
    return !!this.getToken() && !!this.getSession();
  }

  /**
   * Consulta los permisos reales del rol del usuario autenticado
   * (GET /seguridad/permisos/mi-rol) y los cachea en sessionStorage.
   * Se llama siempre desde saveSession() y entrarComo(), asi que la cache
   * queda actualizada en cada inicio de sesion.
   */
  async refrescarPermisosBackend(token?: string): Promise<void> {
    const tok = token || this.getToken();
    if (!tok) return;
    try {
      const r = await fetch(`${config.apiUrl}/seguridad/permisos/mi-rol`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const data = await r.json();
      sessionStorage.setItem(PERMISOS_BACKEND_KEY, JSON.stringify(Array.isArray(data) ? data : []));
    } catch {
      sessionStorage.setItem(PERMISOS_BACKEND_KEY, JSON.stringify([]));
    }
  }

  private getPermisosBackend(): PermisoModulo[] {
    try {
      const raw = sessionStorage.getItem(PERMISOS_BACKEND_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private chequearPermiso(modulo: string, campo: keyof Omit<PermisoModulo, 'modulo'>): boolean {
    const ses = this.getSession();
    if (!ses) return false;
    if (ses.rol === 'admin') return true;
    const permiso = this.getPermisosBackend().find((p) => p.modulo === modulo);
    return Boolean(permiso?.[campo]);
  }

  async saveSession(token: string, usuario: string, rol: string): Promise<void> {
    const rolMap: Record<string, string> = {
      administrador: 'admin',
      operador:      'operador',
      visitante:     'visitante',
    };
    const rolFinal = rolMap[rol.toLowerCase()] || 'visitante';
    sessionStorage.setItem('za_token', token);
    sessionStorage.setItem('za_user', JSON.stringify({
      nombre: usuario,
      rol: rolFinal,
    }));
    await this.refrescarPermisosBackend(token);
    this.notificarEvento({
      titulo: 'Inicio de sesion',
      mensaje: `${usuario} inicio sesion como ${rolFinal}`,
      tipo: 'Info',
      modulo: 'General',
    }, token);
  }

  async entrarComo(): Promise<void> {
    const r = await fetch(`${config.apiUrl}/auth/acceso-publico`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await r.json();
    sessionStorage.setItem('za_token', data.access_token);
    sessionStorage.setItem('za_user', JSON.stringify({
      nombre: 'Visitante',
      rol: 'visitante',
    }));
    await this.refrescarPermisosBackend(data.access_token);
    this.notificarEvento({
      titulo: 'Inicio de sesion',
      mensaje: 'Visitante ingreso al sistema',
      tipo: 'Info',
      modulo: 'General',
    }, data.access_token);
  }

  logout(): void {
    const ses = this.getSession();
    const token = this.getToken();
    if (ses && token) {
      // Disparar la notificacion ANTES de limpiar la sesion, para que aun
      // se pueda mandar el token en el header de autorizacion.
      this.notificarEvento({
        titulo: 'Cierre de sesion',
        mensaje: `${ses.nombre} cerro sesion`,
        tipo: 'Info',
        modulo: 'General',
      }, token);
    }
    sessionStorage.clear();
    this.router.navigate(['/login']);
  }

  /**
   * Envia una notificacion de evento de sesion al backend. Si falla
   * (backend caido, sin conexion, etc) se guarda localmente para que no
   * se pierda — mismo patron que usa el modulo de Configuracion.
   */
  private notificarEvento(
    payload: { titulo: string; mensaje: string; tipo: 'Info' | 'Alerta' | 'Error'; modulo: string },
    token: string,
  ): void {
    fetch(`${config.apiUrl}/notificaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    }).catch(() => {
      try {
        const raw = localStorage.getItem('notif_historial');
        const lista: any[] = raw ? JSON.parse(raw) : [];
        lista.unshift({
          id_notificacion: Date.now(),
          ...payload,
          leida: false,
          fecha_creacion: new Date().toISOString(),
          fecha: new Date().toISOString(),
          _manual: true,
        });
        localStorage.setItem('notif_historial', JSON.stringify(lista));
      } catch { /* no se pudo persistir, se ignora */ }
    });
  }

  /**
   * Visibilidad de un modulo en el menu. Para 'admin' y para los modulos sin
   * control CRUD (dashboard, manual) se rige por ROL_ACCESO. Para el resto
   * (gallinas, clasificacion, inventario, reportes) se rige por el permiso
   * real puede_ver que trajo el backend en el login (tabla `permisos`).
   */
  puedeVerModulo(modId: string): boolean {
    const ses = this.getSession();
    if (!ses) return false;
    if (ses.rol === 'admin') return ROL_ACCESO['admin'].includes(modId);
    if (!ROL_ACCESO[ses.rol]?.includes(modId)) return false;
    if (MODULOS_SIN_PERMISO.includes(modId)) return true;
    return this.chequearPermiso(modId, 'puede_ver');
  }

  /**
   * Permisos reales por modulo, consultados al backend (GET /seguridad/permisos/mi-rol)
   * en el login y cacheados en sessionStorage. `modulo` debe ser uno de los que existen
   * en la tabla `permisos`: 'gallinas' | 'clasificacion' | 'inventario' | 'reportes'.
   */
  puedeVer(modulo: string): boolean {
    return this.chequearPermiso(modulo, 'puede_ver');
  }

  puedeCrear(modulo: string): boolean {
    return this.chequearPermiso(modulo, 'puede_crear');
  }

  puedeEditar(modulo: string): boolean {
    return this.chequearPermiso(modulo, 'puede_editar');
  }

  puedeEliminar(modulo: string): boolean {
    return this.chequearPermiso(modulo, 'puede_eliminar');
  }

  puedeDescargar(modulo: string): boolean {
    return this.chequearPermiso(modulo, 'puede_descargar');
  }

  authHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.getToken()}` };
  }
}
