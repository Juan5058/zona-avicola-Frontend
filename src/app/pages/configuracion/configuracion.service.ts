import { Injectable, OnDestroy } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router, ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api';
import { ToastService } from '../../services/toast';
import { AuthService } from '../../services/auth';
import { SVG_UI_CLOSE } from '../../components/shared/ui-icons';
import { MOD_ICON } from '../../components/shared/module-icons';

// ─── Constantes ────────────────────────────────────────────────────────────────

const MODULOS = [
  { id: 'dashboard',     label: 'Dashboard' },
  { id: 'gallinas',      label: 'Gallinas' },
  { id: 'clasificacion', label: 'Clasificacion' },
  { id: 'inventario',    label: 'Inventario' },
  { id: 'reportes',      label: 'Reportes' },
  { id: 'manual',        label: 'Manual' },
  { id: 'configuracion', label: 'Configuracion' },
];

const ROL_DETALLE: Record<string, { nivel: string; desc: string; permisos: Record<string, string> }> = {
  Administrador: {
    nivel: 'Control Total',
    desc: 'Acceso completo a todos los modulos del sistema.',
    permisos: {
      dashboard: 'TOTAL', gallinas: 'TOTAL', clasificacion: 'TOTAL',
      inventario: 'TOTAL', reportes: 'TOTAL', manual: 'TOTAL', configuracion: 'TOTAL',
    },
  },
  Operador: {
    nivel: 'Control Parcial',
    desc: 'Puede ingresar y consultar datos. Sin acceso a Configuracion.',
    permisos: {
      dashboard: 'VER+INGRESAR', gallinas: 'VER+INGRESAR', clasificacion: 'VER+INGRESAR',
      inventario: 'VER+INGRESAR', reportes: 'VER+INGRESAR', manual: 'VER', configuracion: 'SIN ACCESO',
    },
  },
  Visitante: {
    nivel: 'Solo Lectura',
    desc: 'Solo visualizacion. No requiere credenciales de acceso.',
    permisos: {
      dashboard: 'VER', gallinas: 'VER', clasificacion: 'VER',
      inventario: 'VER', reportes: 'VER+DESCARGAR', manual: 'VER', configuracion: 'SIN ACCESO',
    },
  },
};

const ADMIN_ONLY_CARDS = ['usuarios', 'auditoria'];

const CARDS = [
  {
    id: 'usuarios',
    title: 'Usuarios',
    badge: 'CUENTAS',
    desc: 'Gestiona cuentas, roles y permisos.',
    color: '#2e7d32', colorDark: '#1b5e20',
    items: ['Crear y editar cuentas', 'Asignar roles', 'Activar / desactivar'],
    row: 1,
  },
  {
    id: 'notificaciones',
    title: 'Notificaciones',
    badge: 'ALERTAS',
    desc: 'Reglas de alertas y historial del sistema.',
    color: '#e65100', colorDark: '#bf360c',
    items: ['Reglas por modulo', 'Umbrales editables', 'Historial de eventos'],
    row: 1,
  },
  {
    id: 'granja',
    title: 'Granja',
    badge: 'INFO',
    desc: 'Datos generales para encabezados de reportes.',
    color: '#1565c0', colorDark: '#0d47a1',
    items: ['Nombre y NIT', 'Direccion y ciudad', 'Telefono y correo'],
    row: 1,
  },
  {
    id: 'catalogos',
    title: 'Catalogos',
    badge: 'LISTAS',
    desc: 'Tablas controladas agrupadas por modulo.',
    color: '#6a1b9a', colorDark: '#4a148c',
    items: ['Razas de gallinas', 'Categorias de inventario', 'Enfermedades y tratamientos', 'Galpones y proveedores'],
    row: 2,
  },
  {
    id: 'auditoria',
    title: 'Auditoria',
    badge: 'REGISTRO',
    desc: 'Historial de acciones con comparacion antes / despues.',
    color: '#00695c', colorDark: '#004d40',
    items: ['Filtrar por modulo y accion', 'Buscar por usuario y fecha', 'Diff antes / despues'],
    row: 2,
  },
];

// Color por módulo para las reglas de notificación
const MODULO_COLOR: Record<string, string> = {
  'Gallinas':       '#2e7d32',
  'Clasificacion':  '#1565c0',
  'Inventario':     '#6a1b9a',
  'Reportes':       '#00695c',
  'Usuarios':       '#e65100',
  'Configuracion':  '#37474f',
  'General':        '#546e7a',
};

// Version del catalogo de reglas — subir este numero cuando se agreguen/quiten reglas
// para que el navegador descarte automaticamente lo guardado en localStorage y tome las nuevas.
const REGLAS_VERSION = 3;

