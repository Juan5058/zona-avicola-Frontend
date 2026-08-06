import { Component } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ConfiguracionService } from "../configuracion.service";

@Component({
  selector: "app-configuracion-granja",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./granja.html",
  styleUrl: "../configuracion.scss",
})
export class GranjaComponent {
  constructor(public svc: ConfiguracionService) {}
}
