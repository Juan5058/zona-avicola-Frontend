import { Component } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ConfiguracionService } from "../configuracion.service";

@Component({
  selector: "app-configuracion-notificaciones",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./notificaciones.html",
  styleUrl: "../configuracion.scss",
})
export class NotificacionesComponent {
  constructor(public svc: ConfiguracionService) {}
}