const REGLAS_DEFAULT = [
  // ══ GALLINAS — Lotes ══════════════════════════════════════════════════════════
  { id: 'lote_nuevo',               modulo: 'Gallinas',       severidad: 'info',    nombre: 'Nuevo lote registrado',                   desc: 'Se genera cuando se crea un nuevo lote en el sistema.',                                                              tieneUmbral: false, umbral: 0,    unidad: '',         activa: false },
  { id: 'lote_cuarentena',          modulo: 'Gallinas',       severidad: 'alerta',  nombre: 'Lote en cuarentena',                      desc: 'Se genera cuando el estado de un lote cambia a En cuarentena.',                                                     tieneUmbral: false, umbral: 0,    unidad: '',         activa: true  },
  { id: 'lote_agotado',             modulo: 'Gallinas',       severidad: 'critica', nombre: 'Lote sin aves vivas',                     desc: 'Se genera cuando las bajas acumuladas de un lote igualan o superan la cantidad inicial.',                            tieneUmbral: false, umbral: 0,    unidad: '',         activa: true  },
  { id: 'baja_masiva_lote',         modulo: 'Gallinas',       severidad: 'critica', nombre: 'Baja masiva en un registro',              desc: 'Alerta cuando la cantidad de aves en un solo registro de mortalidad supera el umbral.',                             tieneUmbral: true,  umbral: 10,   unidad: 'aves',     activa: true  },
  { id: 'mortalidad_alta',          modulo: 'Gallinas',       severidad: 'critica', nombre: 'Tasa de mortalidad elevada',              desc: 'Alerta cuando el porcentaje de bajas acumuladas de un lote supera el umbral.',                                       tieneUmbral: true,  umbral: 5,    unidad: '%',        activa: true  },

  // ══ GALLINAS — Tratamientos ════════════════════════════════════════════════════
  { id: 'proxima_dosis_vencida',    modulo: 'Gallinas',       severidad: 'critica', nombre: 'Proxima dosis ya vencida',                desc: 'Alerta cuando la fecha de proxima dosis de un tratamiento ya paso sin aplicarse.',                                    tieneUmbral: false, umbral: 0,    unidad: '',         activa: true  },
  { id: 'proxima_dosis_urgente',    modulo: 'Gallinas',       severidad: 'alerta',  nombre: 'Proxima dosis en menos de 3 dias',        desc: 'Alerta cuando una proxima dosis vence en 3 dias o menos.',                                                           tieneUmbral: false, umbral: 0,    unidad: '',         activa: true  },
  { id: 'lote_sin_tratamiento',     modulo: 'Gallinas',       severidad: 'alerta',  nombre: 'Lote activo sin tratamientos recientes',  desc: 'Alerta cuando un lote activo no registra ningun tratamiento en los ultimos N dias.',                                 tieneUmbral: true,  umbral: 30,   unidad: 'dias',     activa: false },

  // ══ GALLINAS — Ventas ══════════════════════════════════════════════════════════
  { id: 'venta_registrada',         modulo: 'Gallinas',       severidad: 'info',    nombre: 'Venta de gallinas registrada',            desc: 'Notifica cada vez que se registra una venta de gallinas en el sistema.',                                             tieneUmbral: false, umbral: 0,    unidad: '',         activa: false },
  { id: 'venta_alta',               modulo: 'Gallinas',       severidad: 'alerta',  nombre: 'Venta de alto volumen',                   desc: 'Alerta cuando la cantidad de aves en una venta supera el umbral.',                                                   tieneUmbral: true,  umbral: 100,  unidad: 'aves',     activa: false },

  // ══ CLASIFICACION ══════════════════════════════════════════════════════════════
  { id: 'sin_clasificacion',        modulo: 'Clasificacion',  severidad: 'alerta',  nombre: 'Dias consecutivos sin clasificar',        desc: 'Alerta cuando no hay registros de clasificacion en N dias seguidos.',                                                tieneUmbral: true,  umbral: 3,    unidad: 'dias',     activa: true  },
  { id: 'huevos_danados_alto',      modulo: 'Clasificacion',  severidad: 'alerta',  nombre: 'Porcentaje de huevos danados elevado',    desc: 'Alerta cuando el porcentaje de danados (rotos + descarte) en una jornada supera el umbral.',                         tieneUmbral: true,  umbral: 5,    unidad: '%',        activa: true  },
  { id: 'produccion_baja',          modulo: 'Clasificacion',  severidad: 'alerta',  nombre: 'Produccion diaria baja',                  desc: 'Alerta cuando el total de huevos clasificados en el dia cae por debajo del umbral.',                                 tieneUmbral: true,  umbral: 100,  unidad: 'huevos',   activa: false },
  { id: 'produccion_sin_jumbo',     modulo: 'Clasificacion',  severidad: 'info',    nombre: 'Sin produccion JUMBO en el dia',          desc: 'Notifica cuando la categoria JUMBO registra 0 unidades en una jornada.',                                            tieneUmbral: false, umbral: 0,    unidad: '',         activa: false },

  // ══ INVENTARIO — Stock general ══════════════════════════════════════════════════
  { id: 'stock_critico',            modulo: 'Inventario',     severidad: 'critica', nombre: 'Stock en nivel critico',                  desc: 'Alerta cuando el stock de un producto cae por debajo o igual a su stock minimo (estado Critico).',                   tieneUmbral: false, umbral: 0,    unidad: '',         activa: true  },
  { id: 'stock_atencion',           modulo: 'Inventario',     severidad: 'alerta',  nombre: 'Stock en nivel de atencion',              desc: 'Aviso cuando el stock de un producto esta entre el minimo y 1.5x el minimo (estado Atencion).',                      tieneUmbral: false, umbral: 0,    unidad: '',         activa: false },
  { id: 'stock_agotado',            modulo: 'Inventario',     severidad: 'critica', nombre: 'Producto agotado',                        desc: 'Alerta cuando el stock de un producto llega a cero.',                                                               tieneUmbral: false, umbral: 0,    unidad: '',         activa: true  },
  { id: 'sin_entradas_inventario',  modulo: 'Inventario',     severidad: 'alerta',  nombre: 'Sin entradas de inventario',              desc: 'Alerta cuando no se registran entradas de ningun producto en los ultimos N dias.',                                  tieneUmbral: true,  umbral: 15,   unidad: 'dias',     activa: false },
  { id: 'ajuste_stock_manual',      modulo: 'Inventario',     severidad: 'info',    nombre: 'Ajuste manual de stock',                  desc: 'Notifica cuando un usuario aplica un ajuste manual sobre el stock de un producto.',                                 tieneUmbral: false, umbral: 0,    unidad: '',         activa: false },

  // ══ INVENTARIO — Alimento ════════════════════════════════════════════════════════
  { id: 'alimento_stock_critico',   modulo: 'Inventario',     severidad: 'critica', nombre: 'Stock de alimento en nivel critico',      desc: 'Alerta cuando el stock de un alimento cae por debajo o igual a su minimo configurado.',                              tieneUmbral: false, umbral: 0,    unidad: '',         activa: true  },
  { id: 'alimento_stock_atencion',  modulo: 'Inventario',     severidad: 'alerta',  nombre: 'Stock de alimento en nivel de atencion',  desc: 'Aviso cuando el stock de un alimento esta entre el minimo y 1.5x el minimo.',                                       tieneUmbral: false, umbral: 0,    unidad: '',         activa: false },
  { id: 'alimento_sin_entradas',    modulo: 'Inventario',     severidad: 'alerta',  nombre: 'Sin entradas de alimento',                desc: 'Alerta cuando no se registran entradas de alimento en los ultimos N dias.',                                         tieneUmbral: true,  umbral: 7,    unidad: 'dias',     activa: false },
  { id: 'consumo_alimento_alto',    modulo: 'Inventario',     severidad: 'alerta',  nombre: 'Consumo de alimento elevado',             desc: 'Alerta cuando el consumo diario de alimento supera el umbral configurado.',                                         tieneUmbral: true,  umbral: 200,  unidad: 'kg',       activa: false },

  // ══ REPORTES ═══════════════════════════════════════════════════════════════════
  { id: 'reporte_pdf_generado',     modulo: 'Reportes',       severidad: 'info',    nombre: 'Reporte PDF generado',                    desc: 'Notifica cada vez que un usuario descarga un reporte PDF.',                                                         tieneUmbral: false, umbral: 0,    unidad: '',         activa: false },
  { id: 'reporte_excel_generado',   modulo: 'Reportes',       severidad: 'info',    nombre: 'Reporte Excel generado',                  desc: 'Notifica cada vez que un usuario descarga un reporte en formato Excel.',                                           tieneUmbral: false, umbral: 0,    unidad: '',         activa: false },

  // ══ USUARIOS ═══════════════════════════════════════════════════════════════════
  { id: 'nuevo_usuario',            modulo: 'Usuarios',       severidad: 'info',    nombre: 'Nuevo usuario registrado',                desc: 'Notifica cuando se crea una nueva cuenta en el sistema.',                                                           tieneUmbral: false, umbral: 0,    unidad: '',         activa: true  },
  { id: 'usuario_desactivado',      modulo: 'Usuarios',       severidad: 'alerta',  nombre: 'Usuario desactivado',                     desc: 'Notifica cuando se desactiva una cuenta de usuario.',                                                               tieneUmbral: false, umbral: 0,    unidad: '',         activa: true  },
  { id: 'login_fallido',            modulo: 'Usuarios',       severidad: 'critica', nombre: 'Intentos de acceso fallidos',             desc: 'Alerta cuando se registran N intentos de inicio de sesion fallidos en el mismo dia.',                               tieneUmbral: true,  umbral: 3,    unidad: 'intentos', activa: false },

  // ══ CONFIGURACION ════════════════════════════════════════════════════════════════
  { id: 'cambio_granja',            modulo: 'Configuracion',  severidad: 'info',    nombre: 'Datos de la granja modificados',          desc: 'Notifica cuando se actualizan los datos generales de la granja.',                                                   tieneUmbral: false, umbral: 0,    unidad: '',         activa: false },
  { id: 'cambio_catalogo',          modulo: 'Configuracion',  severidad: 'info',    nombre: 'Catalogo modificado',                     desc: 'Notifica cuando se agrega, edita o elimina un registro en cualquier catalogo del sistema.',                        tieneUmbral: false, umbral: 0,    unidad: '',         activa: false },
  { id: 'cambio_reglas_notif',      modulo: 'Configuracion',  severidad: 'info',    nombre: 'Reglas de notificacion actualizadas',     desc: 'Notifica cuando el administrador guarda cambios en las reglas de alerta.',                                          tieneUmbral: false, umbral: 0,    unidad: '',         activa: false },

  // ══ GENERAL — Sesion ═══════════════════════════════════════════════════════════
  { id: 'sesion_iniciada',          modulo: 'General',        severidad: 'info',    nombre: 'Inicio de sesion',                        desc: 'Notifica cada vez que un usuario inicia sesion en el sistema.',                                                     tieneUmbral: false, umbral: 0,    unidad: '',         activa: true  },
  { id: 'sesion_cerrada',           modulo: 'General',        severidad: 'info',    nombre: 'Cierre de sesion',                        desc: 'Notifica cada vez que un usuario cierra sesion en el sistema.',                                                     tieneUmbral: false, umbral: 0,    unidad: '',         activa: false },

  // ══ GENERAL — Acciones sobre registros (cualquier modulo) ═════════════════════
  { id: 'registro_creado',          modulo: 'General',        severidad: 'info',    nombre: 'Registro creado',                         desc: 'Notifica cuando se crea un registro nuevo en cualquier modulo (gallinas, inventario, etc).',                        tieneUmbral: false, umbral: 0,    unidad: '',         activa: false },
  { id: 'registro_editado',         modulo: 'General',        severidad: 'info',    nombre: 'Registro editado',                        desc: 'Notifica cuando se edita un registro existente en cualquier modulo.',                                               tieneUmbral: false, umbral: 0,    unidad: '',         activa: false },
  { id: 'registro_eliminado',       modulo: 'General',        severidad: 'alerta',  nombre: 'Registro eliminado',                      desc: 'Notifica cuando se elimina un registro en cualquier modulo. Accion irreversible.',                                  tieneUmbral: false, umbral: 0,    unidad: '',         activa: true  },

  // ══ GENERAL — Errores del sistema ══════════════════════════════════════════════
  { id: 'error_sistema',            modulo: 'General',        severidad: 'critica', nombre: 'Error del sistema',                       desc: 'Notifica cuando ocurre un error inesperado (ej: falla de conexion con el servidor).',                               tieneUmbral: false, umbral: 0,    unidad: '',         activa: true  },

  // ══ USUARIOS — Cuenta ══════════════════════════════════════════════════════════
  { id: 'usuario_password_cambiada', modulo: 'Usuarios',      severidad: 'alerta',  nombre: 'Contraseña cambiada',                     desc: 'Notifica cuando un usuario cambia su contraseña.',                                                                  tieneUmbral: false, umbral: 0,    unidad: '',         activa: true  },
  { id: 'usuario_rol_cambiado',      modulo: 'Usuarios',      severidad: 'alerta',  nombre: 'Rol de usuario cambiado',                 desc: 'Notifica cuando se modifica el rol asignado a un usuario.',                                                         tieneUmbral: false, umbral: 0,    unidad: '',         activa: true  },

  // ══ GALLINAS — Ciclo de vida ═══════════════════════════════════════════════════
  { id: 'lote_fin_ciclo',           modulo: 'Gallinas',       severidad: 'alerta',  nombre: 'Lote cerca de fin de ciclo',              desc: 'Alerta cuando un lote se acerca a la edad limite de produccion configurada.',                                       tieneUmbral: true,  umbral: 60,   unidad: 'semanas',  activa: false },

  // ══ INVENTARIO — Vencimientos ══════════════════════════════════════════════════
  { id: 'producto_por_vencer',      modulo: 'Inventario',     severidad: 'alerta',  nombre: 'Producto por vencer',                     desc: 'Alerta cuando un producto con fecha de vencimiento esta a N dias de vencerse.',                                     tieneUmbral: true,  umbral: 7,    unidad: 'dias',     activa: false },
  { id: 'producto_vencido',         modulo: 'Inventario',     severidad: 'critica', nombre: 'Producto vencido',                        desc: 'Alerta cuando un producto en inventario ya supero su fecha de vencimiento.',                                        tieneUmbral: false, umbral: 0,    unidad: '',         activa: false },

  // ══ CLASIFICACION — Calidad ════════════════════════════════════════════════════
  { id: 'huevos_rotos_alto',        modulo: 'Clasificacion',  severidad: 'alerta',  nombre: 'Porcentaje de huevos rotos elevado',      desc: 'Alerta cuando el porcentaje de huevos rotos en una jornada supera el umbral.',                                      tieneUmbral: true,  umbral: 5,    unidad: '%',        activa: false },
];

