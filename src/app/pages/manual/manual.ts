import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MOD_ICON, SVG_MOD_TIPS } from '../../components/shared/module-icons';
import { SVG_UI_SEARCH, SVG_UI_CLOSE } from '../../components/shared/ui-icons';

interface ManualStat {
  value: string;
  label: string;
}

interface ManualSeccion {
  icon: string;
  title: string;
  desc: string;
  color: string;
  gradient: string;
  items: string[];
  pasos?: string[];
  stats?: ManualStat[];
  tip?: string;
  badge?: string;
  badgeType?: string;
}

@Component({
  selector: 'app-manual',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manual.html',
  styleUrls: ['./manual.scss'],
})
export class ManualComponent {
  searchQuery = '';
  modalAbierto = false;
  seccionActiva: ManualSeccion | null = null;

  // Iconos SVG (reemplazan las lupas, la X y el bombillo en emoji)
  svgSearch!: SafeHtml;
  svgClose!: SafeHtml;
  svgTip!: SafeHtml;

  constructor(private sanitizer: DomSanitizer) {
    this.svgSearch = this.sanitizer.bypassSecurityTrustHtml(SVG_UI_SEARCH);
    this.svgClose  = this.sanitizer.bypassSecurityTrustHtml(SVG_UI_CLOSE);
    this.svgTip    = this.sanitizer.bypassSecurityTrustHtml(SVG_MOD_TIPS);
  }

  // Icono de modulo, mismo set que usan header y sidebar (mas los 3
  // extra: login, usuarios, tips, agregados a module-icons.ts para este componente)
  modIcon(id: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(MOD_ICON[id] || '');
  }

  // Fila 1: modulos principales (indices 0-3)
  get seccionesRow1(): ManualSeccion[] { return this.secciones.slice(0, 4); }
  // Fila 2: modulos secundarios (indices 4-7)
  get seccionesRow2(): ManualSeccion[] { return this.secciones.slice(4, 8); }
  // Fila 3: tips centrado (indice 8)
  get seccionesRow3(): ManualSeccion[] { return this.secciones.slice(8); }

