// componente sidebar
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AuthService } from '../../services/auth';
import { SidebarStateService } from '../../services/sidebar-state';
import { MOD_ICON } from '../shared/module-icons';

interface NavItem {
  id: string;
  label: string;
  route: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard',      label: 'Dashboard',      route: '/dashboard' },
  { id: 'gallinas',       label: 'Gallinas',       route: '/gallinas' },
  { id: 'clasificacion',  label: 'Clasificacion',  route: '/clasificacion' },
  { id: 'inventario',     label: 'Inventario',     route: '/inventario' },
  { id: 'reportes',       label: 'Reportes',       route: '/reportes' },
  { id: 'manual',         label: 'Manual',         route: '/manual' },
  { id: 'configuracion',  label: 'Configuracion',  route: '/configuracion' },
];

// Ícono de puerta para "Cerrar sesión" (antes emoji 🚪). Se queda local a este
// componente porque, a diferencia de los íconos de módulo, no lo usa nadie más.
const SVG_DOOR = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.html',
})
export class SidebarComponent implements OnInit {
  mobileOpen      = false;
  showLogoutModal = false;
  navItems: NavItem[] = [];

  svgDoor!: SafeHtml;

  constructor(
    private auth: AuthService,
    private sanitizer: DomSanitizer,
    public sidebarState: SidebarStateService,
  ) {}

  ngOnInit() {
    this.svgDoor = this.sanitizer.bypassSecurityTrustHtml(SVG_DOOR);

    // filtrar items segun rol
    this.navItems = NAV_ITEMS.filter((i) => this.auth.puedeVerModulo(i.id));
    const saved = localStorage.getItem('za_sidebar');
    if (saved === 'collapsed') this.sidebarState.set(true);
  }

  navIcon(id: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(MOD_ICON[id] || '');
  }

  toggleSidebar() {
    this.sidebarState.toggle();
    localStorage.setItem('za_sidebar', this.sidebarState.collapsed() ? 'collapsed' : 'open');
  }

  openMobile()  { this.mobileOpen = true; }
  closeMobile() { this.mobileOpen = false; }

  // modal logout
  confirmarLogout() { this.showLogoutModal = true; }
  cancelarLogout()  { this.showLogoutModal = false; }
  confirmarSalir()  { this.auth.logout(); }
}
