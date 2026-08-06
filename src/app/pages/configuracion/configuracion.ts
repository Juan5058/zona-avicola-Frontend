import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfiguracionService } from './configuracion.service';
import { UsuariosComponent } from './usuarios/usuarios';
import { NotificacionesComponent } from './notificaciones/notificaciones';
import { GranjaComponent } from './granja/granja';
import { CatalogosComponent } from './catalogos/catalogos';
import { AuditoriaComponent } from './auditoria/auditoria';

@Component({
  selector: 'app-configuracion',
  standalone: true,
  imports: [
    CommonModule,
    UsuariosComponent,
    NotificacionesComponent,
    GranjaComponent,
    CatalogosComponent,
    AuditoriaComponent,
  ],
  templateUrl: './configuracion.html',
  styleUrl: './configuracion.scss',
  // Una sola instancia de ConfiguracionService para el host y sus 5 subcomponentes
  // de pestaña (comparten usuarios/roles, reglas/historial, granja, catálogos, auditoría).
  providers: [ConfiguracionService],
})
export class ConfiguracionComponent implements OnInit, OnDestroy {
  constructor(public svc: ConfiguracionService) {}

  ngOnInit() {
    this.svc.ngOnInit();
  }

  ngOnDestroy() {
    this.svc.ngOnDestroy();
  }
}