  get seccionesFiltradas(): ManualSeccion[] {
    const q = this.searchQuery.toLowerCase().trim();
    if (!q) return this.secciones;
    return this.secciones.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.desc.toLowerCase().includes(q) ||
        s.items.some((i) => i.toLowerCase().includes(q))
    );
  }

  abrirModal(s: ManualSeccion) {
    this.seccionActiva = s;
    this.modalAbierto = true;
    document.body.style.overflow = 'hidden';
  }

  cerrarModal() {
    this.modalAbierto = false;
    this.seccionActiva = null;
    document.body.style.overflow = '';
  }

  secciones: ManualSeccion[] = [

    // ── Inicio de Sesión ────────────────────────────────────────────────────
    {
      icon: 'login',
      title: 'Inicio de Sesion',
      desc: 'Accede al sistema con tus credenciales o como visitante.',
      color: '#43a047',
      gradient: 'linear-gradient(135deg, #2e7d32 0%, #43a047 100%)',
      items: [
        'Ingresa tu nombre de usuario y contrasena',
        'El sistema detecta tu rol automaticamente (Admin, Operador, Visitante)',
        'Admin: acceso total a todos los modulos incluyendo Configuracion',
        'Operador: puede ingresar y consultar datos pero sin Configuracion',
        'Visitante: solo lectura — puede ver Dashboard, Reportes y Manual',
        'La sesion se guarda en sessionStorage con token JWT',
        'El boton "Entrar como Visitante" no requiere credenciales',
      ],
      pasos: [
        'Abre el navegador y accede a la URL del sistema',
        'Escribe tu nombre de usuario y contrasena',
        'Presiona "Iniciar Sesion" o Enter',
        'El sistema redirige automaticamente al Dashboard',
        'Para salir, usa el boton de cierre de sesion en el menu lateral',
      ],
      stats: [
        { value: '3', label: 'Roles' },
        { value: 'JWT', label: 'Auth' },
        { value: 'Session', label: 'Storage' },
      ],
      tip: 'Si olvidaste tu contrasena, pide al Administrador que la restablezca desde el modulo Configuracion > Usuarios.',
    },

    // ── Dashboard ───────────────────────────────────────────────────────────
    {
      icon: 'dashboard',
      title: 'Dashboard',
      desc: 'Panel central con los indicadores clave de la granja.',
      color: '#1976d2',
      gradient: 'linear-gradient(135deg, #1565c0 0%, #1976d2 100%)',
      items: [
        'Carrusel de 10 tarjetas KPI: huevos producidos hoy, lotes activos, ingresos, bajas, total clasificados, ventas de gallinas, consumo de alimento, tratamientos, promedio diario e inventario',
        'Filtro de periodo: Semana, Mes, Año — el estado se recuerda entre sesiones',
        'Grafica de barras con produccion diaria de huevos en el periodo',
        'Grafica donut con distribucion por categoria de calidad (JUMBO, AAA, AA, A, B, C)',
        'Los datos se actualizan al cambiar el filtro o recargar la pagina',
      ],
      pasos: [
        'Selecciona el periodo con los botones Semana / Mes / Ano',
        'Desliza el carrusel para navegar los 10 indicadores',
        'Consulta la grafica de barras para ver la tendencia de produccion',
        'Revisa el donut para ver la proporcion de cada categoria de calidad',
      ],
      stats: [
        { value: '10', label: 'KPIs' },
        { value: '3', label: 'Periodos' },
        { value: '2', label: 'Graficas' },
      ],
      tip: 'El periodo seleccionado se guarda automaticamente — la proxima vez que abras el Dashboard estara donde lo dejaste.',
    },

    // ── Gallinas ────────────────────────────────────────────────────────────
    {
      icon: 'gallinas',
      title: 'Gallinas',
      desc: 'Lotes, tratamientos medicos, mortalidad y ventas de aves.',
      color: '#f57c00',
      gradient: 'linear-gradient(135deg, #e65100 0%, #f57c00 60%, #ff9800 100%)',
      items: [
        'Pestana Lotes: crea y edita lotes con raza, galpon, cantidad inicial y estado (Activo, En cuarentena, Cerrado)',
        'Pestana Tratamientos: registra vacunaciones, desparasitaciones, antibioticos, vitaminas y revisiones generales con fecha de proxima dosis',
        'Pestana Mortalidad: registra bajas diarias eligiendo la causa desde el catalogo dinamico (Configuracion > Catalogos > Causas de mortalidad — ej. Enfermedad respiratoria, Newcastle, Depredador, Estres por calor, etc.)',
        'Pestana Ventas: registra ventas de aves con precio unitario, forma de pago y calculo automatico del total',
        'Cada lote muestra aves vivas actuales descontando bajas y ventas automaticamente',
        'Razas, galpones y causas de mortalidad se gestionan desde Configuracion > Catalogos',
      ],
      pasos: [
        'Crea un nuevo lote en la pestana Lotes indicando raza, galpon y cantidad',
        'Registra los tratamientos del lote en la pestana Tratamientos',
        'Anota la mortalidad diaria en la pestana Mortalidad con la causa correspondiente',
        'Cuando se realice una venta, registrala en la pestana Ventas',
      ],
      stats: [
        { value: '4', label: 'Pestanas' },
        { value: 'Auto', label: 'Calculo aves' },
        { value: '5', label: 'Tipos tratamiento' },
      ],
      tip: 'Mantener los lotes actualizados es clave — el Dashboard, Reportes y las notificaciones de mortalidad dependen de estos datos.',
    },

    // ── Clasificación ───────────────────────────────────────────────────────
    {
      icon: 'clasificacion',
      title: 'Clasificacion',
      desc: 'Clasifica huevos por categoria con modo manual o camara.',
      color: '#8e24aa',
      gradient: 'linear-gradient(135deg, #6a1b9a 0%, #8e24aa 100%)',
      badge: 'Camara',
      badgeType: 'camara',
      items: [
        'Modo Manual: ingresa el conteo por categoria usando el teclado o las flechas arriba/abajo',
        'Modo Automatico: la camara del dispositivo envia frames al servidor Python (localhost:8000) que detecta el peso y clasifica el huevo',
        'Categorias: JUMBO (>73g), AAA (63-73g), AA (53-63g), A (43-53g), B (33-43g), C (<33g)',
        'Campo de danados: registra huevos rotos o con defectos por separado',
        'Calculo automatico de panales completos (30 unidades) y sobrantes por categoria',
        'Jornadas: Manana y Tarde — se selecciona antes de clasificar',
        'Historial de registros con filtro por lote y fecha',
        'Enter en modo automatico dispara la captura instantanea',
      ],
      pasos: [
        'Selecciona el lote activo y la jornada (Manana o Tarde)',
        'Elige el modo: Manual para conteo directo o Automatico para usar la camara',
        'En modo Manual, ingresa la cantidad por cada categoria con el teclado',
        'En modo Automatico, asegurate de que el servidor Python este corriendo en localhost:8000',
        'Registra los danados en el campo correspondiente',
        'Guarda el registro — se agrega automaticamente al historial',
      ],
      stats: [
        { value: '6', label: 'Categorias' },
        { value: '2', label: 'Modos' },
        { value: '30', label: 'Huevos/panal' },
      ],
      tip: 'Para el modo automatico necesitas el servidor Python corriendo localmente. En modo manual puedes usar las flechas del teclado para ajustar cantidades rapidamente.',
    },

    // ── Inventario ──────────────────────────────────────────────────────────
    {
      icon: 'inventario',
      title: 'Inventario',
      desc: 'Control de insumos generales y gestion de alimentos.',
      color: '#00897b',
      gradient: 'linear-gradient(135deg, #00695c 0%, #00897b 100%)',
      items: [
        'Pestana General: productos con categoria, unidad, stock actual, stock minimo y alertas de nivel',
        'Estado Critico: stock igual o menor al minimo configurado',
        'Estado Atencion: stock menor a 1.5 veces el minimo (advertencia temprana)',
        'Ajuste de stock: registra entradas y salidas manuales con observacion',
        'Historial de salidas por producto',
        'Pestana Alimento: tipos de alimento con stock propio, minimo y consumo diario',
        'Categorias y unidades de medida configurables desde Configuracion > Catalogos',
        'KPIs en la parte superior: items criticos, en atencion, agotados y total de productos',
      ],
      pasos: [
        'Revisa los KPIs de alerta al abrir el modulo para ver el estado general',
        'En la pestana General, agrega o edita productos con su stock minimo',
        'Usa el boton de ajuste para registrar entradas o salidas de stock',
        'En la pestana Alimento, registra los tipos de alimento y su consumo diario',
        'Configura stock minimos reales para que las alertas sean utiles',
      ],
      stats: [
        { value: '2', label: 'Pestanas' },
        { value: 'x1.5', label: 'Factor atencion' },
        { value: 'Auto', label: 'Alertas' },
      ],
      tip: 'Configura siempre el stock minimo de cada producto. Sin ese valor, las alertas de nivel critico y atencion no funcionan.',
    },

    // ── Reportes ────────────────────────────────────────────────────────────
    {
      icon: 'reportes',
      title: 'Reportes',
      desc: 'Genera informes completos en PDF o Excel por modulo.',
      color: '#c62828',
      gradient: 'linear-gradient(135deg, #b71c1c 0%, #c62828 60%, #e53935 100%)',
      items: [
        'Informe Completo: consolida todos los modulos en un solo documento',
        'Produccion de Huevos: clasificacion por categoria con KPIs del periodo',
        'Estado de Lotes: aves, galpones y actividad por lote',
        'Salud y Tratamientos: mortalidad por causa y medicamentos aplicados',
        'Inventario de Alimentos: stock actual, minimos y alertas',
        'Ventas de Gallinas: ingresos y detalle de transacciones',
        'Filtros: tipo de reporte, lote especifico y rango de fechas personalizado',
        'Vista previa con KPIs y tabla de datos antes de descargar',
        'Descarga en PDF con encabezado de la granja o en Excel (.xlsx)',
        'Operador y Visitante necesitan el permiso "Descargar" activado en el modulo Reportes para poder bajar el PDF o Excel — si no lo tienen, los botones de descarga no aparecen',
      ],
      pasos: [
        'Selecciona el tipo de reporte en el panel izquierdo',
        'Ajusta los filtros: periodo (Semana/Mes/Ano/Personalizado) y lote si aplica',
        'Presiona "Generar Reporte" para ver la vista previa con KPIs',
        'Revisa los datos en la tabla de resultados',
        'Descarga en PDF (con datos de la granja del encabezado) o en Excel',
      ],
      stats: [
        { value: '6', label: 'Tipos' },
        { value: 'PDF', label: 'Formato 1' },
        { value: 'XLSX', label: 'Formato 2' },
      ],
      tip: 'Los datos del encabezado del PDF (nombre, NIT, ciudad) se configuran en Configuracion > Granja. Completalos antes de generar reportes oficiales. Para los roles Operador y Visitante, descargar PDF o Excel requiere que el Administrador les active el permiso "Descargar" del modulo Reportes.',
    },

    // ── Configuracion ───────────────────────────────────────────────────────
    {
      icon: 'configuracion',
      title: 'Configuracion',
      desc: 'Panel de administracion del sistema — solo Administrador.',
      color: '#2e7d32',
      gradient: 'linear-gradient(135deg, #1b5e20 0%, #2e7d32 100%)',
      badge: 'Solo Admin',
      badgeType: 'admin',
      items: [
        'Usuarios: crear, editar y desactivar cuentas — asignar rol (Admin, Operador, Visitante)',
        'Permisos por rol y modulo: el Administrador los edita desde su menu de perfil (arriba a la derecha, no dentro de Configuracion) — toggles de Ver / Crear / Editar / Eliminar / Descargar para los roles Operador y Visitante, en Gallinas, Clasificacion, Inventario, Reportes y Manual',
        'Notificaciones: 43 reglas de alerta organizadas por modulo con umbrales editables — historial de notificaciones con filtros y acciones masivas; el historial se limita automaticamente a las 100 mas recientes, las mas antiguas se purgan solas',
        'Granja: nombre, NIT, ciudad, telefono, correo y descripcion — aparece en el encabezado de los PDFs',
        'Catalogos: gestion global de las 8 listas del sistema (razas, galpones, causas de mortalidad, categorias de inventario, unidades de medida, tipos de alimento, proveedores, enfermedades) — todas conectadas a la base de datos',
        'Auditoria: historial completo de acciones con filtros por modulo, accion, usuario y fecha — comparacion antes/despues de cada cambio',
      ],
      pasos: [
        'Accede a Configuracion desde el menu lateral (solo visible para Administrador)',
        'Usa Usuarios para crear cuentas nuevas y asignar el rol correcto',
        'Para dar o quitar permisos finos (ej. que Operador pueda editar pero no eliminar), entra a tu menu de perfil y ajusta los toggles por modulo',
        'Completa los datos de Granja antes de generar reportes en PDF',
        'En Catalogos, agrega las razas, galpones y demas listas que usaras en el sistema',
        'Activa las reglas de Notificaciones que quieras monitorear',
        'Consulta Auditoria para revisar cualquier cambio realizado en el sistema',
      ],
      stats: [
        { value: '5', label: 'Submodulos' },
        { value: '43', label: 'Reglas notif.' },
        { value: '8', label: 'Catalogos' },
      ],
      tip: 'El modulo de Configuracion no es visible para roles Operador ni Visitante — solo aparece en el menu si la sesion activa es de Administrador. Los permisos finos por rol se administran aparte, desde el menu de perfil.',
    },

    // ── Usuarios ────────────────────────────────────────────────────────────
    {
      icon: 'usuarios',
      title: 'Usuarios',
      desc: 'Gestion de cuentas de acceso al sistema.',
      color: '#1565c0',
      gradient: 'linear-gradient(135deg, #0d47a1 0%, #1565c0 100%)',
      badge: 'Solo Admin',
      badgeType: 'admin',
      items: [
        'Acceso desde Configuracion > Usuarios (requiere rol Administrador)',
        'Lista de usuarios con busqueda por nombre, usuario o correo y filtro por rol',
        'Formulario de 2 columnas: datos a la izquierda, vista rapida de permisos del rol a la derecha (referencia general, no editable ahi)',
        'Roles disponibles: Administrador (acceso total, no se le puede restringir), Operador (sin Configuracion), Visitante (solo lectura — sin credenciales)',
        'Los permisos finos y editables de Operador y Visitante (Ver / Crear / Editar / Eliminar / Descargar por modulo) se ajustan aparte, desde el menu de perfil del Administrador — no desde este formulario',
        'Desactivar cuenta en vez de eliminarla — el historial de auditoria se mantiene',
        'No es posible desactivar la cuenta propia',
      ],
      pasos: [
        'Ve a Configuracion > Usuarios',
        'En la pestana "Nuevo usuario", completa nombre completo, usuario, rol y correo',
        'Selecciona el rol — el panel derecho muestra una vista general de lo que ese rol puede hacer',
        'Asigna una contrasena (minimo 6 caracteres) — Visitante no la necesita',
        'Guarda. El usuario ya puede iniciar sesion con esas credenciales',
        'Si necesitas ajustar permisos especificos de ese rol (ej. que no pueda eliminar en Inventario), hazlo desde tu menu de perfil, no desde aqui',
      ],
      stats: [
        { value: '3', label: 'Roles' },
        { value: '5', label: 'Modulos con permisos' },
        { value: 'Admin', label: 'Requiere' },
      ],
      tip: 'Usa el rol Visitante para personas que solo necesiten consultar datos (clientes, auditores externos) — no requiere contrasena propia. Los permisos de Operador y Visitante son los mismos para todas las cuentas de ese rol — no se configuran individualmente por persona.',
    },

    // ── Consejos Rapidos ────────────────────────────────────────────────────
    {
      icon: 'tips',
      title: 'Consejos Rapidos',
      desc: 'Tips para sacar el maximo provecho al sistema.',
      color: '#f9a825',
      gradient: 'linear-gradient(135deg, #f57f17 0%, #f9a825 100%)',
      badge: 'Tips',
      badgeType: 'nuevo',
      items: [
        'El menu lateral se puede colapsar para ganar mas espacio de trabajo',
        'En clasificacion, usa las flechas del teclado para ajustar cantidades y Enter para confirmar en modo automatico',
        'Configura los datos de la granja antes de generar el primer reporte PDF',
        'Agrega las razas y galpones en Catalogos antes de crear lotes en Gallinas',
        'El Dashboard recuerda el periodo seleccionado entre sesiones',
        'Las notificaciones del header se actualizan automaticamente — puedes marcarlas como leidas o borrarlas desde ahi',
        'En Auditoria puedes ver el "antes y despues" de cualquier cambio con el boton Ver',
        'Los catalogos (razas, galpones, etc.) se sincronizan entre Configuracion y los formularios de cada modulo',
      ],
      pasos: [
        'Flujo recomendado al iniciar: Configuracion > Granja, luego Catalogos, luego crear Lotes',
        'Para reportes oficiales: completa los datos de Granja primero',
        'Para monitoreo: activa las reglas de notificacion relevantes en Configuracion',
        'Para respaldo: exporta periódicamente desde Reportes en Excel',
      ],
      stats: [
        { value: '7', label: 'Modulos' },
        { value: '100%', label: 'Responsive' },
        { value: 'NestJS', label: 'Backend' },
      ],
      tip: 'El orden ideal para configurar el sistema por primera vez: 1) Datos de Granja, 2) Catalogos (razas y galpones), 3) Crear primer Lote, 4) Activar reglas de notificacion.',
    },
  ];
}