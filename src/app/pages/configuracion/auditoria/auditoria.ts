import { Component } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ConfiguracionService } from "../configuracion.service";

@Component({
  selector: "app-configuracion-auditoria",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./auditoria.html",
  styleUrl: "../configuracion.scss",
})
export class AuditoriaComponent {
  constructor(public svc: ConfiguracionService) {}
}