const CAT_TABLAS = [
  {
    id: 'razas',
    label: 'Razas de gallinas',
    modulo: 'Gallinas',
    endpoint: '/gallinas/razas',
    idField: 'id_raza',
    campos: [{ key: 'nombre', label: 'Nombre de raza' }],
    displayFn: (i: any) => i.nombre,
    lsKey: 'gallinasOpciones', lsField: 'razas',
  },
  {
    id: 'galpones',
    label: 'Galpones',
    modulo: 'Gallinas',
    endpoint: '/galpones',
    idField: 'id_galpon',
    campos: [{ key: 'nombre', label: 'Nombre' }, { key: 'capacidad', label: 'Capacidad' }],
    displayFn: (i: any) => `${i.nombre}${i.capacidad ? ' — cap. ' + i.capacidad : ''}`,
    lsKey: 'gallinasOpciones', lsField: 'galpones',
  },
  {
    id: 'causas_mortalidad',
    label: 'Causas de mortalidad',
    modulo: 'Gallinas',
    endpoint: '/sanidad/causas-mortalidad',
    idField: 'id_causa',
    campos: [{ key: 'nombre', label: 'Causa' }],
    displayFn: (i: any) => i.nombre,
    lsKey: 'gallinasOpciones', lsField: 'causasMort',
  },
  {
    id: 'categorias_inventario',
    label: 'Categorias de inventario',
    modulo: 'Inventario',
    endpoint: '/inventario/categorias',
    idField: 'id_categoria',
    campos: [{ key: 'nombre', label: 'Nombre de categoria' }],
    displayFn: (i: any) => i.nombre,
    lsKey: 'inventarioOpciones', lsField: 'categorias',
  },
  {
    id: 'unidades_medida',
    label: 'Unidades de medida',
    modulo: 'Inventario',
    endpoint: '/unidades',
    idField: 'id_unidad',
    campos: [{ key: 'nombre', label: 'Nombre' }, { key: 'abreviatura', label: 'Abrev.' }],
    displayFn: (i: any) => `${i.nombre}${i.abreviatura ? ' (' + i.abreviatura + ')' : ''}`,
    lsKey: 'inventarioOpciones', lsField: 'unidades',
  },
  {
    id: 'alimentos',
    label: 'Tipos de alimento',
    modulo: 'Inventario',
    endpoint: '/alimentos',
    idField: 'id_alimento',
    campos: [{ key: 'nombre', label: 'Nombre' }],
    displayFn: (i: any) => i.nombre,
    lsKey: null, lsField: null,
  },
  {
    id: 'proveedores',
    label: 'Proveedores',
    modulo: 'Inventario',
    endpoint: '/proveedores',
    idField: 'id_proveedor',
    campos: [{ key: 'nombre', label: 'Nombre' }, { key: 'contacto', label: 'Contacto' }],
    displayFn: (i: any) => `${i.nombre}${i.contacto ? ' — ' + i.contacto : ''}`,
    lsKey: null, lsField: null,
  },
  {
    id: 'enfermedades',
    label: 'Enfermedades',
    modulo: 'Salud',
    endpoint: '/enfermedades',
    idField: 'id_enfermedad',
    campos: [{ key: 'nombre', label: 'Nombre de enfermedad' }],
    displayFn: (i: any) => i.nombre,
    lsKey: null, lsField: null,
  },
];

