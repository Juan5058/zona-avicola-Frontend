import { Component } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ConfiguracionService } from "../configuracion.service";

@Component({
  selector: "app-configuracion-usuarios",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./usuarios.html",
  styleUrl: "../configuracion.scss",
})
export class UsuariosComponent {
  constructor(public svc: ConfiguracionService) {}
}