// ─── Interfaces ────────────────────────────────────────────────────────────────

interface UsuarioForm {
  nombre_completo: string;
  nombre_usuario: string;
  email: string;
  contrasena: string;
  id_rol: number | '';
}

interface GranjaForm {
  nombre: string;
  nit: string;
  direccion: string;
  telefono: string;
  email: string;
  ciudad: string;
  descripcion: string;
}

interface AudFiltros {
  modulo: string;
  accion: string;
  usuario: string;
  desde: string;
  hasta: string;
}


// Estado y lógica de negocio de TODO el módulo Configuración (usuarios, notificaciones,
// granja, catálogos, auditoría), compartido entre el componente host (configuracion.ts)
// y sus 5 subcomponentes de pestaña. Se provee una única instancia por árbol de
// componentes gracias a `providers: [ConfiguracionService]` en ConfiguracionComponent.
@Injectable()
export class ConfiguracionService implements OnDestroy {

  // ── Sesion ────────────────────────────────────────────────────────────────
  isAdmin = false;
  sesNombre = '';
  svgClose: SafeHtml;

  // ── Tarjetas ──────────────────────────────────────────────────────────────
  cards = CARDS;
  get cardsRow1() {
    return CARDS.filter(c => c.row === 1 && (this.isAdmin || !ADMIN_ONLY_CARDS.includes(c.id)));
  }
  get cardsRow2() {
    return CARDS.filter(c => c.row === 2 && (this.isAdmin || !ADMIN_ONLY_CARDS.includes(c.id)));
  }
  activeCard: (typeof CARDS)[0] | null = null;

  // ── Usuarios ──────────────────────────────────────────────────────────────
  modulos = MODULOS;
  roles: any[] = [];
  rolesFormulario: any[] = [];
  users: any[] = [];
  usersFiltered: any[] = [];
  usrSearch = '';
  usrRolFilter: number | '' = '';
  stats: { admin: number; operador: number; visitante: number; activos: number } | null = null;
  usrTab: 'lista' | 'nuevo' = 'lista';
  form: UsuarioForm = this.newForm();
  editId: number | null = null;
  formTitle = 'Nuevo Usuario';
  showPass = false;
  permisoInfo: typeof ROL_DETALLE[string] | null = null;

  // ── Granja ────────────────────────────────────────────────────────────────
  granja: GranjaForm = this.granjaDefault();
  granjaGuardada = false;

  // ── Notificaciones ────────────────────────────────────────────────────────
  reglas: any[] = JSON.parse(JSON.stringify(REGLAS_DEFAULT));
  modulosReglas: string[] = [...new Set(REGLAS_DEFAULT.map(r => r.modulo))];
  moduloReglaActivo = '';
  severidadFiltro = '';          // '' | 'info' | 'alerta' | 'critica'
  reglaPage = 1;
  reglaPageSize = 15;
  notifTab: 'reglas' | 'historial' = 'reglas';
  historial: any[] = [];
  historialFiltradas: any[] = [];
  historialModulo = '';
  historialTipo = '';
  historialSoloNoLeidas = false;
  historialPage = 1;
  historialPageSize = 15;
  loadingHistorial = false;
  private notifPollInterval: any;

  get historialNoLeidas() { return this.historial.filter(n => !n.leida).length; }
  get historialPage_data() {
    const s = (this.historialPage - 1) * this.historialPageSize;
    return this.historialFiltradas.slice(s, s + this.historialPageSize);
  }
  get totalPagHistorial() {
    return Math.max(1, Math.ceil(this.historialFiltradas.length / this.historialPageSize));
  }

  // ── Catalogos ─────────────────────────────────────────────────────────────
  catTablas = CAT_TABLAS;
  catModulos: string[] = [...new Set(CAT_TABLAS.map(t => t.modulo))];
  catModuloFiltro = '';
  catTablaActiva: (typeof CAT_TABLAS[0]) | null = CAT_TABLAS[0];
  catItems: any[] = [];
  catNuevo: Record<string, string> = {};
  catConteos: { [key: string]: number | string | undefined } = {};
  loadingCat = false;
  catPage = 1;
  catPageSize = 10;

  get catPage_data(): any[] {
    const s = (this.catPage - 1) * this.catPageSize;
    return this.catItems.slice(s, s + this.catPageSize);
  }
  get totalPagCat(): number {
    return Math.max(1, Math.ceil(this.catItems.length / this.catPageSize));
  }
  onChangeCatSize(e: Event) {
    const val = parseInt((e.target as HTMLSelectElement).value, 10);
    if (val && val > 0) { this.catPageSize = +val; this.catPage = 1; }
  }
  onCustomSizeCat(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (!val || val < 1) return;
    this.catPageSize = +val; this.catPage = 1;
    (e.target as HTMLInputElement).value = '';
  }

  // ── Auditoria ─────────────────────────────────────────────────────────────
  audRegistros: any[] = [];
  audFiltradas: any[] = [];
  audModulos: string[] = [];
  audAcciones: string[] = [];
  audFiltros: AudFiltros = this.audFiltrosDefault();
  loadingAud = false;
  audModalOpen = false;
  audSelected: any = null;

  // ── Confirm ───────────────────────────────────────────────────────────────
  confirmVisible = false;
  confirmMsg = '';
  private confirmCb: (() => Promise<void>) | null = null;

  // ── Paginacion ────────────────────────────────────────────────────────────
  usrPage: number = 1;
  usrPageSize: number = 10;
  audPage: number = 1;
  audPageSize: number = 10;

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private auth: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private sanitizer: DomSanitizer,
  ) {
    this.svgClose = this.sanitizer.bypassSecurityTrustHtml(SVG_UI_CLOSE);
  }

  ngOnInit() {
    const ses = this.auth.getSession();
    this.isAdmin = ses?.rol === 'admin';
    this.sesNombre = ses?.nombre || '';
    this.cargarRoles().then(() => {
      this.cargarUsuarios();
      this.restaurarEstado(); // después de roles para que usuarios funcione
    });
    this.cargarGranja();
  }

  private restaurarEstado() {
    const cardId = this.route.snapshot.queryParamMap.get('sub');
    if (cardId) {
      if (ADMIN_ONLY_CARDS.includes(cardId) && !this.isAdmin) {
        // Acceso directo por URL a una seccion admin-only: se ignora y se limpia el query param.
        this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
        return;
      }
      const card = CARDS.find(c => c.id === cardId);
      if (card) this.openCard(card, true); // true = no re-escribir URL (ya está)
    }
  }

  ngOnDestroy() {
    this.detenerPollNotif();
  }

  // ─── Notificaciones: polling ─────────────────────────────────────────────────

  iniciarPollNotif() {
    this.detenerPollNotif();
    // Refresca el historial cada 30 segundos mientras el submodulo está abierto
    this.notifPollInterval = setInterval(() => {
      if (this.notifTab === 'historial') this.cargarHistorial(true);
    }, 30_000);
  }

  detenerPollNotif() {
    if (this.notifPollInterval) {
      clearInterval(this.notifPollInterval);
      this.notifPollInterval = null;
    }
  }

  // ─── Navegacion ─────────────────────────────────────────────────────────────

  openCard(card: (typeof CARDS)[0], skipNav = false) {
    if (ADMIN_ONLY_CARDS.includes(card.id) && !this.isAdmin) return;
    this.activeCard = card;
    if (!skipNav) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { sub: card.id },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
    this.usrTab = 'lista';
    this.notifTab = 'reglas';
    this.moduloReglaActivo = '';
    this.severidadFiltro = '';
    if (card.id === 'notificaciones') {
      this.cargarReglas();
      this.iniciarPollNotif();
    }
    if (card.id === 'catalogos') {
      this.catModuloFiltro = '';
      this.catTablaActiva = CAT_TABLAS[0];
      this.catNuevo = {};
      CAT_TABLAS[0].campos.forEach(c => (this.catNuevo[c.key] = ''));
      this.cargarTabla(CAT_TABLAS[0]);
      this.cargarConteos();
    }
    if (card.id === 'auditoria') this.cargarAuditoria();
  }

  closeCard() {
    this.activeCard = null;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { sub: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.detenerPollNotif();
  }

  private iconCache: Record<string, SafeHtml> = {};
  cardIcon(id: string): SafeHtml {
    if (!this.iconCache[id]) {
      this.iconCache[id] = this.sanitizer.bypassSecurityTrustHtml(MOD_ICON[id] ?? '');
    }
    return this.iconCache[id];
  }

  get catTablasFiltradas() {
    return this.catModuloFiltro
      ? this.catTablas.filter(t => t.modulo === this.catModuloFiltro)
      : this.catTablas;
  }

  // ─── Colores de módulo ───────────────────────────────────────────────────────

  moduloColor(modulo: string): string {
    return MODULO_COLOR[modulo] ?? '#546e7a';
  }

  // ─── Utilidades de formato ───────────────────────────────────────────────────

  fmtDate(d: string) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  fmtDateTime(d: string) {
    if (!d) return '—';
    return new Date(d).toLocaleString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  fmtRelativo(d: string): string {
    if (!d) return '—';
    const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
    if (diff < 60)    return `hace ${diff}s`;
    if (diff < 3600)  return `hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
    if (diff < 86400 * 7) return `hace ${Math.floor(diff / 86400)}d`;
    return this.fmtDate(d);
  }

  // ─── Usuarios ───────────────────────────────────────────────────────────────

  newForm(): UsuarioForm {
    return { nombre_completo: '', nombre_usuario: '', email: '', contrasena: '', id_rol: '' };
  }

  async cargarRoles() {
    try {
      this.roles = await this.api.get<any[]>('/roles');
      this.rolesFormulario = this.roles;
    } catch {
      this.toast.error('Error al cargar roles');
    }
  }

  async cargarUsuarios() {
    try {
      this.users = await this.api.get<any[]>('/usuarios');
      this.filterUsr();
      const cnt = (nombre: string) => this.users.filter(u => u.rol?.nombre === nombre).length;
      this.stats = {
        admin: cnt('Administrador'),
        operador: cnt('Operador'),
        visitante: cnt('Visitante'),
        activos: this.users.filter(u => u.activo).length,
      };
    } catch {
      this.toast.error('Error al cargar usuarios');
    }
  }

  filterUsr() {
    const q = this.usrSearch.trim().toLowerCase();
    this.usersFiltered = this.users.filter(u =>
      (!q || u.nombre_completo.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.nombre_usuario.toLowerCase().includes(q)) &&
      (!this.usrRolFilter || Number(u.rol?.id_rol) === Number(this.usrRolFilter))
    );
    this.usrPage = 1;
  }

  get usrPage_data(): any[] {
    const start = (+this.usrPage - 1) * +this.usrPageSize;
    return this.usersFiltered.slice(start, start + +this.usrPageSize);
  }
  get totalPagUsr(): number {
    return Math.max(1, Math.ceil(this.usersFiltered.length / this.usrPageSize));
  }

  getRolCls(nombre: string) {
    return ({ Administrador: 'badge-green', Operador: 'badge-blue', Visitante: 'badge-orange' } as Record<string, string>)[nombre] || 'badge-gray';
  }

  getIni(nombre: string) {
    return (nombre || '').split(' ').map((p: string) => p[0]).join('').toUpperCase().slice(0, 2);
  }

  getAvatarBg(nombre: string) {
    return ({ Administrador: '#e8f5e9', Operador: '#e3f2fd', Visitante: '#fff3e0' } as Record<string, string>)[nombre] || '#f5f5f5';
  }

  esYo(u: any) {
    return !!this.sesNombre && u.nombre_completo === this.sesNombre;
  }

  updatePermisos() {
    const rol = this.roles.find(r => Number(r.id_rol) === Number(this.form.id_rol));
    this.permisoInfo = rol ? (ROL_DETALLE[rol.nombre] ?? null) : null;
  }

  esVisitante(): boolean {
    const rol = this.roles.find(r => Number(r.id_rol) === Number(this.form.id_rol));
    return rol?.nombre === 'Visitante';
  }

  permisoCls(nivel: string) {
    if (nivel === 'TOTAL') return 'perm-full';
    if (nivel === 'VER+INGRESAR') return 'perm-edit';
    if (nivel === 'VER' || nivel === 'VER+DESCARGAR') return 'perm-view';
    return 'perm-none';
  }

  async guardarUsr() {
    const f = this.form;
    if (!f.nombre_completo.trim()) { this.toast.error('Ingresa el nombre completo'); return; }
    if (!f.nombre_usuario.trim())  { this.toast.error('Ingresa el nombre de usuario'); return; }
    if (!f.email.trim() || !f.email.includes('@')) { this.toast.error('Correo invalido'); return; }
    if (!f.id_rol) { this.toast.error('Selecciona un rol'); return; }
    // Visitante no requiere contraseña
    if (!this.esVisitante()) {
      if (!this.editId && !f.contrasena) { this.toast.error('Ingresa la contrasena'); return; }
      if (f.contrasena && f.contrasena.length < 6) { this.toast.error('La contrasena debe tener minimo 6 caracteres'); return; }
    }

    const body: Record<string, any> = {
      nombre_completo: f.nombre_completo.trim(),
      nombre_usuario:  f.nombre_usuario.trim(),
      email:           f.email.trim(),
      id_rol:          Number(f.id_rol),
    };
    if (f.contrasena && !this.esVisitante()) body['contrasena'] = f.contrasena;

    try {
      if (this.editId) {
        await this.api.patch(`/usuarios/${this.editId}`, body);
        this.toast.success('Usuario actualizado');
      } else {
        await this.api.post('/usuarios', body);
        this.toast.success('Usuario creado');
      }
      await this.cargarUsuarios();
      this.form = this.newForm();
      this.editId = null;
      this.formTitle = 'Nuevo Usuario';
      this.permisoInfo = null;
      this.usrTab = 'lista';
    } catch (e: any) {
      this.toast.error(e?.error?.message || e?.message || 'Error al guardar');
    }
  }

  editUsr(u: any) {
    this.form = {
      nombre_completo: u.nombre_completo,
      nombre_usuario:  u.nombre_usuario,
      email:           u.email,
      contrasena:      '',
      id_rol:          u.rol?.id_rol ?? '',
    };
    this.editId = u.id_usuario;
    this.formTitle = 'Editar Usuario';
    this.updatePermisos();
    this.usrTab = 'nuevo';
  }

  elimUsr(u: any) {
    if (this.esYo(u)) { this.toast.error('No puedes desactivar tu propia cuenta'); return; }
    this.confirmMsg = `Desactivar a <strong>${u.nombre_completo}</strong>?`;
    this.confirmCb = async () => {
      try {
        await this.api.delete(`/usuarios/${u.id_usuario}`);
        await this.cargarUsuarios();
        this.toast.warning('Usuario desactivado');
      } catch {
        this.toast.error('Error al desactivar');
      }
    };
    this.confirmVisible = true;
  }

  // ─── Granja ──────────────────────────────────────────────────────────────────

  granjaDefault(): GranjaForm {
    return { nombre: '', nit: '', direccion: '', telefono: '', email: '', ciudad: '', descripcion: '' };
  }

  async cargarGranja() {
    try {
      const data = await this.api.get<GranjaForm>('/configuracion/granja');
      if (data) this.granja = data;
    } catch {
      const saved = localStorage.getItem('cfg_granja');
      if (saved) {
        try { this.granja = JSON.parse(saved); } catch { /* ignore */ }
      }
    }
  }

  async guardarGranja() {
    if (!this.granja.nombre?.trim()) {
      this.toast.error('El nombre de la granja es obligatorio');
      return;
    }
    try {
      await this.api.post('/configuracion/granja', this.granja);
      this.granjaGuardada = true;
      this.toast.success('Datos de la granja guardados');
      setTimeout(() => (this.granjaGuardada = false), 3000);
    } catch {
      localStorage.setItem('cfg_granja', JSON.stringify(this.granja));
      this.granjaGuardada = true;
      this.toast.success('Guardado localmente');
      setTimeout(() => (this.granjaGuardada = false), 3000);
    }
  }

  granjaCompleta(): number {
    const campos = Object.values(this.granja).filter(v => String(v).trim() !== '');
    return Math.round((campos.length / 7) * 100);
  }

  // ─── Notificaciones — reglas ─────────────────────────────────────────────────

  async cargarReglas() {
    const versionGuardada = Number(localStorage.getItem('cfg_reglas_version') || 0);
    const catalogoDesactualizado = versionGuardada !== REGLAS_VERSION;

    let reglasGuardadas: any[] | null = null;
    try {
      const data = await this.api.get<any[]>('/configuracion/notificaciones');
      if (data?.length) reglasGuardadas = data;
    } catch { /* ignorar, intentar local */ }

    if (!reglasGuardadas) {
      const saved = localStorage.getItem('cfg_reglas');
      if (saved) {
        try { reglasGuardadas = JSON.parse(saved); } catch { /* ignore */ }
      }
    }

    // Si el catalogo cambio de version O lo guardado tiene menos reglas que
    // el catalogo actual (datos viejos/incompletos), se regenera desde
    // REGLAS_DEFAULT conservando los ajustes (activa/umbral) de lo que siga existiendo.
    const incompleto = !reglasGuardadas || reglasGuardadas.length < REGLAS_DEFAULT.length;

    if (incompleto || catalogoDesactualizado) {
      const porId = new Map((reglasGuardadas ?? []).map((r: any) => [r.id, r]));
      this.reglas = REGLAS_DEFAULT.map(def => {
        const previa = porId.get(def.id);
        return previa
          ? { ...def, activa: previa.activa ?? def.activa, umbral: previa.umbral ?? def.umbral, unidad: previa.unidad ?? def.unidad }
          : { ...def };
      });
      localStorage.setItem('cfg_reglas', JSON.stringify(this.reglas));
      localStorage.setItem('cfg_reglas_version', String(REGLAS_VERSION));
      // Sincronizar el backend tambien, para que no vuelva a quedar con datos incompletos
      try { await this.api.post('/configuracion/notificaciones', this.reglas); } catch { /* se sincroniza despues al guardar manualmente */ }
      return;
    }

    this.reglas = (reglasGuardadas as any[]).map((r: any) => {
      const def = REGLAS_DEFAULT.find(d => d.id === r.id);
      return { ...r, severidad: r.severidad ?? def?.severidad ?? 'info' };
    });
  }

  get reglasFiltradas() {
    return this.reglas.filter(r =>
      (!this.moduloReglaActivo || r.modulo === this.moduloReglaActivo) &&
      (!this.severidadFiltro   || r.severidad === this.severidadFiltro)
    );
  }

  get reglaPage_data() {
    const s = (this.reglaPage - 1) * this.reglaPageSize;
    return this.reglasFiltradas.slice(s, s + this.reglaPageSize);
  }
  get totalPagRegla() {
    return Math.max(1, Math.ceil(this.reglasFiltradas.length / this.reglaPageSize));
  }

  onChangeReglaSize(e: Event) {
    const val = parseInt((e.target as HTMLSelectElement).value, 10);
    if (val && val > 0) { this.reglaPageSize = +val; this.reglaPage = 1; }
  }

  onCustomSizeRegla(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (!val || val < 1) return;
    this.reglaPageSize = +val; this.reglaPage = 1;
    (e.target as HTMLInputElement).value = '';
  }

  get reglaStats() {
    return {
      total:    this.reglas.length,
      activas:  this.reglas.filter(r => r.activa).length,
      inactivas: this.reglas.filter(r => !r.activa).length,
      criticas: this.reglas.filter(r => r.severidad === 'critica' && r.activa).length,
      alertas:  this.reglas.filter(r => r.severidad === 'alerta'  && r.activa).length,
    };
  }

  severidadLabel(s: string): string {
    return ({ info: 'Info', alerta: 'Alerta', critica: 'Critica' } as any)[s] ?? s;
  }

  severidadClass(s: string): string {
    return ({ info: 'sev-info', alerta: 'sev-alerta', critica: 'sev-critica' } as any)[s] ?? 'sev-info';
  }

  activarTodas() {
    this.reglasFiltradas.forEach(r => (r.activa = true));
  }

  desactivarTodas() {
    this.reglasFiltradas.forEach(r => (r.activa = false));
  }

  async guardarReglas() {
    // Blindaje: si por alguna razon this.reglas quedo incompleto (carrera de
    // carga async, instancia recreada, etc), se completa con las que falten
    // del catalogo actual antes de guardar. Nunca se persiste menos de lo que
    // define REGLAS_DEFAULT.
    if (this.reglas.length < REGLAS_DEFAULT.length) {
      const existentes = new Set(this.reglas.map(r => r.id));
      const faltantes = REGLAS_DEFAULT.filter(def => !existentes.has(def.id)).map(def => ({ ...def }));
      this.reglas = [...this.reglas, ...faltantes];
    }
    // Guardar siempre en localStorage como fuente de verdad local
    localStorage.setItem('cfg_reglas', JSON.stringify(this.reglas));
    localStorage.setItem('cfg_reglas_version', String(REGLAS_VERSION));
    try {
      await this.api.post('/configuracion/notificaciones', this.reglas);
      this.toast.success('Reglas guardadas en el servidor');
    } catch {
      this.toast.success('Reglas guardadas localmente');
    }
  }

  // ─── Notificaciones — historial ──────────────────────────────────────────────

  onNotifTabChange(tab: 'reglas' | 'historial') {
    this.notifTab = tab;
    if (tab === 'historial') this.cargarHistorial();
  }

  async cargarHistorial(silencioso = false) {
    if (!silencioso) this.loadingHistorial = true;
    try {
      // El backend ya devuelve el historial completo (activas y borradas),
      // compartido entre todos los roles. Ya no hace falta mergear con
      // localStorage: las borradas desde el header quedan marcadas alla
      // mismo con "borrada: true" y "fecha_borrado".
      const data = await this.api.get<any[]>('/notificaciones/historial');
      this.historial = data.map(n => ({ ...n, _borrada: !!n.borrada }));
      this.filterHistorial();
    } catch {
      if (!silencioso) this.toast.error('Error al cargar historial');
    } finally {
      if (!silencioso) this.loadingHistorial = false;
    }
  }

  filterHistorial() {
    this.historialFiltradas = this.historial.filter(n =>
      (!this.historialModulo || n.modulo === this.historialModulo) &&
      (!this.historialTipo   || n.tipo   === this.historialTipo) &&
      (!this.historialSoloNoLeidas || !n.leida)
    );
    this.historialPage = 1;
  }

  tipoDotClass(tipo: string) {
    return ({ Info: 'dot-info', Alerta: 'dot-alerta', Error: 'dot-error' } as Record<string, string>)[tipo] || 'dot-info';
  }

  tipoBadgeClass(tipo: string) {
    return ({ Info: 'badge-notif-info', Alerta: 'badge-notif-alerta', Error: 'badge-notif-error' } as Record<string, string>)[tipo] || 'badge-notif-info';
  }

  async marcarLeida(n: any) {
    try {
      await this.api.patch(`/notificaciones/${n.id_notificacion}/leer`);
      n.leida = true;
      this.filterHistorial();
      this.toast.success('Marcada como leida');
    } catch {
      this.toast.error('Error al marcar como leida');
    }
  }

  async marcarTodasLeidas() {
    const noLeidas = this.historial.filter(n => !n.leida);
    if (!noLeidas.length) return;
    try {
      await this.api.patch('/notificaciones/leer-todas');
      this.historial.forEach(n => (n.leida = true));
      this.filterHistorial();
      this.toast.success('Todas marcadas como leidas');
    } catch {
      this.toast.error('Error al marcar todas');
    }
  }

  eliminarNotif(n: any) {
    this.confirmMsg = `Eliminar la notificacion <strong>${n.titulo || 'sin titulo'}</strong>?`;
    this.confirmCb = async () => {
      try {
        await this.api.delete(`/notificaciones/${n.id_notificacion}`);
        // Borrado suave en el backend: sigue en el historial marcada
        // como borrada. Recargamos para reflejar el estado real.
        await this.cargarHistorial(true);
        this.toast.warning('Notificacion eliminada del panel (sigue en historial)');
      } catch {
        this.toast.error('Error al eliminar');
      }
    };
    this.confirmVisible = true;
  }

  eliminarTodasLeidas() {
    const leidas = this.historial.filter(n => n.leida && !n.borrada);
    if (!leidas.length) { this.toast.info('No hay notificaciones leidas'); return; }
    this.confirmMsg = `Eliminar <strong>${leidas.length}</strong> notificacion(es) leidas?`;
    this.confirmCb = async () => {
      try {
        for (const n of leidas) {
          await this.api.delete(`/notificaciones/${n.id_notificacion}`);
        }
        await this.cargarHistorial(true);
        this.toast.warning(`${leidas.length} notificaciones eliminadas`);
      } catch {
        this.toast.error('Error al eliminar');
      }
    };
    this.confirmVisible = true;
  }

  // ─── Notificacion manual ─────────────────────────────────────────────────────

  historialStats() {
    return {
      total: this.historial.length,
      noLeidas: this.historialNoLeidas,
      leidas: this.historial.length - this.historialNoLeidas,
      info:    this.historial.filter(n => n.tipo === 'Info').length,
      alertas: this.historial.filter(n => n.tipo === 'Alerta').length,
      errores: this.historial.filter(n => n.tipo === 'Error').length,
    };
  }

  nuevaNotifOpen = false;
  nuevaNotif = this.notifBlank();

  notifBlank() {
    return {
      titulo: '',
      modulo: 'Configuracion',
      mensaje: '',
    };
  }

  abrirNuevaNotif() {
    this.nuevaNotif = this.notifBlank();
    this.nuevaNotifOpen = true;
  }

  cerrarNuevaNotif() {
    this.nuevaNotifOpen = false;
  }

  async guardarNuevaNotif() {
    if (!this.nuevaNotif.titulo.trim()) {
      this.toast.error('Escribe un nombre para la notificacion');
      return;
    }
    try {
      // NOTA: el backend (NotificacionesController) todavia no tiene un
      // endpoint POST /notificaciones — este intento va a fallar hasta que
      // se agregue. Cuando exista, esto va a recargar el historial real.
      await this.api.post('/notificaciones', {
        titulo: this.nuevaNotif.titulo,
        mensaje: this.nuevaNotif.mensaje || this.nuevaNotif.titulo,
        tipo: 'Info',
        modulo: this.nuevaNotif.modulo,
      });
      await this.cargarHistorial(true);
      this.nuevaNotifOpen = false;
      this.toast.success('Notificacion creada');
    } catch {
      this.toast.error('No se pudo crear la notificacion (falta el endpoint en el backend)');
    }
  }

  // ─── Paginacion historial por página ─────────────────────────────────────────

  onChangeHistorialSize(e: Event) {
    const val = parseInt((e.target as HTMLSelectElement).value, 10);
    if (val && val > 0) { this.historialPageSize = +val; this.historialPage = 1; }
  }

  onCustomSizeHistorial(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (!val || val < 1) return;
    this.historialPageSize = +val; this.historialPage = 1;
    (e.target as HTMLInputElement).value = '';
  }


  eliminarReglaPersonalizada(regla: any) {
    this.confirmMsg = `Eliminar la regla <strong>${regla.nombre}</strong>?`;
    this.confirmCb = async () => {
      this.reglas = this.reglas.filter(r => r.id !== regla.id);
      this.toast.warning('Regla eliminada — guarda los cambios');
    };
    this.confirmVisible = true;
  }

  // ─── Catalogos ───────────────────────────────────────────────────────────────

  seleccionarTabla(tabla: any) {
    this.catTablaActiva = tabla;
    this.catNuevo = {};
    this.catPage = 1;
    tabla.campos.forEach((c: any) => (this.catNuevo[c.key] = ''));
    this.cargarTabla(tabla);
  }

  async cargarTabla(tabla: any) {
    this.loadingCat = true;
    try {
      if (tabla.endpoint) {
        const data: any[] = await this.api.get(tabla.endpoint);
        this.catItems = data.map(item => ({
          ...item,
          _id:      item[tabla.idField],
          display:  tabla.displayFn(item),
          editing:  false,
          editVals: { ...item },
        }));
      } else {
        this.catItems = this.leerItemsLocales(tabla).map((nombre: string, idx: number) => ({
          _id:      idx,
          nombre,
          display:  nombre,
          editing:  false,
          editVals: { nombre },
        }));
      }
    } catch {
      this.toast.error('Error al cargar ' + tabla.label);
    } finally {
      this.loadingCat = false;
    }
  }

  leerItemsLocales(tabla: any): string[] {
    if (!tabla.lsKey || !tabla.lsField) return [];
    try {
      const raw = localStorage.getItem(tabla.lsKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return parsed[tabla.lsField] ?? [];
    } catch { return []; }
  }

  guardarItemsLocales(tabla: any, items: string[]) {
    if (!tabla.lsKey || !tabla.lsField) return;
    try {
      const raw = localStorage.getItem(tabla.lsKey);
      const parsed = raw ? JSON.parse(raw) : {};
      parsed[tabla.lsField] = items;
      localStorage.setItem(tabla.lsKey, JSON.stringify(parsed));
    } catch { /* ignore */ }
  }

  async cargarConteos() {
    for (const tabla of this.catTablas) {
      try {
        if (tabla.endpoint) {
          const data: any[] = await this.api.get(tabla.endpoint);
          this.catConteos[tabla.id] = data.length;
        } else {
          this.catConteos[tabla.id] = this.leerItemsLocales(tabla).length;
        }
      } catch {
        this.catConteos[tabla.id] = '—';
      }
    }
  }

  async agregarCat() {
    const tabla = this.catTablaActiva;
    if (!tabla) return;
    const body: Record<string, string> = {};
    for (const campo of tabla.campos) {
      const val = this.catNuevo[campo.key]?.trim();
      if (!val) { this.toast.error(`Ingresa ${campo.label}`); return; }
      body[campo.key] = val;
    }
    try {
      if (tabla.endpoint) {
        const nuevo: any = await this.api.post(tabla.endpoint, body);
        this.catItems.push({
          ...nuevo,
          _id:      nuevo[tabla.idField],
          display:  tabla.displayFn(nuevo),
          editing:  false,
          editVals: { ...nuevo },
        });
      } else {
        const nombre = body['nombre'];
        const items = this.leerItemsLocales(tabla);
        if (items.includes(nombre)) { this.toast.error('Ya existe'); return; }
        items.push(nombre);
        this.guardarItemsLocales(tabla, items);
        const newIdx = this.catItems.length;
        this.catItems.push({ _id: newIdx, nombre, display: nombre, editing: false, editVals: { nombre } });
      }
      tabla.campos.forEach((c: any) => (this.catNuevo[c.key] = ''));
      this.catConteos[tabla.id] = (Number(this.catConteos[tabla.id]) || 0) + 1;
      this.toast.success('Registro agregado');
    } catch {
      this.toast.error('Error al agregar');
    }
  }

  editarCat(item: any) {
    item.editing  = true;
    item.editVals = { ...item };
  }

  async guardarEditCat(item: any) {
    const tabla = this.catTablaActiva;
    if (!tabla) return;
    const body: Record<string, string> = {};
    tabla.campos.forEach((c: any) => (body[c.key] = item.editVals[c.key]));
    try {
      if (tabla.endpoint) {
        await this.api.patch(`${tabla.endpoint}/${item._id}`, body);
      } else {
        const items = this.leerItemsLocales(tabla);
        const idx = items.indexOf(item.nombre);
        if (idx > -1) { items[idx] = body['nombre']; this.guardarItemsLocales(tabla, items); }
      }
      tabla.campos.forEach((c: any) => (item[c.key] = item.editVals[c.key]));
      item.display = tabla.displayFn(item);
      item.editing = false;
      this.toast.success('Actualizado');
    } catch {
      this.toast.error('Error al actualizar');
    }
  }

  eliminarCat(item: any) {
    const tabla = this.catTablaActiva;
    if (!tabla) return;
    this.confirmMsg = `Eliminar <strong>${item.display}</strong>?`;
    this.confirmCb = async () => {
      try {
        if (tabla.endpoint) {
          await this.api.delete(`${tabla.endpoint}/${item._id}`);
        } else {
          const items = this.leerItemsLocales(tabla).filter((n: string) => n !== item.nombre);
          this.guardarItemsLocales(tabla, items);
        }
        this.catItems = this.catItems.filter(i => i._id !== item._id);
        this.catConteos[tabla.id] = Math.max(0, Number(this.catConteos[tabla.id] ?? 1) - 1);
        this.toast.warning('Eliminado');
      } catch (e: any) {
        this.toast.error(this.extraerMensajeError(e, 'Error al eliminar'));
      }
    };
    this.confirmVisible = true;
  }

  /**
   * ApiService lanza `new Error(await r.text())`, donde el texto es el cuerpo
   * JSON del error de NestJS (ej. { message: "No se puede eliminar..." }).
   * Esto intenta extraer ese mensaje real para mostrarlo en el toast, en vez
   * de un genérico que oculta la razón real (ej. una llave foránea en uso).
   */
  private extraerMensajeError(e: any, fallback: string): string {
    try {
      const parsed = JSON.parse(e?.message ?? '');
      if (typeof parsed?.message === 'string') return parsed.message;
      if (Array.isArray(parsed?.message)) return parsed.message.join(', ');
    } catch {
      /* el texto no era JSON, se usa el fallback */
    }
    return fallback;
  }

  // ─── Auditoria ───────────────────────────────────────────────────────────────

  audFiltrosDefault(): AudFiltros {
    return { modulo: '', accion: '', usuario: '', desde: '', hasta: '' };
  }

  async cargarAuditoria() {
    this.loadingAud = true;
    try {
      const data: any[] = await this.api.get('/auditoria');
      this.audRegistros = data.sort(
        (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
      );
      this.audModulos  = [...new Set(data.map(r => r.modulo).filter(Boolean))].sort() as string[];
      this.audAcciones = [...new Set(data.map(r => r.accion).filter(Boolean))].sort() as string[];
      this.filterAud();
    } catch {
      this.toast.error('Error al cargar auditoria');
    } finally {
      this.loadingAud = false;
    }
  }

  filterAud() {
    const f = this.audFiltros;
    this.audFiltradas = this.audRegistros.filter(r => {
      if (f.modulo  && r.modulo  !== f.modulo)  return false;
      if (f.accion  && r.accion  !== f.accion)  return false;
      if (f.usuario && !r.usuario?.nombre_usuario?.toLowerCase().includes(f.usuario.toLowerCase())) return false;
      if (f.desde && new Date(r.fecha) < new Date(f.desde + 'T00:00:00')) return false;
      if (f.hasta && new Date(r.fecha) > new Date(f.hasta + 'T23:59:59')) return false;
      return true;
    });
    this.audPage = 1;
  }

  get audPage_data(): any[] {
    const start = (+this.audPage - 1) * +this.audPageSize;
    return this.audFiltradas.slice(start, start + +this.audPageSize);
  }
  get totalPagAud(): number {
    return Math.max(1, Math.ceil(this.audFiltradas.length / this.audPageSize));
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

  onCustomSizeUsr(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (!val || val < 1) return;
    this.usrPageSize = +val; this.usrPage = 1;
    (e.target as HTMLInputElement).value = '';
  }
  onCustomSizeAud(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (!val || val < 1) return;
    this.audPageSize = +val; this.audPage = 1;
    (e.target as HTMLInputElement).value = '';
  }
  onChangeUsrSize(e: Event) {
    const val = parseInt((e.target as HTMLSelectElement).value, 10);
    if (val && val > 0) { this.usrPageSize = +val; this.usrPage = 1; }
  }
  onChangeAudSize(e: Event) {
    const val = parseInt((e.target as HTMLSelectElement).value, 10);
    if (val && val > 0) { this.audPageSize = +val; this.audPage = 1; }
  }

  limpiarAud() {
    this.audFiltros = this.audFiltrosDefault();
    this.filterAud();
  }

  verDetalleAud(r: any) {
    this.audSelected = r;
    this.audModalOpen = true;
  }

  audTieneDiff(): boolean {
    return !!(this.audSelected?.detalle?.antes || this.audSelected?.detalle?.despues);
  }

  audTieneDatos(): boolean {
    return !!(this.audSelected?.detalle && !this.audTieneDiff());
  }

  accionClass(accion: string) {
    return ({
      CREAR:    'badge-crear',
      EDITAR:   'badge-editar',
      ELIMINAR: 'badge-eliminar',
      LOGIN:    'badge-login',
    } as Record<string, string>)[accion] || 'badge-otro';
  }

  rolClass(rol: string) {
    return ({
      Administrador: 'badge-green',
      Operador:      'badge-blue',
      Visitante:     'badge-orange',
    } as Record<string, string>)[rol] || 'badge-gray';
  }

  getKeys(o: any): string[] {
    return o && typeof o === 'object' ? Object.keys(o) : [];
  }

  fmt(v: any): string {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  hasChanged(k: string): boolean {
    const d = this.audSelected?.detalle;
    if (!d?.antes || !d?.despues) return false;
    return JSON.stringify(d.antes[k]) !== JSON.stringify(d.despues[k]);
  }

  // ─── Confirm ─────────────────────────────────────────────────────────────────

  confirmYes() {
    this.confirmVisible = false;
    if (this.confirmCb) { this.confirmCb(); this.confirmCb = null; }
  }

  confirmNo() {
    this.confirmVisible = false;
    this.confirmCb = null;
  }
}
